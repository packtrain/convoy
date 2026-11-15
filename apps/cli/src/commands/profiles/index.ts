import { Command } from "commander";
import { listCliProfilesCommand } from "./list.js";

export const profilesCommand = new Command("profiles")
  .description("CLI profile commands")
  .addCommand(listCliProfilesCommand);
