import type { Command } from "commander";

export function getGlobalStringOption(
  cmd: Command,
  optionName: string
): string | undefined {
  const value = Reflect.get(cmd.optsWithGlobals(), optionName);
  return typeof value === "string" ? value : undefined;
}

export function getGlobalProjectOption(cmd: Command): string | undefined {
  return getGlobalStringOption(cmd, "project");
}
