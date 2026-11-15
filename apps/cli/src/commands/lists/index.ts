import { Command } from "commander";
import { listTaskListsCommand } from "./list.js";
import { createTaskListCommand } from "./create.js";
import { updateTaskListCommand } from "./update.js";

export const listsCommand = new Command("lists")
  .description("List commands")
  .addCommand(listTaskListsCommand)
  .addCommand(createTaskListCommand)
  .addCommand(updateTaskListCommand);
