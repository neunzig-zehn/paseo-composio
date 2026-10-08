import type { PluginTimelineData } from "@getpaseo/plugin";
import { z } from "zod";

export const callKind = "composio-call";
export const callVersion = 1;

// Pass-through: Paseo validates renderer data on every render, so payloads are not walked.
const payload = z.custom<PluginTimelineData>();

export const callData = z.object({
  /** Composio meta tool without its prefix, such as `MULTI_EXECUTE_TOOL`. */
  tool: z.string(),
  /** App tools the call runs or reads, in call order, such as `GMAIL_SEND_EMAIL`. */
  toolSlugs: z.array(z.string()),
  /** Apps the call names directly, in call order, such as `gmail`. */
  toolkits: z.array(z.string()),
  action: z.string().nullable(),
  summary: z.string().nullable(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  error: z.string().nullable(),
  input: payload,
  output: payload,
});
export type CallData = z.output<typeof callData>;
export type CallStatus = CallData["status"];

export interface ToolCallLike {
  name: string;
  status: CallStatus;
  error: unknown;
  detail: { type: string; input?: unknown; output?: unknown };
}

// Claude: mcp__composio__COMPOSIO_X. Codex: paseo_composio.COMPOSIO_X or composio.COMPOSIO_X.
const namePattern = /composio(?:__|[._])COMPOSIO_([A-Z][A-Z_]*)$/;

const text = z.string().min(1);
const optionalText = text.optional().catch(undefined);

/** Keeps the entries that match; a streaming or odd input never hides the whole row. */
function list<Item extends z.ZodType>(item: Item) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = item.safeParse(entry);
        return parsed.success ? [parsed.data as z.output<Item>] : [];
      }),
    );
}

const connectionEntry = z.union([text, z.object({ name: text, action: optionalText })]);

const inputs = {
  MULTI_EXECUTE_TOOL: z.object({
    tools: list(
      z.object({ tool_slug: text, arguments: z.unknown().optional(), account: optionalText }),
    ),
  }),
  GET_TOOL_SCHEMAS: z.object({ tool_slugs: list(text) }),
  MANAGE_CONNECTIONS: z.object({ toolkits: list(connectionEntry) }),
  SEARCH_TOOLS: z.object({ queries: list(z.object({ use_case: text })) }),
  REMOTE_WORKBENCH: z.object({ thought: optionalText, code_to_execute: optionalText }),
  REMOTE_BASH_TOOL: z.object({ command: optionalText }),
};

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : schema.parse({});
}

const connectionActions: Record<string, string> = {
  add: "Connect",
  list: "Accounts",
  remove: "Disconnect",
  rename: "Rename account",
};

/** Recognizes a Composio MCP call; anything else stays with Paseo's own tool row. */
export function parseCall(item: ToolCallLike): CallData | undefined {
  const tool = namePattern.exec(item.name)?.[1];
  if (!tool) return undefined;
  const input = parseJsonText(item.detail.type === "unknown" ? item.detail.input : undefined);
  const output = item.detail.type === "unknown" ? item.detail.output : undefined;
  const call: CallData = {
    tool,
    toolSlugs: [],
    toolkits: [],
    action: null,
    summary: null,
    status: item.status,
    error: formatError(item.error),
    input: (input ?? null) as PluginTimelineData,
    output: (output ?? null) as PluginTimelineData,
  };
  switch (tool) {
    case "MULTI_EXECUTE_TOOL":
      call.toolSlugs = parseInput(inputs[tool], input).tools.map((entry) => entry.tool_slug);
      call.action = "Run tools";
      break;
    case "GET_TOOL_SCHEMAS":
      call.toolSlugs = parseInput(inputs[tool], input).tool_slugs;
      call.action = "Tool schemas";
      break;
    case "MANAGE_CONNECTIONS": {
      const entries = parseInput(inputs[tool], input).toolkits;
      call.toolkits = entries.map((entry) =>
        (typeof entry === "string" ? entry : entry.name).toLowerCase(),
      );
      const first = entries.find((entry) => typeof entry !== "string");
      call.action = connectionActions[first?.action ?? "add"] ?? "Connections";
      break;
    }
    case "SEARCH_TOOLS":
      call.action = "Search tools";
      call.summary =
        parseInput(inputs[tool], input)
          .queries.map((query) => query.use_case)
          .join("; ") || null;
      break;
    case "REMOTE_WORKBENCH": {
      const args = parseInput(inputs[tool], input);
      call.action = "Workbench";
      call.summary = args.thought ?? firstLine(args.code_to_execute);
      break;
    }
    case "REMOTE_BASH_TOOL":
      call.action = "Shell";
      call.summary = firstLine(parseInput(inputs[tool], input).command);
      break;
    default:
      call.action = humanize(tool);
  }
  return call;
}

export interface ToolkitEntry {
  slug: string;
  name: string;
  /** Null when Composio's logo is the default `logos.composio.dev/api/<slug>`. */
  logo: string | null;
  connected: boolean;
}

export function logoUrl(entry: Pick<ToolkitEntry, "slug" | "logo">) {
  return entry.logo ?? `https://logos.composio.dev/api/${encodeURIComponent(entry.slug)}`;
}

const keyOf = (slug: string) => slug.toUpperCase().replace(/-/g, "_");

/** Resolves app slugs and tool slugs to Composio apps. Build once per catalog. */
export class ToolkitIndex {
  private readonly connected = new Map<string, ToolkitEntry>();
  private readonly all = new Map<string, ToolkitEntry>();

  constructor(entries: readonly ToolkitEntry[]) {
    for (const entry of entries) {
      this.all.set(keyOf(entry.slug), entry);
      if (entry.connected) this.connected.set(keyOf(entry.slug), entry);
    }
  }

  toolkit(slug: string): ToolkitEntry {
    return this.all.get(keyOf(slug)) ?? unknownToolkit(slug.toLowerCase());
  }

  /**
   * Tool slugs are `<APP>_<ACTION>`, and app slugs can contain underscores, so the longest
   * known prefix wins. Connected apps are tried first: they are what agents actually run.
   */
  forTool(toolSlug: string): { toolkit: ToolkitEntry; action: string } {
    const segments = toolSlug.split("_");
    for (const map of [this.connected, this.all]) {
      for (let length = segments.length - 1; length > 0; length -= 1) {
        const entry = map.get(segments.slice(0, length).join("_"));
        if (entry) return { toolkit: entry, action: humanize(segments.slice(length).join("_")) };
      }
    }
    return {
      toolkit: unknownToolkit(segments[0]!.toLowerCase()),
      action: humanize(segments.slice(1).join("_")) || toolSlug,
    };
  }
}

const composio: ToolkitEntry = { slug: "composio", name: "Composio", logo: null, connected: false };

export interface RowView {
  /** Logos to badge the row with, in call order. */
  apps: ToolkitEntry[];
  label: string;
  secondary: string | null;
}

/** Calls that act on several app tools or apps expand into one row per tool, like Paseo's groups. */
export function isGrouped(call: CallData) {
  return call.tool === "MANAGE_CONNECTIONS"
    ? call.toolkits.length > 1
    : call.toolSlugs.length > 1 &&
        (call.tool === "MULTI_EXECUTE_TOOL" || call.tool === "GET_TOOL_SCHEMAS");
}

export function describeCall(call: CallData, index: ToolkitIndex): RowView {
  const apps = new Map<string, ToolkitEntry>();
  const actions = new Set<string>();
  for (const slug of call.toolkits) {
    const entry = index.toolkit(slug);
    apps.set(entry.slug, entry);
  }
  for (const slug of call.toolSlugs) {
    const { toolkit, action } = index.forTool(slug);
    apps.set(toolkit.slug, toolkit);
    actions.add(action);
  }
  if (apps.size === 0) {
    return { apps: [composio], label: call.action ?? "Composio", secondary: call.summary };
  }
  const names = joinNames([...apps.values()].map((app) => app.name));
  if (call.tool !== "MULTI_EXECUTE_TOOL") {
    return { apps: [...apps.values()], label: names, secondary: call.action };
  }
  return {
    apps: [...apps.values()],
    label: isGrouped(call) ? `Used ${names}` : names,
    secondary: [...actions].join(", "),
  };
}

/** Paseo's group summary style: "A and B", "A, B, and C", "A, B, C, and 2 more". */
function joinNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return `${shown.slice(0, -1).join(", ")}, and ${shown.at(-1)}`;
}

/** One expandable block of input and output: a single app tool, an app, or the whole call. */
export interface CallDetail {
  toolSlug: string | null;
  toolkit: string | null;
  status: CallStatus;
  input: unknown;
  output: unknown;
  error: string | null;
}

export function describeDetail(detail: CallDetail, call: CallData, index: ToolkitIndex): RowView {
  if (detail.toolSlug) {
    const { toolkit, action } = index.forTool(detail.toolSlug);
    return { apps: [toolkit], label: toolkit.name, secondary: action };
  }
  const toolkit = index.toolkit(detail.toolkit ?? "composio");
  return { apps: [toolkit], label: toolkit.name, secondary: call.action };
}

// Composio wraps every result as { successful, data, error }.
const envelope = z.object({
  successful: z.boolean(),
  data: z.unknown().optional(),
  error: z.unknown().optional(),
});
const executeResults = z.object({
  results: list(
    z.object({
      index: z.number().optional().catch(undefined),
      response: z.unknown(),
    }),
  ),
});
const schemaResults = z.object({ tool_schemas: z.record(z.string(), z.unknown()) });
const connectionResults = z.object({ results: z.record(z.string(), z.unknown()) });

/**
 * Pairs each app tool or app with its own arguments and result. Parses the full result, so call it
 * only for an expanded row.
 */
export function callDetails(call: CallData): CallDetail[] {
  // A failed call's result arrives as its error text, which Claude cuts in the middle when long.
  const failure = call.output === null ? call.error : null;
  const result = unwrap(failure ? parseJsonText(failure) : resultValue(call.output));
  const whole: CallDetail = {
    toolSlug: null,
    toolkit: null,
    status: call.status,
    input: call.input,
    output: failure ? null : result.data,
    error: failure ? (result.error ?? failure) : result.error,
  };
  const pending = call.status === "running" && call.output === null;
  // A tool reports its own failure; the call failing only means one of its tools did.
  const settled: CallStatus = pending
    ? "running"
    : call.status === "failed"
      ? "completed"
      : call.status;
  switch (call.tool) {
    case "MULTI_EXECUTE_TOOL": {
      const tools = parseInput(inputs[call.tool], call.input).tools;
      if (tools.length === 0) return [whole];
      const results = executeResults.safeParse(result.data);
      const responses = results.success ? results.data.results : [];
      const failures =
        failure && responses.length === 0 ? recoverFailures(failure) : new Map<number, string>();
      // Rejected before any tool ran, so there is nothing to pair.
      if (responses.length === 0 && failures.size === 0 && whole.error) return [whole];
      return tools.map((tool, position) => {
        const match =
          responses.find((entry) => entry.index === position) ??
          (responses[position]?.index === undefined ? responses[position] : undefined);
        const response = match ? unwrap(match.response) : undefined;
        const error = response?.error ?? failures.get(position) ?? null;
        return {
          toolSlug: tool.tool_slug,
          toolkit: null,
          status: error ? "failed" : settled,
          input: tool.account
            ? { account: tool.account, arguments: tool.arguments ?? null }
            : (tool.arguments ?? null),
          output: response?.data ?? null,
          error,
        };
      });
    }
    case "GET_TOOL_SCHEMAS": {
      if (call.toolSlugs.length === 0 || whole.error) return [whole];
      const schemas = schemaResults.safeParse(result.data);
      return call.toolSlugs.map((slug) => ({
        toolSlug: slug,
        toolkit: null,
        status: settled,
        input: null,
        output: schemas.success ? (schemas.data.tool_schemas[slug] ?? null) : null,
        error: null,
      }));
    }
    case "MANAGE_CONNECTIONS": {
      const entries = parseInput(inputs[call.tool], call.input).toolkits;
      if (entries.length === 0 || whole.error) return [whole];
      const connections = connectionResults.safeParse(result.data);
      return entries.map((entry) => {
        const slug = (typeof entry === "string" ? entry : entry.name).toLowerCase();
        return {
          toolSlug: null,
          toolkit: slug,
          status: settled,
          input: entry,
          output: connections.success ? (connections.data.results[slug] ?? null) : null,
          error: null,
        };
      });
    }
    default:
      return [whole];
  }
}

// Each failed tool's entry ends with `"error":"…","tool_slug":"…","index":N}`, which survives
// when the middle of a long result is cut.
const failedEntry = /"error":("(?:[^"\\]|\\.)*"),"tool_slug":"[A-Z0-9_]+","index":(\d+)\}/g;

function recoverFailures(text: string) {
  const failures = new Map<number, string>();
  for (const match of text.matchAll(failedEntry)) {
    try {
      failures.set(Number(match[2]), JSON.parse(match[1]!) as string);
    } catch {
      // A literal cut inside its escapes is not recoverable.
    }
  }
  return failures;
}

const textBlocks = list(z.object({ type: z.literal("text"), text: z.string() }));
const mcpResult = z.union([
  z.array(z.unknown()).pipe(textBlocks),
  z.object({ content: z.array(z.unknown()).pipe(textBlocks) }).transform((result) => result.content),
]);
const claudeResult = z.object({ output: z.unknown() });

/** The tool's own result: Claude wraps it as `{ output }`, Codex passes MCP text blocks. */
function resultValue(output: unknown): unknown {
  const claude = claudeResult.safeParse(output);
  const value = claude.success && claude.data.output !== undefined ? claude.data.output : output;
  const blocks = mcpResult.safeParse(value);
  if (blocks.success && blocks.data.length > 0) {
    return parseJsonText(blocks.data.map((block) => block.text).join("\n"));
  }
  return parseJsonText(value);
}

function unwrap(value: unknown): { data: unknown; error: string | null } {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) return { data: value ?? null, error: null };
  return {
    data: parsed.data.data ?? null,
    error: parsed.data.successful ? null : (formatError(parsed.data.error) ?? "Failed"),
  };
}

const payloadLimit = 20_000;

/** Pretty JSON for an expanded detail, cut at 20,000 characters. */
export function formatPayload(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? prettyJsonText(value) : JSON.stringify(value, null, 2);
  return raw.length > payloadLimit ? `${raw.slice(0, payloadLimit)}\n… truncated` : raw;
}

function prettyJsonText(value: string) {
  const parsed = parseJsonText(value);
  return typeof parsed === "string" ? value : JSON.stringify(parsed, null, 2);
}

/** Parses JSON-looking text; anything else comes back unchanged. */
function parseJsonText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

const toolError = z.union([
  z.string(),
  z.object({ content: z.string() }).transform((error) => error.content),
  z.object({ message: z.string() }).transform((error) => error.message),
]);

function formatError(error: unknown): string | null {
  if (error === null || error === undefined || error === "") return null;
  const parsed = toolError.safeParse(error);
  return parsed.success ? parsed.data : JSON.stringify(error);
}

function unknownToolkit(slug: string): ToolkitEntry {
  return { slug, name: humanize(slug), logo: null, connected: false };
}

function humanize(value: string) {
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function firstLine(value: string | undefined) {
  return value?.trim().split("\n")[0] || null;
}
