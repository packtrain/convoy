import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import type { FunctionArgs } from "convex/server";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import {
  addPaginationOptions,
  parsePageSize,
  parsePaginationCursor,
  printPaginatedOutput,
  shellQuote,
  type PaginationOptions,
} from "../../lib/pagination.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import {
  LIST_OPTION_DESCRIPTION,
  parseOptionalListIdentifier,
  parseOptionalTaskArchiveMode,
  parseOptionalTaskStatus,
  validateNoConflict,
} from "./parsers.js";
import { formatTaskSummaryLine } from "./formatters.js";

interface SearchTasksOptions extends OutputOptions, PaginationOptions {
  org?: string;
  archiveMode?: string;
  status?: string;
  assigneeId?: string;
  unassigned?: boolean;
  delegatedToAgent?: string;
  list?: string;
}

type SearchTasksResult = FunctionReturnType<typeof api.tasks.core.search.byProject>;
type SearchTaskSummary = {
  _id: string;
  refId: string;
  name: string;
  status: string;
  priority: string;
};

function isSearchTaskSummary(value: unknown): value is SearchTaskSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "_id") === "string" &&
    typeof Reflect.get(value, "refId") === "string" &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "status") === "string" &&
    typeof Reflect.get(value, "priority") === "string"
  );
}

function buildNextCommand(query: string, projectId: string, options: SearchTasksOptions, nextCursor: string): string {
  const segments = ["convoy", "tasks", "search", shellQuote(query), "--project", shellQuote(projectId)];

  if (options.archiveMode) {
    segments.push("--archive-mode", shellQuote(options.archiveMode));
  }

  if (options.status) {
    segments.push("--status", shellQuote(options.status));
  }

  if (options.assigneeId) {
    segments.push("--assignee-id", shellQuote(options.assigneeId));
  }

  if (options.unassigned) {
    segments.push("--unassigned");
  }

  if (options.delegatedToAgent) {
    segments.push("--delegated-to-agent", shellQuote(options.delegatedToAgent));
  }

  if (options.list) {
    segments.push("--list", shellQuote(options.list));
  }

  if (options.limit !== undefined) {
    segments.push("--limit", shellQuote(String(options.limit)));
  }

  segments.push("--cursor", shellQuote(nextCursor));
  return segments.join(" ");
}

export const searchTasksCommand = addGlobalOptions(
  addOutputOptions(
    addPaginationOptions(
      new Command("search")
        .description("Search tasks")
        .argument("<query>", "Search query")
        .option("--org <org>", "Organization ID or slug (used with --project alias)")
        .option("--archive-mode <mode>", "Archive mode: active|archived (default: active)")
        .option("--status <status>", "Filter by task status")
        .option("--assignee-id <userId>", "Filter by assignee (human owner) user ID, or \"me\"")
        .option("--unassigned", "Filter to tasks with no assignee")
        .option("--delegated-to-agent <projectAgentId>", "Filter by delegated project agent ID")
        .option("--list <list>", LIST_OPTION_DESCRIPTION)
    )
  )
).action(async (queryText: string, options: SearchTasksOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const query = queryText.trim();
    if (query.length === 0) {
      throw new Error("Search query must be non-empty.");
    }

    validateNoConflict(options.unassigned === true, options.assigneeId !== undefined, "Cannot use --assignee-id and --unassigned together");

    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const archiveMode = parseOptionalTaskArchiveMode(options.archiveMode) ?? "active";
    const status = parseOptionalTaskStatus(options.status);
    const listId = parseOptionalListIdentifier(options.list);
    const limit = parsePageSize(options.limit);
    const cursor = parsePaginationCursor(options.cursor);
    const filters = {
      ...(status !== undefined && { status }),
      ...(options.assigneeId !== undefined && {
        assigneeId: parseId(options.assigneeId, "assigneeId"),
      }),
      ...(options.unassigned === true && { assigneeId: null }),
      ...(options.delegatedToAgent !== undefined && {
        delegatedToAgentId: parseId(options.delegatedToAgent, "delegatedToAgentId"),
      }),
    };

    const searchArgs = {
      projectId,
      query,
      archiveMode,
      ...(listId !== undefined && { listId }),
      paginationOpts: {
        numItems: limit,
        cursor,
      },
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    } as Omit<FunctionArgs<typeof api.tasks.core.search.byProject>, "apiKey">;

    const results: SearchTasksResult = await client.query(api.tasks.core.search.byProject, searchArgs);

    const nextCommand = buildNextCommand(query, projectId, options, results.continueCursor);

    printPaginatedOutput(
      outputMode,
      results,
      (value) => {
        if (value.page.length === 0) {
          console.log(chalk.dim("\nNo tasks found."));
          return;
        }

        console.log(chalk.bold(`\nFound ${value.page.length} task(s) on this page:\n`));
        for (const task of value.page) {
          if (!isSearchTaskSummary(task)) {
            continue;
          }
          console.log(`  ${formatTaskSummaryLine(task)}`);
        }
        console.log();
      },
      nextCommand
    );
  });
});
