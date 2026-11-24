import chalk from "chalk";
import stringWidth from "string-width";
import { stripVTControlCharacters } from "node:util";
import type { BrowseState, Health, Observation, Row } from "./validators.js";
import type { WorkerState } from "../service/validators.js";
import { guidance } from "../project/formatters.js";
import { LOGIN_LABELS, runtimeRows, type RuntimeRow } from "../service/formatters.js";
import { loginRuntimeLabels, loginRuntimeSchema, type LoginRuntime } from "../project/validators.js";
import type { EnvironmentMode } from "../environment/validators.js";

export const plain = (value: unknown) => stripVTControlCharacters(String(value ?? "unknown")).replace(/[\p{Cc}\p{Bidi_Control}]/gu, " ");
/** Text input without C0/C1 control characters. */
export const printable = (input: string) => [...input].filter(char => char.charCodeAt(0) >= 32 && !(char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)).join("");
export const masked = (value: string) => "*".repeat(Math.min(16, value.length));
export const rowId = (row: Row) => `${row.profile}:${row.run?.messageId ?? row.thread.threadId}`;
/** Design palette from /playground/convoy-tui, hand-mapped for 256 colors; 16-color terminals keep named ANSI colors. Spec: docs/specs/cli-tui.md#design-palette-cli-01050 */
export const rich = chalk.level >= 2;
export const palette: Record<"base" | "surface" | "footer" | "text" | "muted" | "accent" | "selected" | "selectedText" | "idle" | "idleText" | "running" | "warning" | "success" | "danger", string | undefined> = chalk.level >= 3 ? {
  base: "#151719", surface: "#1b1f22", footer: "#20262a", text: "#d4d7d9", muted: "#939ba1", accent: "#9cc9db",
  selected: "#34515f", selectedText: "#ecf8ff", idle: "#202a2f", idleText: "#99aab2",
  running: "#91c7dc", warning: "#e4c27a", success: "#9ccaa6", danger: "#f09d9d",
} : rich ? Object.fromEntries(Object.entries({ base: 233, surface: 234, footer: 235, text: 252, muted: 246, accent: 152,
  selected: 238, selectedText: 255, idle: 236, idleText: 249, running: 116, warning: 222, success: 151, danger: 217 }).map(([key, value]) => [key, `ansi256(${value})`])) as typeof palette : { base: undefined, surface: undefined, footer: undefined, text: undefined, muted: "gray", accent: "cyan",
  selected: "blue", selectedText: "white", idle: "gray", idleText: "white", running: "cyan", warning: "yellow", success: "green", danger: "red" };

/** The tones of a status dot; each has its own glyph, so state reads without color. Spec: docs/specs/cli-tui.md#tui-ux-review-cli-01700-os-2547 */
export type DotTone = "success" | "warning" | "danger" | "muted";
export const DOT_GLYPHS: Record<DotTone, string> = { success: "●", muted: "○", warning: "!", danger: "!" };
export const healthTones: Record<Health, DotTone> = { unknown: "muted", connecting: "warning", connected: "success", reconnecting: "warning", incompatible: "warning" };
/** Live health when connected, else the last environment check. Spec: docs/specs/cli-tui.md#environment-row-layout-cli-01320 */
export function environmentTone(observation: Observation): DotTone {
  if (observation.health !== "unknown") return healthTones[observation.health];
  if (observation.environmentError) return "warning";
  return observation.environmentStatus?.serviceRunning === true ? "success" : "muted";
}

const tones: [RegExp, string, keyof typeof palette][] = [
  [/^(streaming|running)/, "●", "running"], [/^(waiting_input|needs_)/, "?", "warning"], [/^(pending|claimed|queued)/, "○", "muted"],
  [/^(completed|done)/, "✓", "success"], [/^failed/, "!", "danger"], [/^cancel/, "■", "muted"],
];
export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
/** Service states as the runs table words them; others show with underscores as spaces. */
const STATE_LABELS: Record<string, string> = { waiting_input: "needs input" };
/** Run-table cells: the title, then a meta line with the task ref and short thread ID. History rows are runs of one thread, told apart by start time. */
export function rowCells(row: Row, now = Date.now()) {
  const status = plain(row.run?.status ?? (row.thread.hasPendingUserMessages ? `${row.thread.status ?? "idle"}+queued` : row.thread.status ?? "unknown"));
  const [, symbol, tone] = tones.find(([pattern]) => pattern.test(status)) ?? [/$/, "·", "muted" as const];
  const label = status.split("+").map(part => STATE_LABELS[part] ?? part.replaceAll("_", " ")).join(" · ");
  const time = row.run ? duration((/^(streaming|running)/.test(status) ? now : row.run.updatedAt) - row.run.createdAt) : `${duration(now - row.thread.lastActivityAt)} ago`;
  const cells = { status, label, symbol, color: palette[tone], time };
  if (row.run) return { ...cells, task: "", runtime: "", title: plain(`Run ${row.run.runId ?? row.run.messageId}`), meta: `Started ${new Date(row.run.createdAt).toLocaleString()}` };
  const task = row.thread.associatedTaskId ? plain(row.thread.associatedTaskRef ?? "task unavailable") : "";
  return { ...cells, task, runtime: row.thread.cliType ? plain(row.thread.cliType) : "", title: plain(row.thread.title), meta: [task, plain(row.thread.threadId.slice(0, 8))].filter(Boolean).join(" · ") };
}

const unhealthy = (profile: WorkerState) => Boolean(profile.warning) || ["failed", "blocked", "retrying"].includes(profile.status);
/** One line per unhealthy project, with the service's warning. Spec: docs/specs/cli-tui.md#project-warnings */
export function warningLines(profiles: WorkerState[], profile?: string): string[] {
  return profiles.filter(p => unhealthy(p) && (profile === undefined || p.profile === profile))
    .map(p => plain(`${p.profile}: ${p.status}${p.warning ? ` · ${p.warning}` : ""}`));
}

/** Compact service notices; retain the full source for the scrollable details view. */
export function warningGroups(profiles: WorkerState[], profile?: string) {
  return profiles.filter(p => unhealthy(p) && (profile === undefined || p.profile === profile)).map(p => {
    const warning = plain(p.warning ?? "");
    let remaining = warning;
    const logins: string[] = [];
    for (const [runtime, label] of Object.entries(loginRuntimeLabels)) {
      // Isolated and shared projects word the notice differently. Spec: docs/specs/cli-shared-environments.md#runtimes-and-logins
      const notice = [`${label} is not logged in for this project.`, `${label} is not logged in on this account.`].find(text => remaining.includes(text));
      if (!notice) continue;
      logins.push(label);
      remaining = remaining.replace(notice, "").replace(`Run project login ${plain(p.profile)} --runtime ${runtime}.`, "")
        .replace(guidance.sharedLogin(runtime as LoginRuntime), "");
    }
    const summary = logins.length && !remaining.trim() ? `Needs sign-in: ${logins.join(", ")}`
      : warning.split(/(?<=[.!?])\s+/)[0] || "No additional details from the service.";
    const details = warning.split(/(?<=\.) (?=(?:Codex|Claude Code|Cursor|OpenCode|Antigravity) is not logged in|Run project login|Run [^.]+ once for all projects)/);
    return { profile: plain(p.profile), status: p.status, summary, details };
  });
}

const MODE_LABELS: Record<EnvironmentMode, string> = { shared: "shared · one account for all projects", isolated: "isolated · a Linux account per project" };

/** A selectable runtime row in Details: one project's runtime. */
export type DetailRow = RuntimeRow & { id: string; profile: string };
/** `label`: how many leading columns draw muted; `kind`: a section heading, a table header or a muted note. */
export type DetailLine = { text: string; row?: DetailRow; label?: number; kind?: "heading" | "header" | "note" };

/** Pads cells into columns two spaces apart. */
export function alignColumns(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => stringWidth(row[column]))));
  return rows.map(row => row.map((cell, column) => cell + " ".repeat(widths[column] - stringWidth(cell))).join("  ").trimEnd());
}

const heading = (text: string): DetailLine => ({ text, kind: "heading" });
const note = (text: string): DetailLine => ({ text: plain(text), kind: "note" });
/** Label and value pairs with the labels in one muted column. */
function fields(pairs: [string, string][], indent: string): DetailLine[] {
  const width = Math.max(...pairs.map(([label]) => label.length));
  return pairs.map(([label, value]) => ({ text: plain(`${indent}${label.padEnd(width)}  ${value}`), label: indent.length + width }));
}

/** One table: a row per runtime and project. Columns left of PROJECT hold for the whole environment and repeat only on a runtime's first row. Spec: docs/specs/cli-tui.md#runtimes-in-details-cli-01690-os-2502 */
function runtimeSection(profiles: WorkerState[], shared: boolean): DetailLine[] {
  if (!profiles.length) return [];
  const entries = loginRuntimeSchema.options.flatMap(runtime => profiles.flatMap(profile => runtimeRows(profile).filter(row => row.runtime === runtime).map(row => ({ profile: profile.profile, row }))));
  if (!entries.length) return [heading("Runtimes"), note("  Not reported by this service")];
  const many = profiles.length > 1;
  const cells = entries.map(({ profile, row }, index) => {
    const first = entries[index - 1]?.row.runtime !== row.runtime, same = entries.filter(entry => entry.row.runtime === row.runtime);
    const project = many ? [plain(profile)] : [], login = LOGIN_LABELS[(shared ? same.find(entry => entry.row.login)?.row.login : row.login) ?? "unknown"];
    const common = first ? [loginRuntimeLabels[row.runtime], same.find(entry => entry.row.version)?.row.version ?? "unknown", ...shared ? [login] : []] : ["", "", ...shared ? [""] : []];
    return [...common, ...project, ...shared ? [] : [login], plain(row.credential)];
  });
  const header = ["RUNTIME", "VERSION", ...shared ? ["LOGIN"] : [], ...many ? ["PROJECT"] : [], ...shared ? [] : ["LOGIN"], "CREDENTIAL"];
  const [top, ...rows] = alignColumns([header, ...cells]);
  return [heading("Runtimes"), { text: `  ${top}`, kind: "header" },
    ...rows.map((text, index) => ({ text: `  ${text}`, row: { ...entries[index].row, id: `${entries[index].profile}:${entries[index].row.runtime}`, profile: entries[index].profile } }))];
}

/** `mode`: the target's own record, used until the service reports one. */
export function detailLines(state: BrowseState, endpoint: string, clientVersion: string, mode?: EnvironmentMode): DetailLine[] {
  const observation = state.observations[state.scope.connection];
  const snapshot = state.stale && observation.environmentStatus ? undefined : observation.snapshot;
  const { inspection, environmentStatus: status } = observation;
  const shown = snapshot?.mode ?? mode;
  const node = inspection ? [`Node ${inspection.nodeVersion}`] : [];
  const service = snapshot ? [snapshot.stopping ? "stopping" : "running", `PID ${snapshot.pid}`, ...node].join(" · ")
    : typeof status?.serviceRunning === "boolean" ? [`${status.serviceRunning ? "running" : "stopped"} at last environment check`, ...node].join(" · ")
      : "Service state has not been observed. Retry connection or inspect Actions.";
  const version = observation.version ? ` · service ${observation.version}` : typeof status?.selectedVersion === "string" ? ` · selected ${status.selectedVersion}` : "";
  const environment = fields([
    ["Connection", `${observation.health}${state.stale ? " (stale)" : ""}`],
    ...shown ? [["Mode", MODE_LABELS[shown]] as [string, string]] : [],
    ["Version", `client ${clientVersion}${version}`],
    ["Service", service],
    ...typeof status?.state === "string" ? [["Container", status.state] as [string, string]] : [],
    ...status?.recoveryPending === true ? [["Recovery", "pending"] as [string, string]] : [],
    ...snapshot ? [["Configuration", snapshot.configurationError ? "invalid; last valid workers retained" : "valid"] as [string, string]] : [],
    ["Endpoint", endpoint],
    ...snapshot?.epoch ? [["Epoch", snapshot.epoch] as [string, string]] : [],
  ], "  ");
  const runtimes = runtimeSection(observation.profiles, shown === "shared");
  const reports = runtimes.some(line => line.row);
  const projects = observation.profiles.flatMap(profile => {
    const config = inspection?.profiles.find(item => item.profile === profile.profile);
    const settings = config ? `concurrency ${config.concurrency ?? "default"} · OS sandbox ${config.isolated ?? "default"} · streaming ${config.streaming ?? "default"}` : "unknown";
    return [{ text: plain(`  ${profile.profile}  ${[profile.status, `${profile.activeRuns ?? "unknown"} active`, ...profile.paused ? ["paused"] : [], ...profile.pending ? ["pending config"] : []].join(" · ")}`) },
      ...fields([["Project", config?.projectId ?? "unknown"], ["Endpoint", config?.endpoint ?? "unknown"], ["Settings", settings],
        ...reports && !runtimeRows(profile).length ? [["Runtimes", "not reported yet"] as [string, string]] : []], "    ")];
  });
  const gap = { text: "" };
  return [...(observation.guidance ?? []).map(text => ({ text: plain(text) })), heading("Environment"), ...environment,
    ...runtimes.length ? [gap, ...runtimes] : [],
    ...projects.length ? [gap, heading("Projects"), ...projects, note("  Settings were captured when each project attached.")] : []];
}


const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const graphemeWidth = (segment: string) => segment.length === 1 && segment.charCodeAt(0) < 0x7f ? 1 : stringWidth(segment);

/** Break sanitized terminal text at the column limit, keeping every character; for raw content such as log JSON. */
export function breakLines(text: string, columns: number): string[] {
  columns = Math.max(1, columns);
  if (/^[\x20-\x7e]*$/.test(text)) {
    const lines: string[] = [];
    for (let offset = 0; offset < text.length; offset += columns) lines.push(text.slice(offset, offset + columns));
    return lines.length ? lines : [""];
  }
  const lines: string[] = [];
  let line = "", width = 0;
  for (const { segment } of segments.segment(text)) {
    const size = graphemeWidth(segment);
    if (width + size > columns && line) { lines.push(line); line = ""; width = 0; }
    line += segment; width += size;
  }
  lines.push(line);
  return lines;
}

/** Wrap sanitized terminal text at the last space that fits, dropping that space; a longer word breaks hard. */
export function wrapLines(text: string, columns: number): string[] {
  columns = Math.max(1, columns);
  const lines: string[] = [];
  let line: { segment: string; size: number }[] = [], width = 0;
  const flush = (next: typeof line) => { lines.push(line.map(item => item.segment).join("")); line = next; width = next.reduce((sum, item) => sum + item.size, 0); };
  for (const { segment } of segments.segment(text)) {
    const size = graphemeWidth(segment);
    if (width + size > columns && line.length) {
      if (segment === " ") { flush([]); continue; }
      // A space at 0 is indentation, not a break.
      let space = line.length - 1;
      while (space > 0 && line[space].segment !== " ") space--;
      if (space > 0) flush(line.splice(space).slice(1));
      if (width + size > columns && line.length) flush([]);
    }
    line.push({ segment, size }); width += size;
  }
  flush([]);
  return lines;
}

/** Items `start` to `end` of a scrolled list; `above` and `below` count hidden items, each side taking one of `capacity` lines. `focus` stays in view. */
export function scrollWindow(total: number, capacity: number, start: number, focus?: number) {
  const at = focus === undefined ? undefined : Math.max(0, Math.min(total - 1, focus));
  if (capacity < 3 || total <= capacity) {
    const max = Math.max(0, total - capacity);
    let first = Math.min(Math.max(0, start), max);
    if (at !== undefined) first = Math.max(0, Math.min(Math.max(first, at - capacity + 1), at, max));
    return { start: first, end: Math.min(total, first + capacity), above: 0, below: 0 };
  }
  const fit = (first: number) => { const shown = capacity - (first > 0 ? 1 : 0); return shown - (first + shown < total ? 1 : 0); };
  let first = Math.max(0, start);
  if (at !== undefined) { if (at < first) first = at; while (at >= first + fit(first)) first++; }
  while (first > 0 && first + fit(first) > total) first--;
  return { start: first, end: first + fit(first), above: first, below: total - first - fit(first) };
}

/** Footer key hints that fit `width`, dropping from the end of `hints` and never from `tail`. */
export function fitHints(hints: [string, string][], tail: [string, string][], width: number): [string, string][] {
  const size = (list: [string, string][]) => list.reduce((sum, [key, label], index) => sum + (index ? 2 : 0) + stringWidth(`${key} ${label}`), 0);
  const kept = [...hints];
  while (kept.length && size([...kept, ...tail]) > width) kept.pop();
  return [...kept, ...tail];
}

/** Escape terminal controls while preserving parsed JSON values. */
export function terminalJson(json: string): string {
  return json.replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
