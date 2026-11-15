import chalk from "chalk";
import ora from "ora";
import * as path from "node:path";
import { api } from "../../convex/_generated/api.js";
import {
  promptUrl,
  promptApiKey,
  promptAuthMethod,
  promptProfileName,
  promptProfileKey,
  promptWorkspacePath,
  resolveWorkspacePath,
  validateWorkspaceDirectory,
} from "./prompts.js";
import { LoginStartError, runBrowserLogin } from "../../lib/browser-login.js";
import { normalizeConvexUrl } from "../../lib/url.js";
import {
  setProfileInConfig,
  createConvexClient,
  getConfigPath,
  getProfileByKey,
} from "../../lib/config/index.js";
import { resolveSetupProject, validateProjectSelection, type ProjectSelectionOptions } from "./resolution.js";
import { validateSetupProfileKey, type AccessibleProject } from "./validators.js";
import { runConnect } from "../connect/workflow.js";

interface SetupOptions extends ProjectSelectionOptions {
  nonInteractive?: boolean;
  url?: string;
  apiKey?: string;
  profile?: string;
  project?: string;
  profileKey?: string;
  path?: string;
  force?: boolean;
  /** Skip the method prompt (used by `convoy login` to force browser auth). */
  authMethod?: "browser" | "paste";
}

function isFullyNonInteractiveSetup(
  options: SetupOptions
): boolean {
  return Boolean(
    options.url &&
      options.apiKey &&
      (options.project || (options.create && options.org && options.projectName && options.projectAlias)) &&
      options.profileKey
  );
}

/**
 * Run the setup wizard (reusable function)
 * Guides user through: URL → API key → validate → project → profile name/key → save → connect
 */
export async function runSetup(options: SetupOptions = {}): Promise<void> {
  console.log(chalk.bold("\nConvoy Setup\n"));
  const isNonInteractive = Boolean(options.nonInteractive) || isFullyNonInteractiveSetup(options);
  try {
    if (options.profileKey) validateSetupProfileKey(options.profileKey);
    validateProjectSelection(options, !isNonInteractive);
    if (isNonInteractive && !isFullyNonInteractiveSetup(options)) throw new Error("Non-interactive setup requires --url, --api-key, --profile-key and --project or complete --create inputs.");
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : "Invalid setup inputs."));
    process.exit(1);
  }

  const defaultRepoPath = process.cwd();

  // === CREDENTIALS SETUP ===

  // Step 1: Get URL
  let url = normalizeConvexUrl(options.url || (await promptUrl()));

  // Step 2: Get API key — browser login is the interactive default;
  // pasting a key remains available (and is the only non-interactive path).
  let apiKey = options.apiKey;
  if (!apiKey) {
    const authMethod = options.authMethod ?? (await promptAuthMethod());
    if (authMethod === "browser") {
      // An unreachable/wrong URL shouldn't kill the wizard — re-prompt.
      for (;;) {
        try {
          apiKey = (await runBrowserLogin(url)).apiKey;
          break;
        } catch (error) {
          if (!(error instanceof LoginStartError)) throw error;
          console.error(chalk.red(`\nError: ${error.message}`));
          console.log(
            chalk.dim(
              "Could not reach this deployment. Check the Convex URL (e.g. https://your-deployment.convex.cloud) and try again.\n"
            )
          );
          url = normalizeConvexUrl(await promptUrl(url));
        }
      }
    } else {
      apiKey = await promptApiKey();
    }
  }

  // Step 3: Validate credentials by fetching projects
  const spinner = ora("Validating credentials...").start();

  let projects: AccessibleProject[];
  const client = createConvexClient({ url, apiKey });
  try {
    projects = await client.query(api.projects.core.listAccessible, {});
    spinner.succeed("Credentials validated");
  } catch (error) {
    await client.close();
    spinner.fail("Failed to validate credentials");
    console.error(
      chalk.red(
        `\nError: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    console.log(
      chalk.dim("\nPlease check your URL and API key and try again.")
    );
    process.exit(1);
  }

  // === PROJECT SELECTION ===

  let profileName: string | undefined;
  let profileKey: string | undefined;
  let repoPath: string | undefined;
  const selection = { ...options, profileName: options.profile };
  const prepareLocalProfile = async (defaultName: string, creating: boolean) => {
    profileName = options.profile || (isNonInteractive ? defaultName : await promptProfileName(defaultName));
    const defaultKey = profileName.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    profileKey = isNonInteractive ? options.profileKey! : await promptProfileKey(options.profileKey ?? defaultKey);
    if (profileKey !== options.profileKey) validateSetupProfileKey(profileKey);
    if ((creating || isNonInteractive) && getProfileByKey(profileKey) && !options.force) {
      throw new Error(`Profile "${profileKey}" already exists. Use --force to overwrite it.`);
    }
    repoPath = options.path ? resolveWorkspacePath(options.path)
      : isNonInteractive ? resolveWorkspacePath(defaultRepoPath) : await promptWorkspacePath(defaultRepoPath);
    const validation = validateWorkspaceDirectory(repoPath);
    if (validation !== true) throw new Error(`${validation}: ${repoPath}`);
    selection.profileKey = profileKey;
    selection.profileName = profileName;
  };
  let creatingProject = false;
  let selectedProject: AccessibleProject;
  try {
    selectedProject = await resolveSetupProject(client, selection, !isNonInteractive, projects, async () => {
      creatingProject = true;
      await prepareLocalProfile(options.projectName || options.profileKey || path.basename(defaultRepoPath), true);
    });
    if (!profileKey) await prepareLocalProfile(selectedProject.name || path.basename(defaultRepoPath), false);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : "Project selection failed."));
    process.exit(1);
  } finally {
    await client.close();
  }
  const projectId = selectedProject._id;
  // Recheck conflicts after asynchronous prompts and remote creation.
  if ((creatingProject || isNonInteractive) && getProfileByKey(profileKey!) && !options.force) {
    console.error(chalk.red(`Profile "${profileKey}" already exists. Use --force to overwrite it.`));
    process.exit(1);
  }

  // Step 7: Save profile to config.toml
  setProfileInConfig(profileKey!, {
    name: profileName!,
    url,
    api_key: apiKey,
    project_id: projectId,
    paths: [repoPath!],
  });

  console.log(chalk.green("\n✓") + ` Profile "${profileKey}" saved`);
  console.log(chalk.dim(`  Config: ${getConfigPath()}`));
  console.log();

  if (isNonInteractive) {
    console.log(chalk.dim("Non-interactive setup complete. Skipping connection."));
    return;
  }

  // === START CONNECTION ===

  // Step 8: Start the connection
  await runConnect({
    convexUrl: url,
    apiKey,
    projectId,
    paths: [repoPath!],
    profileKey,
  });
}
