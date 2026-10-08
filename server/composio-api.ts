import { z } from "zod";

const backendUrl = "https://backend.composio.dev";
const dashboardUrl = "https://dashboard.composio.dev";
export const connectMcpUrl = "https://connect.composio.dev/mcp";

/** The consumer project ("For You") scope that a user API key acts in. */
export interface AccountScope {
  apiKey: string;
  orgId: string;
  projectId: string;
  consumerUserId: string;
}

export class ComposioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ComposioError";
  }
}

const errorBody = z.object({ error: z.object({ message: z.string().min(1) }) });

const loginSession = z.object({
  id: z.string().min(1),
  code: z.string(),
  expiresAt: z.string(),
});

const linkedSession = z.object({
  status: z.enum(["pending", "linked"]),
  api_key: z.string().nullable(),
});

const sessionInfo = z.object({
  project: z.object({ org: z.object({ id: z.string().min(1), name: z.string() }) }),
  org_member: z.object({ email: z.string() }),
});

const consumerProject = z.object({
  project_nano_id: z.string().min(1),
  consumer_user_id: z.string().min(1),
});

const connectedAccount = z.object({
  id: z.string(),
  toolkit: z.object({ slug: z.string() }),
  alias: z.string().nullish(),
  status: z.string(),
  is_disabled: z.boolean().optional(),
});
export type ConnectedAccount = z.infer<typeof connectedAccount>;

const toolkit = z.object({
  name: z.string(),
  meta: z.object({ tools_count: z.number().nullish(), logo: z.string().nullish() }).optional(),
});

const tool = z.object({ slug: z.string(), name: z.string(), description: z.string().nullish() });

const mcpSession = z.object({ mcp: z.object({ url: z.string().url() }) });

type Query = Record<string, string | undefined>;

/** Composio REST and MCP calls. Credentials never appear in thrown messages. */
export class ComposioApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      query?: Query;
    } = {},
  ): Promise<unknown> {
    const url = new URL(path, backendUrl);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, value);
    }
    const response = await this.fetcher(url, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    const json: unknown = text ? safeJson(text) : null;
    if (!response.ok) {
      const parsed = errorBody.safeParse(json);
      throw new ComposioError(
        response.status,
        parsed.success ? parsed.data.error.message : `Composio returned ${response.status}`,
      );
    }
    return json;
  }

  private async pages<Item extends z.ZodType>(
    path: string,
    item: Item,
    headers: Record<string, string>,
    query: Query,
  ): Promise<z.infer<Item>[]> {
    const schema = z.object({ items: z.array(item), next_cursor: z.string().nullish() });
    const items: z.infer<Item>[] = [];
    let cursor: string | undefined;
    // Ten pages is far beyond any real account; it stops a cursor that never ends.
    for (let index = 0; index < 10; index += 1) {
      const result = schema.parse(
        await this.request(path, { headers, query: { ...query, cursor } }),
      );
      items.push(...result.items);
      if (!result.next_cursor) return items;
      cursor = result.next_cursor;
    }
    return items;
  }

  /** Starts the same browser approval flow as `composio login`. */
  async createLoginSession(source: string) {
    const session = loginSession.parse(
      await this.request("/api/v3.1/cli/create-session", { body: { scope: "user", source } }),
    );
    return { ...session, url: `${dashboardUrl}/?cliKey=${encodeURIComponent(session.id)}` };
  }

  async readLoginSession(id: string) {
    const session = linkedSession.parse(
      await this.request("/api/v3.1/cli/get-session", { query: { id } }),
    );
    return session.status === "linked" && session.api_key ? session.api_key : null;
  }

  /** Resolves a user API key to its organization and personal ("For You") project. */
  async resolveAccount(apiKey: string) {
    const info = sessionInfo.parse(
      await this.request("/api/v3.1/auth/session/info", {
        headers: { "x-user-api-key": apiKey },
      }),
    );
    const orgId = info.project.org.id;
    const consumer = consumerProject.parse(
      await this.request("/api/v3.1/org/consumer/project/resolve", {
        method: "POST",
        headers: { "x-user-api-key": apiKey, "x-org-id": orgId },
      }),
    );
    return {
      scope: {
        apiKey,
        orgId,
        projectId: consumer.project_nano_id,
        consumerUserId: consumer.consumer_user_id,
      },
      email: info.org_member.email,
      organization: info.project.org.name,
    };
  }

  listConnectedAccounts(scope: AccountScope) {
    return this.pages("/api/v3.1/connected_accounts", connectedAccount, scopeHeaders(scope), {
      user_ids: scope.consumerUserId,
      limit: "1000",
    });
  }

  async readToolkit(scope: AccountScope, slug: string) {
    const result = toolkit.parse(
      await this.request(`/api/v3.1/toolkits/${encodeURIComponent(slug)}`, {
        headers: scopeHeaders(scope),
      }),
    );
    return {
      name: result.name,
      logo: result.meta?.logo || null,
      toolsCount: result.meta?.tools_count ?? null,
    };
  }

  async listTools(scope: AccountScope, slug: string) {
    const items = await this.pages("/api/v3.1/tools", tool, scopeHeaders(scope), {
      toolkit_slug: slug,
      limit: "1000",
    });
    return items.map(({ slug, name, description }) => ({
      slug,
      name,
      description: description ?? "",
    }));
  }

  /** Creates a tool router session for one agent in the personal project. */
  async createMcpSession(scope: AccountScope) {
    const session = mcpSession.parse(
      await this.request("/api/v3.1/tool_router/session", {
        headers: scopeHeaders(scope),
        body: {
          user_id: scope.consumerUserId,
          manage_connections: { enable: true },
          multi_account: { enable: true },
        },
      }),
    );
    return session.mcp.url;
  }

  /** Composio Connect accepts a consumer key only through MCP, so validate with `initialize`. */
  async verifyConsumerKey(key: string) {
    const response = await this.fetcher(connectMcpUrl, {
      method: "POST",
      headers: {
        "x-consumer-api-key": key,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "paseo-composio", version: "0.1.0" },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403)
      throw new ComposioError(response.status, "Composio rejected this consumer key.");
    if (!response.ok)
      throw new ComposioError(response.status, `Composio returned ${response.status}`);
  }

  async revokeUserKey(apiKey: string) {
    await this.request("/api/v3.1/api_key_revocation", { body: { api_keys: [apiKey] } });
  }
}

export function scopeHeaders(scope: AccountScope): Record<string, string> {
  return {
    "x-user-api-key": scope.apiKey,
    "x-org-id": scope.orgId,
    "x-project-id": scope.projectId,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
