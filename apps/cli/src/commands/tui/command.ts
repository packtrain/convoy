import { Command } from "commander";
import chalk from "chalk";
import { checkForNewerVersion } from "../../lib/version.js";
import { canPromptForUpdate, offerUpdate } from "../update/prompts.js";

export const tuiCommand = new Command("tui")
  .description("Browse existing service connections and runs in an interactive terminal")
  .option("--env, --environment <name>", "Initially select a saved managed Docker environment")
  .action(async (options: { environment?: string }) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
      process.stderr.write("convoy tui requires interactive stdin and stdout. Use convoy service status --json or convoy service runs list --profile <key> --json.\n");
      process.exitCode = 1; return;
    }
    const latest = canPromptForUpdate({}) ? await checkForNewerVersion() : null;
    if (latest && await offerUpdate(latest)) { console.log(chalk.green("Updated. Run convoy tui again.")); return; }
    const { run } = await import("./render.js");
    const { connections } = await import("./resolution.js");
    const { targets, selected, warnings } = connections(options.environment);
    for (const warning of warnings) process.stderr.write(warning + "\n");
    await run(targets, selected);
  });
