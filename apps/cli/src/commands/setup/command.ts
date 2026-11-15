import { Command } from "commander";
import { runSetup } from "./workflow.js";

interface SetupOptions {
  url?: string;
  apiKey?: string;
  profile?: string;
  project?: string;
  profileKey?: string;
  path?: string;
  force?: boolean;
}

export const setupCommand = new Command("setup")
  .description("Interactive setup wizard")
  .option("--url <url>", "Prefill Convex URL")
  .option("--api-key <key>", "Prefill API key")
  .option("--profile <name>", "Prefill profile name")
  .option("--profile-key <key>", "Prefill profile key (for config file)")
  .option("--project <id>", "Prefill project ID")
  .option("--create", "Create a new remote project")
  .option("--org <id-or-slug>", "Organization for the new project")
  .option("--project-name <name>", "New project name")
  .option("--project-alias <alias>", "New project alias (2-5 letters/numbers)")
  .option("--non-interactive", "Require complete inputs and never prompt")
  .option("--path <path>", "Workspace folder path (defaults to current directory)")
  .option("-f, --force", "Overwrite existing profile key")
  .action(async (options: SetupOptions) => {
    await runSetup(options);
  });
