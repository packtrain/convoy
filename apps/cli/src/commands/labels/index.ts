import { Command } from "commander";
import { listLabelsCommand } from "./list.js";
import { createLabelCommand } from "./create.js";
import { updateLabelCommand } from "./update.js";
import { deleteLabelCommand } from "./delete.js";

export const labelsCommand = new Command("labels")
  .alias("label")
  .description("Label commands")
  .addCommand(listLabelsCommand)
  .addCommand(createLabelCommand)
  .addCommand(updateLabelCommand)
  .addCommand(deleteLabelCommand);
