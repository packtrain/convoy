import { Command } from "commander";
import { cancelRunCommand } from "./cancel.js";
import { getRunCommand } from "./get.js";
import { listRunsCommand } from "./list.js";
import { resumeRunLaneCommand } from "./resume.js";
import { approveStepCommand, retryStepCommand, skipStepCommand } from "./steps.js";

export const workflowRunsCommand = new Command("runs")
  .alias("run")
  .description("Workflow run commands")
  .addCommand(listRunsCommand)
  .addCommand(getRunCommand)
  .addCommand(cancelRunCommand)
  .addCommand(approveStepCommand)
  .addCommand(retryStepCommand)
  .addCommand(skipStepCommand)
  .addCommand(resumeRunLaneCommand);
