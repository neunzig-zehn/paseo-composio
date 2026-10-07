import type { AccountScope, ComposioApi, ConnectedAccount } from "./composio-api";

export interface AppSummary {
  slug: string;
  name: string;
  toolsCount: number | null;
  accounts: { id: string; label: string | null; status: string }[];
}

interface ToolkitInfo {
  name: string;
  toolsCount: number | null;
}

// INITIATED and FAILED are abandoned or broken link attempts, not usable connections.
const hiddenStatuses: Record<string, true> = { INITIATED: true, FAILED: true };
const toolkitTtlMs = 60 * 60 * 1000;

/** Groups the personal project's connected accounts by app, active apps first. */
export class AppCatalog {
  private readonly toolkits = new Map<string, { info: Promise<ToolkitInfo>; at: number }>();

  constructor(private readonly api: Pick<ComposioApi, "listConnectedAccounts" | "readToolkit">) {}

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

  private toolkit(scope: AccountScope, slug: string) {
    const cached = this.toolkits.get(slug);
    if (cached && Date.now() - cached.at < toolkitTtlMs) return cached.info;
    const info = this.api.readToolkit(scope, slug).catch((error: Error) => {
      // The app still has usable accounts; show its slug rather than hiding it.
      console.error(`Composio toolkit ${slug} lookup failed:`, error.message);
      this.toolkits.delete(slug);
      return { name: slug, toolsCount: null };
    });
    this.toolkits.set(slug, { info, at: Date.now() });
    return info;
  }
}
