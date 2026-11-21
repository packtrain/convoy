import { plain, wrapLines } from "../formatters.js";
import type { BrowseState } from "../validators.js";
import { loginRuntimeLabels } from "../../project/validators.js";
import { loginRuntime } from "./validators.js";

export function confirmationLines(state: BrowseState, target: string, width?: number): string[] {
  const action = state.action;
  if (!action?.pending) return [];
  const project = state.observations[state.scope.connection].profiles.find(p => p.profile === action.profile);
  const impact = `${project?.activeRuns ?? "Unknown"} observed active runs. Other clients of this project are affected.`;
  let question: string;
  switch (action.kind) {
    case "pause": question = `Pause this project connection and stop its active work? ${impact} Other projects stay connected.`; break;
    case "reload": question = `Reload this project connection, stopping its active work and resuming it with current configuration? ${impact} Other unchanged projects stay connected. Pending registration changes may also reconcile.`; break;
    case "shell": question = action.pauseBeforeShell
      ? `This project needs to be paused before entering its private shell. Pause and stop its active work, then open the shell? ${impact} Other projects stay connected. Exit the shell and reload to resume this project.`
      : "Open the private project shell for native runtime login or diagnostics? Exit the shell to return here, then reload to resume this project's connection. Activity locks still apply."; break;
    case "login-codex": case "login-claude-code": case "login-antigravity": question = `${action.pauseBeforeShell ? `Pause this project connection and stop its active work? ${impact} Other projects stay connected. Then r` : "R"}un only ${loginRuntimeLabels[loginRuntime(action.kind)!]}'s own login in the private shell, and reload the project when it finishes.`; break;
    case "remove": question = `Remove this local registration and stop its connection and active work? ${impact} Private files are retained. The remote project is not deleted. Pending registration changes may also reconcile.`; break;
    case "cancel": question = `Cancel run ${action.row?.run?.runId} in thread ${action.row?.thread.threadId}? All clients observe this cancellation.`; break;
    case "stop": question = "Stop this shared service? All project connections and active work stop for every attached client. Files and saved logs remain."; break;
    case "start": question = "Start this shared service? Registered projects resume for all clients."; break;
    case "status": case "logs": case "check": return [];
    default: { const unhandled: never = action.kind; throw new Error(`Unknown action: ${unhandled}`); }
  }
  return [
    `${target}${state.scope.profile ? ` / ${state.scope.profile}` : ""}`,
    "",
    question,
    "",
    "Tab / arrows select · Enter activate",
  ].flatMap(line => width === undefined ? [plain(line)] : wrapLines(plain(line), width));
}
