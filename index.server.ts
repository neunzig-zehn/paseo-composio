import { hostname } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { withComposio } from "./server/agents";
import { AppCatalog } from "./server/apps";
import { ComposioApi } from "./server/composio-api";
import { CredentialStore, defaultCredentialsPath, type Credentials } from "./server/credentials";
import { BrowserLogin } from "./server/login";
import * as rpc from "./shared/composio";

export default function contribute(server: PluginServerContext) {
  const api = new ComposioApi();
  const store = new CredentialStore(defaultCredentialsPath());
  const login = new BrowserLogin(api, store, `Paseo on ${hostname()}`);
  const catalog = new AppCatalog(api);
  const settings = server.registerSettings(rpc.agentSettings);

  async function status() {
    const credentials = await store.read();
    const connection =
      credentials?.kind === "account"
        ? {
            kind: "account" as const,
            email: credentials.email,
            organization: credentials.organization,
          }
        : credentials
          ? { kind: "consumer_key" as const }
          : null;
    return { connection, ...login.view() };
  }

  async function account() {
    const credentials = await store.read();
    if (credentials?.kind !== "account")
      throw new Error("Sign in with your browser to list your Composio apps.");
    return credentials;
  }

  async function signedOut() {
    if (await store.read()) throw new Error("Sign out of Composio first.");
  }

  server.handle(rpc.status, status);

  server.handle(rpc.startLogin, async () => {
    await signedOut();
    return login.start();
  });

  server.handle(rpc.cancelLogin, async () => {
    login.cancel();
    return status();
  });

  server.handle(rpc.saveKey, async ({ key }) => {
    await signedOut();
    let credentials: Credentials;
    if (key.startsWith("ck_")) {
      await api.verifyConsumerKey(key);
      credentials = { kind: "consumer_key", key };
    } else {
      const resolved = await api.resolveAccount(key);
      credentials = {
        kind: "account",
        source: "key",
        ...resolved.scope,
        email: resolved.email,
        organization: resolved.organization,
      };
    }
    login.cancel();
    await store.write(credentials);
    return status();
  });

  server.handle(rpc.signOut, async () => {
    const credentials = await store.read();
    // Keys from browser sign-in belong to this host only. A pasted key may serve other clients.
    if (credentials?.kind === "account" && credentials.source === "browser")
      await api.revokeUserKey(credentials.apiKey);
    await store.remove();
    login.cancel();
    return status();
  });

  server.handle(rpc.apps, async () => ({ apps: await catalog.list(await account()) }));

  server.handle(rpc.tools, async ({ toolkit }) => ({
    tools: await api.listTools(await account(), toolkit),
  }));

  server.before("agent.create", async ({ request }) => {
    const current = await settings.read();
    if (current.status !== "ready" || !current.values.addToNewAgents) return;
    const credentials = await store.read();
    if (!credentials) return;
    try {
      return await withComposio(request, credentials, api);
    } catch (error) {
      // Composio being unreachable must not block agent creation.
      console.error("Composio was not added to the new agent:", (error as Error).message);
      return undefined;
    }
  });

  return () => login.cancel();
}
