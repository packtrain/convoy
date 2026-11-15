import { Command } from "commander";
import { addTaskCommentCommand } from "./add.js";

export const taskCommentsCommand = new Command("comments")
  .description("Task comment commands")
  .addCommand(addTaskCommentCommand);
