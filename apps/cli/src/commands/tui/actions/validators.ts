import type { LogEntry } from "../../service/validators.js";
import type { Row } from "../validators.js";
import type { LoginRuntime } from "../../project/validators.js";

export type Action = "cancel" | "stop" | "start" | "status" | "logs" | "pause" | "reload" | "shell" | "login-codex" | "login-claude-code" | "login-antigravity" | "check" | "remove" | "concurrency";
const LOGIN_ACTIONS: Partial<Record<Action, LoginRuntime>> = { "login-codex": "codex", "login-claude-code": "claude-code", "login-antigravity": "antigravity" };
/** Login actions run only that runtime's login in the private shell, then reload. */
export const loginRuntime = (kind: Action) => LOGIN_ACTIONS[kind];
/** The TUI login action of a runtime; Cursor and OpenCode have none. */
export const loginAction = (runtime: LoginRuntime) => (Object.keys(LOGIN_ACTIONS) as Action[]).find(kind => LOGIN_ACTIONS[kind] === runtime);
export interface ActionState {
  kind: Action;
  profile?: string;
  identity?: string;
  /** A shared environment's Sign in: `profile` only carries the terminal, and every project reloads after it. */
  environment?: boolean;
  pauseBeforeShell?: boolean;
  /** Set concurrency: the confirmed value (null clears it) and whether to reload now. */
  concurrency?: number | null;
  interrupt?: boolean;
  pending?: boolean;
  busy?: boolean;
  row?: Row;
  message?: string;
  entries?: LogEntry[];
  cursor?: number;
}
