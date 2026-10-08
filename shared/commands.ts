import type { ToolkitEntry } from "./timeline";

export interface AppCommand {
  name: string;
  app: ToolkitEntry;
}

/** `Google Calendar` → `google-calendar`, `Better Stack MCP` → `better-stack-mcp`. */
function commandName(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Paseo's rule for command names.
const validName = /^[a-z][a-z0-9-]*$/;

/**
 * One slash command per connected app, named after the app. A name two apps share, or one that
 * cannot be a command such as `90-10`, falls back to the slug; apps with neither get none.
 */
export function appCommands(entries: readonly ToolkitEntry[]): AppCommand[] {
  const connected = entries.filter((entry) => entry.connected);
  const counts = new Map<string, number>();
  for (const app of connected) {
    counts.set(commandName(app.name), (counts.get(commandName(app.name)) ?? 0) + 1);
  }
  return connected
    .map((app) => {
      const name = commandName(app.name);
      return {
        name: counts.get(name) === 1 && validName.test(name) ? name : commandName(app.slug),
        app,
      };
    })
    .filter((command) => validName.test(command.name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function commandPrompt(app: ToolkitEntry, args: string) {
  const request = args.trim() || `Show me what you can do with my ${app.name}.`;
  return `Use my ${app.name} through Composio (toolkit \`${app.slug}\`): ${request}`;
}

/** Lets agents read `/gmail` or `/google-calendar` anywhere in a message as a Composio app. */
export const mentionInstructions =
  "When the user writes `/name` for an app, such as `/gmail`, `/google-calendar`, or `/linear`, " +
  "they mean their app connected through the Composio MCP server, named by its app name or " +
  "Composio toolkit slug (`/google-calendar` is `googlecalendar`). Use the Composio tools for " +
  "that app.";
