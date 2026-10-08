import {
  openExternalUrl,
  useRpc,
  useSettings,
  type PluginScreenProps,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import type { RpcOutput } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import * as rpc from "../shared/composio";
import { refreshAppCommands } from "./commands";
import { toolkitsKey } from "./timeline";
import { ToolsModal } from "./tools";

type Status = RpcOutput<typeof rpc.status>;
type Connection = NonNullable<Status["connection"]>;
type App = RpcOutput<typeof rpc.apps>["apps"][number];

const statusKey = ["composio", "status"];
const appsKey = ["composio", "apps"];
const dashboardUrl = "https://dashboard.composio.dev";

/** The sidebar screen: Paseo's centered 720px detail column around the settings content. */
export function ComposioScreen(props: PluginScreenProps) {
  const { theme, layout } = props;
  const styles = useMemo(
    () => ({
      scroll: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        alignItems: "center" as const,
        paddingHorizontal: layout.compact ? 16 : 24,
        paddingVertical: layout.compact ? 16 : 32,
      },
      column: { width: "100%" as const, maxWidth: 720 },
    }),
    [theme, layout.compact],
  );
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.column}>
        <ComposioPage {...props} />
      </View>
    </ScrollView>
  );
}

/** Settings content. Paseo's settings shell supplies the frame for the settings screen. */
export function ComposioPage(props: PluginSurfaceProps) {
  const readStatus = useRpc(rpc.status);
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => readStatus({}),
    // Poll only while a browser sign-in waits for approval. Approval happens in another tab or
    // app, so keep polling while this one is in the background.
    refetchInterval: (query) => (query.state.data?.login ? 2_000 : false),
    refetchIntervalInBackground: true,
  });
  const setStatus = (next: Status) => {
    queryClient.setQueryData(statusKey, next);
    void queryClient.invalidateQueries({ queryKey: appsKey });
    void queryClient.invalidateQueries({ queryKey: toolkitsKey });
    refreshAppCommands();
  };

  if (status.isPending)
    return (
      <SettingsSection title="Composio">
        <SettingsCard>
          <SettingsRow label="Loading..." />
        </SettingsCard>
      </SettingsSection>
    );
  if (status.isError)
    return (
      <SettingsSection title="Composio">
        <SettingsCard>
          <SettingsAction
            label="Unable to reach Composio on this host"
            error={status.error.message}
            actionLabel="Retry"
            onPress={() => void status.refetch()}
          />
        </SettingsCard>
      </SettingsSection>
    );
  return status.data.connection ? (
    <Connected {...props} connection={status.data.connection} onStatus={setStatus} />
  ) : (
    <SignIn {...props} status={status.data} onStatus={setStatus} />
  );
}

function SignIn({
  host,
  status,
  onStatus,
}: PluginSurfaceProps & { status: Status; onStatus(status: Status): void }) {
  const toast = useToast();
  const startLogin = useRpc(rpc.startLogin);
  const cancelLogin = useRpc(rpc.cancelLogin);
  const saveKey = useRpc(rpc.saveKey);
  const input = useRef<SettingsInputHandle>(null);
  const [key, setKey] = useState("");
  const start = useMutation({
    mutationFn: () => startLogin({}),
    onSuccess: async (login) => {
      onStatus({ ...status, login, loginError: null });
      await openBrowser(login.url);
    },
  });
  const cancel = useMutation({ mutationFn: () => cancelLogin({}), onSuccess: onStatus });
  const save = useMutation({
    mutationFn: () => saveKey({ key: key.trim() }),
    onSuccess: (next) => {
      input.current?.replaceText("");
      setKey("");
      onStatus(next);
    },
  });

  async function openBrowser(url: string) {
    try {
      await openExternalUrl(url);
    } catch {
      toast.error("Unable to open the browser. Copy the link instead.");
    }
  }

  async function copyLink(url: string) {
    try {
      await copyText(url);
      toast.show("Sign-in link copied", { variant: "success" });
    } catch {
      toast.error("Unable to copy. Use Open again instead.");
    }
  }

  const { login } = status;
  return (
    <>
      <SettingsSection
        title="Composio"
        info={`Sign in once for ${host.label}. Every Paseo app and agent on this host uses the same connection.`}
      >
        <SettingsCard>
          {login ? (
            [
              <SettingsAction
                key="waiting"
                label="Waiting for approval"
                hint={`Approve code ${login.code} in Composio`}
                actionLabel="Open again"
                onPress={() => void openBrowser(login.url)}
              />,
              <SettingsAction
                key="copy"
                label="Sign-in link"
                hint="Open it on any device signed in to Composio"
                actionLabel="Copy link"
                onPress={() => void copyLink(login.url)}
              />,
              <SettingsAction
                key="cancel"
                label="Cancel sign-in"
                actionLabel={cancel.isPending ? "Cancelling..." : "Cancel"}
                disabled={cancel.isPending}
                error={cancel.error?.message}
                onPress={() => cancel.mutate()}
              />,
            ]
          ) : (
            <SettingsAction
              label="Sign in with browser"
              hint={`Connects ${host.label} to your Composio account`}
              actionLabel={start.isPending ? "Opening..." : "Sign in"}
              disabled={start.isPending}
              error={start.error?.message ?? status.loginError}
              onPress={() => start.mutate()}
            />
          )}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Use a key instead"
        info="Find your consumer key in Composio under Settings, Sessions & API Key. A consumer key gives agents Composio, but this page lists your apps only after browser sign-in."
      >
        <SettingsCard>
          <SettingsInput
            ref={input}
            label="Consumer key"
            hint="A ck_ consumer key or a uak_ user API key"
            placeholder="ck_..."
            secureTextEntry
            disabled={save.isPending}
            onChangeText={setKey}
          />
          <SettingsAction
            label="Save key"
            hint="Composio checks the key before it is saved"
            actionLabel={save.isPending ? "Saving..." : "Save"}
            disabled={!key.trim() || save.isPending}
            error={save.error?.message}
            onPress={() => save.mutate()}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function Connected({
  connection,
  onStatus,
  ...props
}: PluginSurfaceProps & { connection: Connection; onStatus(status: Status): void }) {
  const settings = useSettings(rpc.agentSettings);
  const signOutRpc = useRpc(rpc.signOut);
  const signOut = useMutation({ mutationFn: () => signOutRpc({}), onSuccess: onStatus });
  const account = connection.kind === "account" ? connection : null;
  return (
    <>
      <SettingsSection
        title="Composio"
        info={`${props.host.label} keeps this connection for every Paseo app and agent on the host.`}
      >
        <SettingsCard>
          <SettingsAction
            label={account?.email ?? "Consumer key"}
            hint={`${account ? `${account.organization} · ` : ""}Connected on ${props.host.label}`}
            actionLabel={signOut.isPending ? "Signing out..." : "Sign out"}
            disabled={signOut.isPending}
            error={signOut.error?.message}
            onPress={() => signOut.mutate()}
          />
          {settings.status === "ready" ? (
            <SettingsSwitch
              label="Add to new agents"
              hint="New agents on this host get Composio's MCP tools"
              value={settings.values.addToNewAgents}
              disabled={settings.saving}
              error={settings.saveError}
              onValueChange={(addToNewAgents) =>
                void settings.save({ ...settings.values, addToNewAgents }, settings.revision)
              }
            />
          ) : (
            <SettingsRow
              label="Add to new agents"
              hint={settings.status === "loading" ? "Loading..." : undefined}
              error={settings.status === "loading" ? undefined : settings.error}
            />
          )}
        </SettingsCard>
      </SettingsSection>
      {account ? (
        <Apps {...props} />
      ) : (
        <SettingsSection title="Apps">
          <SettingsCard>
            <SettingsRow
              label="Apps are listed after browser sign-in"
              hint="Sign out, then sign in with your browser to see your apps and tools here"
            />
          </SettingsCard>
        </SettingsSection>
      )}
    </>
  );
}

function Apps(props: PluginSurfaceProps) {
  const listApps = useRpc(rpc.apps);
  const apps = useQuery({ queryKey: appsKey, queryFn: () => listApps({}) });
  const [selected, setSelected] = useState<App | null>(null);
  return (
    <>
      <SettingsSection
        title="Apps"
        info="Apps you connected in Composio. Agents can connect another app when a task needs it."
        trailing={<ExternalLink href={dashboardUrl}>Manage</ExternalLink>}
      >
        <SettingsCard>
          {apps.isPending ? (
            <SettingsRow label="Loading apps..." />
          ) : apps.isError ? (
            <SettingsAction
              label="Unable to load apps"
              error={apps.error.message}
              actionLabel="Retry"
              onPress={() => void apps.refetch()}
            />
          ) : apps.data.apps.length === 0 ? (
            <SettingsRow
              label="No apps connected yet"
              hint="Agents ask you to connect an app when a task needs it"
            />
          ) : (
            apps.data.apps.map((app) => (
              <View key={app.slug} style={appRowStyle}>
                <AppLogo app={app} theme={props.theme} />
                <View style={appActionStyle}>
                  <SettingsAction
                    label={app.name}
                    hint={appHint(app)}
                    error={
                      app.accounts.some((account) => account.status === "ACTIVE")
                        ? undefined
                        : "Expired. Reconnect it in Composio"
                    }
                    actionLabel="Tools"
                    onPress={() => setSelected(app)}
                  />
                </View>
              </View>
            ))
          )}
        </SettingsCard>
      </SettingsSection>
      {selected ? <ToolsModal {...props} app={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

// SettingsAction has no leading slot; its row supplies the 16px inset after the logo.
const appRowStyle = { flexDirection: "row", alignItems: "center", paddingLeft: 16 } as const;
const appActionStyle = { flex: 1, minWidth: 0 } as const;
const logoSize = 28;

/** Composio's toolkit logo, or a blank tile of the same size so labels stay aligned. */
function AppLogo({ app, theme }: { app: App; theme: PluginSurfaceProps["theme"] }) {
  const [failed, setFailed] = useState(false);
  const frame = { width: logoSize, height: logoSize, borderRadius: 6 };
  if (!app.logo || failed) {
    return <View style={[frame, { backgroundColor: theme.colors.surface2 }]} />;
  }
  return (
    <Image
      source={{ uri: app.logo }}
      style={frame}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      onError={() => setFailed(true)}
    />
  );
}

function appHint(app: App) {
  const labels = [...new Set(app.accounts.flatMap((account) => account.label ?? []))];
  const expired = app.accounts.filter((account) => account.status !== "ACTIVE").length;
  const accounts = app.accounts.length === 1 ? "1 account" : `${app.accounts.length} accounts`;
  return [
    labels.length > 0 ? labels.join(", ") : accounts,
    expired > 0 && expired < app.accounts.length ? `${expired} expired` : null,
    app.toolsCount === null ? null : `${app.toolsCount} tools`,
  ]
    .filter(Boolean)
    .join(" · ");
}
