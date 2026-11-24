import { stripVTControlCharacters } from "node:util";
import type { RuntimeLogin, ServiceResponse, WorkerState } from "./validators.js";
import { loginRuntimeLabels, loginRuntimeSchema, type LoginRuntime } from "../project/validators.js";
import { runtimeDescriptor, type AuthDescriptor } from "../../lib/config/credentials/validators.js";

type Print = (text: string) => void;
const plain = (value: unknown) => stripVTControlCharacters(String(value ?? "-"));
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

export function printServiceEvent(event: ServiceResponse, json = false, print: Print = console.log): void {
  if (json) { print(JSON.stringify(event)); return; }
  if (event.event === "heartbeat") return;
  if (event.gap) print("Event history expired or service restarted. Showing a fresh snapshot.");
  if (event.profiles) {
    print(`Service ${event.pid}${event.stopping ? " stopping" : " running"} | cursor ${event.cursor}`);
    print("PROFILE\tSTATUS\tACTIVE\tPENDING\tPAUSED");
    for (const p of event.profiles) print([p.profile, p.status, p.activeRuns ?? 0, Boolean(p.pending), Boolean(p.paused)].map(plain).join("\t"));
    const runtimes = runtimeLines(event.profiles);
    if (runtimes.length) print(runtimes.join("\n"));
    const warnings = event.profiles.filter(p => p.warning);
    if (warnings.length) print(["Warnings:", ...warnings.map(p => `  ${plain(p.profile)}: ${plain(p.status)} · ${plain(p.warning)}`)].join("\n"));
  }
  if (event.result !== undefined) {
    const result = record(event.result), execution = record(result.event);
    print(`[${plain(result.profile)}] ${plain(execution.threadId)} ${plain(execution.phase)}${execution.runId ? ` (run ${plain(execution.runId)})` : ""}`);
  }
}

export const LOGIN_LABELS: Record<RuntimeLogin, string> = { "signed-in": "signed in", "signed-out": "signed out", unknown: "unknown" };
/** `unassigned`: the binding disables the runtime; `credential` is only its label. */
export interface RuntimeRow { runtime: LoginRuntime; version?: string; login?: RuntimeLogin; credential: string; unassigned: boolean }

/** A project's runtimes with their version, native login and saved credential. Spec: docs/specs/cli-tui.md#runtimes-in-details-cli-01690-os-2502 */
export function runtimeRows(profile: WorkerState): RuntimeRow[] {
  const auth = profile.desiredAuth ?? profile.auth;
  return loginRuntimeSchema.options.filter(runtime => profile.versions?.[runtime] !== undefined || profile.logins?.[runtime] !== undefined)
    .map(runtime => ({ runtime, version: profile.versions?.[runtime], login: profile.logins?.[runtime], ...credential(runtime, auth) }));
}

/** `native` without a binding, `none` when unassigned (runtime disabled), else `key <name>`, so a key named none reads apart. */
function credential(runtime: LoginRuntime, auth?: AuthDescriptor) {
  if (runtime === "opencode") {
    const names = Object.values(auth?.opencode ?? {}).flatMap(slot => slot?.name ? [slot.name] : []);
    return !auth?.opencode ? { credential: "native", unassigned: false } : names.length ? { credential: `key ${names.join(", ")}`, unassigned: false } : { credential: "none", unassigned: true };
  }
  const binding = runtimeDescriptor(runtime, auth);
  if (!binding || binding.mode === "native") return { credential: "native", unassigned: false };
  return binding.mode === "disabled" ? { credential: "none", unassigned: true } : { credential: `key ${binding.name ?? "managed"}`, unassigned: false };
}

/** One tab-separated row per project and runtime, like the profile table above it. */
function runtimeLines(profiles: WorkerState[]) {
  if (!profiles.length) return [];
  if (!profiles.some(profile => runtimeRows(profile).length)) return ["Runtimes: not reported by this service"];
  const missing = profiles.filter(profile => !runtimeRows(profile).length).map(profile => plain(profile.profile));
  return ["PROFILE\tRUNTIME\tVERSION\tLOGIN\tCREDENTIAL", ...profiles.flatMap(profile => runtimeRows(profile).map(row =>
    [profile.profile, loginRuntimeLabels[row.runtime], row.version ?? "unknown", LOGIN_LABELS[row.login ?? "unknown"], row.credential].map(plain).join("\t"))),
  ...missing.length ? [`Runtimes not reported yet: ${missing.join(", ")}`] : []];
}

export function printRunResult(value: unknown, json = false, print: Print = console.log): void {
  if (json) { print(JSON.stringify(value)); return; }
  const row = record(value);
  if (Array.isArray(row.page)) {
    print("THREAD\tSTATUS\tTITLE\tRUN\tMESSAGE");
    for (const item of row.page) {
      const run = record(item);
      print([run.threadId, run.status, run.title, run.runId, run.messageId].map(plain).join("\t"));
    }
    if (row.page.length === 0) print("No runs found.");
    if (row.isDone === false && row.continueCursor) print(`Next page: --cursor ${plain(row.continueCursor)}`);
    return;
  }
  if (row.truncated === true || row.kind === "truncated") { print(`[truncated] ${plain(row.preview)}`); return; }
  if (row.kind) {
    if ((row.kind === "text" || row.kind === "reasoning") && typeof row.text === "string") print(plain(row.text));
    else print([row.kind, row.toolName ?? row.name, row.toolCallId ?? row.id, row.message ?? row.errorText ?? row.status].filter(v => v !== undefined).map(plain).join(" "));
    return;
  }
  for (const [key, item] of Object.entries(row)) {
    if (item !== undefined && (item === null || typeof item !== "object")) print(`${key}: ${plain(item)}`);
  }
}

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** A launchd job that runs once at each login, without KeepAlive. Spec: docs/specs/cli-shared-environments.md#start-at-login-on-macos */
export function launchAgentPlist(label: string, programArguments: string[], environment: Record<string, string>): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`, `<dict>`,
    `  <key>Label</key>`, `  <string>${xml(label)}</string>`,
    `  <key>ProgramArguments</key>`, `  <array>`, ...programArguments.map(value => `    <string>${xml(value)}</string>`), `  </array>`,
    `  <key>EnvironmentVariables</key>`, `  <dict>`,
    ...Object.entries(environment).flatMap(([name, value]) => [`    <key>${xml(name)}</key>`, `    <string>${xml(value)}</string>`]),
    `  </dict>`,
    `  <key>ProcessType</key>`, `  <string>Interactive</string>`,
    `  <key>RunAtLoad</key>`, `  <true/>`,
    `</dict>`, `</plist>`, "",
  ].join("\n");
}
