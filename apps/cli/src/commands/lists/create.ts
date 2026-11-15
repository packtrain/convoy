import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalEnum, parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { BOARD_GROUP_BYS, DEFAULT_VIEW_MODES } from "./constants.js";

interface CreateTaskListOptions extends OutputOptions {
  name: string;
  ref?: string;
  color?: string;
  defaultView?: string;
  boardGroupBy?: string;
  org?: string;
}

export const createTaskListCommand = addGlobalOptions(
  addOutputOptions(
    new Command("create")
      .description("Create a project List")
      .requiredOption("--name <name>", "List name (unique per project, max 80 chars)")
      .option("--ref <ref>", "List ref (uppercase, e.g. SPRINT-1; derived from name when omitted)")
      .option("--color <hex>", "List color from the supported palette")
      .option(
        "--default-view <mode>",
        `Default view for this List (${DEFAULT_VIEW_MODES.join("|")}); inherits the project default when omitted`
      )
      .option("--board-group-by <field>", `Board grouping for --default-view board (${BOARD_GROUP_BYS.join("|")})`)
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: CreateTaskListOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const ref = parseOptionalNonEmptyString(options.ref, "Ref");
    const color = parseOptionalNonEmptyString(options.color, "Color");
    const defaultViewMode = parseOptionalEnum(options.defaultView, "Default view", DEFAULT_VIEW_MODES);
    const defaultBoardGroupBy = parseOptionalEnum(options.boardGroupBy, "Board group by", BOARD_GROUP_BYS);
    // A flag that silently does nothing is worse than an error.
    if (defaultBoardGroupBy !== undefined && defaultViewMode !== "board") {
      throw new Error("--board-group-by only applies with --default-view board.");
    }

    const listId = await client.mutation(api.tasks.lists.create, {
      projectId,
      name: options.name,
      ...(ref !== undefined && { ref }),
      ...(color !== undefined && { color }),
      ...(defaultViewMode !== undefined && { defaultViewMode }),
      ...(defaultBoardGroupBy !== undefined && { defaultBoardGroupBy }),
    });

    printOutput(outputMode, { listId }, (value) => {
      console.log(chalk.green("✓") + " List created");
      console.log(`  ${options.name}`);
      console.log(`  ID: ${value.listId}`);
      console.log();
    });
  });
});
