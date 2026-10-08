import type { PluginTheme } from "@getpaseo/plugin";
import {
  useRpc,
  type PluginClientContext,
  type PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View, type ImageStyle } from "react-native";
import * as rpc from "../shared/composio";
import {
  callData,
  callDetails,
  callKind,
  callVersion,
  describeCall,
  describeDetail,
  formatPayload,
  isGrouped,
  logoUrl,
  parseCall,
  ToolkitIndex,
  type CallData,
  type CallDetail,
  type CallStatus,
  type RowView,
  type ToolkitEntry,
} from "../shared/timeline";

export const toolkitsKey = ["composio", "toolkits"];

/** Replaces Composio's MCP tool rows with rows named and badged by app. */
export function addComposioCalls(client: PluginClientContext) {
  const stopTransform = client.addTimelineTransformer({
    id: "composio-calls",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const data = parseCall(item);
      return data
        ? { items: [{ type: "plugin", kind: callKind, version: callVersion, data }] }
        : undefined;
    },
  });
  const stopRender = client.addTimelineRenderer({
    kind: callKind,
    version: callVersion,
    schema: callData,
    Component: ComposioCallRow,
  });
  return () => {
    void stopTransform();
    void stopRender();
  };
}

// One index per fetched catalog, shared by every row.
const indexes = new WeakMap<object, ToolkitIndex>();
const emptyIndex = new ToolkitIndex([]);

function useToolkitIndex() {
  const listToolkits = useRpc(rpc.toolkits);
  const { data } = useQuery({
    queryKey: toolkitsKey,
    queryFn: () => listToolkits({}),
    staleTime: 60 * 60_000,
    gcTime: Infinity,
    retry: 1,
  });
  if (!data) return emptyIndex;
  let index = indexes.get(data);
  if (!index) {
    index = new ToolkitIndex(data.toolkits);
    indexes.set(data, index);
  }
  return index;
}

/**
 * Parses the call's result only while a row is open. Paseo re-parses row data on every render, so
 * the memo keys on the payload references, which pass through unchanged, not on derived arrays.
 */
function useCallDetails(call: CallData) {
  const { tool, status, error, input, output } = call;
  // toolSlugs and toolkits derive from input, so input covers them.
  return useMemo(() => callDetails(call), [tool, status, error, input, output]);
}

const monospace = Platform.select({
  ios: "ui-monospace",
  default: "monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

/** Builds a value once per theme object; every row shares it. */
function perTheme<Value>(build: (theme: PluginTheme) => Value) {
  const cache = new WeakMap<PluginTheme, Value>();
  return (theme: PluginTheme) => {
    let value = cache.get(theme);
    if (value === undefined) {
      value = build(theme);
      cache.set(theme, value);
    }
    return value;
  };
}

// Values mirror Paseo's ExpandableBadge, Overview group, and ToolCallDetailsContent styles.
const stylesFor = perTheme(({ colors }) => {
  return {
    container: { marginHorizontal: -13 },
    childContainer: { marginHorizontal: -13, marginBottom: 4 },
    pressable: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "transparent",
      paddingHorizontal: 8,
      paddingVertical: 4,
      overflow: "hidden" as const,
    },
    pressed: { opacity: 0.9 },
    expanded: { backgroundColor: colors.surface1 },
    attached: {
      borderColor: colors.border,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    header: { flexDirection: "row" as const, alignItems: "center" as const },
    slot: {
      height: 22,
      marginRight: 4,
      flexDirection: "row" as const,
      alignItems: "center" as const,
    },
    // The first logo centers in Paseo's 22px icon cell; more follow 4px apart.
    slotCell: { width: 22, alignItems: "center" as const, justifyContent: "center" as const },
    moreLogos: { flexDirection: "row" as const, gap: 4 },
    logo: { width: 14, height: 14, borderRadius: 3 },
    labelRow: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      overflow: "hidden" as const,
    },
    label: { color: colors.foregroundMuted, fontSize: 14, flexShrink: 0 },
    labelActive: { color: colors.foreground },
    labelLoading: { color: colors.foreground, opacity: 0.72 },
    secondary: {
      flexShrink: 1,
      minWidth: 0,
      color: colors.foregroundMuted,
      fontSize: 14,
      marginLeft: 4,
    },
    details: {
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
      borderWidth: 1,
      borderTopWidth: 0,
      borderColor: colors.border,
      overflow: "hidden" as const,
    },
    detailsBody: { gap: 16 },
    sectionHeader: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sectionHeaderText: { color: colors.foregroundMuted, fontSize: 14 },
    section: { gap: 8 },
    errorTitle: {
      color: colors.statusDanger,
      fontSize: 12,
      fontWeight: "600" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },
    jsonBox: {
      maxHeight: 400,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      backgroundColor: colors.surface2,
    },
    jsonBoxError: { borderColor: colors.statusDanger },
    jsonContent: { padding: 12 },
    code: { fontFamily: monospace, fontSize: 12, lineHeight: 18, color: colors.foreground },
    codeError: { color: colors.statusDanger },
    empty: { color: colors.foregroundMuted, fontSize: 14, fontStyle: "italic" as const, padding: 12 },
    groupBody: { maxHeight: 400 },
    groupContent: { paddingTop: 4, paddingHorizontal: 13 },
  };
});

interface Shared {
  theme: PluginTheme;
  web: boolean;
}

function ComposioCallRow({ item, theme, layout }: PluginTimelineItemProps<CallData>) {
  const call = item.data;
  const index = useToolkitIndex();
  const styles = stylesFor(theme);
  const [expanded, setExpanded] = useState(false);
  const grouped = isGrouped(call);
  const shared = { theme, web: layout.platform === "web" };
  const { ref, spacing } = useStreamSpacing(shared.web);
  return (
    <View ref={ref} style={spacing} testID={rowTestId}>
      <View style={styles.container}>
        <Badge
          {...shared}
          view={describeCall(call, index)}
          // A group's failed child carries the warning; the group keeps its logos.
          status={grouped && call.status === "failed" ? "completed" : call.status}
          expanded={expanded}
          attached={!grouped}
          onToggle={() => setExpanded((open) => !open)}
        />
        {expanded ? (
          grouped ? (
            <GroupBody {...shared} call={call} index={index} />
          ) : (
            <SingleBody call={call} theme={theme} />
          )
        ) : null}
      </View>
    </View>
  );
}

// Paseo spaces a plugin row 16px from everything, like a message. Its own tool rows sit 4px from
// text and touch other tool rows. These margins cancel the difference for each neighbor.
type Neighbor = "none" | "user" | "text" | "tool" | "composio";
const rowTestId = "composio-call";
const marginAbove: Record<Neighbor, number> = {
  none: 0,
  user: 0,
  text: -12,
  tool: -16,
  composio: -16,
};
// The Composio row below cancels the shared gap with its own top margin.
const marginBelow: Record<Neighbor, number> = {
  none: 0,
  user: 0,
  text: -12,
  tool: -16,
  composio: 0,
};
// Without the web DOM, a row cannot see its neighbors: exact below text, 4px loose above text.
const blindSpacing = { marginTop: -12, marginBottom: -8 };

function neighborKind(row: Element | null): Neighbor {
  if (!row) return "none";
  if (row.querySelector(`[data-testid="${rowTestId}"]`)) return "composio";
  if (row.querySelector('[data-testid="user-message"]')) return "user";
  // Thoughts render as tool rows too; Overview mode groups tool rows.
  return row.querySelector('[data-testid="tool-call-badge"], [data-testid="tool-call-group"]')
    ? "tool"
    : "text";
}

function streamSibling(row: Element, step: "previousElementSibling" | "nextElementSibling") {
  let sibling = row[step];
  while (sibling && !sibling.hasAttribute("data-history-row-id")) sibling = sibling[step];
  return sibling;
}

/** On web, reads the neighboring stream rows and follows the list as the agent adds rows. */
function useStreamSpacing(web: boolean) {
  const ref = useRef<View>(null);
  const [spacing, setSpacing] = useState(blindSpacing);
  useLayoutEffect(() => {
    // React Native Web refs are DOM elements; every stream item is a `data-history-row-id` row.
    const node = web ? (ref.current as unknown as Element | null) : null;
    const row = node?.closest("[data-history-row-id]");
    const list = row?.parentElement;
    if (!row || !list) return;
    const update = () => {
      const next = {
        marginTop: marginAbove[neighborKind(streamSibling(row, "previousElementSibling"))],
        marginBottom: marginBelow[neighborKind(streamSibling(row, "nextElementSibling"))],
      };
      setSpacing((current) =>
        current.marginTop === next.marginTop && current.marginBottom === next.marginBottom
          ? current
          : next,
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(list, { childList: true });
    return () => observer.disconnect();
  }, [web]);
  return { ref, spacing };
}

function SingleBody({ call, theme }: { call: CallData; theme: PluginTheme }) {
  const [detail] = useCallDetails(call);
  return <DetailPanel detail={detail!} theme={theme} />;
}

/** Paseo's Overview group body: borderless, rows inset to the chat rail, capped at 400px. */
function GroupBody({
  call,
  index,
  ...shared
}: { call: CallData; index: ToolkitIndex } & Shared) {
  const details = useCallDetails(call);
  return (
    <ScrollView
      style={stylesFor(shared.theme).groupBody}
      contentContainerStyle={stylesFor(shared.theme).groupContent}
      nestedScrollEnabled
    >
      {details.map((detail, position) => (
        <ChildRow
          key={position}
          {...shared}
          detail={detail}
          view={describeDetail(detail, call, index)}
        />
      ))}
    </ScrollView>
  );
}

function ChildRow({ detail, view, ...shared }: { detail: CallDetail; view: RowView } & Shared) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={stylesFor(shared.theme).childContainer}>
      <Badge
        {...shared}
        view={view}
        status={detail.status}
        expanded={expanded}
        attached
        onToggle={() => setExpanded((open) => !open)}
      />
      {expanded ? <DetailPanel detail={detail} theme={shared.theme} /> : null}
    </View>
  );
}

/** Paseo's tool row: icon slot, label, muted secondary label, chevron while hovered or open. */
function Badge({
  theme,
  web,
  view,
  status,
  expanded,
  attached,
  onToggle,
}: Shared & {
  view: RowView;
  status: CallStatus;
  expanded: boolean;
  attached: boolean;
  onToggle(): void;
}) {
  const styles = stylesFor(theme);
  const [hovered, setHovered] = useState(false);
  const active = hovered || expanded;
  const logos = web && status !== "failed" ? view.apps.slice(0, 3) : [];
  const slotWidth = Math.max(22, 4 + 14 * logos.length + 4 * (logos.length - 1));
  return (
    <Pressable
      onPress={onToggle}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      style={({ pressed }) => [
        styles.pressable,
        pressed && styles.pressed,
        expanded && styles.expanded,
        expanded && attached && styles.attached,
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.slot, { width: slotWidth }]}>
          <View style={styles.slotCell}>
            {active ? (
              <View
                style={{
                  marginLeft: -4,
                  transform: [{ scale: 1.3 }, { rotate: expanded ? "90deg" : "0deg" }],
                }}
              >
                <Icon name="ChevronRight" size={12} color={theme.colors.foreground} />
              </View>
            ) : status === "failed" ? (
              <View style={{ marginLeft: -1, opacity: 0.8 }}>
                <Icon name="TriangleAlert" size={12} color={theme.colors.statusDanger} />
              </View>
            ) : logos[0] ? (
              <AppLogo app={logos[0]} style={styles.logo} />
            ) : (
              // Composio's logos are SVG, which React Native's Image renders only on web.
              <View style={{ marginLeft: -1 }}>
                <Icon name="Blocks" size={12} color={theme.colors.foregroundMuted} />
              </View>
            )}
          </View>
          {/* The chevron takes only the first logo's place, so the others never move. */}
          {logos.length > 1 ? (
            <View style={styles.moreLogos}>
              {logos.slice(1).map((app) => (
                <AppLogo key={app.slug} app={app} style={styles.logo} />
              ))}
            </View>
          ) : null}
        </View>
        <View style={styles.labelRow}>
          <Text
            style={[
              styles.label,
              active && styles.labelActive,
              status === "running" && styles.labelLoading,
            ]}
            numberOfLines={1}
          >
            {view.secondary ? `${view.label}:` : view.label}
          </Text>
          {view.secondary ? (
            <Text style={[styles.secondary, active && styles.labelActive]} numberOfLines={1}>
              {view.secondary}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Paseo's input and output sections for a tool without a dedicated detail view. */
function DetailPanel({ detail, theme }: { detail: CallDetail; theme: PluginTheme }) {
  const styles = stylesFor(theme);
  const sections = useMemo(
    () =>
      [
        { title: "Input", body: formatPayload(detail.input) },
        { title: "Output", body: formatPayload(detail.output) },
      ].filter((section) => section.body),
    [detail],
  );
  return (
    <View style={styles.details}>
      {sections.length === 0 && !detail.error ? (
        <Text style={styles.empty}>
          {detail.status === "running" ? "Waiting for the result" : "No details"}
        </Text>
      ) : (
        <View style={styles.detailsBody}>
          {sections.flatMap((section) => [
            <View key={`${section.title}-header`} style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>,
            <JsonBox key={`${section.title}-value`} text={section.body!} theme={theme} />,
          ])}
          {detail.error ? (
            <View style={styles.section}>
              <Text style={styles.errorTitle}>Error</Text>
              <JsonBox text={formatPayload(detail.error)!} theme={theme} error />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function JsonBox({ text, theme, error }: { text: string; theme: PluginTheme; error?: boolean }) {
  const styles = stylesFor(theme);
  return (
    <ScrollView style={[styles.jsonBox, error && styles.jsonBoxError]} nestedScrollEnabled>
      <ScrollView horizontal nestedScrollEnabled contentContainerStyle={styles.jsonContent}>
        <Text selectable style={[styles.code, error && styles.codeError]}>
          {text}
        </Text>
      </ScrollView>
    </ScrollView>
  );
}

function AppLogo({ app, style }: { app: ToolkitEntry; style: ImageStyle }) {
  return (
    <Image
      source={{ uri: logoUrl(app) }}
      style={style}
      resizeMode="contain"
      accessibilityLabel={app.name}
    />
  );
}
