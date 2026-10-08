import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  callDetails,
  describeCall,
  formatPayload,
  parseCall,
  ToolkitIndex,
  type ToolCallLike,
  type ToolkitEntry,
} from "../shared/timeline";

const call = (name: string, input: unknown, status: ToolCallLike["status"] = "completed") =>
  parseCall({ name, status, error: null, detail: { type: "unknown", input, output: null } });

const entry = (slug: string, name: string, connected = false): ToolkitEntry => ({
  slug,
  name,
  logo: null,
  connected,
});

describe("Composio tool calls", () => {
  test("recognizes Composio's meta tools under every provider's naming", () => {
    const input = { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: {} }] };
    for (const name of [
      "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL",
      "paseo_composio.COMPOSIO_MULTI_EXECUTE_TOOL",
      "composio.COMPOSIO_MULTI_EXECUTE_TOOL",
    ]) {
      assert.deepEqual(call(name, input)?.toolSlugs, ["GMAIL_SEND_EMAIL"], name);
    }
    assert.equal(call("mcp__paseo__list_agents", {}), undefined);
    assert.equal(call("Bash", { command: "ls" }), undefined);
    // Streaming arguments arrive as partial JSON; the row still renders.
    assert.deepEqual(
      call("composio.COMPOSIO_MULTI_EXECUTE_TOOL", '{"tools":[{"tool_slug":', "running")
        ?.toolSlugs,
      [],
    );
  });

  test("names tools by the longest app prefix, preferring connected apps", () => {
    const catalog = [
      entry("slack", "Slack"),
      entry("slackbot", "Slackbot"),
      entry("better_stack_mcp", "Better Stack MCP", true),
      entry("google", "Google"),
      entry("google_maps", "Google Maps"),
    ];
    const index = new ToolkitIndex(catalog);
    assert.deepEqual(index.forTool("BETTER_STACK_MCP_LIST_MONITORS"), {
      toolkit: catalog[2],
      action: "List monitors",
    });
    assert.equal(index.forTool("GOOGLE_MAPS_GEOCODE").toolkit.slug, "google_maps");
    assert.deepEqual(index.forTool("ACME_DO_THING"), {
      toolkit: entry("acme", "Acme"),
      action: "Do thing",
    });
    // A connected "google" wins over the longer, unconnected "google_maps".
    const connected = new ToolkitIndex([entry("google", "Google", true), catalog[4]!]);
    assert.equal(connected.forTool("GOOGLE_MAPS_GEOCODE").toolkit.slug, "google");
  });

  test("labels rows with app names and actions", () => {
    const index = new ToolkitIndex([entry("gmail", "Gmail", true), entry("slack", "Slack", true)]);
    const execute = describeCall(
      call("composio.COMPOSIO_MULTI_EXECUTE_TOOL", {
        tools: [
          { tool_slug: "GMAIL_SEND_EMAIL" },
          { tool_slug: "SLACK_SEND_MESSAGE" },
          { tool_slug: "GMAIL_SEND_EMAIL" },
        ],
      })!,
      index,
    );
    assert.deepEqual(
      [execute.apps.map((app) => app.slug), execute.label, execute.secondary],
      [["gmail", "slack"], "Used Gmail and Slack", "Send email, Send message"],
    );
    const single = describeCall(
      call("composio.COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL" }] })!,
      index,
    );
    assert.deepEqual([single.label, single.secondary], ["Gmail", "Send email"]);
    const many = describeCall(
      call("composio.COMPOSIO_MULTI_EXECUTE_TOOL", {
        tools: ["GMAIL_A", "SLACK_B", "NOTION_C", "LINEAR_D", "GITHUB_E"].map((tool_slug) => ({
          tool_slug,
        })),
      })!,
      index,
    );
    assert.equal(many.label, "Used Gmail, Slack, Notion, and 2 more");
    const connect = describeCall(
      call("composio.COMPOSIO_MANAGE_CONNECTIONS", {
        toolkits: [{ name: "Slack", action: "remove" }],
      })!,
      index,
    );
    assert.deepEqual([connect.label, connect.secondary], ["Slack", "Disconnect"]);
    const search = describeCall(
      call("composio.COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: "send an email" }] })!,
      index,
    );
    assert.deepEqual(
      [search.apps.map((app) => app.slug), search.label, search.secondary],
      [["composio"], "Search tools", "send an email"],
    );
  });

  test("pairs each executed tool with its own arguments and result", () => {
    const input = {
      tools: [
        { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "ada@example.com" } },
        { tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "x" }, account: "slack_work" },
      ],
      session_id: "fall",
    };
    // Claude wraps the parsed result as { output }; results can arrive out of order.
    const claude = callDetails({
      ...call("mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", input)!,
      output: {
        output: {
          successful: true,
          data: {
            results: [
              { index: 1, response: { successful: false, data: {}, error: "channel_not_found" } },
              { index: 0, response: { successful: true, data: { id: "m1" }, error: null } },
            ],
          },
          error: null,
        },
      },
    });
    assert.deepEqual(claude, [
      {
        toolSlug: "GMAIL_SEND_EMAIL",
        toolkit: null,
        status: "completed",
        input: { to: "ada@example.com" },
        output: { id: "m1" },
        error: null,
      },
      {
        toolSlug: "SLACK_SEND_MESSAGE",
        toolkit: null,
        status: "failed",
        input: { account: "slack_work", arguments: { channel: "x" } },
        output: {},
        error: "channel_not_found",
      },
    ]);
    // Codex passes MCP text blocks.
    const codex = callDetails({
      ...call("paseo_composio.COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [input.tools[0]] })!,
      output: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              successful: true,
              data: { results: [{ response: { successful: true, data: { id: "m2" } } }] },
            }),
          },
        ],
      },
    });
    assert.deepEqual(codex[0]!.output, { id: "m2" });
    // A call Composio rejects as a whole keeps its own input and error.
    const rejected = callDetails({
      ...call("composio.COMPOSIO_MULTI_EXECUTE_TOOL", input)!,
      output: { output: { successful: false, data: null, error: "Invalid session" } },
    });
    assert.deepEqual(
      rejected.map((detail) => [detail.toolSlug, detail.input, detail.error]),
      [[null, input, "Invalid session"]],
    );
  });

  test("keeps one row per tool when Claude cuts a failed batch's result", () => {
    const input = {
      tools: [
        { tool_slug: "GITHUB_LIST_REPOSITORIES", arguments: { per_page: 3 } },
        { tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: { repo: "missing" } },
      ],
    };
    // Claude reports the batch as an error and replaces the middle of long error text.
    const error =
      '{"successful":false,"data":{"results":[{"response":{"successful":true,"data":{"repos' +
      "\n\n... [5832 characters truncated] ...\n\n" +
      '"}},"tool_slug":"GITHUB_LIST_REPOSITORIES","index":0},{"response":{"successful":false},' +
      '"error":"{\\"message\\":\\"Not Found\\"}","tool_slug":"GITHUB_GET_A_REPOSITORY","index":1}],' +
      '"error_count":1},"error":"1 out of 2 tools failed"}';
    const details = callDetails({
      ...call("mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", input, "failed")!,
      error,
    });
    assert.deepEqual(
      details.map((detail) => [detail.toolSlug, detail.status, detail.input, detail.error]),
      [
        ["GITHUB_LIST_REPOSITORIES", "completed", { per_page: 3 }, null],
        ["GITHUB_GET_A_REPOSITORY", "failed", { repo: "missing" }, '{"message":"Not Found"}'],
      ],
    );
  });

  test("pretty-prints JSON text", () => {
    assert.equal(formatPayload('{"ok":true}'), '{\n  "ok": true\n}');
    assert.equal(formatPayload("plain"), "plain");
  });
});
