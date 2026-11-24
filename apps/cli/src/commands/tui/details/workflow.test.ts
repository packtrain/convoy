import { expect, it } from "vitest";
import { rowActions } from "./workflow.js";
import type { DetailRow } from "../formatters.js";

const row = (runtime: DetailRow["runtime"], profile = "a", credential = "native"): DetailRow => ({ id: `${profile}:${runtime}`, runtime, profile, credential, unassigned: credential === "none" });
const docker = { mode: "shared" as const, maintenance: { runtimes: {} } as never, credentials: {} as never };

it("offers Sign in, Update and the project's credential actions on one row (OS-2502)", () => {
  expect(rowActions(row("codex"), docker)).toEqual({ actions: ["signin", "update", "assign", "unassign"], notes: [] });
  expect(rowActions(row("claude-code", "a", "none"), { ...docker, mode: "isolated" }).actions).toEqual(["signin", "update", "assign"]);
  expect(rowActions(row("codex"), { mode: "shared", credentials: {} as never }).actions).toEqual(["signin", "assign", "unassign"]);
});

it("names the reason for each action a row cannot offer (OS-2502)", () => {
  const local = { mode: "shared" as const, credentials: {} as never };
  expect(rowActions(row("cursor"), local)).toEqual({ actions: ["assign", "unassign"], notes: ["Sign in: run NO_OPEN_BROWSER=1 cursor-agent login in a terminal"] });
  expect(rowActions(row("cursor"), { mode: "isolated" }).notes).toEqual([
    "Sign in: run convoy project login a --runtime cursor in a terminal", "Credentials need a shared environment, a managed Docker target or a Linux project environment"]);
  expect(rowActions(row("opencode"), local).notes).toEqual(["Sign in: run opencode auth login in a terminal", "OpenCode keys: use convoy keys"]);
});

it("offers Unassign by the binding, not its label, so a key named none keeps it (OS-2502)", () => {
  expect(rowActions({ ...row("codex", "a", "none"), unassigned: false }, docker).actions).toEqual(["signin", "update", "assign", "unassign"]);
  expect(rowActions({ ...row("codex", "a", "none"), unassigned: true }, docker).actions).toEqual(["signin", "update", "assign"]);
});
