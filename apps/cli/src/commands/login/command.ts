import { Command } from "commander";
import { runSetup } from "../setup/workflow.js";

interface LoginOptions {
  url?: string;
  profile?: string;
  project?: string;
  profileKey?: string;
  path?: string;
  force?: boolean;
}

/**
 * `convoy login` — browser-approve login (OS-1137). A thin alias for the
 * setup wizard with browser auth forced: approve in the web app, receive a
 * freshly minted API key, then continue with project selection and profile
 * save exactly like `convoy setup`.
 */
export const loginCommand = new Command("login")
  .description("Log in with your browser and set up a profile")
  .option("--url <url>", "Prefill Convex URL")
  .option("--profile <name>", "Prefill profile name")
  .option("--profile-key <key>", "Prefill profile key (for config file)")
  .option("--project <id>", "Prefill project ID")
  .option("--path <path>", "Workspace folder path (defaults to current directory)")
  .option("-f, --force", "Overwrite existing profile key")
  .action(async (options: LoginOptions) => {
    await runSetup({ ...options, authMethod: "browser" });
  });
