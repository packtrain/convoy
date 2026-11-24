import type { Connection } from "../resolution.js";
import type { DetailRow } from "../formatters.js";
import { LOGIN_COMMANDS } from "../../project/validators.js";
import { loginAction } from "../actions/validators.js";

export type RuntimeAction = "signin" | "update" | "assign" | "unassign";
export const ACTION_KEYS: Record<RuntimeAction, string> = { signin: "l", update: "u", assign: "c", unassign: "x" };
export const ACTION_LABELS: Record<RuntimeAction, string> = { signin: "Sign in", update: "Update", assign: "Assign credential", unassign: "Unassign" };

/** A runtime row's actions, and a note for each one this target cannot offer. Spec: docs/specs/cli-tui.md#runtimes-in-details-cli-01690-os-2502 */
export function rowActions(row: DetailRow, target: Pick<Connection, "mode" | "maintenance" | "credentials">) {
  const actions: RuntimeAction[] = [], notes: string[] = [];
  const environment = row.profile === undefined, shared = target.mode === "shared";
  // A shared account signs in once for the environment; an isolated project has its own account.
  if (environment === shared) {
    if (loginAction(row.runtime)) actions.push("signin");
    else notes.push(`Sign in: run ${environment ? LOGIN_COMMANDS[row.runtime] : `convoy project login ${row.profile} --runtime ${row.runtime}`} in a terminal`);
  }
  if (environment) {
    if (target.maintenance?.runtimes) actions.push("update");
    else notes.push("No Update: the TUI updates managed Docker runtimes only");
  } else if (row.runtime === "opencode") notes.push("OpenCode keys: use convoy keys");
  else if (!target.credentials) notes.push("Credentials need a shared environment, a managed Docker target or a Linux project environment");
  else actions.push("assign", ...row.unassigned ? [] : ["unassign" as const]);
  return { actions, notes };
}

/** Packs hints into lines of `width`, three spaces apart, so a narrow panel wraps them instead of clipping. */
export function hintLines<T extends { text: string }>(hints: T[], width: number): T[][] {
  const lines: T[][] = [];
  let used = 0;
  for (const hint of hints) {
    if (!lines.length || used + 3 + hint.text.length > width) { lines.push([hint]); used = hint.text.length; }
    else { lines.at(-1)!.push(hint); used += 3 + hint.text.length; }
  }
  return lines;
}
