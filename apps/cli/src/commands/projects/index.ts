import { Command } from "commander";
import { listProjectsCommand } from "./list.js";

export const projectsCommand = new Command("projects")
  .description("Project commands")
  .addCommand(listProjectsCommand);
