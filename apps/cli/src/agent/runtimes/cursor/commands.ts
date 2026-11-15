import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

/**
 * Cursor CLI reads custom slash commands from `<repo>/.cursor/commands/` and
 * `~/.cursor/commands/` but does not advertise them in its stream, so the runner scans
 * both and reports the inventory as a synthetic `convoy.commands` chunk. Project
 * commands win collisions; any read error means that directory contributes nothing.
 */
export async function discoverCursorCommands(
  workingDirectory: string,
): Promise<string[]> {
  const [projectCommands, globalCommands] = await Promise.all([
    listCommandNames(join(workingDirectory, ".cursor", "commands")),
    listCommandNames(join(homedir(), ".cursor", "commands")),
  ]);

  const seen = new Set<string>();
  const commands: string[] = [];
  for (const name of [...projectCommands, ...globalCommands]) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    commands.push(name);
  }
  return commands;
}

async function listCommandNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
      .map((entry) => basename(entry.name, ".md"))
      .filter((name) => name.length > 0)
      .sort();
  } catch {
    return [];
  }
}
