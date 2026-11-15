import { stripVTControlCharacters } from "node:util";
import type { ServiceResponse } from "./validators.js";

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
    const warnings = event.profiles.filter(p => p.warning);
    if (warnings.length) print(["Warnings:", ...warnings.map(p => `  ${plain(p.profile)}: ${plain(p.status)} · ${plain(p.warning)}`)].join("\n"));
  }
  if (event.result !== undefined) {
    const result = record(event.result), execution = record(result.event);
    print(`[${plain(result.profile)}] ${plain(execution.threadId)} ${plain(execution.phase)}${execution.runId ? ` (run ${plain(execution.runId)})` : ""}`);
  }
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
