import type { ToolkitEntry } from "./timeline";

export interface AppCommand {
  name: string;
  app: ToolkitEntry;
}

/** `googlecalendar` → `calendar`, `google_maps` → `maps`, `_1password` → `1password`. */
function shortName(slug: string) {
  return commandName(slug.replace(/^google_?(?=.)/, ""));
}

function commandName(slug: string) {
  return slug.replace(/_/g, "-").replace(/^-+|-+$/g, "");
}

// Paseo's rule for command names.
const validName = /^[a-z][a-z0-9-]*$/;

/**
 * One slash command per connected app; a short name that two apps share falls back to the slug.
 * Apps whose name cannot be a command, such as `1password`, get none.
 */
export function appCommands(entries: readonly ToolkitEntry[]): AppCommand[] {
  const connected = entries.filter((entry) => entry.connected);
  const counts = new Map<string, number>();
  for (const app of connected) {
    counts.set(shortName(app.slug), (counts.get(shortName(app.slug)) ?? 0) + 1);
  }
  return connected
    .map((app) => {
      const short = shortName(app.slug);
      return { name: counts.get(short) === 1 ? short : commandName(app.slug), app };
    })
    .filter((command) => validName.test(command.name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function commandPrompt(app: ToolkitEntry, args: string) {
  const request = args.trim() || `Show me what you can do with my ${app.name}.`;
  return `Use my ${app.name} through Composio (toolkit \`${app.slug}\`): ${request}`;
}

/** Lets agents read `/gmail` or `/calendar` anywhere in a message as a Composio app. */
export const mentionInstructions =
  "When the user writes `/name` for an app, such as `/gmail`, `/calendar`, or `/linear`, they mean " +
  "their app connected through the Composio MCP server: the Composio toolkit with that slug, or " +
  "with `google` in front of it (`/calendar` is `googlecalendar`, `/drive` is `googledrive`). Use " +
  "the Composio tools for that app.";
