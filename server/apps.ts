import { logoUrl, type ToolkitEntry } from "../shared/timeline";
import type { AccountScope, ComposioApi, ConnectedAccount } from "./composio-api";

export interface AppSummary {
  slug: string;
  name: string;
  logo: string | null;
  toolsCount: number | null;
  accounts: { id: string; label: string | null; status: string }[];
}

interface ToolkitInfo {
  name: string;
  logo: string | null;
  toolsCount: number | null;
}

// INITIATED and FAILED are abandoned or broken link attempts, not usable connections.
const hiddenStatuses: Record<string, true> = { INITIATED: true, FAILED: true };
const toolkitTtlMs = 60 * 60 * 1000;
const allToolkitsTtlMs = 24 * 60 * 60 * 1000;

/** Groups the personal project's connected accounts by app, active apps first. */
export class AppCatalog {
  private readonly toolkits = new Map<string, { info: Promise<ToolkitInfo>; at: number }>();
  private allToolkits: { list: Promise<Omit<ToolkitEntry, "connected">[]>; at: number } | null =
    null;

  constructor(
    private readonly api: Pick<
      ComposioApi,
      "listConnectedAccounts" | "readToolkit" | "listToolkits"
    >,
  ) {}

  async list(scope: AccountScope): Promise<AppSummary[]> {
    const accounts = (await this.api.listConnectedAccounts(scope)).filter(
      (account) => !account.is_disabled && !hiddenStatuses[account.status],
    );
    const bySlug = new Map<string, ConnectedAccount[]>();
    for (const account of accounts) {
      bySlug.set(account.toolkit.slug, [...(bySlug.get(account.toolkit.slug) ?? []), account]);
    }
    const apps = await Promise.all(
      [...bySlug].map(async ([slug, connected]) => {
        const info = await this.toolkit(scope, slug);
        return {
          slug,
          name: info.name,
          logo: info.logo,
          toolsCount: info.toolsCount,
          accounts: connected.map((account) => ({
            id: account.id,
            label: account.alias ?? null,
            status: account.status,
          })),
        };
      }),
    );
    return apps.sort(
      (left, right) =>
        Number(right.accounts.some((account) => account.status === "ACTIVE")) -
          Number(left.accounts.some((account) => account.status === "ACTIVE")) ||
        left.name.localeCompare(right.name),
    );
  }

  /** Every Composio app, connected ones marked. The full list is fetched at most once a day. */
  async catalog(scope: AccountScope): Promise<ToolkitEntry[]> {
    const [all, connected] = await Promise.all([this.everything(scope), this.list(scope)]);
    const entries = new Map<string, ToolkitEntry>();
    for (const toolkit of all) entries.set(toolkit.slug, { ...toolkit, connected: false });
    // Connected custom toolkits are missing from the public list, so connected apps add theirs.
    for (const app of connected) {
      const known = entries.get(app.slug) ?? app;
      entries.set(app.slug, { slug: app.slug, name: known.name, logo: known.logo, connected: true });
    }
    // Most logos follow logos.composio.dev/api/<slug>; the client rebuilds those.
    return [...entries.values()].map((entry) =>
      entry.logo === logoUrl({ slug: entry.slug, logo: null }) ? { ...entry, logo: null } : entry,
    );
  }

  private everything(scope: AccountScope) {
    if (this.allToolkits && Date.now() - this.allToolkits.at < allToolkitsTtlMs)
      return this.allToolkits.list;
    const list = this.api.listToolkits(scope).catch((error: Error) => {
      // Connected apps still resolve, and other slugs fall back to readable names.
      console.error("Composio toolkit list failed:", error.message);
      this.allToolkits = null;
      return [];
    });
    this.allToolkits = { list, at: Date.now() };
    return list;
  }

  private toolkit(scope: AccountScope, slug: string) {
    const cached = this.toolkits.get(slug);
    if (cached && Date.now() - cached.at < toolkitTtlMs) return cached.info;
    const info = this.api.readToolkit(scope, slug).catch((error: Error) => {
      // The app still has usable accounts; show its slug rather than hiding it.
      console.error(`Composio toolkit ${slug} lookup failed:`, error.message);
      this.toolkits.delete(slug);
      return { name: slug, logo: null, toolsCount: null };
    });
    this.toolkits.set(slug, { info, at: Date.now() });
    return info;
  }
}
