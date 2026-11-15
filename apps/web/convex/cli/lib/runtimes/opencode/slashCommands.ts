import type { RawCliChunk } from "../contracts";
import type { RuntimeSlashCommand } from "../validators";
import { getSyntheticSlashCommandsFromIncomingChunks } from "../shared/syntheticCommands";

/**
 * The CLI's OpenCode runner advertises the directory's `command.list()`
 * inventory as a synthetic `convoy.commands` chunk
 * (`{ commands: string[] }`) at the start of every run. Returns null when
 * the incoming chunks carry no inventory chunk.
 */
export function getOpencodeSlashCommandsFromIncomingChunks(
  incomingChunks: RawCliChunk[],
): RuntimeSlashCommand[] | null {
  return getSyntheticSlashCommandsFromIncomingChunks(incomingChunks);
}
