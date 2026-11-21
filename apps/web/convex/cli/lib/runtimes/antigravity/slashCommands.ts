import { isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";
import { toRuntimeSlashCommand, type RuntimeSlashCommand } from "../validators";

/** Would sign the machine's agy out, outside the thread. */
const HIDDEN_COMMANDS = new Set(["logout"]);

/**
 * Commands from agy's own `available_commands_update`, the last one in the batch.
 * Null when the chunks carry none. Spec: docs/specs/cli-antigravity-runtime.md.
 */
export function getAntigravitySlashCommandsFromIncomingChunks(chunks: RawCliChunk[]): RuntimeSlashCommand[] | null {
  let commands: RuntimeSlashCommand[] | null = null;
  for (const chunk of chunks) {
    if (chunk.type !== "session/update") continue;
    let data: unknown;
    try {
      data = JSON.parse(chunk.data);
    } catch {
      continue;
    }
    const update = isRecord(data) && isRecord(data.update) ? data.update : {};
    if (update.sessionUpdate !== "available_commands_update" || !Array.isArray(update.availableCommands)) continue;
    commands = update.availableCommands.flatMap((entry: unknown) => {
      if (!isRecord(entry)) return [];
      const command = toRuntimeSlashCommand({ ...entry, argumentHint: isRecord(entry.input) ? entry.input.hint : undefined });
      return command && !HIDDEN_COMMANDS.has(command.name) ? [command] : [];
    });
  }
  return commands;
}
