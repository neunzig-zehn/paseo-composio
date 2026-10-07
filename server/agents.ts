import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { connectMcpUrl, scopeHeaders, type ComposioApi } from "./composio-api";
import type { Credentials } from "./credentials";

type AgentCreateRequest = PluginBeforeRequests["agent.create"];

/**
 * Codex keeps MCP OAuth tokens by server name. Someone who once signed Codex in to Composio's own
 * `composio` server would otherwise send that token here, so Codex gets a separate name.
 */
export function mcpServerName(provider: string) {
  return provider === "codex" ? "paseo_composio" : "composio";
}

/**
 * Paseo rejects an agent whose provider cannot take MCP servers. Pi takes them only with its MCP
 * extension, and ACP providers can opt out through `supportsMcpServers: false`.
 */
export function acceptsMcpServers(config: AgentCreateRequest["config"]) {
  if (config.provider === "pi") return false;
  const options = config.providerOptions as Record<string, unknown> | undefined;
  return options?.supportsMcpServers !== false;
}

/** Adds Composio to a new agent's MCP servers, keeping a server the request already names. */
export async function withComposio(
  request: AgentCreateRequest,
  credentials: Credentials,
  api: Pick<ComposioApi, "createMcpSession">,
): Promise<AgentCreateRequest | undefined> {
  const { config } = request;
  const name = mcpServerName(config.provider);
  if (config.internal || config.mcpServers?.[name] || !acceptsMcpServers(config)) return undefined;
  const server =
    credentials.kind === "account"
      ? {
          type: "http" as const,
          url: await api.createMcpSession(credentials),
          headers: scopeHeaders(credentials),
        }
      : {
          type: "http" as const,
          url: connectMcpUrl,
          headers: { "x-consumer-api-key": credentials.key },
        };
  return {
    ...request,
    config: { ...config, mcpServers: { ...config.mcpServers, [name]: server } },
  };
}
