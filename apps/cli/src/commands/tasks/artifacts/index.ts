import { Command } from "commander";
import { listTaskArtifactsCommand } from "./list.js";
import { getTaskArtifactCommand } from "./get.js";
import { createTaskArtifactCommand } from "./create.js";
import { updateTaskArtifactCommand } from "./update.js";
import { replaceTaskArtifactCommand } from "./replace.js";
import { moveTaskArtifactCommand } from "./move.js";
import { deleteTaskArtifactCommand } from "./delete.js";
import { artifactCommentsCommand } from "./comments/index.js";

export const taskArtifactsCommand = new Command("artifacts")
  .description("Task artifact commands")
  .addCommand(listTaskArtifactsCommand)
  .addCommand(getTaskArtifactCommand)
  .addCommand(createTaskArtifactCommand)
  .addCommand(updateTaskArtifactCommand)
  .addCommand(replaceTaskArtifactCommand)
  .addCommand(moveTaskArtifactCommand)
  .addCommand(deleteTaskArtifactCommand)
  .addCommand(artifactCommentsCommand);
