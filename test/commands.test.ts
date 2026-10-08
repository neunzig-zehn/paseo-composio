import assert from "node:assert/strict";
import { test } from "node:test";
import { appCommands } from "../shared/commands";

const app = (slug: string, connected = true) => ({ slug, name: slug, logo: null, connected });

test("names commands after connected apps, dropping a leading google unless that collides", () => {
  assert.deepEqual(
    appCommands([
      app("gmail"),
      app("googlecalendar"),
      app("google_search_console"),
      app("better_stack_mcp"),
      app("drive"),
      app("_1password"),
      app("googledrive"),
      app("slack", false),
    ]).map((command) => [command.name, command.app.slug]),
    [
      ["better-stack-mcp", "better_stack_mcp"],
      ["calendar", "googlecalendar"],
      ["drive", "drive"],
      ["gmail", "gmail"],
      ["googledrive", "googledrive"],
      ["search-console", "google_search_console"],
    ],
  );
});
