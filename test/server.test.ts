import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { withComposio } from "../server/agents";
import { AppCatalog } from "../server/apps";
import { ComposioApi, ComposioError, type AccountScope } from "../server/composio-api";
import { CredentialStore, type Credentials } from "../server/credentials";
import { BrowserLogin } from "../server/login";

const scope: AccountScope = {
  apiKey: "uak_secret",
  orgId: "ok_org",
  projectId: "pr_consumer",
  consumerUserId: "consumer-1",
};
const account = {
  kind: "account",
  source: "browser",
  ...scope,
  email: "ada@example.com",
  organization: "Example",
} satisfies Credentials;

let directory: string;
let store: CredentialStore;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "paseo-composio-"));
  store = new CredentialStore(join(directory, "nested", "credentials.json"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("credential store", () => {
  test("writes a private file only the daemon user can read", async () => {
    await store.write(account);
    assert.deepEqual(await store.read(), account);
    const file = await stat(join(directory, "nested", "credentials.json"));
    assert.equal(file.mode & 0o777, 0o600);
    await store.remove();
    assert.equal(await store.read(), null);
  });
});

describe("browser sign-in", () => {
  const interval = 3_000;
  let saved: Credentials[];
  const memory = {
    write: async (credentials: Credentials) => {
      saved.push(credentials);
    },
  };

  beforeEach(() => {
    saved = [];
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  });
  afterEach(() => mock.timers.reset());

  // Runs one poll: fires its timer, then lets the in-memory fakes settle.
  async function poll() {
    mock.timers.tick(interval);
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }

  function loginApi(answers: (string | null | Error)[], overrides: object = {}) {
    const revoked: string[] = [];
    const api = {
      createLoginSession: async () => ({
        id: "session-1",
        code: "ABC123",
        expiresAt: new Date(Date.now() + 10 * interval).toISOString(),
        url: "https://dashboard.composio.dev/?cliKey=session-1",
      }),
      readLoginSession: async () => {
        const answer = answers.shift() ?? null;
        if (answer instanceof Error) throw answer;
        return answer;
      },
      resolveAccount: async (apiKey: string) => ({
        scope: { ...scope, apiKey },
        email: account.email,
        organization: account.organization,
      }),
      revokeUserKey: async (apiKey: string) => {
        revoked.push(apiKey);
      },
      ...overrides,
    };
    return { api, revoked, answers };
  }

  test("stores the linked account once Composio approves the session", async () => {
    const { api } = loginApi([null, "uak_secret"]);
    const login = new BrowserLogin(api, memory, "Paseo on test", interval);
    const started = await login.start();
    assert.equal(started.code, "ABC123");
    assert.deepEqual(await login.start(), started, "a second press reuses the pending session");
    await poll();
    assert.deepEqual(saved, []);
    await poll();
    assert.deepEqual(saved, [account]);
    assert.deepEqual(login.view(), { login: null, loginError: null });
  });

  test("keeps polling through a failed check", async () => {
    const { api } = loginApi([new Error("socket hang up"), "uak_secret"]);
    const login = new BrowserLogin(api, memory, "Paseo on test", interval);
    await login.start();
    await poll();
    assert.notEqual(login.view().login, null);
    await poll();
    assert.deepEqual(saved, [account]);
  });

  test("revokes a linked key it cannot resolve and reports the failure", async () => {
    const { api, revoked } = loginApi(["uak_secret"], {
      resolveAccount: async () => {
        throw new ComposioError(500, "Consumer project unavailable");
      },
    });
    const login = new BrowserLogin(api, memory, "Paseo on test", interval);
    await login.start();
    await poll();
    assert.deepEqual(revoked, ["uak_secret"]);
    assert.deepEqual(saved, []);
    assert.match(login.view().loginError ?? "", /Consumer project unavailable/);
  });

  test("ends an expired session with an error", async () => {
    const { api } = loginApi([]);
    const login = new BrowserLogin(api, memory, "Paseo on test", interval);
    await login.start();
    for (let index = 0; index < 10; index += 1) await poll();
    assert.deepEqual(login.view(), { login: null, loginError: "Sign-in expired. Start again." });
  });

  test("cancel stops polling", async () => {
    const { api, answers } = loginApi(["uak_secret"]);
    const login = new BrowserLogin(api, memory, "Paseo on test", interval);
    await login.start();
    login.cancel();
    await poll();
    assert.deepEqual(answers, ["uak_secret"], "no check ran after cancel");
    assert.deepEqual(saved, []);
  });
});

describe("agent injection", () => {
  const api = {
    createMcpSession: async () => "https://backend.composio.dev/tool_router/trs_1/mcp",
  };
  const request = (provider: string, extra: object = {}) => ({
    config: { provider, cwd: "/work", ...extra },
  });

  test("gives each agent a personal-project session", async () => {
    const result = await withComposio(request("claude"), account, api);
    assert.deepEqual(result?.config.mcpServers, {
      composio: {
        type: "http",
        url: "https://backend.composio.dev/tool_router/trs_1/mcp",
        headers: {
          "x-user-api-key": "uak_secret",
          "x-org-id": "ok_org",
          "x-project-id": "pr_consumer",
        },
      },
    });
  });

  test("uses Composio Connect for a consumer key and a separate name for Codex", async () => {
    const result = await withComposio(request("codex"), { kind: "consumer_key", key: "ck_1" }, api);
    assert.deepEqual(result?.config.mcpServers, {
      paseo_composio: {
        type: "http",
        url: "https://connect.composio.dev/mcp",
        headers: { "x-consumer-api-key": "ck_1" },
      },
    });
  });

  test("leaves agents alone when they cannot or should not take the server", async () => {
    const own = { type: "http" as const, url: "https://example.com/mcp" };
    assert.equal(await withComposio(request("pi"), account, api), undefined);
    assert.equal(
      await withComposio(request("claude", { internal: true }), account, api),
      undefined,
    );
    assert.equal(
      await withComposio(
        request("acp", { providerOptions: { supportsMcpServers: false } }),
        account,
        api,
      ),
      undefined,
    );
    assert.equal(
      await withComposio(request("claude", { mcpServers: { composio: own } }), account, api),
      undefined,
    );
    const kept = await withComposio(
      request("claude", { mcpServers: { other: own } }),
      account,
      api,
    );
    assert.deepEqual(Object.keys(kept?.config.mcpServers ?? {}), ["other", "composio"]);
  });
});

describe("app catalog", () => {
  test("groups usable accounts by app with active apps first", async () => {
    const catalog = new AppCatalog({
      listConnectedAccounts: async () => [
        { id: "1", toolkit: { slug: "gmail" }, alias: "ada@example.com", status: "EXPIRED" },
        { id: "2", toolkit: { slug: "gmail" }, alias: "ada@work.com", status: "ACTIVE" },
        { id: "3", toolkit: { slug: "airtable" }, alias: null, status: "EXPIRED" },
        { id: "4", toolkit: { slug: "slack" }, alias: null, status: "INITIATED" },
        { id: "5", toolkit: { slug: "notion" }, status: "ACTIVE", is_disabled: true },
        { id: "6", toolkit: { slug: "custom_1" }, status: "ACTIVE" },
      ],
      readToolkit: async (_scope, slug) => {
        if (slug === "custom_1") throw new ComposioError(404, "Toolkit not found");
        return { name: slug === "gmail" ? "Gmail" : "Airtable", toolsCount: 7 };
      },
    });
    const apps = await catalog.list(scope);
    assert.deepEqual(
      apps.map((app) => [app.name, app.accounts.map((account) => account.id)]),
      [
        ["custom_1", ["6"]],
        ["Gmail", ["1", "2"]],
        ["Airtable", ["3"]],
      ],
    );
  });
});

describe("Composio API", () => {
  test("follows cursors and reports Composio's message without the key", async () => {
    const requests: URL[] = [];
    const api = new ComposioApi(async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal((init?.headers as Record<string, string>)["x-project-id"], "pr_consumer");
      if (url.pathname.endsWith("/connected_accounts")) {
        const second = url.searchParams.get("cursor") === "page-2";
        return Response.json({
          items: [{ id: second ? "b" : "a", toolkit: { slug: "gmail" }, status: "ACTIVE" }],
          next_cursor: second ? null : "page-2",
        });
      }
      return Response.json(
        { error: { message: "Invalid or revoked user API key", code: 2113 } },
        { status: 401 },
      );
    });
    const accounts = await api.listConnectedAccounts(scope);
    assert.deepEqual(
      accounts.map((item) => item.id),
      ["a", "b"],
    );
    assert.equal(requests[0]?.searchParams.get("user_ids"), "consumer-1");
    await assert.rejects(api.listTools(scope, "gmail"), (error: Error) => {
      assert.equal(error.message, "Invalid or revoked user API key");
      assert.doesNotMatch(error.message, /uak_secret/);
      return true;
    });
  });
});
