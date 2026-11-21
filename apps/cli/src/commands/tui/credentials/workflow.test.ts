import { expect, it } from "vitest";
import type { ManagedCredentialStatus } from "../../../lib/config/credentials/validators.js";
import { assignedRows, bindingRows, choices, draftMutations, entryRuntimes, rollbackRevision } from "./workflow.js";
import { delivery, draftNote, providerLabel } from "./formatters.js";

const openai = { name: "work-openai", provider: "openai", auth: "api-key", billing: "API usage", enabled: true, revision: 3, retainedRevisions: [1, 3] };
const mantle = { name: "work-mantle", provider: "mantle", region: "us-east-1", auth: "api-key", billing: "AWS", enabled: false, revision: 1, retainedRevisions: [1] };
const status: ManagedCredentialStatus = { service: true, compatible: true, configurationError: false, entries: [openai, mantle], projects: [
  { identity: "a".repeat(64), profiles: ["a"], state: "online", verified: false, pending: false,
    desired: { mode: "managed", name: "work-openai", revision: 3, claude: { mode: "managed", name: "work-mantle", revision: 1 } },
    applied: { mode: "managed", name: "work-openai", revision: 3, claude: { mode: "managed", name: "work-mantle", revision: 1 } } },
  { identity: "b".repeat(64), profiles: ["b"], state: "online", verified: false, pending: true, desired: { mode: "disabled" }, applied: { mode: "native" } },
] };
const workers = [{ profile: "a", identity: "a".repeat(64), status: "online" as const, attempts: 1 }, { profile: "b", status: "online" as const, attempts: 1 }, { profile: "c", status: "online" as const, attempts: 1 }];

it("derives saved bindings per project and runtime, matching by identity or profile key", () => {
  const rows = bindingRows(status, workers);
  expect(rows.map(row => [row.key, row.saved])).toEqual([
    ["a:codex", { mode: "managed", name: "work-openai" }], ["a:claude-code", { mode: "managed", name: "work-mantle" }], ["a:cursor", { mode: "native" }], ["a:antigravity", { mode: "native" }],
    ["b:codex", { mode: "disabled" }], ["b:claude-code", { mode: "native" }], ["b:cursor", { mode: "native" }], ["b:antigravity", { mode: "native" }],
    ["c:codex", { mode: "native" }], ["c:claude-code", { mode: "native" }], ["c:cursor", { mode: "native" }], ["c:antigravity", { mode: "native" }],
  ]);
  expect(assignedRows(rows, "work-mantle").map(row => row.key)).toEqual(["a:claude-code"]);
});

it("reports service delivery per runtime instead of inferring it from a save", () => {
  const rows = bindingRows(status, workers);
  expect(delivery(rows[0])).toBe("applied");
  expect(delivery(rows[4])).toBe("pending reconnect · [u] Reload project");
  expect(delivery(rows[5])).toBe("applied");
  expect(delivery(rows[8])).toBe("default native login");
  expect(delivery({ ...rows[0], project: { ...rows[0].project!, pending: undefined, state: "offline" } })).toBe("applied unknown (offline)");
  expect(delivery({ ...rows[0], project: { ...rows[0].project!, authResult: { result: "authentication-failed", at: 1 } } })).toBe("failed: authentication-failed");
});

it("shows a failed or blocked worker's connection state instead of asking for a reload", () => {
  // localManagedStatus() omits `applied` for stopped, failed and blocked workers.
  for (const state of ["failed", "blocked"]) {
    const [codex, claude] = bindingRows({ ...status, projects: [{ ...status.projects[0], state, applied: undefined, pending: true }] }, workers.slice(0, 1));
    expect([delivery(codex), delivery(claude)]).toEqual([`connection ${state}`, `connection ${state}`]);
  }
});

it("reports Codex auth outcomes only on the Codex row", () => {
  const project = { ...status.projects[0], verified: true, authResult: { result: "request-succeeded" as const, at: 1 } };
  const [codex, claude] = bindingRows({ ...status, projects: [project] }, workers.slice(0, 1));
  expect([delivery(codex), delivery(claude)]).toEqual(["applied · request succeeded", "applied"]);
  const failed = { ...project, verified: false, authResult: { result: "authentication-failed" as const, at: 1 } };
  expect(delivery({ ...claude, project: failed })).toBe("applied");
});

it("detects AWS entries by provider", () => {
  const regionless = { ...mantle, region: undefined };
  expect(entryRuntimes(regionless)).toEqual(["codex", "claude-code"]);
  expect(providerLabel(regionless)).toContain("Mantle");
});

it("offers an Anthropic entry to Claude Code only (OS-2016)", () => {
  const anthropic = { ...mantle, provider: "anthropic", region: undefined };
  expect(entryRuntimes(anthropic)).toEqual(["claude-code"]);
  expect(providerLabel(anthropic)).toBe("Anthropic");
});

it("offers only compatible, enabled entries and keeps a disabled entry from gaining assignments", () => {
  const rows = bindingRows(status, workers);
  // Keys sit next to native login, so one → from the default selects a key.
  expect(choices(rows[8], status.entries)).toEqual([{ mode: "native" }, { mode: "managed", name: "work-openai" }, { mode: "disabled" }]);
  expect(choices(rows[1], status.entries)).toEqual([{ mode: "native" }, { mode: "managed", name: "work-mantle" }, { mode: "disabled" }]);
  expect(choices(rows[9], status.entries)).toEqual([{ mode: "native" }, { mode: "disabled" }]);
  expect(choices(rows[9], status.entries, mantle)).toEqual([{ mode: "native" }]);
  expect(choices(rows[1], status.entries, mantle)).toEqual([{ mode: "disabled" }, { mode: "managed", name: "work-mantle" }]);
});

it("turns only changed draft rows into bind requests and names replacements", () => {
  const rows = bindingRows({ ...status, entries: [openai, { ...mantle, enabled: true }] }, workers);
  const draft = { "a:codex": { mode: "managed" as const, name: "work-openai" }, "b:claude-code": { mode: "managed" as const, name: "work-mantle" }, "c:codex": { mode: "disabled" as const } };
  expect(draftMutations(rows, draft).map(change => change.request)).toEqual([
    { action: "bind", profile: "b", runtime: "claude-code", binding: { mode: "managed", name: "work-mantle" } },
    { action: "bind", profile: "c", binding: { mode: "disabled" } },
  ]);
  expect(draftNote(rows[0], { mode: "managed", name: "other" })).toBe("unsaved · replaces work-openai");
  expect(draftNote(rows[4], { mode: "managed", name: "work-openai" })).toBe("unsaved · was unassigned");
});

it("rolls back to the newest retained revision older than the current one", () => {
  expect(rollbackRevision(openai)).toBe(1);
  expect(rollbackRevision(mantle)).toBeUndefined();
});

it("gives Cursor its own row, offered Cursor keys only (OS-2017)", () => {
  const cursor = { ...openai, name: "work-cursor", provider: "cursor", billing: "Cursor account" };
  expect(entryRuntimes(cursor)).toEqual(["cursor"]);
  expect(entryRuntimes(openai)).toEqual(["codex"]);
  expect(providerLabel(cursor)).toBe("Cursor account key");
  const desired = { mode: "native" as const, cursor: { mode: "managed" as const, name: "work-cursor", revision: 3 } };
  const project = { ...status.projects[0], desired, applied: { mode: "native" as const }, pending: true };
  const [codexRow, , cursorRow] = bindingRows({ ...status, entries: [openai, cursor], projects: [project] }, workers.slice(0, 1));
  expect(cursorRow.saved).toEqual({ mode: "managed", name: "work-cursor" });
  expect([delivery(codexRow), delivery(cursorRow)]).toEqual(["applied", "pending reconnect · [u] Reload project"]);
  expect(choices(cursorRow, [openai, cursor])).toEqual([{ mode: "native" }, { mode: "managed", name: "work-cursor" }, { mode: "disabled" }]);
  expect(draftMutations([cursorRow], { "a:cursor": { mode: "native" } }).map(change => change.request)).toEqual([
    { action: "bind", profile: "a", runtime: "cursor", binding: { mode: "native" } },
  ]);
});

it("gives Antigravity its own row, offered Gemini keys only (OS-2476)", () => {
  const gemini = { ...openai, name: "work-gemini", provider: "gemini" };
  expect(entryRuntimes(gemini)).toEqual(["antigravity"]);
  expect(providerLabel(gemini)).toBe("Gemini");
  const desired = { mode: "native" as const, antigravity: { mode: "managed" as const, name: "work-gemini", revision: 3 } };
  const project = { ...status.projects[0], desired, applied: { mode: "native" as const }, pending: true };
  const [codexRow, , , antigravityRow] = bindingRows({ ...status, entries: [openai, gemini], projects: [project] }, workers.slice(0, 1));
  expect(antigravityRow.saved).toEqual({ mode: "managed", name: "work-gemini" });
  expect([delivery(codexRow), delivery(antigravityRow)]).toEqual(["applied", "pending reconnect · [u] Reload project"]);
  expect(choices(antigravityRow, [openai, gemini])).toEqual([{ mode: "native" }, { mode: "managed", name: "work-gemini" }, { mode: "disabled" }]);
  expect(draftMutations([antigravityRow], { "a:antigravity": { mode: "disabled" } }).map(change => change.request)).toEqual([
    { action: "bind", profile: "a", runtime: "antigravity", binding: { mode: "disabled" } },
  ]);
});
