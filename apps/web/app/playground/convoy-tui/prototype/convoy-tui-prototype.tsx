"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { AppLink, routeTarget } from "@/lib/navigation";
import { SAMPLE_CREDENTIALS, type Credential, ENVIRONMENTS, HISTORY, REMOTE_RUNS, RUNS, type Run } from "./fixtures";
import { LogView } from "./log-view";
import { ConnectionPanel } from "./connection-panel";
import { ConnectionsSidebar } from "./connections-sidebar";
import { ActionsPanel } from "./actions-panel";
import { SetupForm, type SetupResult } from "./setup-form";
import styles from "./terminal.module.css";

type Scenario = "Connected" | "Reconnecting" | "Empty" | "Disconnected";
const SCENARIOS: Scenario[] = ["Connected", "Reconnecting", "Empty", "Disconnected"];
const SYMBOLS: Record<Run["status"], string> = { running: "●", waiting: "?", queued: "○", completed: "✓", failed: "!", canceled: "■" };

export function ConvoyTuiPrototype() {
  const [credentialStores, setCredentialStores] = useState<Record<string, Credential[]>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [actions, setActions] = useState(false);
  const [environments, setEnvironments] = useState(ENVIRONMENTS);
  const [activePane, setActivePane] = useState<"connections" | "runs">("runs");
  const [drawer, setDrawer] = useState(false);
  const [setup, setSetup] = useState<{ environment: string | null } | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const [environmentId, setEnvironmentId] = useState("test");
  const [runsByEnvironment, setRunsByEnvironment] = useState<Record<string, Run[]>>({ test: RUNS, "build-vm": REMOTE_RUNS });
  const environment = environments.find(item => item.id === environmentId) ?? ENVIRONMENTS[0];
  const runs = runsByEnvironment[environmentId] ?? [];
  const [selected, setSelected] = useState(RUNS[0].id);
  const [detail, setDetail] = useState(false);
  const [profile, setProfile] = useState("all");
  const [scenario, setScenario] = useState<Scenario>("Connected");
  const [narrow, setNarrow] = useState(false);
  const [detached, setDetached] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [help, setHelp] = useState(false);
  const [older, setOlder] = useState(false);
  const [following, setFollowing] = useState(true);
  const [events, setEvents] = useState(0);
  const [unread, setUnread] = useState(0);
  const terminal = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const visible = scenario === "Empty" ? [] : runs.filter(run => profile === "all" || run.profile === profile);
  const current = visible.find(run => run.id === selected) ?? visible[0];
  const connectionSelected = profile === "connection" || profile === "credentials";
  const online = scenario === "Connected";
  const active = runs.filter(run => run.status === "running").length;
  const queued = runs.filter(run => run.status === "queued").length;
  const cancelable = current && ["running", "waiting", "queued"].includes(current.status);

  const logEntries = current ? [
    ...(older ? [{ sequence: 0, type: "run.created", runId: current.id, profile: current.profile }] : []),
    ...(current.id === "r-104" ? HISTORY : [{ sequence: 1, type: "message", role: "user", content: current.title }]),
    ...Array.from({ length: events }, (_, index) => ({
      sequence: 6 + index, type: "notification", method: "item/agentMessage/delta",
      params: { itemId: "item-03", delta: `Sample update ${index + 1}: checked another history page.` },
    })),
    { type: "run.status", runId: current.id, status: current.status, message: current.activity },
  ] : [];

  function switchEnvironment(id: string, nextProfile = "all", stayInSidebar = false) {
    if (actionBusy) return;
    if (profile === "credentials" && nextProfile === "connection") nextProfile = "credentials";
    if (nextProfile === "credentials") setActions(true);
    setEnvironmentId(id); setDetail(false); setProfile(nextProfile); setDrawer(false); setSetup(null);
    setSelected(runsByEnvironment[id]?.[0]?.id ?? ""); setConfirm(false); setHelp(false);
    setScenario("Connected"); setDetached(false); setUnread(0); setEvents(0);
    if (stayInSidebar) focusConnections(); else focusTerminal();
  }
  function focusConnections() {
    if (actionBusy) return;
    setActivePane("connections"); setDetail(false); setHelp(false); setDrawer(true);
    requestAnimationFrame(() => sidebar.current?.focus());
  }
  function saveSetup({ name, mode, location, profileKey, projectKey, endpoint, existing, runtimes }: SetupResult) {
    if (!setup) return;
    const id = `sample-${environments.reduce((count, item) => count + item.profiles.length, 0) + 1}`;
    if (setup.environment) {
      setEnvironments(items => items.map(item => item.id === setup.environment ? { ...item, profiles: [...item.profiles, {
        id, key: profileKey, name, endpoint, project: mode === "Create new project" ? `sample-${projectKey}` : existing, path: location, skill: false,
      }] } : item));
      switchEnvironment(setup.environment, id);
    } else {
      setEnvironments(items => [...items, { ...ENVIRONMENTS[0], id: name, transport: mode === "Remote SSH" ? "SSH" : "Docker", address: location, profiles: [], runtimes: runtimes.join(" · "), workspaceRoot: mode === "Remote SSH" ? "/srv/convoy-workspaces" : "/workspace", instance: "sample-instance", uptime: "0m", latency: "n/a" }]);
      setRunsByEnvironment(items => ({ ...items, [name]: [] }));
      switchEnvironment(name);
    }
  }
  function focusTerminal() {
    setActivePane("runs"); setDrawer(false); terminal.current?.focus();
    if (actions) requestAnimationFrame(() => terminal.current?.querySelector<HTMLButtonElement>('[aria-label="Context actions"] button')?.focus());
  }
  function openActions() { if (profile === "credentials") setProfile("connection"); setActions(true); setDetail(false); setConfirm(false); setHelp(false); setDrawer(false); focusTerminal(); }
  function openRun(id: string) {
    setSelected(id); setDetail(true); setOlder(false); setFollowing(true); setEvents(0); setUnread(0); focusTerminal();
    requestAnimationFrame(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; });
  }
  function follow() {
    setFollowing(true); setUnread(0);
    requestAnimationFrame(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; });
  }
  function addEvent() {
    setEvents(count => count + 1);
    if (following) follow(); else setUnread(count => count + 1);
  }
  function cancel() {
    if (!online || !current) return;
    setRunsByEnvironment(items => ({ ...items, [environmentId]: items[environmentId].map(run => run.id === current.id ? { ...run, status: "canceled", activity: "Canceled by you · visible to all attached clients" } : run) }));
    setConfirm(false);
  }
  function closeActions() {
    if (profile === "credentials") setProfile("connection");
    setActions(false);
    if (activePane === "connections") focusConnections(); else focusTerminal();
  }
  function performAction(action: string, version?: string) {
    if (action === "Environment maintenance started") setScenario("Reconnecting");
    if (action === "Environment recovery pending") setScenario("Disconnected");
    if (["Stop service", "Stop environment"].includes(action)) setScenario("Disconnected");
    if (["Start service", "Start environment", "Restart environment", "Update environment", "Verify isolation"].includes(action)) setScenario("Connected");
    if (action === "Update environment") setEnvironments(items => items.map(item => item.id === environmentId ? { ...item, serviceVersion: version || item.clientVersion } : item));
    if (action === "Verify isolation") setEnvironments(items => items.map(item => item.id === environmentId ? { ...item, isolated: true } : item));
    if (["Pause project", "Open private shell", "Remove registration"].includes(action)) {
      setRunsByEnvironment(items => ({ ...items, [environmentId]: (items[environmentId] ?? []).map(run => run.profile === profile && ["running", "queued", "waiting"].includes(run.status) ? { ...run, status: "canceled", activity: "Project connection paused in preview" } : run) }));
    }
    if (action === "Remove registration") {
      setEnvironments(items => items.map(item => item.id === environmentId ? { ...item, profiles: item.profiles.filter(item => item.id !== profile) } : item));
      setProfile("all"); setActions(false); focusConnections();
    }
    if (action === "Cancel selected run") cancel();
    if (action === "Open run logs" && current) { setActions(false); openRun(current.id); }
  }
  function onTabShortcut(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || actionBusy || confirm || setup || detached || detail || help) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === "k" && connectionSelected) { event.preventDefault(); event.stopPropagation(); setProfile("credentials"); setActions(true); return; }
    if (key !== "a" && key !== (connectionSelected ? "d" : "r")) return;
    event.preventDefault(); event.stopPropagation();
    if (key === "a") { if (!actions || profile === "credentials") openActions(); }
    else if (actions) closeActions();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (actions) {
      if (actionBusy) return;
      if (event.key === "ArrowLeft" || event.key === "e" || event.key === "p") { event.preventDefault(); focusConnections(); }
      if (event.key === "ArrowRight") { event.preventDefault(); focusTerminal(); }
      if (event.key === "Escape") closeActions();
      return;
    }
    if (event.target instanceof HTMLInputElement && event.key !== "Escape") return;

    if (setup) return;
    if (event.key === "Tab" && !detail) {
      event.preventDefault(); focusConnections(); return;
    }
    if (event.target instanceof HTMLButtonElement && ["Enter", " "].includes(event.key)) return;
    const key = event.key;
    if (key === "Escape") { event.preventDefault(); if (confirm) setConfirm(false); else if (help) setHelp(false); else { setDrawer(false); setDetail(false); } return; }
    if (event.ctrlKey && key === "c") {
      const selection = window.getSelection();
      if (selection?.toString() && selection.anchorNode && terminal.current?.contains(selection.anchorNode)) return;
      event.preventDefault(); setDetached(true); setConfirm(false); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || detached) return;
    if (confirm) { if (key === "y") cancel(); if (key === "n") setConfirm(false); return; }
    if (key === "e" || key === "p") { focusConnections(); return; }
    if (key === "?") { setHelp(value => !value); return; }
    if (help) return;
    if (!detail && key === "ArrowLeft") { event.preventDefault(); focusConnections(); return; }
    if (!detail && key === "ArrowRight") { event.preventDefault(); focusTerminal(); return; }
    if (connectionSelected) {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(key)) {
        event.preventDefault();
        const node = terminal.current?.querySelector<HTMLElement>('[aria-label="Connection details"]');
        if (node) node.scrollTop = key === "Home" ? 0 : key === "End" ? node.scrollHeight : node.scrollTop + (key === "ArrowUp" ? -44 : key === "ArrowDown" ? 44 : key === "PageUp" ? -node.clientHeight : node.clientHeight);
      }
      return;
    }
    if (key === "c" && cancelable && online) { setConfirm(true); return; }
    if (detail) {
      if (key === "f") { follow(); return; }
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(key)) {
        event.preventDefault();
        if (key === "End") { follow(); return; }
        setFollowing(false);
        const panel = transcript.current;
        if (panel) panel.scrollTop = key === "Home" ? 0 : panel.scrollTop + (key === "ArrowUp" ? -44 : key === "ArrowDown" ? 44 : key === "PageUp" ? -panel.clientHeight : panel.clientHeight);
      }
      return;
    }
    if (["ArrowDown", "j", "ArrowUp", "k"].includes(key)) {
      event.preventDefault();
      const next = Math.max(0, Math.min(visible.length - 1, visible.findIndex(run => run.id === current?.id) + (["ArrowDown", "j"].includes(key) ? 1 : -1)));
      if (visible[next]) {
        setSelected(visible[next].id);
        document.getElementById(`run-${visible[next].id}`)?.scrollIntoView?.({ block: "nearest" });
      }
    }
    if (key === "Enter" && current) { event.preventDefault(); openRun(current.id); }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-3">
          <AppLink href={routeTarget("/playground")} className="text-sm text-muted-foreground hover:text-foreground">← Playground</AppLink>
          <div className="flex flex-wrap items-baseline gap-3"><h1 className="text-2xl font-semibold">Convoy terminal</h1><span className="text-xs text-muted-foreground">OS-1997 · design proposal</span></div>
          <p className="max-w-3xl text-sm text-muted-foreground">A run list first. Open a run to inspect and copy its raw JSON logs. This browser prototype uses sample data; the CLI will use Ink.</p>
        </header>
        <div className="flex flex-wrap items-center gap-2" aria-label="Prototype controls">
          {SCENARIOS.map(value => <Button key={value} size="sm" variant={scenario === value ? "secondary" : "outline"} aria-pressed={scenario === value} onClick={() => { setScenario(value); setConfirm(false); if (value === "Empty") setDetail(false); setDetached(false); }}>{value}</Button>)}
          <span className="mx-1 h-4 border-l border-border" />
          <Button size="sm" variant="outline" aria-pressed={narrow} onClick={() => setNarrow(value => !value)}>Narrow terminal</Button>
          <Button size="sm" variant="outline" disabled={actions || !detail || !online || detached || current?.status !== "running"} onClick={addEvent}>Simulate new output</Button>
          <Button size="sm" variant="ghost" onClick={() => { setCredentialStores({}); setActions(false); setEnvironments(ENVIRONMENTS); setSetup(null); setDrawer(false); setRunsByEnvironment({ test: RUNS, "build-vm": REMOTE_RUNS }); setEnvironmentId("test"); setDetached(false); setDetail(false); setConfirm(false); setHelp(false); setScenario("Connected"); setProfile("all"); setSelected(RUNS[0].id); }}>Reset</Button>
        </div>
        <div className={`${styles.terminal} ${narrow ? styles.narrow : ""}`} ref={terminal} data-active-pane={activePane} tabIndex={0} onKeyDownCapture={onTabShortcut} onKeyDown={onKeyDown} aria-label="Convoy terminal preview" aria-describedby="terminal-instructions">
          <div className={styles.header}>
            <strong>convoy</strong><button disabled={detached || actionBusy || !!setup} onClick={focusConnections}>[e] {environment.id} / {environment.transport}</button>
            <span className={styles.right}>client {environment.clientVersion} · service {environment.serviceVersion}</span>
          </div>
          <div className={styles.endpointSummary}>
            <span>{environment.address}</span>
            <span>{(profile === "all" || connectionSelected) ? `${environment.profiles.length} Convex endpoints · all profiles` : environment.profiles.find(item => item.id === profile)?.endpoint}</span>
          </div>
          <div className={styles.workspace}>
          <div style={{ display: detached || detail || help ? "none" : undefined }} className={`${styles.sidebarShell} ${drawer ? styles.drawerOpen : ""}`}>
            <ConnectionsSidebar locked={actionBusy || !!setup} status={detached ? "Unknown" : scenario === "Disconnected" ? "Unavailable" : scenario === "Empty" ? "Connected" : scenario} environments={environments} active={environmentId} profile={profile === "credentials" ? "connection" : profile} sidebarRef={sidebar} onActivate={() => setActivePane("connections")} onSelect={(id, nextProfile) => switchEnvironment(id, nextProfile, true)} onAdd={id => { focusTerminal(); setActions(false); setSetup({ environment: id }); setConfirm(false); }} onRuns={() => { setDrawer(false); focusTerminal(); }} />
          </div>
          <div className={styles.mainPane}>
          {!detached && !setup && !detail && !help && <div className={styles.viewTabs} role="tablist" aria-label="Target view">
            <button role="tab" aria-label={connectionSelected ? "Details" : "Runs"} aria-keyshortcuts={connectionSelected ? "d" : "r"} aria-selected={!actions} disabled={actionBusy} onClick={closeActions}><span aria-hidden="true">{connectionSelected ? "[d] " : "[r] "}</span>{connectionSelected ? "Details" : "Runs"}</button>
            <button role="tab" aria-label="Actions" aria-keyshortcuts="a" aria-selected={actions && profile !== "credentials"} disabled={actionBusy} onClick={openActions}><span aria-hidden="true">[a] </span>Actions</button>
            {connectionSelected && <button role="tab" aria-label="Credentials" aria-keyshortcuts="k" aria-selected={profile === "credentials"} disabled={actionBusy} onClick={() => { setProfile("credentials"); setActions(true); focusTerminal(); }}>[k] Credentials</button>}
            <span className={styles.muted}>{environment.id}{profile === "all" ? " / All projects" : connectionSelected ? "" : ` / ${environment.profiles.find(item => item.id === profile)?.name}`}</span>
          </div>}
          {actions ? <ActionsPanel key={`${environmentId}/${profile}`} environment={environment} keys={credentialStores[environmentId] ?? SAMPLE_CREDENTIALS} setKeys={update => setCredentialStores(items => ({ ...items, [environmentId]: update(items[environmentId] ?? SAMPLE_CREDENTIALS) }))} profile={profile} run={current} online={online} focusOnOpen={activePane === "runs"} onBusyChange={setActionBusy} onSidebar={focusConnections} onActivate={() => setActivePane("runs")} onClose={closeActions} onAction={performAction} /> : <>
          {setup ? <SetupForm key={setup.environment ?? "new"} environment={setup.environment} workspaceRoot={environments.find(item => item.id === setup.environment)?.workspaceRoot ?? "/workspace"} existingNames={setup.environment ? environments.find(item => item.id === setup.environment)?.profiles.map(item => item.key) ?? [] : environments.map(item => item.id)} onClose={() => { setSetup(null); focusTerminal(); }} onSave={saveSetup} /> : detached ? <div className={styles.empty}><strong>Detached from {environment.id}.</strong><p>Your agents are still running. Only this client disconnected.</p><button onClick={() => { setDetached(false); focusTerminal(); }}>↵ Reattach</button></div> : <>
            {!connectionSelected && <div className={styles.toolbar}>
              {detail && current ? <><button onClick={() => setDetail(false)}>← runs</button><strong>{current.task}</strong><span>{current.id}</span><span className={styles.right}>{current.runtime}</span></> : <><strong>Runs</strong><span className={styles.muted}>{profile === "all" ? "All projects" : environment.profiles.find(item => item.id === profile)?.name}</span><span className={styles.right}>{visible.length} runs</span></>}
            </div>}
            {scenario !== "Connected" && scenario !== "Empty" && <div role="status" className={styles.notice}>{scenario === "Reconnecting" ? "↻ Reconnecting · retry 2/5 · showing last snapshot" : "! Service unavailable · showing last snapshot"} · controls paused</div>}
            {connectionSelected && !help ? <ConnectionPanel environment={environment} profile="all" stale={!online} /> : help ? <div className={styles.empty}><strong>Keyboard shortcuts</strong><p>↑ ↓ / j k select · Enter open · Esc back</p><p>← → switch panes · Tab also works · p connections · f follow output · c cancel run</p><p>PgUp / PgDn scroll · Home / End history / latest</p><p>r Runs · d Details · a Actions · k Credentials · e connections</p><p>Ctrl+C detach · ? close help</p><button onClick={() => setHelp(false)}>Close help</button></div> : detail && current ? <>
              <div className={styles.detailTitle}><strong>{current.title}</strong><span className={styles[current.status]}>{SYMBOLS[current.status]} {current.status}</span><span>{current.profile} · {current.elapsed}</span></div>
              <div className={styles.transcript} ref={transcript} aria-label="Run transcript" onScroll={event => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight > 30) setFollowing(false); }}>
                <button disabled={older || !online} className={styles.muted} onClick={() => { setFollowing(false); setOlder(true); }}>{older ? "Beginning of run" : "↑ Load older history"}</button>
                <LogView key={current.id} entries={logEntries} />
              </div>
              <div className={styles.follow}><span>{following ? "● Following output" : "Ⅱ Scroll paused"}</span><button onClick={follow}>[f] {unread > 0 ? `${unread} new updates · ` : ""}Jump to latest</button></div>
            </> : visible.length === 0 ? <div className={styles.empty}><strong>No runs yet.</strong><p>Start a task in the Convoy web app. Its run will appear here.</p><p>Connected to {environment.id} · waiting for activity</p></div> : <div className={styles.list} role="listbox" aria-label="Agent runs" aria-activedescendant={`run-${current?.id}`}>
              <div className={styles.columns} aria-hidden="true"><span>RUN / TASK</span><span>PROFILE</span><span>STATE</span><span>ELAPSED</span></div>
              {visible.map(run => <div key={run.id} id={`run-${run.id}`} role="option" aria-selected={run.id === current?.id} className={`${styles.row} ${run.id === current?.id ? styles.selected : ""}`} onClick={() => { setSelected(run.id); focusTerminal(); }} onDoubleClick={() => openRun(run.id)}>
                <div className={styles.runTitle}><span>{run.id === current?.id ? "›" : " "} {run.task} <span className={styles.muted}>· {run.id}</span></span><strong>{run.title}</strong><span className={styles.muted}>{run.activity}</span></div>
                <span className={styles.profile}>{run.profile}<span className={styles.muted}>{run.runtime}</span></span><span className={styles[run.status]}>{SYMBOLS[run.status]} {run.status}</span><span className={styles.elapsed}>{run.elapsed}</span>
              </div>)}
            </div>}
            {confirm && current && <div role="alertdialog" aria-label="Cancel this run?" className={styles.confirm}><strong>Cancel {current.task} / {current.id}?</strong><p>This stops the run for everyone attached to {environment.id}.</p><button onClick={cancel}>[y] Cancel run</button> <button onClick={() => setConfirm(false)}>[n / Esc] Keep running</button></div>}
            <div className={styles.shortcuts}>{connectionSelected ? <span>← connections · ↑↓ scroll details</span> : detail ? <button onClick={() => setDetail(false)}>[Esc] back</button> : <><span>← connections · ↑↓ select</span><button disabled={!current} onClick={() => current && openRun(current.id)}>[Enter] open</button></>}{cancelable && <button disabled={!online} onClick={() => setConfirm(true)}>[c] cancel</button>}<button onClick={() => { setHelp(value => !value); }}>[?] help</button><button onClick={() => { setDetached(true); setConfirm(false); }}>[Ctrl+C] detach</button></div>
          </>}
          </>}
          </div></div>
          <div className={styles.footer}><span>{detached ? "○ detached" : scenario === "Connected" || scenario === "Empty" ? "● connected" : `○ ${scenario.toLowerCase()}`}</span><span>{environment.id} · {environment.transport}</span><span>{scenario === "Empty" ? 0 : active} running · {scenario === "Empty" ? 0 : queued} queued</span><span>{scenario === "Empty" ? 0 : active}/{environment.concurrency} slots · isolation {environment.isolated ? "on" : "off"}</span></div>
        </div>
        <p id="terminal-instructions" className="text-xs text-muted-foreground">Click the terminal, then use ↑ ↓ and Enter. Double-click a run to open it with the mouse. Escape returns to the list. All actions are simulated.</p>
      </div>
    </main>
  );
}
