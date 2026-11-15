import type { LogEntry } from "../../service/validators.js";
import type { Row } from "../validators.js";

export type Action = "cancel" | "stop" | "start" | "status" | "logs" | "pause" | "reload" | "shell" | "login-codex" | "login-claude-code" | "check" | "remove";
/** Login actions run only that runtime's login in the private shell, then reload. */
export const loginRuntime = (kind: Action) => kind === "login-codex" ? "codex" : kind === "login-claude-code" ? "claude-code" : undefined;
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
