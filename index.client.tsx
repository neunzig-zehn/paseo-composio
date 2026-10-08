import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ComposioPage, ComposioScreen } from "./client/composio";
import { addAppCommands } from "./client/commands";
import { addComposioCalls } from "./client/timeline";

function ComposioItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Blocks"
      active={currentScreen?.screenId === "composio"}
      onPress={() => openScreen({ screenId: "composio" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "composio", title: "Composio", Component: ComposioScreen });
  client.addSidebarHeaderItem({ id: "composio", title: "Composio", Component: ComposioItem });
  client.addSettingsScreen({
    id: "composio",
    title: "Composio",
    icon: "Blocks",
    Component: ComposioPage,
  });
  const stopCalls = addComposioCalls(client);
  const stopCommands = addAppCommands(client);
  return () => {
    stopCalls();
    stopCommands();
  };
}
