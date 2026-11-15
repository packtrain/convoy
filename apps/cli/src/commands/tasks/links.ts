import { Command } from "commander";
import chalk from "chalk";
import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../lib/output.js";
import { formatExternalLinkLine, type TaskExternalLinkSummary } from "./formatters.js";

type UpdateExternalLinkArgs = FunctionArgs<
  typeof api.tasks.core.updateExternalLink
>;
type TaskLinkInput = NonNullable<UpdateExternalLinkArgs["link"]>;

const LINK_KINDS = ["commit", "branch", "pull_request", "url"] as const;
type LinkKind = (typeof LINK_KINDS)[number];

interface UpsertTaskLinkOptions extends OutputOptions {
  id?: string;
  kind?: string;
  sha?: string;
  name?: string;
  linkUrl?: string;
  title?: string;
  repo?: string;
  branch?: string;
  identifier?: string;
}

function parseLinkKind(value: string | undefined): LinkKind {
  if (value === undefined || !(LINK_KINDS as readonly string[]).includes(value)) {
    throw new Error(`--kind is required and must be one of: ${LINK_KINDS.join(", ")}`);
  }
  return value as LinkKind;
}

function requireOption(value: string | undefined, message: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function buildLinkInput(options: UpsertTaskLinkOptions): TaskLinkInput {
  const kind = parseLinkKind(options.kind);
  switch (kind) {
    case "commit":
      return {
        kind,
        sha: requireOption(options.sha, "--sha is required for --kind commit"),
        ...(options.title !== undefined && { title: options.title }),
        ...(options.repo !== undefined && { repo: options.repo }),
        ...(options.branch !== undefined && { branch: options.branch }),
        ...(options.linkUrl !== undefined && { url: options.linkUrl }),
      };
    case "branch":
      return {
        kind,
        name: requireOption(options.name, "--name is required for --kind branch"),
        ...(options.repo !== undefined && { repo: options.repo }),
        ...(options.linkUrl !== undefined && { url: options.linkUrl }),
      };
    case "pull_request":
      return {
        kind,
        url: requireOption(
          options.linkUrl,
          "--link-url is required for --kind pull_request"
        ),
        ...(options.title !== undefined && { title: options.title }),
        ...(options.identifier !== undefined && { identifier: options.identifier }),
        ...(options.repo !== undefined && { repo: options.repo }),
        ...(options.branch !== undefined && { branch: options.branch }),
      };
    case "url":
      return {
        kind,
        url: requireOption(options.linkUrl, "--link-url is required for --kind url"),
        ...(options.title !== undefined && { title: options.title }),
      };
  }
}

export const upsertTaskLinkCommand = addGlobalOptions(
  addOutputOptions(
    new Command("upsert")
      .description(
        "Create or replace an external link on a task (commit, branch, pull request, or URL). " +
          "Use a deterministic --id so repeated upserts update instead of duplicating."
      )
      .argument("<taskId>", "Task ID")
      .requiredOption("--id <id>", "Stable link ID (e.g. github-pr-acme-app-12)")
      .option("--kind <kind>", `Link kind: ${LINK_KINDS.join("|")}`)
      .option("--sha <sha>", "Commit sha (commit kind)")
      .option("--name <name>", "Branch name (branch kind)")
      .option("--link-url <url>", "http(s) URL (required for pull_request/url kinds)")
      .option("--title <title>", "Display title")
      .option("--identifier <identifier>", "Provider identifier, e.g. '#123' (pull_request kind)")
      .option("--repo <repo>", "Repository, e.g. 'owner/repo'")
      .option("--branch <branch>", "Related branch name (commit/pull_request kinds)")
  )
).action(async (taskId: string, options: UpsertTaskLinkOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const parsedTaskId = parseId(taskId, "taskId");
    const id = requireOption(options.id, "--id is required");
    const link = buildLinkInput(options);

    const result = await client.mutation(api.tasks.core.updateExternalLink, {
      taskId: parsedTaskId,
      op: "upsert",
      id,
      link,
    });

    printOutput(outputMode, result, (value) => {
      console.log(chalk.green("✓") + " Link upserted");
      const upserted = value.externalLinks.find(
        (item: TaskExternalLinkSummary) => item.id === id
      );
      if (upserted) {
        console.log(`  - ${formatExternalLinkLine(upserted)}`);
      }
      console.log(`  Task links: ${value.externalLinks.length}`);
      console.log();
    });
  });
});

interface DeleteTaskLinkOptions extends OutputOptions {
  id?: string;
}

export const deleteTaskLinkCommand = addGlobalOptions(
  addOutputOptions(
    new Command("delete")
      .description("Delete an external link from a task (idempotent)")
      .argument("<taskId>", "Task ID")
      .requiredOption("--id <id>", "Link ID to delete")
  )
).action(async (taskId: string, options: DeleteTaskLinkOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const parsedTaskId = parseId(taskId, "taskId");
    const id = options.id;
    if (id === undefined || id.trim().length === 0) {
      throw new Error("--id is required");
    }

    const result = await client.mutation(api.tasks.core.updateExternalLink, {
      taskId: parsedTaskId,
      op: "delete",
      id,
    });

    printOutput(outputMode, result, (value) => {
      console.log(chalk.green("✓") + " Link deleted");
      console.log(`  ID: ${id}`);
      console.log(`  Task links: ${value.externalLinks.length}`);
      console.log();
    });
  });
});

export const taskLinksCommand = new Command("links")
  .description("Task external link commands")
  .addCommand(upsertTaskLinkCommand)
  .addCommand(deleteTaskLinkCommand);
