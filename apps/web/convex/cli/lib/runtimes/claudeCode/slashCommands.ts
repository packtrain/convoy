import type { RawCliChunk } from "../contracts";
import { toRuntimeSlashCommand, type RuntimeSlashCommand } from "../validators";
import { getSyntheticSlashCommandsFromIncomingChunks } from "../shared/syntheticCommands";

function toCommands(values: unknown[]): RuntimeSlashCommand[] {
  return values
    .map(toRuntimeSlashCommand)
    .filter((command): command is RuntimeSlashCommand => command !== null);
}

/**
 * Slash commands advertised by the Agent SDK: the `system/init` event
 * (`slash_commands: string[]`: built-ins plus user/project custom commands
 * and skills) and mid-session `system/commands_changed` events
 * (`commands: [{ name, description, argumentHint }]`). The last event in the
 * batch wins. Returns null when the incoming chunks carry neither event.
 *
 * The stream carries names only, so the runner reports descriptions and
 * argument hints through the synthetic `convoy.commands` chunk, which wins the
 * batch whenever it is there (OS-1806, docs/specs/cli-runtime-commands.md).
 */
export function getClaudeCodeSlashCommandsFromIncomingChunks(
  incomingChunks: RawCliChunk[],
): RuntimeSlashCommand[] | null {
  const reported = getSyntheticSlashCommandsFromIncomingChunks(incomingChunks);
  if (reported) {
    return reported;
  }

  let commands: RuntimeSlashCommand[] | null = null;

  for (const chunk of incomingChunks) {
    if (chunk.type !== "system") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(chunk.data);
    } catch {
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.subtype === "init" && Array.isArray(obj.slash_commands)) {
      commands = toCommands(obj.slash_commands);
    } else if (obj.subtype === "commands_changed" && Array.isArray(obj.commands)) {
      commands = toCommands(obj.commands);
    }
  }

  return commands;
}
