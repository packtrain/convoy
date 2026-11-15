import type { Command } from "commander";
import {
  requireCredentials,
  resolveConfigFromProfileCommand,
  type RequiredConfig,
} from "./config/index.js";

export function resolveOneShotConfig(cmd: Command, cwd?: string): RequiredConfig {
  const resolved = resolveConfigFromProfileCommand(cmd, cwd);
  requireCredentials(resolved);
  return resolved;
}
