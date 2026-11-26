import { Command } from "commander";
import { deleteWorktreeSetupCommand } from "./delete.js";
import { getWorktreeSetupCommand } from "./get.js";
import { listWorktreeSetupsCommand } from "./list.js";
import { setWorktreeSetupCommand } from "./set.js";

export const worktreeSetupsCommand = new Command("worktree-setups")
  .description("Worktree setup script commands")
  .addCommand(listWorktreeSetupsCommand)
  .addCommand(getWorktreeSetupCommand)
  .addCommand(setWorktreeSetupCommand)
  .addCommand(deleteWorktreeSetupCommand);
