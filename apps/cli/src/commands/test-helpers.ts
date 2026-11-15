import type { Command } from "commander";

export function resetCommandOptions(cmd: Command): void {
  for (const option of cmd.options) {
    cmd.setOptionValue(option.attributeName(), option.defaultValue);
  }
}
