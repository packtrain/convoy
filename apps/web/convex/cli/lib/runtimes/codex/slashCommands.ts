import type { RawCliChunk } from "../contracts";
import type { RuntimeSlashCommand } from "../validators";
import { getSyntheticSlashCommandsFromIncomingChunks } from "../shared/syntheticCommands";

/**
 * The codex app-server advertises no command inventory in its event stream,
 * so the CLI's app-server runner (≥ 0.42.0) emits the commands it can
 * execute as a synthetic `convoy.commands` chunk (OS-1582). The exec
 * transport advertises an empty list — it has no per-thread RPC channel and
 * cannot run them. Returns null when the chunks carry no inventory chunk.
 */
export function getCodexSlashCommandsFromIncomingChunks(
  incomingChunks: RawCliChunk[],
): RuntimeSlashCommand[] | null {
  return getSyntheticSlashCommandsFromIncomingChunks(incomingChunks);
}
