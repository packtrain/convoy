import { Command } from "commander";
import { createProjectAgentCommand } from "./create.js";
import { listProjectAgentsCommand } from "./list.js";
import { updateProjectAgentCommand } from "./update.js";

export const projectAgentsCommand = new Command("project-agents")
  .description("Project agent commands")
  .addCommand(listProjectAgentsCommand)
  .addCommand(createProjectAgentCommand)
  .addCommand(updateProjectAgentCommand);
