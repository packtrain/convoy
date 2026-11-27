import { Clickable, Dialog, Spinner } from "./dialog/index.js";
import { Environments } from "./environments/index.js";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useMouseTracking, useWheel, type LeaveRef } from "./mouse.js";
import { getCliVersion } from "../../lib/version.js";
import { alignColumns, detailLines, DOT_GLYPHS, environmentTone, fitHints, healthTones, palette, plain, rowCells, rowId, scrollWindow, warningLines, warningGroups, wrapLines, type DotTone } from "./formatters.js";
import type { Browser } from "./workflow.js";
import type { BrowseState, Row, Scope } from "./validators.js";
import type { WorkerStatus } from "../service/validators.js";

import { Actions, ActionDialog } from "./actions/index.js";
import { LogDetail } from "./logs/index.js";

import { Onboarding } from "./onboarding/index.js";
import { Credentials } from "./credentials/index.js";
import { Runtimes } from "./runtimes/index.js";
import { Details } from "./details/index.js";

const clientVersion = getCliVersion();

function scopeId(scope: Scope) { return `${scope.connection}:${scope.addProject ? "add" : scope.details ? "details" : scope.profile === undefined ? "all" : `profile:${scope.profile}`}`; }
const tab = (label: string, selected: boolean, activate: () => void) => [label, selected, activate] as const;
const statusTones: Record<WorkerStatus, DotTone> = { connecting: "warning", online: "success", retrying: "warning", blocked: "danger", failed: "danger", stopped: "muted" };
// The ? list: the focused view's keys, then the global ones. Spec: docs/specs/cli-tui.md#tui-ux-review-cli-01700-os-2547
const VIEW_KEYS: Record<"Sidebar" | "Details" | "Actions" | "Credentials" | "Agent runtimes" | "Runs" | "Execution history", [string, string][]> = {
  Sidebar: [["↑/↓ j/k", "select a row; its view opens"], ["→ / ←", "expand / collapse an environment"], ["Enter / Space", "expand an environment or focus its view"], ["E", "add environment"], ["+", "add project"]],
  Details: [["↑/↓ j/k", "select a runtime row"], ["PgUp / PgDn", "scroll"], ["[key] on a row", "that row's action"], ["s", "inspect status"], ["+", "add project"]],
  Actions: [["↑/↓ j/k", "select an action"], ["Enter", "run the selected action"], ["[key] on a row", "run that action"], ["Esc", "back"]],
  Credentials: [["↑/↓ j/k", "select"], ["Enter", "open"], ["Esc", "back"]],
  "Agent runtimes": [["↑/↓ j/k", "select"], ["Space", "check a runtime"], ["Esc", "back"]],
  Runs: [["↑/↓ j/k", "select a thread"], ["Enter", "open its execution history"], ["n / PgDn", "next page"], ["p / PgUp", "previous page"], ["Home", "first page"]],
  "Execution history": [["↑/↓ j/k", "select a run"], ["Enter", "open its logs"], ["c", "cancel the selected active run"], ["n / p", "next / previous page"], ["Esc", "back to threads"]],
};
const GLOBAL_KEYS: [string, string][] = [["←/→ Tab", "switch panes"], ["d a c", "environment Details, Actions, Credentials"], ["r a", "project Runs, Actions"],
  ["w", "all project notices"], ["f", "retry connection"], ["m", "mouse on or off, to select text"], ["?", "this list"], ["q Ctrl+C", "detach; the service keeps running"]];
type SidebarRow = { scope: Scope; view?: "actions" | "credentials"; text: string; transport: string; health: BrowseState["observations"][number]["health"]; busy?: boolean; loading?: boolean; dot?: DotTone; shortcut?: string };

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
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const reading = warningsOpen || keysOpen;
  const [mouse, setMouse] = useState(true);
  // Set by an open form or editor: a sidebar click leaves it, asking first on a draft. Spec: docs/specs/cli-tui.md#leaving-editors-and-panel-spacing-cli-01681
  const leave: LeaveRef = useRef(undefined);
  useEffect(() => { setWarningsOpen(false); setKeysOpen(false); }, [state.scope.connection, state.scope.profile, state.scope.details, state.actions, state.credentials, state.runtimes]);
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
      rows.push({ scope: { connection: index, details: true }, view: "actions", text: "  Actions", transport: "", health, shortcut: "a" });
      rows.push({ scope: { connection: index, details: true }, view: "credentials", text: "  Credentials", transport: "", health, shortcut: "c" });
      rows.push({ scope: { connection: index, details: true, addProject: true }, text: "  + Add project", transport: "", health, shortcut: "+" });
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
  // The endpoint line shows only while the connection fails; Details lists it otherwise.
  const failing = observation.health === "reconnecting" || observation.health === "incompatible";
  const header = failing ? 2 : 1;
  const capacity = Math.max(1, size.height - 6 - header);
  const sidebarWindow = scrollWindow(sidebarLines.length, capacity, 0, selectedSidebarLine);
  const choose = (scope: Scope) => { setAddEnvironmentSelected(false); browser.select(scope); setSelectedId(undefined); };
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
  const editing = state.credentials === "editing" || state.runtimes === "editing" || Boolean(state.action?.pending && state.action.kind === "concurrency");
  // Below 100 columns the sidebar narrows so the panel keeps its values; names truncate.
  const sidebarWidth = narrow && (workflow || pane === "content") ? 0 : narrow ? size.width : size.width < 100 ? 22 : 30;
  const actionWidth = Math.max(1, size.width - sidebarWidth - 2);
  // A line with a key hint runs that key on click, where the key works too.
  const inspect = state.scope.details && !state.credentials && !state.runtimes ? () => void browser.inspectEnvironment() : undefined;
  const retry = !state.credentials && !state.runtimes ? () => browser.retryNow() : undefined;
  // A hint names its key only where the key and click work.
  const contextLines: { text: string; warn?: boolean; run?: () => void }[] = reading ? [] : [
    ...(state.error ? wrapLines(plain(state.error), actionWidth).slice(0, 2).map(text => ({ text, warn: true })) : []),
    ...(observation.environmentError ? wrapLines(`${plain(observation.environmentError)}${inspect ? " · [s] Retry check" : ""}`, actionWidth).slice(0, 2).map(text => ({ text, warn: true, run: inspect })) : []),
    ...(observation.checkingEnvironment ? [{ text: "Checking status…" }] : []),
    ...(state.stale && observation.snapshot ? [{ text: `Last observation is stale.${retry ? " [f] Retry connection" : ""}`, run: retry }] : []),
    ...(state.scope.details && !state.credentials && !target.maintenance ? [{ text: "Host lifecycle is not managed here. Service controls are in Actions." }] : []),
  ].slice(0, Math.max(1, size.height - 9 - header));
  const warnings = state.scope.addProject || editing ? [] : warningGroups(observation.profiles, state.scope.profile);
  const warningHeight = warnings.length && !reading ? 2 : 0;
  const toolbar = !reading && state.scope.details && !state.actions && !state.credentials && !state.runtimes && !state.scope.addProject;
  const contentHeight = Math.max(1, size.height - 6 - header - (contextLines.length && contextLines.length + 1) - warningHeight - (toolbar ? 2 : 0));
  const compact = contentHeight < 10;
  const tableLines = contentHeight - 1 - (compact ? 0 : 2) - (state.rows[selectedRow]?.run ? 1 : 0);
  const visibleRows = Math.max(1, Math.floor(tableLines / 2));
  const rowStart = Math.max(0, selectedRow - visibleRows + 1);
  const toggleExpanded = (connection: number) => setExpanded(old => {
    const next = new Set(old);
    if (next.has(connection)) next.delete(connection); else next.add(connection);
    return next;
  });
  // Moves the run selection, by ↑/↓ or the wheel; Details scrolls itself.
  // An updater, so several wheel reports in one stdin chunk each move a step.
  const scroll = (delta: number) => setSelectedId(old => {
    const row = state.rows[Math.max(0, Math.min(state.rows.length - 1, Math.max(0, state.rows.findIndex(row => rowId(row) === old)) + delta))];
    return row ? rowId(row) : old;
  });
  // The states where useInput below stops before navigation keys; clicks and the wheel stop there too.
  const locked = Boolean(reading || workflow || state.detail || state.action?.busy || editing || state.action?.pending || (state.action?.message && !state.action.entries));
  const unlocked = (action: () => void) => () => { if (!locked) action(); };
  // Details owns ↑/↓, its row keys and c while its panel has focus.
  const detailsShown = state.scope.details && !reading && !state.scope.addProject && !state.runtimes && !state.credentials && !state.actions && !(state.action && !state.action.pending);
  const sidebarClick = (action: () => void) => () => { if (leave.current) leave.current(action); else if (!locked) action(); };
  // Enter on a run row: a thread opens its history, a run its logs.
  const openRow = (row: Row) => {
    if (!state.history) { browser.history(row); setSelectedId(undefined); }
    else if (row.run) browser.logs(row);
  };
  // The first click selects a run row and focuses the table; a click on the selected row opens it.
  const clickRun = (row: Row, selected: boolean) => {
    if (selected && pane === "content") { openRow(row); return; }
    setSelectedId(rowId(row)); setPane("content");
  };
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
    if (input === "m" && !key.ctrl && !key.meta && (!locked || reading)) { setMouse(on => !on); return; }
    if (reading || state.environment || state.onboarding || state.detail || state.action?.busy || editing) return;
    if (state.action?.pending) {
      if (small && (key.escape || input === "n" || key.return)) browser.dismissAction();
      return;
    }
    if (input === "w" && !key.ctrl && !key.meta && warnings.length) { setWarningsOpen(true); return; }
    if (input === "?" && !key.ctrl && !key.meta) { setKeysOpen(true); return; }
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
    if ((input === "a" || (input === "c" && !(detailsShown && pane === "content"))) && state.scope.details) { chooseView({ connection: state.scope.connection, details: true }, input === "a" ? "actions" : "credentials"); setPane("content"); return; }
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
      if (key.return && state.rows[selectedRow]) { openRow(state.rows[selectedRow]); return; }
    }
    const delta = key.upArrow || input === "k" ? -1 : key.downArrow || input === "j" ? 1 : 0;
    if (!delta) return;
    if (pane === "sidebar") {
      if (delta < 0 && selectedSidebar === 0) setAddEnvironmentSelected(true);
      else if (addEnvironmentSelected) setAddEnvironmentSelected(false);
      else { const row = sidebar[Math.max(0, Math.min(sidebar.length - 1, selectedSidebar + delta))]; chooseView(row.scope, row.view); }
    }
    else if (!state.scope.details) scroll(delta);
  });
  useMouseTracking(mouse);
  useWheel(locked || state.scope.details || state.actions || state.credentials || state.runtimes ? undefined : scroll);
  if (small && !state.detail && !state.onboarding && !state.environment && !editing) return <Box flexDirection="column"><Text>Resize to 45×10 to browse.</Text><Text>q / Ctrl+C detach</Text></Box>;
  const fill = (selected: boolean, active: boolean) => selected ? { backgroundColor: active ? palette.selected : palette.idle, color: active ? palette.selectedText : palette.idleText } : {};
  const keys = (hints: [string, string][]) => <Text wrap="truncate" color={palette.muted}>{hints.map(([key, label], i) => <Text key={i}>{i ? "  " : ""}<Text color={palette.accent}>{key}</Text> {label}</Text>)}</Text>;
  const viewName: keyof typeof VIEW_KEYS = pane === "sidebar" ? "Sidebar" : state.runtimes ? "Agent runtimes" : state.actions ? "Actions" : state.credentials ? "Credentials" : state.scope.details ? "Details" : state.history ? "Execution history" : "Runs";
  // The focused view's keys first; the tail always fits. Spec: docs/specs/cli-tui.md#tui-ux-review-cli-01700-os-2547
  const environmentRow = state.scope.details && !state.scope.addProject && !view;
  const viewHints: Record<keyof typeof VIEW_KEYS, [string, string][]> = {
    Sidebar: [["[Enter]", "open"], ...environmentRow ? [["[←/→]", "expand"] as [string, string]] : [], ["[E]", "add environment"], ["[f]", "retry"], ["[↑/↓]", "select"]],
    Details: [["[↑/↓]", "rows"], ["[s]", "inspect"], ["[f]", "retry"], ["[Esc]", "sidebar"]],
    Actions: [["[Enter]", "choose"], ["[Esc]", "back"], ["[↑/↓]", "select"]],
    Credentials: [["[Enter]", "open"], ["[Esc]", "back"], ["[↑/↓]", "select"]],
    "Agent runtimes": [["[Esc]", "back"], ["[↑/↓]", "select"]],
    Runs: [["[Enter]", "open"], ["[n/p]", "page"], ["[Esc]", "sidebar"], ["[↑/↓]", "select"]],
    "Execution history": [["[Enter]", "logs"], ...state.rows[selectedRow]?.run?.status === "streaming" ? [["[c]", "cancel"] as [string, string]] : [], ["[Esc]", "back"], ["[n/p]", "page"], ["[↑/↓]", "select"]],
  };
  const mouseHint: [string, string] = ["[m]", mouse ? "select text" : "mouse"];
  const footerHints = reading ? fitHints([["[↑/↓ PgUp/PgDn]", "scroll"], ["[Esc]", "back"]], [mouseHint, ["[q]", "detach"]], actionWidth)
    : fitHints(viewHints[viewName], [mouseHint, ["[?]", "keys"], ["[q]", "detach"]], actionWidth);
  const tabs = state.scope.details ? [] : [tab("[r] Runs", !state.actions, () => browser.showActions(false)), tab("[a] Actions", Boolean(state.actions), () => { browser.showActions(true); setPane("content"); })];
  const title = state.runtimes ? "Agent runtimes" : view === "actions" ? "Actions" : view === "credentials" ? "Credentials" : state.scope.addProject ? "Add project" : "Details";
  const wide = actionWidth >= 60;
  const runs = state.rows.slice(rowStart, rowStart + visibleRows).map((row, index) => ({ row, cells: rowCells(row), selected: rowStart + index === selectedRow }));
  return <Box flexDirection="column" width={size.width} height={size.height - 1} backgroundColor={palette.base}>
    {!state.detail && <Box flexDirection="column" flexShrink={0} paddingX={1} backgroundColor={palette.surface}>
      <Box height={1} gap={2}><Box flexShrink={0}><Text bold color={palette.accent}>convoy</Text></Box><Box flexGrow={1} flexShrink={1}><Text wrap="truncate" color={palette.text}>{plain(target.name)} / {plain(target.transport)}</Text></Box>
        <Box flexShrink={narrow ? 1 : 0}><Text wrap="truncate" color={palette.muted}>client {clientVersion} · service {plain(observation.version)}</Text></Box></Box>
      {failing && <Text wrap="truncate" color={palette.muted}>{plain(target.endpoint)}</Text>}
    </Box>}
    <Box height={Math.max(1, size.height - (state.detail ? 1 : 2 + header))}>
      <Box display={small || sidebarWidth === 0 ? "none" : "flex"} width={sidebarWidth} flexShrink={0} flexDirection="column" paddingRight={1} paddingTop={1} backgroundColor={palette.surface}>
        <Text color={palette.muted}>  ENVIRONMENTS</Text>
        <Clickable onClick={sidebarClick(() => browser.openEnvironment("create"))} backgroundColor={fill(addEnvironmentSelected, pane === "sidebar").backgroundColor}><Text wrap="truncate" color={fill(addEnvironmentSelected, pane === "sidebar").color ?? palette.muted}>{addEnvironmentSelected ? "›" : " "} + Add environment</Text></Clickable>
        <Text> </Text>
        {sidebarWindow.above > 0 && <Text color={palette.muted}>  ↑ {sidebarWindow.above} more</Text>}
        {sidebarLines.slice(sidebarWindow.start, sidebarWindow.end).map((row, index) => {
          if (!row) return <Text key={`gap:${sidebarWindow.start + index}`}> </Text>;
          const selected = !addEnvironmentSelected && isSelected(row);
          const { color, ...rowFill } = fill(selected, pane === "sidebar");
          const environment = row.scope.details && !row.scope.addProject && !row.view && !row.loading;
          const key = `${scopeId(row.scope)}:${row.view ?? ""}${row.loading ? ":loading" : ""}`;
          const onClick = sidebarClick(() => clickRow(row));
          // The marker shows the selection without color.
          const marker = <Box flexShrink={0}><Text color={color ?? palette.accent}>{selected ? "›" : " "} </Text></Box>;
          if (environment) {
            const tone = environmentTone(state.observations[row.scope.connection]);
            return <Clickable key={key} onClick={onClick} {...rowFill}>{marker}<Box flexGrow={1} flexShrink={1}><Text wrap="truncate" bold color={color ?? palette.text}>{plain(row.text)}</Text></Box>
              <Box flexShrink={0}><Text color={color ?? palette.muted}> {plain(row.transport)}<Text color={palette[tone]}> {DOT_GLYPHS[tone]} </Text></Text></Box></Clickable>;
          }
          return <Clickable key={key} onClick={onClick} {...rowFill}>{marker}<Box flexGrow={1} flexShrink={1}><Text wrap="truncate" color={color ?? (row.scope.addProject || row.loading ? palette.muted : palette.text)}>
            {row.busy ? <><Spinner color={color ?? palette.accent} /> {plain(row.text.slice(2))}</> : plain(row.text)}
          </Text></Box>{row.dot ? <Box flexShrink={0}><Text color={palette[row.dot]}> {DOT_GLYPHS[row.dot]} </Text></Box>
            : row.shortcut && <Box flexShrink={0}><Text color={color ?? palette.muted}> {row.shortcut} </Text></Box>}</Clickable>;
        })}
        {sidebarWindow.below > 0 && <Text color={palette.muted}>  ↓ {sidebarWindow.below} more</Text>}
      </Box>
      <Box display={narrow && sidebarWidth > 0 && !workflow ? "none" : "flex"} flexGrow={1} flexDirection="column" paddingX={1} paddingTop={1}>
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {state.onboarding && <Onboarding browser={browser} leave={leave} load={onboardingLoad} width={actionWidth} height={Math.max(1, size.height - 7)} />}
        {state.environment && <Environments browser={browser} leave={leave} width={actionWidth} height={Math.max(1, size.height - 7)} />}
        {!workflow && (state.detail ? <LogDetail key={`${state.scope.connection}:${state.detail.run?.messageId}`} browser={browser} row={state.detail} width={Math.max(1, size.width - (small ? 0 : sidebarWidth) - 2)} height={Math.max(1, size.height - 3)} small={small} mouse={mouse} toggleMouse={() => setMouse(on => !on)} /> : <>
        <Box gap={2} marginBottom={1}>
          {tabs.length ? tabs.map(([label, selected, activate]) => <Clickable key={label} flexShrink={0} onClick={unlocked(activate)}><Text {...(selected ? fill(true, true) : { color: palette.accent })}>{` ${label} `}</Text></Clickable>) : <Text bold color={palette.text}>{title}</Text>}
          <Box flexShrink={1}><Text wrap="truncate" color={palette.muted}>{plain(target.name)}{state.scope.profile ? ` / ${plain(state.scope.profile)}` : ""}{state.history ? " / execution history" : ""}</Text></Box>
        </Box>
        {!reading && warnings.length > 0 && <Clickable marginBottom={1} gap={1} onClick={unlocked(() => setWarningsOpen(true))}>
          <Box flexShrink={1}><Text wrap="truncate-end" color={palette.warning}>! {warnings[0].profile}: {warnings[0].summary}</Text></Box>
          <Box flexShrink={0}><Text color={palette.muted}>{warnings.length > 1 ? `· +${warnings.length - 1} more ` : ""}· <Text color={palette.accent}>[w]</Text> all notices</Text></Box>
        </Clickable>}
        {contextLines.length > 0 && <Box flexDirection="column" marginBottom={1}>{contextLines.map(({ text, warn, run }, index) => <Clickable key={index} onClick={unlocked(() => run?.())}><Text color={warn ? palette.warning : palette.muted} wrap="truncate">{text}</Text></Clickable>)}</Box>}
        {toolbar && <Box marginBottom={1} gap={2}>{([["[s]", "Inspect status", () => void browser.inspectEnvironment()], ["[f]", "Retry connection", () => browser.retryNow()], ["[+]", "Add project", () => { browser.openOnboarding(); setPane("content"); }]] as const)
          .map(([hint, label, run]) => <Clickable key={hint} flexShrink={0} onClick={unlocked(run)}>{keys([[hint, label]])}</Clickable>)}</Box>}
        {keysOpen ? <Dialog inline scrollable width={actionWidth} height={contentHeight}
          lines={[`Keys · ${viewName}`, "↑/↓ PgUp/PgDn scroll · Esc back", "", ...alignColumns(VIEW_KEYS[viewName]), "", "Everywhere", ...alignColumns(GLOBAL_KEYS)]}
          buttons={[{ label: "Back", activate: () => setKeysOpen(false) }]} onCancel={() => setKeysOpen(false)} />
          : warningsOpen ? <Dialog inline scrollable width={actionWidth} height={contentHeight}
          lines={[`Warning details · ${plain(target.name)}`, "↑/↓ PgUp/PgDn scroll · Esc back", ...(warnings.length ? warnings.flatMap(warning => ["", `${warning.profile} · ${warning.status}`, ...warning.details]) : ["No current project notices."])]}
          buttons={[{ label: "Back", activate: () => setWarningsOpen(false) }]} onCancel={() => setWarningsOpen(false)} />
          : state.action && !state.actions && !state.action.pending ? <ActionDialog inline state={state} browser={browser} width={actionWidth} height={contentHeight} /> : state.runtimes ? <Runtimes key={scopeId(state.scope)} browser={browser} state={state} active={pane === "content"} onSidebar={() => setPane("sidebar")} onContent={() => setPane("content")} width={actionWidth} height={contentHeight} /> : state.credentials ? <Credentials key={scopeId(state.scope)} browser={browser} state={state} leave={leave} active={pane === "content"} onContent={() => setPane("content")} width={actionWidth} height={contentHeight} /> : state.actions ? <Actions onContent={() => setPane("content")} selectedKey={actionSelection?.scope === scopeId(state.scope) ? actionSelection.key : undefined} onSelect={key => setActionSelection({ scope: scopeId(state.scope), key })} browser={browser} state={state} row={state.rows[selectedRow]} active={pane === "content" && !state.environment} width={actionWidth} height={contentHeight} /> : state.scope.addProject ? <Text color={palette.text}>Press + to add or link a project. Enter or Space opens the selected sidebar row.</Text> : state.scope.details ? <Details key={scopeId(state.scope)} browser={browser} state={state} lines={lines} focused={pane === "content"} locked={locked} width={actionWidth} height={contentHeight}
          onContent={() => setPane("content")} onCredentials={() => { chooseView({ connection: state.scope.connection, details: true }, "credentials"); setPane("content"); }} /> : <>
          <Box gap={2} marginBottom={compact ? 0 : 1}>
            <Box flexShrink={0}><Text bold color={palette.text}>{state.history ? "Execution history" : "Runs"}</Text></Box>
            <Box flexGrow={1} flexShrink={1}><Text wrap="truncate" color={palette.muted}>{plain(state.history ? [rowCells(state.history).task, state.history.thread.title].filter(Boolean).join(" · ") : state.rows[0]?.profile ?? state.scope.profile ?? "Projects in registration order")} · page {state.pageNumber}{state.loading ? " · loading" : ""}{state.next ? " · n next" : ""}</Text></Box>
            <Box flexShrink={0}><Text color={palette.muted}>{state.rows.length} {state.history ? "runs" : "threads"} on page</Text></Box>
          </Box>
          {state.rows[selectedRow]?.run && <Clickable onClick={unlocked(() => browser.beginAction("cancel", state.rows[selectedRow]))}><Text wrap="truncate" color={palette.muted}>{state.rows[selectedRow].run?.status === "streaming" ? "[c] Cancel selected run · Enter logs" : "Cancel unavailable: run is not active · Enter logs"}</Text></Clickable>}
          {state.rows.length === 0 ? <Text color={palette.text}>{state.loading ? "Loading…" : state.error ? "Page unavailable" : "No runs on this page."}</Text> : <>
            {!compact && <Box paddingX={1} gap={2}><Box flexGrow={1}><Text color={palette.muted}>{state.history ? "RUN · NEWEST FIRST" : "THREAD / TASK"}</Text></Box>
              <Box width={15} flexShrink={0}><Text color={palette.muted}>STATE</Text></Box>
              {wide && <Box width={11} flexShrink={0}><Text color={palette.muted}>{state.history ? "ELAPSED" : "UPDATED"}</Text></Box>}</Box>}
            {runs.map(({ row, cells, selected }) => {
              const { color, ...rowFill } = fill(selected, pane === "content");
              return <Clickable key={rowId(row)} onClick={unlocked(() => clickRun(row, selected))} flexShrink={0} paddingX={1} gap={2} {...rowFill}>
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                  <Box><Box flexShrink={1}><Text wrap="truncate" color={color ?? palette.text}>{selected ? "›" : " "} {cells.title}</Text></Box>
                    {cells.runtime && <Box flexShrink={0}><Text color={color ?? palette.muted}> · {cells.runtime}</Text></Box>}</Box>
                  <Text wrap="truncate" color={color ?? palette.muted}>{"  "}{cells.meta}</Text>
                </Box>
                <Box width={15} flexShrink={0}><Text wrap="truncate" color={cells.color}>{cells.symbol} {cells.label}</Text></Box>
                {wide && <Box width={11} flexShrink={0}><Text wrap="truncate" color={color ?? palette.muted}>{cells.time}</Text></Box>}
              </Clickable>;
            })}
          </>}
        </>}
        </>)}
        </Box>
        {!state.detail && <Box flexShrink={0}>{workflow || editing ? keys([["[Tab]", "focus"], ["[Enter]", "activate"], ["[Esc]", "back"], ["[Ctrl+C]", "detach · inputs retained through repair"]]) : keys(footerHints)}</Box>}
      </Box>
    </Box>
    {!state.detail && <Box flexShrink={0} height={1} paddingX={1} gap={3} backgroundColor={palette.footer}>
      <Box flexShrink={0}><Text color={palette[healthTones[observation.health]]}>{observation.health === "connected" ? "●" : "○"} <Text color={palette.muted}>{observation.health}{state.stale ? " · stale" : ""}</Text></Text></Box>
      <Box flexShrink={1}><Text wrap="truncate" color={state.stale || state.error ? palette.warning : palette.muted}>{`${plain(target.name)} · ${plain(target.transport)}${observation.snapshot && observation.profiles.every(p => p.activeRuns !== undefined) ? `   ${observation.profiles.reduce((sum, p) => sum + (p.activeRuns ?? 0), 0)} observed active` : ""}${state.updatedAt ? `   page updated ${new Date(state.updatedAt).toLocaleTimeString()}` : ""}`}</Text></Box>
    </Box>}
    {state.action && <ActionDialog state={state} browser={browser} width={size.width} height={size.height - 1} />}
  </Box>;
}
