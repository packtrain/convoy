import { expect, it } from "vitest";
import { rowActions } from "./workflow.js";
import type { DetailRow } from "../formatters.js";

const row = (runtime: DetailRow["runtime"], profile?: string, credential = "native"): DetailRow => ({ id: `${profile ?? ""}:${runtime}`, runtime, profile, credential, unassigned: credential === "none" });
const docker = { mode: "shared" as const, maintenance: { runtimes: {} } as never, credentials: {} as never };

it("signs in once on a shared environment's rows and per project when isolated (OS-2502)", () => {
  expect(rowActions(row("codex"), docker)).toEqual({ actions: ["signin", "update"], notes: [] });
  expect(rowActions(row("codex", "a"), docker)).toEqual({ actions: ["assign", "unassign"], notes: [] });
  expect(rowActions(row("codex"), { ...docker, mode: "isolated" }).actions).toEqual(["update"]);
  expect(rowActions(row("claude-code", "a", "none"), { ...docker, mode: "isolated" }).actions).toEqual(["signin", "assign"]);
});

it("names the reason for each action a row cannot offer (OS-2502)", () => {
  const local = { mode: "shared" as const, credentials: {} as never };
  expect(rowActions(row("cursor"), local)).toEqual({ actions: [], notes: [
    "Sign in: run NO_OPEN_BROWSER=1 cursor-agent login in a terminal", "No Update: the TUI updates managed Docker runtimes only"] });
  expect(rowActions(row("cursor", "a"), { mode: "isolated" }).notes).toEqual([
    "Sign in: run convoy project login a --runtime cursor in a terminal", "Credentials need a shared environment, a managed Docker target or a Linux project environment"]);
  expect(rowActions(row("opencode", "a"), local)).toEqual({ actions: [], notes: ["OpenCode keys: use convoy keys"] });
});

it("offers Unassign by the binding, not its label, so a key named none keeps it (OS-2502)", () => {
  expect(rowActions({ ...row("codex", "a", "none"), unassigned: false }, docker).actions).toEqual(["assign", "unassign"]);
  expect(rowActions({ ...row("codex", "a", "none"), unassigned: true }, docker).actions).toEqual(["assign"]);
});
