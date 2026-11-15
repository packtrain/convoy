import { Command } from "commander";
import { listTaskTypesCommand } from "./list.js";

export const taskTypesCommand = new Command("task-types")
  .description("Task type commands")
  .addCommand(listTaskTypesCommand);
