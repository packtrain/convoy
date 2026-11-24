import { loginRuntime, type Action } from "./validators.js";
import { useState } from "react";
import { Text, useInput } from "ink";
import type { Browser } from "../workflow.js";
import type { BrowseState, Row } from "../validators.js";
import { palette, plain, terminalJson, wrapLines } from "../formatters.js";
import { confirmationLines } from "./formatters.js";
import { Clickable, Dialog } from "../dialog/index.js";

const labels: Record<Action, string> = { status: "Service status", logs: "Saved service JSON logs", start: "Start shared service", stop: "Stop shared service", pause: "Pause project", reload: "Reload project", shell: "Private project shell", "login-codex": "Log in to Codex", "login-claude-code": "Log in to Claude Code", "login-antigravity": "Log in to Antigravity", check: "Check project", remove: "Remove project from environment", cancel: "Cancel selected run" };
export function ActionDialog({ state, browser, width, height, inline = false }: { state: BrowseState; browser: Browser; width: number; height: number; inline?: boolean }) {
  const action = state.action;
  if (!action || action.entries || Boolean(action.pending) === inline) return null;
  const close = () => browser.dismissAction();
  const lines = action.pending ? confirmationLines(state, browser.targets[state.scope.connection].name)
    : [`${plain(browser.targets[state.scope.connection].name)}${action.profile && !action.environment ? ` / ${plain(action.profile)}` : ""}`, ...(action.busy ? `Working: ${labels[action.kind]}` : action.message ?? "").split("\n"), "↑/↓ PgUp/PgDn scroll · Esc back"];
  return <Dialog inline={inline} key={`${action.kind}:${Boolean(action.pending)}`} lines={lines} width={width} height={height} scrollable={!action.pending}
    onCancel={close} buttons={action.pending ? [{ label: "Cancel", activate: close },
      { label: action.environment ? "Sign in" : action.pauseBeforeShell ? loginRuntime(action.kind) ? "Pause and log in" : "Pause and enter shell" : labels[action.kind], activate: () => browser.confirmAction() }]
      : action.busy ? [] : [{ label: "Back", activate: close }]} />;
}

type Control = { key: string; label: string; section: string }
  & ({ type: "action"; kind: Action } | { type: "environment"; environment: NonNullable<BrowseState["environment"]> } | { type: "credentials" } | { type: "runtime-access" } | { type: "runtimes" });
const service: Control[] = [
  { type: "action", kind: "logs", key: "l", label: labels.logs, section: "Service" },
  { type: "action", kind: "start", key: "b", label: labels.start, section: "Service" },
  { type: "action", kind: "stop", key: "x", label: labels.stop, section: "Service" },
];
const maintenance: Control[] = [
  { type: "environment", environment: "restart", key: "t", label: "Restart service", section: "Service" },
  { type: "environment", environment: "update", key: "u", label: "Update CLI", section: "Maintenance" },
  { type: "runtimes", key: "r", label: "Agent runtimes", section: "Maintenance" },
  { type: "environment", environment: "start", key: "g", label: "Start environment / recover", section: "Container" },
  { type: "environment", environment: "stop", key: "z", label: "Stop environment", section: "Container" },
  { type: "environment", environment: "delete", key: "D", label: "Delete environment", section: "Container" },
];
const project: Control[] = [
  { type: "action", kind: "pause", key: "p", label: labels.pause, section: "Project" },
  { type: "action", kind: "reload", key: "u", label: labels.reload, section: "Project" },
  { type: "action", kind: "shell", key: "h", label: labels.shell, section: "Project" },
  { type: "action", kind: "login-codex", key: "i", label: labels["login-codex"], section: "Project" },
  { type: "action", kind: "login-claude-code", key: "o", label: labels["login-claude-code"], section: "Project" },
  { type: "action", kind: "login-antigravity", key: "y", label: labels["login-antigravity"], section: "Project" },
  { type: "action", kind: "check", key: "e", label: labels.check, section: "Project" },
  { type: "action", kind: "remove", key: "v", label: labels.remove, section: "Project" },
  { type: "runtime-access", key: "t", label: "Runtime access", section: "Credentials" },
  { type: "credentials", key: "c", label: "Assign or unassign credentials", section: "Credentials" },
];
export function Actions({ browser, state, row, active, width, height, selectedKey, onSelect, onContent }: {
  browser: Browser; state: BrowseState; row?: Row; active: boolean; width: number; height: number; selectedKey?: string; onSelect?: (key: string) => void; onContent?: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const [offset, setOffset] = useState(0);
  const action = state.action;
  const target = browser.targets[state.scope.connection];
  const controls = state.scope.details ? [
    ...service,
    ...(target.maintenance ? maintenance.filter(control => control.type !== "runtimes" || target.maintenance?.runtimes) : []),
    // A shared environment signs in from its Details. Spec: docs/specs/cli-tui.md#runtimes-in-details-cli-01690-os-2502
  ] : state.scope.profile ? project.filter(control => !(target.mode === "shared" && control.type === "action" && loginRuntime(control.kind))) : [];
  const observation = state.observations[state.scope.connection];
  const unavailable = (control: Control) => {
    if (observation.environmentError && (control.type === "environment" || control.type === "runtimes")) return `${observation.environmentError} · Inspect status [s] before retrying.`;
    if (observation.health !== "connected" && ["stopped", "not-created"].includes(String(observation.environmentStatus?.state)) && (control.type === "runtimes" || (control.type === "environment" && control.environment !== "start" && control.environment !== "delete"))) return "Container is stopped. Start environment [g] first.";
    if (observation.health !== "connected" && ["stopped", "not-created"].includes(String(observation.environmentStatus?.state)) && control.type === "action" && control.kind === "start") return "Start environment [g] to restore the container and service.";
    if (control.type === "action" && control.kind === "start" && observation.health === "connected") return "Service already running.";
    if ((control.type === "credentials" || control.type === "runtime-access") && !target.credentials) return "Runtime credentials need a shared environment, a managed Docker target or a Linux project environment.";
    return control.type === "action" ? browser.unavailable(control.kind, row) : undefined;
  };
  const choice = selectedKey && controls.some(control => control.key === selectedKey) ? controls.findIndex(control => control.key === selectedKey) : Math.min(selected, Math.max(0, controls.length - 1));
  const select = (index: number) => { setSelected(index); if (controls[index]) onSelect?.(controls[index].key); };
  const lines = [...(action?.message ?? "").split("\n"), ...(action?.entries ?? []).map(entry => terminalJson(JSON.stringify(entry)))].flatMap(line => wrapLines(plain(line), width));
  const capacity = Math.max(1, height - 2);
  const start = Math.min(offset, Math.max(0, lines.length - capacity));
  // A control's key, Enter on it, and a click on its row all land here.
  const run = (control: Control) => {
    select(controls.indexOf(control)); setOffset(0);
    if (unavailable(control)) return;
    if (control.type === "runtime-access") browser.openRuntimeAccess();
    else if (control.type === "runtimes") browser.showRuntimes(true);
    else if (control.type === "credentials") browser.showCredentials(true);
    else if (control.type === "environment") browser.openEnvironment(control.environment);
    else browser.beginAction(control.kind, row);
  };
  useInput((input, key) => {
    if (key.ctrl || key.meta || key.escape || action?.busy || action?.pending || !active) return;
    if (action?.message && !action.entries && !controls.some(control => control.key === input)) return;
    if (action?.entries) {
      if (input === "n") { setOffset(0); browser.moreOperationalLogs(); return; }
      if (key.home) { setOffset(0); browser.beginAction("logs"); return; }
      const delta = key.pageDown ? capacity : key.pageUp ? -capacity : key.upArrow || input === "k" ? -1 : key.downArrow || input === "j" ? 1 : 0;
      if (delta) setOffset(Math.max(0, Math.min(lines.length - capacity, start + delta)));
      return;
    }
    if (key.upArrow || input === "k") { select(Math.max(0, choice - 1)); return; }
    if (key.downArrow || input === "j") { select(Math.min(controls.length - 1, choice + 1)); return; }
    const control = key.return ? controls[choice] : controls.find(value => value.key === input);
    if (control) run(control);
  });
  // A click works from either pane, so it moves focus here; a pending confirmation keeps the menu inert.
  const click = (control: Control) => () => { if (action?.busy || action?.pending) return; onContent?.(); run(control); };
  if (action && !action.pending && !action.entries) return <ActionDialog inline state={state} browser={browser} width={width} height={height} />;
  if (action?.entries) return <>
    <Text bold color={palette.text}>{plain(target.name)} · Saved service logs</Text>
    <Text color={palette.muted}>↑/↓ PgUp/PgDn · Esc actions · n next · Home first</Text>
    {lines.slice(start, start + capacity).map((line, i) => <Text key={i} color={palette.text}>{line}</Text>)}
  </>;
  const menu = controls.flatMap((control, i) => [
    ...(i === 0 || control.section !== controls[i - 1].section ? [{ text: control.section, index: -1 }] : []),
    { text: `${i === choice ? ">" : " "} [${control.key}] ${control.label}${unavailable(control) ? " · unavailable" : ""}`, index: i },
  ]);
  const focused = controls[choice];
  const reason = focused ? unavailable(focused) : undefined;
  const environment = focused?.type === "environment" ? focused.environment : undefined;
  const hint = reason ?? (environment === "delete" ? "Permanently deletes the container and all saved environment data." : environment === "stop" ? "Stops the container and all projects; volumes remain."
    : environment === "start" ? "Starts or rebuilds the container and starts its service."
    : focused?.type === "runtimes" ? "See installed agent runtime versions, then install or update the ones you check in one batch."
    : focused?.type === "runtime-access" ? "Check Codex and Claude Code accounts, sign in or choose their authentication method."
    : focused?.type === "credentials" ? "Choose each runtime's managed key, unassign it or use native login. Changes apply after reload." : "Enter to choose · Esc back");
  const hintLines = wrapLines(plain(hint), width).slice(0, Math.max(1, Math.floor(height / 3)));
  const menuCapacity = Math.max(1, height - hintLines.length);
  const menuStart = Math.max(0, menu.findIndex(line => line.index === choice) - menuCapacity + 1);
  return <>
    {menu.slice(menuStart, menuStart + menuCapacity).map((line, i) => line.index < 0 ? <Text key={i} wrap="truncate" color={palette.muted}>{line.text}</Text>
      : <Clickable key={i} onClick={click(controls[line.index])} backgroundColor={line.index === choice ? active ? palette.selected : palette.idle : undefined}><Text wrap="truncate" color={line.index === choice ? active ? palette.selectedText : palette.idleText : palette.text}>{line.text}</Text></Clickable>)}
    {hintLines.map((line, i) => <Text key={i} color={reason ? palette.warning : palette.muted}>{line}</Text>)}
  </>;
}
