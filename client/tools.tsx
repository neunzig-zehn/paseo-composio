import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import type { RpcOutput } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import * as rpc from "../shared/composio";

type App = RpcOutput<typeof rpc.apps>["apps"][number];

/** Every tool of one connected app, searchable, in Paseo's adaptive modal. */
export function ToolsModal({
  app,
  theme,
  onClose,
}: PluginSurfaceProps & { app: App; onClose(): void }) {
  const listTools = useRpc(rpc.tools);
  const tools = useQuery({
    queryKey: ["composio", "tools", app.slug],
    queryFn: () => listTools({ toolkit: app.slug }),
    staleTime: 10 * 60_000,
  });
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = tools.data?.tools ?? [];
    if (!needle) return all;
    return all.filter((tool) =>
      `${tool.name} ${tool.slug} ${tool.description}`.toLowerCase().includes(needle),
    );
  }, [tools.data, search]);
  const styles = useMemo(
    () => ({
      body: { backgroundColor: theme.colors.surface1 },
      searchBar: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      search: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        fontSize: 14,
        paddingHorizontal: 12,
        paddingVertical: 8,
      },
      list: { flex: 1, minHeight: 0 },
      row: { paddingVertical: 16, paddingHorizontal: 16 },
      rowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
      title: { color: theme.colors.foreground, fontSize: 14 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 },
      error: { color: theme.colors.statusDanger, fontSize: 12, padding: 16 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 14, padding: 16 },
    }),
    [theme],
  );
  return (
    <Modal
      title={`${app.name} tools`}
      icon={<Icon name="Blocks" size={16} color={theme.colors.foreground} />}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content
        scrollable={false}
        style={styles.body}
        contentContainerStyle={{ padding: 0, gap: 0 }}
      >
        <View style={styles.searchBar}>
          <TextInput
            accessibilityLabel={`Search ${app.name} tools`}
            placeholder="Search tools"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={search}
            onChangeText={setSearch}
            style={styles.search}
          />
        </View>
        {tools.isPending ? (
          <Text style={styles.empty}>Loading tools...</Text>
        ) : tools.isError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {tools.error.message}
          </Text>
        ) : (
          <FlatList
            style={styles.list}
            data={visible}
            keyExtractor={(tool) => tool.slug}
            ListEmptyComponent={
              <Text style={styles.empty}>{search ? "No matching tools" : "No tools"}</Text>
            }
            renderItem={({ item, index }) => (
              <View style={index > 0 ? [styles.row, styles.rowBorder] : styles.row}>
                <Text style={styles.title}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.hint} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
            )}
          />
        )}
      </Modal.Content>
    </Modal>
  );
}
