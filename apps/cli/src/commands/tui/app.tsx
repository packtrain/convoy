import { Dialog, Spinner } from "./dialog/index.js";
import { Environments } from "./environments/index.js";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { Box, Text, useApp, useInput, useWindowSize, type DOMElement } from "ink";
import { useClick, useMouseTracking, useWheel } from "./mouse.js";
import { getCliVersion } from "../../lib/version.js";
import { detailLines, environmentTone, healthTones, palette, plain, rowCells, rowId, warningLines, warningGroups, wrapLines } from "./formatters.js";
import type { Browser } from "./workflow.js";
import type { BrowseState, Scope } from "./validators.js";
import type { WorkerStatus } from "../service/validators.js";

import { Actions, ActionDialog } from "./actions/index.js";
import { LogDetail } from "./logs/index.js";

import { Onboarding } from "./onboarding/index.js";
import { Credentials } from "./credentials/index.js";
import { Runtimes } from "./runtimes/index.js";

const clientVersion = getCliVersion();

function scopeId(scope: Scope) { return `${scope.connection}:${scope.addProject ? "add" : scope.details ? "details" : scope.profile === undefined ? "all" : `profile:${scope.profile}`}`; }
const tab = (label: string, selected: boolean, activate: () => void) => [label, selected, activate] as const;
const statusTones: Record<WorkerStatus, keyof typeof palette> = { connecting: "warning", online: "success", retrying: "warning", blocked: "danger", failed: "danger", stopped: "muted" };
type SidebarRow = { scope: Scope; view?: "actions" | "credentials"; text: string; transport: string; health: BrowseState["observations"][number]["health"]; busy?: boolean; loading?: boolean; dot?: keyof typeof palette };

/** A Box that runs `onClick` on a left click. */
function Clickable({ onClick, ...props }: ComponentProps<typeof Box> & { onClick(): void }) {
  const ref = useRef<DOMElement>(null);
  useClick(ref, onClick);
  return <Box ref={ref} {...props} />;
}

export function App({ browser, onboardingLoad }: { browser: Browser; onboardingLoad?: ComponentProps<typeof Onboarding>["load"] }) {
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot);
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const size = { width: columns, height: rows };
  const [pane, setPane] = useState<"sidebar" | "content">(state.actions ? "content" : "sidebar");
  const [expanded, setExpanded] = useState(() => new Set([state.scope.connection]));
  const [addEnvironmentSelected, setAddEnvironmentSelected] = useState(false);
  const [actionSelection, setActionSelection] = useState<{ scope: string; key: string }>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detailOffset, setDetailOffset] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [mouse, setMouse] = useState(true);
  useEffect(() => { setWarningsOpen(false); }, [state.scope.connection, state.scope.profile, state.scope.details, state.actions, state.credentials, state.runtimes]);
  useEffect(() => {
    setAddEnvironmentSelected(false);
    if (state.environment === "create") setExpanded(old => new Set([...old, state.scope.connection]));
  }, [state.scope.connection]);
  const observation = state.observations[state.scope.connection];
  const target = browser.targets[state.scope.connection];
  const sidebar = browser.targets.flatMap((connection, index) => {
    const health = state.observations[index].health;
    const rows: SidebarRow[] = [{ scope: { connection: index, details: true },
      text: `${expanded.has(index) ? "▾" : "▸"} ${connection.name}`, transport: connection.transport, health }];
    if (expanded.has(index)) {
      rows.push({ scope: { connection: index, details: true }, view: "actions", text: "  Actions", transport: "", health });
      rows.push({ scope: { connection: index, details: true }, view: "credentials", text: "  Credentials", transport: "", health });
      rows.push({ scope: { connection: index, details: true, addProject: true }, text: "  + Add project", transport: "", health });
      rows.push(...state.observations[index].profiles.map(profile => ({
        scope: { connection: index, profile: profile.profile, details: false }, text: `  ${profile.displayName?.trim() && profile.displayName.trim() !== profile.profile ? `${profile.displayName.trim()} (${profile.profile})` : profile.profile}`, transport: "", health,
        // Pushed with each service snapshot; other environments' counts would be stale.
        busy: health === "connected" && Boolean(profile.activeRuns),
        // Other environments' statuses are stale; a notice turns an online dot to warning.
        dot: health !== "connected" ? "muted" as const : warningLines([profile]).length && statusTones[profile.status] === "success" ? "warning" as const : statusTones[profile.status],
      })));
    }
    return rows;
  });
  const view = state.scope.details && !state.scope.addProject ? state.actions ? "actions" : state.credentials ? "credentials" : undefined : undefined;
  const isSelected = (row: SidebarRow) => !row.loading && scopeId(row.scope) === scopeId(state.scope) && row.view === view;
  // Before the selected environment's first snapshot; a failed attach shows its error instead.
  const loadingProjects = (index: number) => index === state.scope.connection && !observation.snapshot && !observation.profiles.length && ["unknown", "connecting", "connected"].includes(observation.health);
  const selectedSidebar = Math.max(0, sidebar.findIndex(isSelected));
  const sidebarLines = sidebar.flatMap((row, index) => (row.scope.profile !== undefined && sidebar[index - 1]?.scope.addProject)
    || (index > 0 && row.scope.details && !row.scope.addProject && !row.view) ? [null, row]
    : row.scope.addProject && loadingProjects(row.scope.connection) ? [row, null, { ...row, scope: { ...row.scope, addProject: false }, text: "  Loading projects…", busy: true, loading: true }] : [row]);
  const selectedSidebarLine = Math.max(0, sidebarLines.findIndex(row => row && isSelected(row)));
  const selectedRow = Math.max(0, state.rows.findIndex(row => rowId(row) === selectedId));
  const lines = detailLines(state, target.endpoint, clientVersion, target.mode);
  const capacity = Math.max(1, size.height - 8);
  const sidebarStart = Math.max(0, selectedSidebarLine - capacity + 1);
  const choose = (scope: Scope) => { setAddEnvironmentSelected(false); browser.select(scope); setSelectedId(undefined); setDetailOffset(0); };
  // Sidebar rows pick the view too: Actions and Credentials rows open those panels, every other row its default.
  const chooseView = (scope: Scope, view?: SidebarRow["view"]) => {
    choose(scope);
    if (view === "actions") browser.showActions(true);
    else if (view === "credentials") browser.showCredentials(true);
    else if (browser.getSnapshot().actions || browser.getSnapshot().credentials || browser.getSnapshot().runtimes) browser.showActions(false);
  };
  const small = size.width < 45 || size.height < 10;
  const narrow = size.width < 76;
  const workflow = Boolean(state.environment || state.onboarding);
  const editing = state.credentials === "editing" || state.runtimes === "editing";
  const sidebarWidth = narrow && (workflow || pane === "content") ? 0 : narrow ? size.width : 30;
  const actionWidth = Math.max(1, size.width - sidebarWidth - 2);
  const contextLines = warningsOpen ? [] : [
    ...(state.error ? wrapLines(plain(state.error), actionWidth).slice(0, 2) : []),
    ...(observation.environmentError ? wrapLines(`${plain(observation.environmentError)} · [s] Retry check`, actionWidth).slice(0, 2) : []),
    ...(observation.checkingEnvironment ? ["Checking status…"] : []),
    ...(state.stale && observation.snapshot ? ["Last observation is stale. [f] Retry connection"] : []),
    ...(state.scope.details && !state.credentials && !target.maintenance ? ["Host lifecycle is not managed here. Service controls are in Actions."] : []),
  ].slice(0, Math.max(1, size.height - 11));
  const warnings = state.scope.addProject || editing ? [] : warningGroups(observation.profiles, state.scope.profile);
  const visibleWarnings = warnings.slice(0, size.height >= 28 ? 2 : 1);
  const warningHeight = warnings.length && !warningsOpen ? visibleWarnings.length * 2 + 2 + (warnings.length > visibleWarnings.length ? 1 : 0) : 0;
  const toolbar = !warningsOpen && state.scope.details && !state.actions && !state.credentials && !state.runtimes && !state.scope.addProject;
  const contentHeight = Math.max(1, size.height - 8 - contextLines.length - warningHeight - (toolbar ? 2 : 0));
  const compact = contentHeight < 10;
  const tableLines = contentHeight - 1 - (compact ? 0 : 2) - (state.rows[selectedRow]?.run ? 1 : 0);
  const visibleRows = Math.max(1, Math.floor((tableLines + (compact ? 0 : 1)) / (compact ? 2 : 3)));
  const rowStart = Math.max(0, selectedRow - visibleRows + 1);
  const detailsStart = Math.min(detailOffset, Math.max(0, lines.length - contentHeight));
  const toggleExpanded = (connection: number) => setExpanded(old => {
    const next = new Set(old);
    if (next.has(connection)) next.delete(connection); else next.add(connection);
    return next;
  });
  // Moves the detail lines or the run selection, by ↑/↓ or the wheel.
  // Updaters, so several wheel reports in one stdin chunk each move a step.
  const scroll = (delta: number) => {
    if (state.scope.details) setDetailOffset(old => Math.max(0, Math.min(lines.length - 1, Math.min(old, Math.max(0, lines.length - contentHeight)) + delta)));
    else setSelectedId(old => {
      const row = state.rows[Math.max(0, Math.min(state.rows.length - 1, Math.max(0, state.rows.findIndex(row => rowId(row) === old)) + delta))];
      return row ? rowId(row) : old;
    });
  };
  // The states where useInput below stops before navigation keys; clicks and the wheel stop there too.
  const locked = Boolean(warningsOpen || workflow || state.detail || state.action?.busy || editing || state.action?.pending || (state.action?.message && !state.action.entries));
  const unlocked = (action: () => void) => () => { if (!locked) action(); };
  const clickRow = (row: SidebarRow) => {
    if (row.loading) return;
    chooseView(row.scope, row.view);
    if (row.scope.addProject) { browser.openOnboarding(); setPane("content"); return; }
    setPane("sidebar");
    if (row.scope.details && !row.view) toggleExpanded(row.scope.connection);
  };
  useInput((input, key) => {
    if ((input === "q" && !state.detail && !state.onboarding && !state.environment && !editing) || (key.ctrl && input === "c")) { browser.dispose(); exit(); return; }
    // The read-only warnings list keeps the toggle so its text can be copied.
    if (input === "m" && !key.ctrl && !key.meta && (!locked || warningsOpen)) { setMouse(on => !on); return; }
    if (warningsOpen || state.environment || state.onboarding || state.detail || state.action?.busy || editing) return;
    if (state.action?.pending) {
      if (small && (key.escape || input === "n" || key.return)) browser.dismissAction();
      return;
    }
    if (input === "w" && !key.ctrl && !key.meta && warnings.length) { setWarningsOpen(true); return; }
    if (state.action?.message && !state.action.entries) { if (key.escape) browser.dismissAction(); return; }
    if (state.runtimes && key.escape) { browser.showRuntimes(false); return; }
    if (view && key.escape) { if (state.action) browser.dismissAction(); else setPane("sidebar"); return; }
    if (state.actions && key.escape) {
      if (state.action) browser.dismissAction(); else browser.showActions(false);
      return;
    }
    if (key.escape) { if (state.history) browser.history(); else setPane("sidebar"); return; }
    if (key.ctrl || key.meta) return;
    // Tree arrows on the sidebar: → expands an environment, ← collapses it or selects a child's environment.
    if (pane === "sidebar" && !addEnvironmentSelected && (key.leftArrow || key.rightArrow)) {
      const connection = state.scope.connection;
      const environmentRow = state.scope.details && !state.scope.addProject && !view && !state.runtimes;
      if (key.rightArrow && environmentRow && !expanded.has(connection)) { setExpanded(old => new Set([...old, connection])); return; }
      if (key.leftArrow && environmentRow && expanded.has(connection)) { setExpanded(old => new Set([...old].filter(index => index !== connection))); return; }
      if (key.leftArrow && !environmentRow) { chooseView({ connection, details: true }); return; }
    }
    // The runtimes panel's button row owns ←/→; ← on its list returns to the sidebar.
    if (key.leftArrow && !(pane === "content" && state.runtimes)) { setPane("sidebar"); return; }
    if (key.rightArrow && !(pane === "content" && state.runtimes)) { setPane("content"); return; }
    if (key.tab) { setPane(value => value === "sidebar" ? "content" : "sidebar"); return; }
    if (input === "E") { browser.openEnvironment("create"); return; }
    if (input === "+") { browser.openOnboarding(); setPane("content"); return; }
    if (input === "a" && state.scope.profile) { browser.showActions(true); setPane("content"); return; }
    if ((input === "a" || input === "c") && state.scope.details) { chooseView({ connection: state.scope.connection, details: true }, input === "a" ? "actions" : "credentials"); setPane("content"); return; }
    if (input === "d") { browser.showActions(false); choose({ connection: state.scope.connection, details: true }); return; }
    if (input === "r" && state.scope.profile) { browser.showActions(false); return; }
    if (input === "s" && state.scope.details && !state.credentials && !state.runtimes) { void browser.inspectEnvironment(); return; }
    if (input === "f" && !state.credentials && !state.runtimes) { browser.retryNow(); return; }
    if (pane === "sidebar" && addEnvironmentSelected && (input === " " || key.return)) { browser.openEnvironment("create"); return; }
    if (pane === "sidebar" && (input === " " || key.return) && view) { setPane("content"); return; }
    if (pane === "sidebar" && (input === " " || key.return) && state.scope.details) {
      if (state.scope.addProject) { browser.openOnboarding(); setPane("content"); return; }
      toggleExpanded(state.scope.connection); return;
    }
    if (pane === "sidebar" && key.return && !state.scope.details) { setPane("content"); return; }
    if (pane === "content" && (state.actions || state.credentials || state.runtimes)) return;
    if (pane === "content" && !state.scope.details) {
      if (input === "c" && state.rows[selectedRow]?.run) { browser.beginAction("cancel", state.rows[selectedRow]); return; }
      if (key.pageDown || input === "n") { browser.next(); setSelectedId(undefined); return; }
      if (key.pageUp || input === "p") { browser.back(); setSelectedId(undefined); return; }
      if (key.home) { browser.first(); setSelectedId(undefined); return; }
      if (key.return && state.history && state.rows[selectedRow]?.run) { browser.logs(state.rows[selectedRow]); return; }
      if (key.return && !state.history && state.rows[selectedRow]) { browser.history(state.rows[selectedRow]); setSelectedId(undefined); return; }
    }
    const delta = key.upArrow || input === "k" ? -1 : key.downArrow || input === "j" ? 1 : 0;
    if (!delta) return;
    if (pane === "sidebar") {
      if (delta < 0 && selectedSidebar === 0) setAddEnvironmentSelected(true);
      else if (addEnvironmentSelected) setAddEnvironmentSelected(false);
      else { const row = sidebar[Math.max(0, Math.min(sidebar.length - 1, selectedSidebar + delta))]; chooseView(row.scope, row.view); }
    }
    else scroll(delta);
  });
  // The log view promises native selection, and its export path takes typed m.
  useMouseTracking(mouse && !state.detail);
  useWheel(locked || state.actions || state.credentials || state.runtimes || state.scope.addProject ? undefined : scroll);
  if (small && !state.detail && !state.onboarding && !state.environment && !editing) return <Box flexDirection="column"><Text>Resize to 45×10 to browse.</Text><Text>q / Ctrl+C detach</Text></Box>;
  const fill = (selected: boolean, active: boolean) => selected ? { backgroundColor: active ? palette.selected : palette.idle, color: active ? palette.selectedText : palette.idleText } : {};
  const keys = (hints: [string, string][]) => <Text wrap="truncate" color={palette.muted}>{hints.map(([key, label], i) => <Text key={i}>{i ? "  " : ""}<Text color={palette.accent}>{key}</Text> {label}</Text>)}</Text>;
  const tabs = state.scope.details ? [] : [tab("[r] Runs", !state.actions, () => browser.showActions(false)), tab("[a] Actions", Boolean(state.actions), () => { browser.showActions(true); setPane("content"); })];
  const title = state.runtimes ? "Agent runtimes" : view === "actions" ? "Actions" : view === "credentials" ? "Credentials" : state.scope.addProject ? "Add project" : "Details";
  const wide = actionWidth >= 76;
  const runs = state.rows.slice(rowStart, rowStart + visibleRows).map((row, index) => ({ row, cells: rowCells(row), selected: rowStart + index === selectedRow }));
  return <Box flexDirection="column" width={size.width} height={size.height - 1} backgroundColor={palette.base}>
    {!state.detail && <Box flexDirection="column" flexShrink={0} paddingX={1} backgroundColor={palette.surface}>
      <Box height={1} gap={2}><Box flexShrink={0}><Text bold color={palette.accent}>convoy</Text></Box><Box flexGrow={1} flexShrink={1}><Text wrap="truncate" color={palette.text}>{plain(target.name)} / {plain(target.transport)}</Text></Box>
        <Box flexShrink={narrow ? 1 : 0}><Text wrap="truncate" color={palette.muted}>client {clientVersion} · service {plain(observation.version)}</Text></Box></Box>
      <Text wrap="truncate" color={palette.muted}>{plain(target.endpoint)}{observation.snapshot ? `   ${observation.profiles.length} registered projects` : ""}</Text>
    </Box>}
    <Box height={Math.max(1, size.height - (state.detail ? 1 : 4))}>
      <Box display={small || sidebarWidth === 0 ? "none" : "flex"} width={sidebarWidth} flexShrink={0} flexDirection="column" paddingX={1} paddingTop={1} backgroundColor={palette.surface}>
        <Text color={palette.muted}>ENVIRONMENTS</Text>
        <Clickable onClick={unlocked(() => browser.openEnvironment("create"))} backgroundColor={fill(addEnvironmentSelected, pane === "sidebar").backgroundColor}><Text wrap="truncate" color={fill(addEnvironmentSelected, pane === "sidebar").color ?? palette.muted}>+ Add environment</Text></Clickable>
        <Text> </Text>
        {sidebarLines.slice(sidebarStart, sidebarStart + capacity).map((row, index) => {
          if (!row) return <Text key={`gap:${sidebarStart + index}`}> </Text>;
          const selected = !addEnvironmentSelected && isSelected(row);
          const { color, ...rowFill } = fill(selected, pane === "sidebar");
          const environment = row.scope.details && !row.scope.addProject && !row.view && !row.loading;
          const key = `${scopeId(row.scope)}:${row.view ?? ""}${row.loading ? ":loading" : ""}`;
          const onClick = unlocked(() => clickRow(row));
          if (environment) return <Clickable key={key} onClick={onClick} {...rowFill}><Box flexGrow={1} flexShrink={1}><Text wrap="truncate" bold color={color ?? palette.text}>{plain(row.text)}</Text></Box>
            <Box flexShrink={0}><Text color={color ?? palette.muted}> {plain(row.transport)}<Text color={palette[environmentTone(state.observations[row.scope.connection])]}> ● </Text></Text></Box></Clickable>;
          return <Clickable key={key} onClick={onClick} {...rowFill}><Box flexGrow={1} flexShrink={1}><Text wrap="truncate" color={color ?? (row.scope.addProject || row.loading ? palette.muted : palette.text)}>
            {row.busy ? <><Spinner color={color ?? palette.accent} /> {plain(row.text.slice(2))}</> : plain(row.text)}
          </Text></Box>{row.dot && <Box flexShrink={0}><Text color={palette[row.dot]}> ● </Text></Box>}</Clickable>;
        })}
      </Box>
      <Box display={narrow && sidebarWidth > 0 && !workflow ? "none" : "flex"} flexGrow={1} flexDirection="column" paddingX={1} paddingTop={1}>
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {state.onboarding && <Onboarding browser={browser} load={onboardingLoad} width={actionWidth} height={Math.max(1, size.height - 7)} />}
        {state.environment && <Environments browser={browser} width={actionWidth} height={Math.max(1, size.height - 7)} />}
        {!workflow && (state.detail ? <LogDetail key={`${state.scope.connection}:${state.detail.run?.messageId}`} browser={browser} row={state.detail} width={Math.max(1, size.width - (small ? 0 : sidebarWidth) - 2)} height={Math.max(1, size.height - 3)} small={small} /> : <>
        <Box gap={2} marginBottom={1}>
          {tabs.length ? tabs.map(([label, selected, activate]) => <Clickable key={label} onClick={unlocked(activate)}><Text {...(selected ? fill(true, true) : { color: palette.accent })}>{` ${label} `}</Text></Clickable>) : <Text bold color={palette.text}>{title}</Text>}
          <Box flexShrink={1}><Text wrap="truncate" color={palette.muted}>{plain(target.name)}{state.scope.profile ? ` / ${plain(state.scope.profile)}` : ""}{state.history ? " / execution history" : ""}</Text></Box>
        </Box>
        {!warningsOpen && warnings.length > 0 && <Box flexDirection="column" marginBottom={1}>
          <Text bold color={palette.warning}>Project notices <Text bold={false} color={palette.accent}>[w] Details</Text></Text>
          {visibleWarnings.map(warning => <Box key={warning.profile} flexDirection="column">
            <Text bold wrap="truncate">{warning.profile} <Text bold={false} color={palette.muted}>· {warning.status}</Text></Text>
            <Text color={palette.warning} wrap="truncate-end">  {warning.summary}</Text>
          </Box>)}
          {warnings.length > visibleWarnings.length && <Text color={palette.muted}>+{warnings.length - visibleWarnings.length} more projects · w shows all</Text>}
        </Box>}
        {contextLines.map((line, index) => <Text key={index} color={state.error || observation.environmentError ? palette.warning : palette.muted} wrap="truncate">{line}</Text>)}
        {toolbar && <Box marginBottom={1}>{keys([["[s]", "Inspect status"], ["[f]", "Retry connection"], ["[+]", "Add project"]])}</Box>}
        {warningsOpen ? <Dialog inline scrollable width={actionWidth} height={contentHeight}
          lines={[`Warning details · ${plain(target.name)}`, "↑/↓ PgUp/PgDn scroll · Esc back", ...(warnings.length ? warnings.flatMap(warning => ["", `${warning.profile} · ${warning.status}`, ...warning.details]) : ["No current project notices."])]}
          buttons={[{ label: "Back", activate: () => setWarningsOpen(false) }]} onCancel={() => setWarningsOpen(false)} />
          : state.action && !state.actions && !state.action.pending ? <ActionDialog inline state={state} browser={browser} width={actionWidth} height={contentHeight} /> : state.runtimes ? <Runtimes key={scopeId(state.scope)} browser={browser} state={state} active={pane === "content"} onSidebar={() => setPane("sidebar")} width={actionWidth} height={contentHeight} /> : state.credentials ? <Credentials key={scopeId(state.scope)} browser={browser} state={state} active={pane === "content"} width={actionWidth} height={contentHeight} /> : state.actions ? <Actions selectedKey={actionSelection?.scope === scopeId(state.scope) ? actionSelection.key : undefined} onSelect={key => setActionSelection({ scope: scopeId(state.scope), key })} browser={browser} state={state} row={state.rows[selectedRow]} active={pane === "content" && !state.environment} width={actionWidth} height={contentHeight} /> : state.scope.addProject ? <Text color={palette.text}>Press + to add or link a project. Enter or Space opens the selected sidebar row.</Text> : state.scope.details ? lines.slice(detailsStart, detailsStart + contentHeight).map((line, index) => {
          const [, label = "", value = line] = /^(\s*[^:]{1,40}:)( .*)$/.exec(line) ?? [];
          return <Text key={index} wrap="truncate" color={palette.text}><Text color={palette.muted}>{label}</Text>{value}</Text>;
        }) : <>
          <Box gap={2} marginBottom={compact ? 0 : 1}>
            <Text bold color={palette.text}>{state.history ? "Execution history" : "Runs"}</Text>
            <Box flexGrow={1} flexShrink={1}><Text wrap="truncate" color={palette.muted}>{plain(state.history ? `${rowCells(state.history).task} ${state.history.thread.title}` : state.rows[0]?.profile ?? state.scope.profile ?? "Projects in registration order")} · page {state.pageNumber}{state.loading ? " · loading" : ""}{state.next ? " · n next" : ""}</Text></Box>
            <Box flexShrink={0}><Text color={palette.muted}>{state.rows.length} {state.history ? "runs" : "threads"} on page</Text></Box>
          </Box>
          {state.rows[selectedRow]?.run && <Text wrap="truncate" color={palette.muted}>{state.rows[selectedRow].run?.status === "streaming" ? "[c] Cancel selected run · Enter logs" : "Cancel unavailable: run is not active · Enter logs"}</Text>}
          {state.rows.length === 0 ? <Text color={palette.text}>{state.loading ? "Loading…" : state.error ? "Page unavailable" : "No runs on this page."}</Text> : <>
            {!compact && <Box paddingX={1} gap={2}><Box flexGrow={1}><Text color={palette.muted}>{state.history ? "RUN · NEWEST FIRST" : "THREAD / TASK"}</Text></Box>
              {wide && <Box width={14} flexShrink={0}><Text color={palette.muted}>PROJECT</Text></Box>}<Box width={15} flexShrink={0}><Text color={palette.muted}>STATE</Text></Box>
              {wide && <Box width={11} flexShrink={0}><Text color={palette.muted}>{state.history ? "ELAPSED" : "UPDATED"}</Text></Box>}</Box>}
            {runs.map(({ row, cells, selected }, index) => {
              const { color, ...rowFill } = fill(selected, pane === "content");
              return <Box key={rowId(row)} flexShrink={0} marginBottom={compact || index === runs.length - 1 ? 0 : 1} paddingX={1} gap={2} {...rowFill}>
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate" color={color ?? palette.muted}>{selected ? "›" : " "} <Text color={color ?? palette.text}>{cells.task}</Text>{cells.id && ` · ${cells.id}`}</Text>
                  <Text wrap="truncate" color={color ?? (row.run ? palette.muted : palette.text)}>{"  "}{cells.title}</Text>
                </Box>
                {wide && <Box flexDirection="column" width={14} flexShrink={0}><Text wrap="truncate" color={color ?? palette.text}>{cells.profile}</Text><Text wrap="truncate" color={color ?? palette.muted}>{cells.runtime}</Text></Box>}
                <Box width={15} flexShrink={0}><Text wrap="truncate" color={cells.color}>{cells.symbol} {cells.status}</Text></Box>
                {wide && <Box width={11} flexShrink={0}><Text wrap="truncate" color={color ?? palette.muted}>{cells.time}</Text></Box>}
              </Box>;
            })}
          </>}
        </>}
        </>)}
        </Box>
        {!state.detail && <Box flexShrink={0}>{warningsOpen ? keys([["[↑/↓ PgUp/PgDn]", "scroll"], ["[Esc]", "back"], ["[m]", mouse ? "select text" : "mouse"], ["[q]", "detach"]]) : workflow || editing ? keys([["[Tab]", "focus"], ["[Enter]", "activate"], ["[Esc]", "back"], ["[Ctrl+C]", "detach · inputs retained through repair"]])
          : keys([["[←/→]", "panes"], ["[↑/↓]", "select"], ["[Enter]", "activate"], ["[Esc]", "back"], ["[m]", mouse ? "select text" : "mouse"], ["[n/p]", "page"], ["[f]", "retry"], ["[E]", "add environment"], ["[+]", "add project"], ["[q]", "detach"]])}</Box>}
      </Box>
    </Box>
    {!state.detail && <Box flexShrink={0} height={1} paddingX={1} gap={3} backgroundColor={palette.footer}>
      <Box flexShrink={0}><Text color={palette[healthTones[observation.health]]}>{observation.health === "connected" ? "●" : "○"} <Text color={palette.muted}>{observation.health}{state.stale ? " · stale" : ""}</Text></Text></Box>
      <Box flexShrink={1}><Text wrap="truncate" color={state.stale || state.error ? palette.warning : palette.muted}>{`${plain(target.name)} · ${plain(target.transport)}   ${observation.snapshot && observation.profiles.every(p => p.activeRuns !== undefined) ? `${observation.profiles.reduce((sum, p) => sum + (p.activeRuns ?? 0), 0)} observed active` : "Activity unknown"} · queued count unknown${state.updatedAt ? `   page updated ${new Date(state.updatedAt).toLocaleTimeString()}` : ""}`}</Text></Box>
    </Box>}
    {state.action && <ActionDialog state={state} browser={browser} width={size.width} height={size.height - 1} />}
  </Box>;
}
