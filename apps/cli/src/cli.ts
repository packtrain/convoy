import { registerEnvironmentCommands } from "./commands/environment/index.js";
import { registerRemoteCommands } from "./commands/remote/index.js";
import { Command } from "commander";
import { attachCommand } from "./commands/service/attach.js";
import { tuiCommand } from "./commands/tui/index.js";
import { configCommand } from "./commands/config/command.js";
import { setupCommand } from "./commands/setup/command.js";
import { loginCommand } from "./commands/login/command.js";
import { connectCommand } from "./commands/connect/command.js";
import { statusCommand } from "./commands/status/command.js";
import { pathsCommand } from "./commands/paths/command.js";
import { keysCommand } from "./commands/keys/command.js";
import { projectsCommand } from "./commands/projects/index.js";
import { projectCommand } from "./commands/project/command.js";
import { initCommand } from "./commands/init.js";
import { devcontainerCommand } from "./commands/devcontainer/command.js";
import { orgsCommand } from "./commands/orgs/index.js";
import { tasksCommand } from "./commands/tasks/index.js";
import { listsCommand } from "./commands/lists/index.js";
import { labelsCommand } from "./commands/labels/index.js";
import { taskTypesCommand } from "./commands/task-types/index.js";
import { projectAgentsCommand } from "./commands/project-agents/index.js";
import { promptsCommand } from "./commands/prompts/index.js";
import { skillsCommand } from "./commands/skills/index.js";
import { threadsCommand } from "./commands/threads/index.js";
import { workflowsCommand } from "./commands/workflows/index.js";
import { profilesCommand } from "./commands/profiles/index.js";
import { updateCommand } from "./commands/update/command.js";
import { serviceCommand } from "./commands/service/command.js";

/**
 * Add global CLI options (--profile, --url, --api-key, --project) to a command.
 * These mirror the root program options so they can be placed after subcommands.
 */
export function addGlobalOptions<T extends Command>(cmd: T): T {
  return cmd
    .option("--profile <name>", "Profile key (for profile lookup)")
    .option("--url <url>", "Convex backend URL (overrides config)")
    .option("--api-key <key>", "API key (overrides config)")
    .option("--project <id>", "Project ID (overrides config)") as T;
}

export function registerCommands(program: Command): void {
  // Setup and config commands
  program.addCommand(setupCommand);
  program.addCommand(loginCommand);
  program.addCommand(configCommand);
  program.addCommand(statusCommand);
  program.addCommand(pathsCommand);
  program.addCommand(keysCommand);
  program.addCommand(updateCommand);

  // Agent commands
  program.addCommand(connectCommand);
  program.addCommand(serviceCommand);
  program.addCommand(attachCommand);
  program.addCommand(tuiCommand);

  // Integration commands
  program.addCommand(initCommand);
  program.addCommand(devcontainerCommand);

  // Nested commands
  program.addCommand(orgsCommand);
  program.addCommand(projectsCommand);
  program.addCommand(projectCommand);
  program.addCommand(listsCommand);
  program.addCommand(labelsCommand);
  program.addCommand(taskTypesCommand);
  program.addCommand(projectAgentsCommand);
  program.addCommand(promptsCommand);
  program.addCommand(skillsCommand);
  program.addCommand(threadsCommand);
  program.addCommand(workflowsCommand);
  program.addCommand(profilesCommand);

  program.addCommand(tasksCommand);
  // Remote first: its preAction rejects --remote with --environment before Docker is touched.
  registerRemoteCommands(program);
  registerEnvironmentCommands(program);
}
