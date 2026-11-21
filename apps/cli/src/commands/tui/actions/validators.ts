import type { LogEntry } from "../../service/validators.js";
import type { Row } from "../validators.js";
import type { LoginRuntime } from "../../project/validators.js";

export type Action = "cancel" | "stop" | "start" | "status" | "logs" | "pause" | "reload" | "shell" | "login-codex" | "login-claude-code" | "login-antigravity" | "check" | "remove";
const LOGIN_ACTIONS: Partial<Record<Action, LoginRuntime>> = { "login-codex": "codex", "login-claude-code": "claude-code", "login-antigravity": "antigravity" };
/** Login actions run only that runtime's login in the private shell, then reload. */
export const loginRuntime = (kind: Action) => LOGIN_ACTIONS[kind];
export interface ActionState {
  kind: Action;
  profile?: string;
  identity?: string;
  pauseBeforeShell?: boolean;
  pending?: boolean;
  busy?: boolean;
  row?: Row;
  message?: string;
  entries?: LogEntry[];
  cursor?: number;
}
