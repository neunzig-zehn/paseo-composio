import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const stored = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("account"),
    /** `browser` keys were minted for this host and are revoked on sign-out. */
    source: z.enum(["browser", "key"]),
    apiKey: z.string().min(1),
    orgId: z.string().min(1),
    projectId: z.string().min(1),
    consumerUserId: z.string().min(1),
    email: z.string(),
    organization: z.string(),
  }),
  z.object({ kind: z.literal("consumer_key"), key: z.string().min(1) }),
]);
export type Credentials = z.infer<typeof stored>;

export function defaultCredentialsPath() {
  return join(
    process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
    "plugins",
    "composio",
    "credentials.json",
  );
}

/** One private file per daemon: every client and agent of the host shares the connection. */
export class CredentialStore {
  constructor(private readonly path: string) {}

  async read(): Promise<Credentials | null> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return stored.parse(JSON.parse(text));
  }

  async write(credentials: Credentials) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(stored.parse(credentials))}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  async remove() {
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
