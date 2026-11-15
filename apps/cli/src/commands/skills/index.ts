import { Command } from "commander";
import { createSkillCommand } from "./create.js";
import { installSkillCommand } from "./install.js";
import { updateSkillCommand } from "./update.js";
import { listSkillsCommand } from "./list.js";
import { removeSkillCommand } from "./remove.js";
import { showSkillCommand } from "./show.js";

export const skillsCommand = new Command("skills")
  .alias("skill")
  .description("Skill commands")
  .addCommand(listSkillsCommand)
  .addCommand(showSkillCommand)
  .addCommand(createSkillCommand)
  .addCommand(installSkillCommand)
  .addCommand(updateSkillCommand)
  .addCommand(removeSkillCommand);
