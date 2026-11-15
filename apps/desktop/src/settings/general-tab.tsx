import { useCallback, useEffect, useState, type ReactNode } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/status-chip";
import { runningAgents, startAgent, stopAgent, type ConfigInfo, type ProfileInfo } from "@/lib/backend";
import { getCliBin } from "@/lib/cli-bin";
import { getVerboseLoggingPref } from "@/lib/verbose-logging";
import { applyDockIconPref, getDockIconPref } from "@/lib/dock";
import { ensureNotificationPermission, getNotificationsPref, setNotificationsPref } from "@/lib/notifications";

export function GeneralTab({
  config,
  defaultProfileKey,
}: {
  config: ConfigInfo;
  defaultProfileKey?: string;
}) {
  return (
    <div className="flex flex-col">
      <AgentList config={config} defaultProfileKey={defaultProfileKey} />
      <LaunchAtLoginRow />
      <DockIconRow />
      <NotificationsRow />
    </div>
  );
}

/** One supervisor child per profile (OS-1274): each row starts/stops its own agent. */
function AgentList({ config, defaultProfileKey }: { config: ConfigInfo; defaultProfileKey?: string }) {
  const [running, setRunning] = useState<string[] | null>(null);

  const refresh = useCallback(() => {
    void runningAgents().then(setRunning);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (config.profiles.length === 0) return null;

  return (
    <div className="mb-4 divide-y divide-border rounded-lg border border-border bg-card px-4">
      {config.profiles.map((profile) => (
        <AgentRow
          key={profile.key}
          profile={profile}
          isDefault={profile.key === defaultProfileKey}
          running={running === null ? null : running.includes(profile.key)}
          refresh={refresh}
        />
      ))}
    </div>
  );
}

function AgentRow({
  profile,
  isDefault,
  running,
  refresh,
}: {
  profile: ProfileInfo;
  isDefault: boolean;
  running: boolean | null;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (running) {
        await stopAgent(profile.key);
      } else {
        const result = await startAgent(profile.key, getCliBin(), getVerboseLoggingPref());
        if (!result.ok) {
          setError(
            result.error === "cli-not-found"
              ? getCliBin() === "convoy-dev"
                ? "Dev CLI not found in the source tree (node_modules/.bin/tsx + apps/cli/bin/convoy.ts)."
                : "The convoy CLI is not installed. Run: npm install -g @useconvoy/cli"
              : (result.error ?? "Could not start the agent.")
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.includes("multiple-local-agents")
          ? "More than one local connection uses this profile. Stop the intended one in Advanced."
          : message
      );
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{profile.name}</div>
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {profile.key}
            {isDefault ? " · default" : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusChip
            tone={running ? "success" : "muted"}
            label={running === null ? "…" : running ? "Agent running" : "Agent stopped"}
          />
          <Button variant="quiet" size="sm" disabled={busy || running === null} onClick={() => void toggle()}>
            {running ? "Stop agent" : "Start agent"}
          </Button>
        </div>
      </div>
      {error ? <div className="mt-2 text-[12.5px] text-destructive">{error}</div> : null}
    </div>
  );
}

function NotificationsRow() {
  const [enabled, setEnabled] = useState(getNotificationsPref);

  function toggle(next: boolean) {
    setEnabled(next);
    setNotificationsPref(next);
    // Surface the macOS permission prompt at opt-in, not at first delivery.
    if (next) void ensureNotificationPermission();
  }

  return (
    <SettingRow
      title="Thread notifications"
      description="Native notifications when a thread finishes, needs your input, fails, or an agent disconnects."
    >
      <Switch checked={enabled} onCheckedChange={toggle} />
    </SettingRow>
  );
}

function LaunchAtLoginRow() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isEnabled()
      .then(setEnabled)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next); // optimistic; revert on failure
    setError(null);
    try {
      if (next) {
        await enable();
      } else {
        await disable();
      }
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingRow
      title="Launch at login"
      description="Start Convoy when you log in, so agents are reachable without opening the app."
      error={error}
    >
      <Switch disabled={enabled === null} checked={enabled ?? false} onCheckedChange={(next) => void toggle(next)} />
    </SettingRow>
  );
}

function DockIconRow() {
  const [visible, setVisible] = useState(getDockIconPref);

  async function toggle(next: boolean) {
    setVisible(next);
    await applyDockIconPref(next).catch(() => {});
  }

  return (
    <SettingRow
      title="Show Dock icon"
      description="Off switches to tray-only mode. A crowded menu bar can hide the tray icon — the Dock icon is the reliable way back in."
    >
      <Switch checked={visible} onCheckedChange={(next) => void toggle(next)} />
    </SettingRow>
  );
}

function SettingRow({
  title,
  description,
  error,
  children,
}: {
  title: string;
  description: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-6 border-b border-border py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</div>
        {error ? <div className="mt-1 text-[12.5px] text-destructive">{error}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
