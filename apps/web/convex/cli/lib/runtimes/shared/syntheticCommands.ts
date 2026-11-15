import type { RawCliChunk } from "../contracts";
import { toRuntimeSlashCommand, type RuntimeSlashCommand } from "../validators";

/**
 * Runtimes whose CLI does not advertise slash commands in its own stream
 * (OpenCode, Cursor), or advertises names only (Claude Code), have the Convoy
 * runner emit a synthetic `convoy.commands` chunk at the start of a run or at
 * its first result. Entries are bare names or `{ name, description?,
 * argumentHint? }` (OS-1806). Returns null when the chunks carry no inventory.
 */
export function getSyntheticSlashCommandsFromIncomingChunks(
  incomingChunks: RawCliChunk[],
): RuntimeSlashCommand[] | null {
  for (const chunk of incomingChunks) {
    if (chunk.type !== "convoy.commands") {
      continue;
    }

    const commands = parseSyntheticSlashCommandsChunk(chunk.data);
    if (commands) {
      return commands;
    }
  }

  return null;
}

/** The inventory inside one `convoy.commands` chunk, or null if unreadable. */
export function parseSyntheticSlashCommandsChunk(
  data: string,
): RuntimeSlashCommand[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.commands)) {
    return null;
  }

  return obj.commands
    .map(toRuntimeSlashCommand)
    .filter((command): command is RuntimeSlashCommand => command !== null);
}
