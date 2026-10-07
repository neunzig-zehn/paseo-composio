Composio gives Paseo agents the apps you connected in Composio, such as Gmail, Slack, Notion, GitHub, and Linear. Sign in once per host. Every Paseo app connected to that host sees the same connection, and new agents on the host get Composio's MCP tools.

## Setup

Open **Composio** in the sidebar and select **Sign in**. Your browser opens Composio, where you approve the host. Approval works from any device signed in to Composio, so you can also copy the sign-in link and open it elsewhere.

If you can't use a browser, paste a key instead. A consumer key (`ck_`) from Composio under **Settings, Sessions & API Key** gives agents Composio, but the page lists your apps only after browser sign-in. A user API key (`uak_`) works like browser sign-in.

With the plugin on several hosts, pick the host in the screen header. Each host has its own connection.

## What you see

The page shows the signed-in account and every app you connected in Composio, with its accounts, whether a connection expired, and the number of tools. Select **Tools** on an app to search its tools.

**Add to new agents** controls whether new agents on the host get the Composio MCP server. Agents can search and run tools across your apps and ask you to connect another app when a task needs it. Existing agents are not changed.

## What it stores and sends

Browser sign-in creates a Composio user API key for the host. The plugin stores it in a private file in the daemon's Paseo home, under `plugins/composio`. **Sign out** deletes the file and revokes a key created by browser sign-in. A pasted key is deleted but not revoked.

Each new agent gets its own Composio session in your personal ("For You") project. The agent's MCP configuration carries the key, as Composio requires, so anyone who can read that host's agent configuration can use your Composio apps. Do not sign in on a host other people use.

The plugin talks only to Composio: `backend.composio.dev` for sign-in, apps, tools, and sessions, and `connect.composio.dev` for consumer keys.

## Limits

Pi agents are skipped because Pi accepts MCP servers only with its MCP extension. Codex agents get the server as `paseo_composio`, so an existing Codex login to Composio's own server is not reused. Requires Paseo 0.11.0 or later.
