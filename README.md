# Composio for Paseo

A [Paseo](https://paseo.sh) plugin that connects a host to your [Composio](https://composio.dev) apps and adds Composio's MCP tools to new agents. See [OVERVIEW.md](OVERVIEW.md) for what it does and what it stores.

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

| Path                     | Runtime | Role                                                            |
| ------------------------ | ------- | --------------------------------------------------------------- |
| `index.client.tsx`       | App     | Sidebar header item, screen, and settings screen                |
| `client/`                | App     | Composio page and tools modal                                   |
| `index.server.ts`        | Daemon  | RPC handlers and the `agent.create` hook                        |
| `server/composio-api.ts` | Daemon  | Composio REST and MCP calls                                     |
| `server/login.ts`        | Daemon  | Browser sign-in through Composio's CLI session flow             |
| `server/credentials.ts`  | Daemon  | `<PASEO_HOME>/plugin-data/composio/credentials.json`, mode 0600 |
| `server/agents.ts`       | Daemon  | MCP server for new agents                                       |
| `shared/composio.ts`     | Both    | RPC contracts and the host-scoped **Add to new agents** setting |

Browser sign-in uses the same session flow as `composio login`: the daemon creates a session at `backend.composio.dev`, the user approves it at `dashboard.composio.dev`, and the daemon polls until Composio returns a user API key. The plugin resolves the organization's consumer project and lists connected accounts there. Each new agent gets a separate tool router session in that project.

## License

MIT
