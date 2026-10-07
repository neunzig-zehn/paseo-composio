import type { ComposioApi } from "./composio-api";
import type { CredentialStore } from "./credentials";

interface PendingLogin {
  id: string;
  url: string;
  code: string;
  expiresAt: string;
  timer?: NodeJS.Timeout;
}

/**
 * Browser sign-in, as in `composio login`: the daemon creates a session, any device opens its
 * URL and approves it, and the daemon polls until Composio links a user API key.
 */
export class BrowserLogin {
  private pending: PendingLogin | null = null;
  private error: string | null = null;

  constructor(
    private readonly api: Pick<
      ComposioApi,
      "createLoginSession" | "readLoginSession" | "resolveAccount" | "revokeUserKey"
    >,
    private readonly store: Pick<CredentialStore, "write">,
    private readonly source: string,
    private readonly intervalMs = 3_000,
  ) {}

  view() {
    const login = this.pending
      ? { url: this.pending.url, code: this.pending.code, expiresAt: this.pending.expiresAt }
      : null;
    return { login, loginError: this.error };
  }

  async start() {
    if (!this.pending || Date.parse(this.pending.expiresAt) <= Date.now()) {
      this.cancel();
      const session = await this.api.createLoginSession(this.source);
      this.pending = {
        id: session.id,
        url: session.url,
        code: session.code,
        expiresAt: session.expiresAt,
      };
      this.schedule(this.pending);
    }
    const { url, code, expiresAt } = this.pending;
    return { url, code, expiresAt };
  }

  cancel() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = null;
    this.error = null;
  }

  private schedule(login: PendingLogin) {
    login.timer = setTimeout(() => void this.poll(login), this.intervalMs);
    login.timer.unref?.();
  }

  private async poll(login: PendingLogin) {
    if (this.pending !== login) return;
    if (Date.parse(login.expiresAt) <= Date.now()) {
      this.pending = null;
      this.error = "Sign-in expired. Start again.";
      return;
    }
    let apiKey: string | null;
    try {
      apiKey = await this.api.readLoginSession(login.id);
    } catch (error) {
      // A dropped request is retried on the next tick; expiry ends the attempt.
      console.error("Composio sign-in check failed:", (error as Error).message);
      if (this.pending === login) this.schedule(login);
      return;
    }
    if (this.pending !== login) return;
    if (!apiKey) {
      this.schedule(login);
      return;
    }
    this.pending = null;
    try {
      const account = await this.api.resolveAccount(apiKey);
      await this.store.write({
        kind: "account",
        source: "browser",
        ...account.scope,
        email: account.email,
        organization: account.organization,
      });
    } catch (error) {
      this.error = `Unable to finish sign-in: ${(error as Error).message}`;
      // The key is unusable without its account; do not leave it valid.
      await this.api
        .revokeUserKey(apiKey)
        .catch((revokeError: Error) =>
          console.error("Composio key revocation failed:", revokeError.message),
        );
    }
  }
}
