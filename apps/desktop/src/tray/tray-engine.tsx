import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  expectedAgentStops,
  loadConfig,
  runningAgents,
  setTrayMenu,
  setTrayStatus,
  startAgent,
  stopAgent,
  type ConfigInfo,
  type TrayMenuEntry,
} from "@/lib/backend";
import { getCliBin } from "@/lib/cli-bin";
import { getVerboseLoggingPref } from "@/lib/verbose-logging";
import { notify } from "@/lib/notifications";
import { useActiveThreads, type ActiveThread } from "@/lib/active-threads";

/** Fallback for deployments predating location.appUrl in listActiveForUser. */
const CONVOY_WEB_URL = "https://app.convoy.build";

const CLI_TYPE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  "cursor-agent": "Cursor",
};

/**
 * Tray engine (OS-1237): a headless component in the hidden main window that feeds the
 * NATIVE tray menu and icon state. It owns the Convex thread subscriptions and the
 * running_agents poll, rebuilding the menu via set_tray_menu on every change; clicks come
 * back through the "tray-menu-action" event. Process health comes from the supervisor,
 * thread state from the server — the CLI learns thread state from the same subscription,
 * so there is no local source to prefer.
 */
export function TrayEngine() {
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  // Profile keys with a live agent child (OS-1274: one per profile).
  const [running, setRunning] = useState<string[] | null>(null);
  // Coarse clock for elapsed labels; menus only refresh while closed anyway.
  const [now, setNow] = useState(() => Date.now());
  const { threads, ready } = useActiveThreads(config);

  // Config changes land through the settings UI in this same webview; a slow
  // poll keeps external edits (CLI, editor) from being missed forever.
  useEffect(() => {
    const reload = () =>
      void loadConfig()
        // loadConfig always returns a fresh object, so identity alone would
        // re-render (and rebuild the native menu) every 30s forever. Only
        // accept a structurally different config.
        .then((next) =>
          setConfig((previous) =>
            previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next
          )
        )
        .catch(() => {});
    reload();
    window.addEventListener("focus", reload);
    const interval = setInterval(reload, 30_000);
    return () => {
      window.removeEventListener("focus", reload);
      clearInterval(interval);
    };
  }, []);

  const refreshRunning = useCallback(() => {
    void runningAgents()
      .then((keys) => {
        keys.sort();
        // Keep the previous array identity when nothing changed, so the 3s
        // poll doesn't rebuild the native menu (which closes it if open).
        setRunning((previous) =>
          previous && previous.length === keys.length && previous.every((key, i) => key === keys[i])
            ? previous
            : keys
        );
      })
      .catch(() => {});
  }, []);

  // This poll forks `ps` and parses the whole process table, for the app's entire lifetime (the
  // tray engine outlives the window). 3s only bought faster "agent disconnected" detection on a
  // surface nobody is watching; 15s keeps that within a menu-open's reach at a fifth the cost.
  // Toggling an agent calls refreshRunning() directly, so the UI stays snappy.
  useEffect(() => {
    refreshRunning();
    const interval = setInterval(refreshRunning, 15_000);
    return () => clearInterval(interval);
  }, [refreshRunning]);

  // Only streaming rows render an elapsed label, so an idle tray has nothing
  // to re-time — ticking anyway rebuilt the whole native menu twice a minute.
  const hasStreamingThread = threads.some((thread) => thread.processingState === "streaming");
  useEffect(() => {
    if (!hasStreamingThread) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [hasStreamingThread]);

  // Notifications (OS-1240): diff each thread snapshot against the previous
  // one. The first post-ready snapshot only seeds the baseline — pre-existing
  // waiting/failed threads must not fire a burst on app start.
  const prevThreadsRef = useRef<Map<string, ActiveThread> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const current = new Map(threads.map((thread) => [thread._id, thread]));
    const previous = prevThreadsRef.current;
    prevThreadsRef.current = current;
    if (previous === null) return;

    for (const thread of current.values()) {
      const before = previous.get(thread._id);
      if (thread.requiresAttention && !before?.requiresAttention) {
        void notify(thread.status === "failed" ? "Agent run failed" : "Needs your input", threadLabel(thread));
      } else if (
        before &&
        before.processingState !== "idle" &&
        thread.processingState === "idle" &&
        !thread.requiresAttention
      ) {
        void notify("Thread finished", threadLabel(thread));
      }
    }
    // Completed threads usually drop out of the active list entirely.
    for (const [id, before] of previous) {
      if (!current.has(id) && before.processingState !== "idle" && !before.requiresAttention) {
        void notify("Thread finished", threadLabel(before));
      }
    }
  }, [threads, ready]);

  // A profile key vanishing from running_agents without a user-initiated stop
  // means the `convoy connect` child died — the closest thing to
  // "connection lost" the supervisor can observe.
  const prevRunningRef = useRef<string[] | null>(null);
  useEffect(() => {
    const previous = prevRunningRef.current;
    prevRunningRef.current = running;
    if (previous === null || running === null) return;
    for (const key of previous) {
      if (running.includes(key)) continue;
      if (expectedAgentStops.delete(key)) continue;
      const name = config?.profiles.find((profile) => profile.key === key)?.name ?? key;
      void notify("Agent disconnected", `${name} — convoy connect exited unexpectedly`);
    }
  }, [running, config]);

  // Memoized: `listed` is a dependency of the menu-rebuild effect, so a fresh
  // array identity on every render would rebuild the native NSMenu each time.
  const listed = useMemo(
    () => threads.filter((thread) => thread.processingState !== "idle" || thread.requiresAttention),
    [threads]
  );
  const queuedCount = threads.length - listed.length;
  const activeCount = threads.filter((thread) => thread.processingState !== "idle").length;
  // ponytail: coarse "no agents at all" check — threads carry no local profile
  // key, so per-profile "your agent is down" needs a thread→profile mapping first.
  const allStopped = running !== null && running.length === 0;
  const needsAttention = threads.some((thread) => thread.requiresAttention) || (queuedCount > 0 && allStopped);

  // Tray icon state: "!" needs attention, count while running, else clean.
  useEffect(() => {
    const title = needsAttention ? "!" : activeCount > 0 ? String(activeCount) : "";
    const tooltip = allStopped
      ? "Convoy — agents stopped"
      : activeCount > 0
        ? `Convoy — ${activeCount} thread${activeCount === 1 ? "" : "s"} running`
        : "Convoy — idle";
    void setTrayStatus(title, tooltip).catch(() => {});
  }, [needsAttention, activeCount, allStopped]);

  // Native menu model, ChatGPT-menubar style: one enabled row per agent and
  // per thread, each with a gray native subtitle (NSMenuItem.subtitle) for
  // the meta line — no disabled section headers between items.
  const lastMenuRef = useRef<string | null>(null);
  useEffect(() => {
    const entries: TrayMenuEntry[] = [];
    const profiles = config?.profiles ?? [];
    if (profiles.length === 0) {
      entries.push({ kind: "header", text: "Convoy" });
    }
    for (const profile of profiles) {
      const isRunning = running === null ? null : running.includes(profile.key);
      // U+FE0E after the glyph forces the small monochrome text variant
      // (native NSImage menu icons come at a fixed, larger size).
      entries.push({
        kind: "item",
        id: `toggle-agent:${profile.key}`,
        text: isRunning ? "⏸︎ Pause Agent" : "▶︎ Start Agent",
        subtext: `${profile.name} — ${isRunning === null ? "…" : isRunning ? "Connected" : "Stopped"}`,
      });
    }
    entries.push({ kind: "separator" });

    if (listed.length === 0) {
      entries.push({ kind: "header", text: queuedCount > 0 ? "Nothing running yet" : "Nothing running" });
    }
    for (const thread of listed) {
      const title = threadLabel(thread);
      const state = thread.requiresAttention
        ? "needs attention"
        : thread.processingState === "streaming"
          ? formatElapsed(now - thread.lastActivityAt)
          : "starting";
      entries.push({
        kind: "item",
        id: `thread:${thread._id}`,
        text: `${title} — ${state}`,
        subtext: threadMeta(thread),
      });
    }
    if (queuedCount > 0) {
      entries.push({
        kind: "header",
        text: `${queuedCount} more thread${queuedCount === 1 ? "" : "s"} queued${allStopped ? " — agents stopped" : ""}`,
      });
    }
    entries.push({ kind: "separator" });

    entries.push({ kind: "item", id: "open-web", text: "Open Convoy" });
    entries.push({ kind: "item", id: "settings", text: "Settings…" });
    entries.push({ kind: "separator" });
    entries.push({ kind: "item", id: "quit", text: "Quit Convoy" });

    // Every rebuild allocates a new NSMenu plus one NSMenuItem/NSString per
    // row and drops the previous tree through Tauri's deferred main-thread
    // drop. Thread rows change on activity the menu doesn't render (chunk
    // appends, read state), so compare the rendered model and skip no-ops.
    const rendered = JSON.stringify(entries);
    if (rendered === lastMenuRef.current) return;
    lastMenuRef.current = rendered;
    void setTrayMenu(entries).catch(() => {
      // Retry on the next change: the native menu no longer matches the model.
      lastMenuRef.current = null;
    });
  }, [config, running, allStopped, listed, queuedCount, now]);

  const toggleAgent = useCallback(
    async (profileKey: string) => {
      if (running === null) return;
      try {
        if (running.includes(profileKey)) {
          await stopAgent(profileKey);
        } else {
          await startAgent(profileKey, getCliBin(), getVerboseLoggingPref());
        }
      } finally {
        refreshRunning();
      }
    },
    [running, refreshRunning]
  );

  // Dynamic menu clicks arrive from Rust (static ids are handled there).
  const threadsRef = useRef<ActiveThread[]>(threads);
  threadsRef.current = threads;
  const toggleAgentRef = useRef(toggleAgent);
  toggleAgentRef.current = toggleAgent;

  useEffect(() => {
    const unlisten = listen<string>("tray-menu-action", (event) => {
      const id = event.payload;
      if (id.startsWith("toggle-agent:")) {
        void toggleAgentRef.current(id.slice("toggle-agent:".length));
        return;
      }
      if (id.startsWith("thread:")) {
        const thread = threadsRef.current.find((candidate) => `thread:${candidate._id}` === id);
        if (thread) {
          const { organizationSlug, projectAlias, appUrl } = thread.location;
          void openUrl(`${appUrl ?? CONVOY_WEB_URL}/o/${organizationSlug}/${projectAlias}/threads/${thread._id}`);
        }
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return null;
}

/** Long titles blow up the native menu width — truncate before they reach NSMenu. */
const THREAD_TITLE_MAX = 44;

function threadLabel(thread: ActiveThread): string {
  const title =
    thread.title.length > THREAD_TITLE_MAX ? `${thread.title.slice(0, THREAD_TITLE_MAX).trimEnd()}…` : thread.title;
  return thread.associatedTask?.refId ? `${thread.associatedTask.refId} · ${title}` : title;
}

function threadMeta(thread: ActiveThread): string {
  const label = CLI_TYPE_LABELS[thread.cliType] ?? thread.cliType;
  return `${label} · ${thread.branch ? `${thread.pathLabel} (${thread.branch})` : thread.pathLabel}`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
