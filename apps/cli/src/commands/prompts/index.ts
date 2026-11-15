import { Command } from "commander";
import { createPromptCommand } from "./create.js";
import { listPromptsCommand } from "./list.js";
import { updatePromptCommand } from "./update.js";

export const promptsCommand = new Command("prompts")
  .alias("prompt")
  .description("Prompt (slash command) commands")
  .addCommand(listPromptsCommand)
  .addCommand(createPromptCommand)
  .addCommand(updatePromptCommand);
