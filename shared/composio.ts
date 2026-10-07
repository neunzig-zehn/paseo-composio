import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const empty = z.object({});

export const connectionView = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("account"),
    email: z.string(),
    organization: z.string(),
  }),
  z.object({ kind: z.literal("consumer_key") }),
]);

export const loginView = z.object({
  url: z.string().url(),
  code: z.string(),
  expiresAt: z.string(),
});

export const statusView = z.object({
  connection: connectionView.nullable(),
  login: loginView.nullable(),
  loginError: z.string().nullable(),
});

export const status = defineRpc({ name: "composio.status", input: empty, output: statusView });

export const startLogin = defineRpc({
  name: "composio.login.start",
  input: empty,
  output: loginView,
});

export const cancelLogin = defineRpc({
  name: "composio.login.cancel",
  input: empty,
  output: statusView,
});

export const saveKey = defineRpc({
  name: "composio.key.save",
  input: z.object({
    key: z
      .string()
      .trim()
      .max(500)
      .regex(/^(ck|uak)_[A-Za-z0-9_-]+$/u, "Paste a consumer key (ck_) or a user API key (uak_)."),
  }),
  output: statusView,
});

export const signOut = defineRpc({ name: "composio.sign_out", input: empty, output: statusView });

export const appView = z.object({
  slug: z.string(),
  name: z.string(),
  toolsCount: z.number().nullable(),
  accounts: z.array(
    z.object({
      id: z.string(),
      label: z.string().nullable(),
      status: z.string(),
    }),
  ),
});

export const apps = defineRpc({
  name: "composio.apps",
  input: empty,
  output: z.object({ apps: z.array(appView) }),
});

export const toolkitSlug = z.string().regex(/^[a-z0-9_-]{1,100}$/u);

export const tools = defineRpc({
  name: "composio.tools",
  input: z.object({ toolkit: toolkitSlug }),
  output: z.object({
    tools: z.array(z.object({ slug: z.string(), name: z.string(), description: z.string() })),
  }),
});

export const agentSettings = defineSettings({
  id: "agents",
  scope: "host",
  version: 1,
  schema: z.object({ addToNewAgents: z.boolean().default(true) }),
});
