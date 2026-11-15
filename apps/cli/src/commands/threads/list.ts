import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addPaginationOptions,
  parsePageSize,
  parsePaginationCursor,
  printPaginatedOutput,
  shellQuote,
  type CursorPageResult,
  type PaginationOptions,
} from "../../lib/pagination.js";
import { addOutputOptions, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { formatThreadRow, type ThreadRow } from "./formatters.js";

interface ListThreadsOptions extends OutputOptions, PaginationOptions {
  org?: string;
  includeDone?: boolean;
}

/**
 * No `--org`: this emits the *resolved* `projectId`, which is unambiguous, so an
 * organization disambiguator would be redundant rather than omitted.
 */
function buildNextCommand(projectId: string, options: ListThreadsOptions, nextCursor: string): string {
  const segments = ["convoy", "threads", "list", "--project", shellQuote(projectId)];
  if (options.includeDone) {
    segments.push("--include-done");
  }
  if (options.limit !== undefined) {
    segments.push("--limit", shellQuote(String(options.limit)));
  }
  segments.push("--cursor", shellQuote(nextCursor));
  return segments.join(" ");
}

export const listThreadsCommand = addGlobalOptions(
  addOutputOptions(
    addPaginationOptions(
      new Command("list")
        .description("List CLI threads in a project, or one thread group's members")
        .argument("[containerId]", "Thread group container ID: list that group's members")
        .option("--org <org>", "Organization ID or slug (used with --project alias)")
        .option("--include-done", "Include threads marked done")
    )
  )
).action(async (containerId: string | undefined, options: ListThreadsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const includeDone = options.includeDone ?? false;

    // The drill-down needs no project: a container ID is globally unique and the
    // query authorizes through the container's own project.
    if (containerId !== undefined) {
      const members: ThreadRow[] = await client.query(api.cli.threads.summaries.listGroupSummaries, {
        parentThreadId: parseId<"cliThreads">(containerId, "containerId"),
        includeDone,
      });
      // Wrapped like the MCP tool does, so JSON output has one shape either way.
      // The group is capped at 100 rows and read in one scan, so it is never partial.
      printPaginatedOutput(outputMode, { page: members, isDone: true, continueCursor: "" }, renderPage, "");
      return;
    }

    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const results: CursorPageResult<ThreadRow> = await client.query(api.cli.threads.summaries.listSummaries, {
      projectId,
      includeDone,
      paginationOpts: {
        numItems: parsePageSize(options.limit),
        cursor: parsePaginationCursor(options.cursor),
      },
    });

    printPaginatedOutput(outputMode, results, renderPage, buildNextCommand(projectId, options, results.continueCursor));
  });
});

function renderPage(value: CursorPageResult<ThreadRow>): void {
  if (value.page.length === 0) {
    console.log(chalk.dim("\nNo threads found."));
    return;
  }

  console.log(chalk.bold(`\nFound ${value.page.length} thread(s):\n`));
  for (const thread of value.page) {
    console.log(`  ${formatThreadRow(thread)}`);
  }
  console.log();
}
