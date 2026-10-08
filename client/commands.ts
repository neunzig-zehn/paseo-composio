import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { appCommands, commandPrompt } from "../shared/commands";
import * as rpc from "../shared/composio";

const refreshMs = 10 * 60_000;
let refresh: () => void = () => {};

/** Re-reads the connected apps now, as after sign-in or sign-out. */
export function refreshAppCommands() {
  refresh();
}

/** Registers `/gmail`, `/calendar`, … for the connected apps and follows connection changes. */
export function addAppCommands(client: PluginClientContext) {
  const registered = new Map<string, { slug: string; cleanup: PluginCleanup }>();
  let stopped = false;

  async function sync() {
    let toolkits;
    try {
      ({ toolkits } = await client.rpc(rpc.toolkits, {}));
    } catch (error) {
      // Signed out or offline: keep the current commands and try again later.
      console.warn("Composio app commands not refreshed:", (error as Error).message);
      return;
    }
    if (stopped) return;
    const wanted = new Map(appCommands(toolkits).map((command) => [command.name, command]));
    for (const [name, entry] of registered) {
      if (wanted.get(name)?.app.slug === entry.slug) continue;
      void entry.cleanup();
      registered.delete(name);
    }
    for (const [name, { app }] of wanted) {
      if (registered.has(name)) continue;
      try {
        const cleanup = client.addSlashCommand({
          name,
          description: `Use ${app.name} through Composio`,
          argumentHint: "what to do",
          context: "agent",
          onSubmit: ({ paseo, agent, args }) =>
            paseo.agents.ref(agent.id).send(commandPrompt(app, args)),
        });
        registered.set(name, { slug: app.slug, cleanup });
      } catch (error) {
        // Another plugin can own the same name; the other apps still get theirs.
        console.warn(`Composio command /${name} not added:`, (error as Error).message);
      }
    }
  }

  void sync();
  const timer = setInterval(() => void sync(), refreshMs);
  refresh = () => void sync();
  return () => {
    stopped = true;
    clearInterval(timer);
    refresh = () => {};
    for (const entry of registered.values()) void entry.cleanup();
    registered.clear();
  };
}
