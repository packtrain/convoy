import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import {
  addPaginationOptions,
  parsePageSize,
  parsePaginationCursor,
  printPaginatedOutput,
  shellQuote,
  type PaginationOptions,
} from "../../lib/pagination.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";

interface ListTaskListsOptions extends OutputOptions, PaginationOptions {
  org?: string;
  archived?: boolean;
  query?: string;
}

type ListTaskListsResult = FunctionReturnType<typeof api.tasks.lists.list>;
type TaskListSummary = ListTaskListsResult["page"][number];

function buildNextCommand(projectId: string, options: ListTaskListsOptions, nextCursor: string): string {
  const segments = ["convoy", "lists", "list", "--project", shellQuote(projectId)];

  if (options.archived) {
    segments.push("--archived");
  }

  if (options.query) {
    segments.push("--query", shellQuote(options.query));
  }

  if (options.limit !== undefined) {
    segments.push("--limit", shellQuote(String(options.limit)));
  }

  segments.push("--cursor", shellQuote(nextCursor));
  return segments.join(" ");
}

function formatTaskListSummaryLine(list: TaskListSummary): string {
  const archivedSuffix = list.isArchived ? chalk.dim(" archived") : "";
  // Only Lists that override the project default view carry a view suffix.
  const defaultViewSuffix = list.defaultViewMode
    ? chalk.dim(` [${list.defaultViewMode === "board" ? `board:${list.defaultBoardGroupBy ?? "status"}` : "list"}]`)
    : "";
  return `${chalk.cyan(list.ref.padEnd(12))} ${list.name} ${chalk.dim(`(${list._id})`)}${defaultViewSuffix}${archivedSuffix}`;
}

export const listTaskListsCommand = addGlobalOptions(
  addOutputOptions(
    addPaginationOptions(
      new Command("list")
        .description("List project Lists")
        .option("--org <org>", "Organization ID or slug (used with --project alias)")
        .option("--archived", "List archived Lists")
        .option("--query <query>", "Search Lists by name or ref")
    )
  )
).action(async (options: ListTaskListsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const limit = parsePageSize(options.limit);
    const cursor = parsePaginationCursor(options.cursor);
    const query = parseOptionalNonEmptyString(options.query, "List query");

    const results: ListTaskListsResult = await client.query(api.tasks.lists.list, {
      projectId,
      archived: options.archived ?? false,
      ...(query ? { query } : {}),
      paginationOpts: {
        numItems: limit,
        cursor,
      },
    });

    const nextCommand = buildNextCommand(projectId, options, results.continueCursor);

    printPaginatedOutput(
      outputMode,
      results,
      (value) => {
        if (value.page.length === 0) {
          console.log(chalk.dim("\nNo Lists found."));
          return;
        }

        console.log(chalk.bold(`\nFound ${value.page.length} List(s) on this page:\n`));
        for (const list of value.page) {
          console.log(`  ${formatTaskListSummaryLine(list)}`);
        }
        console.log();
      },
      nextCommand
    );
  });
});
