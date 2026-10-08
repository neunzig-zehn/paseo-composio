import assert from "node:assert/strict";
import { test } from "node:test";
import { appCommands } from "../shared/commands";

const app = (slug: string, name: string, connected = true) => ({
  slug,
  name,
  logo: null,
  connected,
});

test("names commands after connected apps, falling back to the slug when names collide", () => {
  assert.deepEqual(
    appCommands([
      app("gmail", "Gmail"),
      app("googlecalendar", "Google Calendar"),
      app("better_stack_mcp", "Better Stack MCP"),
      app("posthog", "PostHog"),
      app("posthog_mcp", "PostHog"),
      app("custom_90_10", "90/10"),
      app("_1password", "1Password"),
      app("slack", "Slack", false),
    ]).map((command) => [command.name, command.app.slug]),
    [
      ["better-stack-mcp", "better_stack_mcp"],
      ["custom-90-10", "custom_90_10"],
      ["gmail", "gmail"],
      ["google-calendar", "googlecalendar"],
      ["posthog", "posthog"],
      ["posthog-mcp", "posthog_mcp"],
    ],
  );
});
