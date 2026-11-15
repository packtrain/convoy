import { Command } from "commander";
import { createWorkflowCommand } from "./create.js";
import { deleteWorkflowCommand } from "./delete.js";
import { getWorkflowCommand } from "./get.js";
import { listWorkflowsCommand } from "./list.js";
import { workflowRunsCommand } from "./runs/index.js";
import { startWorkflowCommand } from "./start.js";
import { updateWorkflowCommand } from "./update.js";
import { validateWorkflowCommand } from "./validate.js";

export const workflowsCommand = new Command("workflows")
  .alias("workflow")
  .description("Workflow commands")
  .addCommand(listWorkflowsCommand)
  .addCommand(getWorkflowCommand)
  .addCommand(createWorkflowCommand)
  .addCommand(updateWorkflowCommand)
  .addCommand(deleteWorkflowCommand)
  .addCommand(validateWorkflowCommand)
  .addCommand(startWorkflowCommand)
  .addCommand(workflowRunsCommand);
