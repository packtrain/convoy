import { Command } from "commander";
import { listOrgsCommand } from "./list.js";

export const orgsCommand = new Command("orgs")
  .description("Organization commands")
  .addCommand(listOrgsCommand);
