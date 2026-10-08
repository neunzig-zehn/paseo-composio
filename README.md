# Composio for Paseo

A [Paseo](https://paseo.sh) plugin that gives your agents Gmail, GitHub, Slack, Linear, and 1,000+ more apps through [Composio](https://composio.dev). Sign in once per host; new agents get Composio's MCP tools, and every connected app becomes a slash command such as `/gmail`. See [OVERVIEW.md](OVERVIEW.md) for what it does and what it stores.

## Install

Enable plugins on the target host under **Settings → Plugins**, then:

```bash
paseo plugin add git:neunzig-zehn/paseo-composio
```

Use `--host <url>` to install on another daemon. Install it on each host you want to connect; the Composio screen header then switches between them.

## Develop

```bash
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload composio
```

`npm run hero` renders `assets/hero.png`, the first listing image, from `assets/hero.html` with Chrome; set `CHROME` to use another Chromium binary.

| Path                     | Runtime | Role                                                            |
| ------------------------ | ------- | --------------------------------------------------------------- |
| `index.client.tsx`       | App     | Sidebar header item, screens, and chat timeline rows            |
| `client/`                | App     | Composio page, tools modal, and Composio tool-call rows         |
| `index.server.ts`        | Daemon  | RPC handlers and the `agent.create` hook                        |
| `server/composio-api.ts` | Daemon  | Composio REST and MCP calls                                     |
| `server/login.ts`        | Daemon  | Browser sign-in through Composio's CLI session flow             |
| `server/credentials.ts`  | Daemon  | `<PASEO_HOME>/plugin-data/composio/credentials.json`, mode 0600 |
| `server/agents.ts`       | Daemon  | MCP server for new agents                                       |
| `shared/composio.ts`     | Both    | RPC contracts and the host-scoped **Add to new agents** setting |
| `shared/timeline.ts`     | Both    | Recognizes Composio tool calls and resolves tool slugs to apps  |
| `shared/commands.ts`     | Both    | One slash command per connected app, and the mention instruction |

Browser sign-in uses the same session flow as `composio login`: the daemon creates a session at `backend.composio.dev`, the user approves it at `dashboard.composio.dev`, and the daemon polls until Composio returns a user API key. The plugin resolves the organization's consumer project and lists connected accounts there. Each new agent gets a separate tool router session in that project.

Chat rows resolve a tool slug such as `GOOGLECALENDAR_EVENTS_LIST` to its app by the longest known app prefix, trying connected apps first. The daemon fetches Composio's full app list at most once a day and the app caches the catalog for an hour, so rows cost no network requests after the first.

Paseo spaces plugin timeline rows like messages, 16px from every neighbor. To sit like Paseo's own tool rows, a Composio row on web reads its neighboring `[data-history-row-id]` rows and offsets its margins: 4px from assistant text, flush against tool, thinking, and other Composio rows. It recognizes Paseo's rows by `data-testid` (`tool-call-badge`, `tool-call-group`, `user-message`), so a change to those in Paseo's web app needs a matching change in `client/timeline.tsx`. Native apps use fixed margins.

## License

MIT
