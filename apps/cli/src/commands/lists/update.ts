import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalEnum, parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { BOARD_GROUP_BYS, DEFAULT_VIEW_MODES } from "./constants.js";
import { resolveTaskList } from "./resolve.js";

interface UpdateTaskListOptions extends OutputOptions {
  name?: string;
  ref?: string;
  color?: string;
  clearColor?: boolean;
  defaultView?: string;
  boardGroupBy?: string;
  clearDefaultView?: boolean;
  org?: string;
}

export const updateTaskListCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Rename, re-ref, recolor, or set the default view of a project List")
      .argument("<list>", "List ID or bare List ref (e.g. SPRINT-1)")
      .option("--name <name>", "New List name")
      .option("--ref <ref>", "New List ref (uppercase)")
      .option("--color <hex>", "New List color from the supported palette")
      .option("--clear-color", "Clear the List color")
      .option("--default-view <mode>", `Default view for this List (${DEFAULT_VIEW_MODES.join("|")})`)
      .option("--board-group-by <field>", `Board grouping for --default-view board (${BOARD_GROUP_BYS.join("|")})`)
      .option("--clear-default-view", "Clear the List default view so it inherits the project default")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (list: string, options: UpdateTaskListOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const name = parseOptionalNonEmptyString(options.name, "Name");
    const ref = parseOptionalNonEmptyString(options.ref, "Ref");
    const color = parseOptionalNonEmptyString(options.color, "Color");

    const defaultViewMode = parseOptionalEnum(options.defaultView, "Default view", DEFAULT_VIEW_MODES);
    const defaultBoardGroupBy = parseOptionalEnum(options.boardGroupBy, "Board group by", BOARD_GROUP_BYS);

    if (options.clearColor && color !== undefined) {
      throw new Error("Pass either --color or --clear-color, not both.");
    }
    if (options.clearDefaultView && defaultViewMode !== undefined) {
      throw new Error("Pass either --default-view or --clear-default-view, not both.");
    }
    // A flag that silently does nothing is worse than an error.
    if (defaultBoardGroupBy !== undefined && defaultViewMode !== "board") {
      throw new Error("--board-group-by only applies with --default-view board.");
    }
    const isChangingDefaultView = defaultViewMode !== undefined || options.clearDefaultView === true;
    if (name === undefined && ref === undefined && color === undefined && !options.clearColor && !isChangingDefaultView) {
      throw new Error("No updates provided. Pass --name, --ref, --color, --clear-color, --default-view, or --clear-default-view.");
    }

    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const resolved = await resolveTaskList(client, projectId, list);

    await client.mutation(api.tasks.lists.update, {
      id: resolved._id,
      ...(name !== undefined && { name }),
      ...(ref !== undefined && { ref }),
      ...(options.clearColor ? { color: null } : color !== undefined ? { color } : {}),
      // `null` clears the override so the List inherits the project default.
      ...(isChangingDefaultView && { defaultViewMode: defaultViewMode ?? null }),
      ...(defaultBoardGroupBy !== undefined && { defaultBoardGroupBy }),
    });

    printOutput(outputMode, { listId: resolved._id }, (value) => {
      console.log(chalk.green("✓") + " List updated");
      console.log(`  ID: ${value.listId}`);
      console.log();
    });
  });
});
