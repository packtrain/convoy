import { Command } from "commander";
import { listTasksCommand } from "./list.js";
import { searchTasksCommand } from "./search.js";
import { getTaskCommand } from "./get.js";
import { refsTasksCommand } from "./refs.js";
import { createTaskCommand } from "./create.js";
import { updateTaskCommand } from "./update.js";
import { moveTaskCommand } from "./move.js";
import { deleteTaskCommand } from "./delete.js";
import { taskArtifactsCommand } from "./artifacts/index.js";
import { taskLinksCommand } from "./links.js";
import { taskAttachmentsCommand } from "./attachments/index.js";
import { attachTaskCommand } from "./attach.js";
import { taskCommentsCommand } from "./comments/index.js";
import { moveTasksToListCommand } from "./move-to-list.js";

export const tasksCommand = new Command("tasks")
  .alias("task")
  .description("Task commands")
  .addCommand(listTasksCommand)
  .addCommand(searchTasksCommand)
  .addCommand(getTaskCommand)
  .addCommand(refsTasksCommand)
  .addCommand(attachTaskCommand)
  .addCommand(taskArtifactsCommand)
  .addCommand(taskCommentsCommand)
  .addCommand(taskAttachmentsCommand)
  .addCommand(taskLinksCommand)
  .addCommand(createTaskCommand)
  .addCommand(updateTaskCommand)
  .addCommand(moveTaskCommand)
  .addCommand(moveTasksToListCommand)
  .addCommand(deleteTaskCommand);
