import { Command } from "commander";
import { listProjectsCommand } from "./list.js";
import { archiveProjectCommand, unarchiveProjectCommand } from "./archive.js";

export const projectsCommand = new Command("projects")
  .description("Project commands")
  .addCommand(listProjectsCommand)
  .addCommand(archiveProjectCommand)
  .addCommand(unarchiveProjectCommand);
