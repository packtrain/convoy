import chalk from "chalk";
import stringWidth from "string-width";
import { stripVTControlCharacters } from "node:util";
import type { BrowseState, Health, Observation, Row } from "./validators.js";
import type { WorkerState } from "../service/validators.js";
import { guidance } from "../project/formatters.js";
import { loginRuntimeLabels, type LoginRuntime } from "../project/validators.js";
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

export const healthTones: Record<Health, keyof typeof palette> = { unknown: "muted", connecting: "warning", connected: "success", reconnecting: "warning", incompatible: "warning" };
/** Live health when connected, else the last environment check. Spec: docs/specs/cli-tui.md#environment-row-layout-cli-01320 */
export function environmentTone(observation: Observation): keyof typeof palette {
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
/** Run-table cells: task label before the title, runtime under the project, state symbol and age. History rows are runs of one thread, told apart by start time. */
export function rowCells(row: Row, now = Date.now()) {
  const status = plain(row.run?.status ?? (row.thread.hasPendingUserMessages ? `${row.thread.status ?? "idle"}+queued` : row.thread.status ?? "unknown"));
  const [, symbol, tone] = tones.find(([pattern]) => pattern.test(status)) ?? [/$/, "·", "muted" as const];
  const task = row.thread.associatedTaskId ? row.thread.associatedTaskRef ?? "task unavailable" : "no task";
  const time = row.run ? duration((/^(streaming|running)/.test(status) ? now : row.run.updatedAt) - row.run.createdAt) : `${duration(now - row.thread.lastActivityAt)} ago`;
  const identity = { task: plain(`[${task}]`), id: plain(row.thread.threadId), title: plain(row.thread.title) };
  if (row.run) Object.assign(identity, { task: `Started ${new Date(row.run.createdAt).toLocaleString()}`, id: "", title: plain(`Run ${row.run.runId ?? row.run.messageId}`) });
  return { ...identity,
    profile: plain(row.profile), runtime: plain(row.thread.cliType ?? "runtime unknown"), status, symbol, color: palette[tone], time };
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

const MODE_LABELS: Record<EnvironmentMode, string> = { shared: "shared (one account for all projects)", isolated: "isolated (a Linux account per project)" };

/** `mode`: the target's own record, used until the service reports one. */
export function detailLines(state: BrowseState, endpoint: string, clientVersion: string, mode?: EnvironmentMode): string[] {
  const observation = state.observations[state.scope.connection];
  const snapshot = state.stale && observation.environmentStatus ? undefined : observation.snapshot;
  const inspection = observation.inspection;
  const shown = snapshot?.mode ?? mode;
  return [
    ...(observation.guidance ?? []),
    `Connection: ${observation.health}${state.stale ? " (stale)" : ""}`,
    ...(shown ? [`Mode: ${MODE_LABELS[shown]}`] : []),
    `Client: ${clientVersion}${observation.version ? `   Service: ${observation.version}` : ""}`,
    ...(snapshot ? [
      `Service: ${snapshot.stopping ? "stopping" : "running"}   PID: ${snapshot.pid}`,
      `Configuration: ${snapshot.configurationError ? "invalid; last valid workers retained" : "valid"}`,
      `Epoch: ${snapshot.epoch}`,
    ] : typeof observation.environmentStatus?.serviceRunning === "boolean" ? [`Service: ${observation.environmentStatus.serviceRunning ? "running" : "stopped"} at last environment check`] : ["Service state has not been observed. Retry connection or inspect Actions."]),
    ...(observation.environmentStatus ? Object.entries(observation.environmentStatus).map(([key, value]) => `${key}: ${JSON.stringify(value)}`) : []),
    `Service endpoint: ${endpoint}`,
    ...(inspection ? [`Service Node: ${inspection.nodeVersion}`] : []),
    ...(observation.profiles.length ? ["Project configuration was captured when attached."] : []),
    ...observation.profiles.flatMap(profile => {
      const config = inspection?.profiles.find(item => item.profile === profile.profile);
      return [
        `${profile.profile}: ${profile.status}, active ${profile.activeRuns ?? "unknown"}${profile.paused ? ", paused" : ""}${profile.pending ? ", pending config" : ""}`,
        `  Project: ${config?.projectId ?? "unknown"}   Endpoint: ${config?.endpoint ?? "unknown"}`,
        `  Concurrency: ${config ? config.concurrency ?? "default" : "unknown"}   OS sandbox: ${config ? config.isolated ?? "default" : "unknown"}   Streaming: ${config ? config.streaming ?? "default" : "unknown"}`,
      ];
    }),
  ].map(plain);
}


const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Wrap sanitized terminal text without splitting graphemes. */
export function wrapLines(text: string, columns: number): string[] {
  columns = Math.max(1, columns);
  if (/^[\x20-\x7e]*$/.test(text)) {
    const lines: string[] = [];
    for (let offset = 0; offset < text.length; offset += columns) lines.push(text.slice(offset, offset + columns));
    return lines.length ? lines : [""];
  }
  const lines: string[] = [];
  let line = "", width = 0;
  for (const { segment } of segments.segment(text)) {
    const size = segment.length === 1 && segment.charCodeAt(0) < 0x7f ? 1 : stringWidth(segment);
    if (width + size > columns && line) { lines.push(line); line = ""; width = 0; }
    line += segment; width += size;
  }
  lines.push(line);
  return lines;
}

/** Escape terminal controls while preserving parsed JSON values. */
export function terminalJson(json: string): string {
  return json.replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
