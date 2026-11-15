import { Command } from "commander";
import chalk from "chalk";
import { addGlobalOptions } from "../../cli.js";
import { resolveTaskIdForCommand } from "./resolve.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../lib/output.js";
import { parseOptionalCommentsLimit } from "./parsers.js";
import { fetchRichTask } from "./hydrate.js";
import {
  formatAgentThreadWorkLine,
  formatArtifactSummaryLine,
  formatCommentSummaryLine,
  formatExternalLinkLine,
} from "./formatters.js";

interface GetTaskOptions extends OutputOptions {
  comments?: string;
  org?: string;
}

export const getTaskCommand = addGlobalOptions(
  addOutputOptions(
    new Command("get")
      .description("Get a task with artifacts, files, subtasks, and optional comments")
      .argument("<taskId>", "Task ID or ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("--comments <n>", "Include latest comments (1-50)")
  )
).action(async (taskId: string, options: GetTaskOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const commentLimit = parseOptionalCommentsLimit(options.comments);
    const id = await resolveTaskIdForCommand({ client, config, cmd, taskIdOrRef: taskId, org: options.org });
    const task = await fetchRichTask(client, id, {
      commentLimit,
    });
    if (!task) {
      throw new Error("Task not found or not accessible.");
    }

    printOutput(outputMode, task, (value) => {
      console.log(chalk.bold(`\n${value.refId} ${value.name}`));
      console.log(`  ID: ${value._id}`);
      console.log(`  Status: ${value.status}`);
      console.log(`  Priority: ${value.priority}`);
      console.log(`  Assignee: ${value.assignee?.name ?? "Unassigned"}`);
      if (value.delegatedToAgent) {
        console.log(`  Delegated to: ${value.delegatedToAgent.name}`);
      }
      console.log(`  Due date: ${value.dueDate ? new Date(value.dueDate).toISOString() : "None"}`);

      if (value.tags.length > 0) {
        console.log(`  Tags: ${value.tags.join(", ")}`);
      }

      console.log(`  Links: ${value.externalLinks.length}`);
      console.log(`  Runs: ${value.agentThreadWork?.length ?? 0}`);
      console.log(`  Artifacts: ${value.artifacts.length}`);
      console.log(`  Files: ${value.files.length}`);
      if (value.comments !== undefined) {
        const commentsCountSuffix = value.commentsHasMore === true ? "+" : "";
        console.log(`  Comments: ${value.comments.length}${commentsCountSuffix}`);
      }
      console.log(`  Subtasks: ${value.subtasks.length}`);

      console.log("\nSubtasks:");
      if (value.subtasks.length === 0) {
        console.log("  (none)");
      } else {
        for (const subtask of value.subtasks) {
          console.log(`  - ${subtask.refId} ${subtask.name} [${subtask.status}]`);
        }
      }

      if (value.externalLinks.length > 0) {
        console.log("\nLinks:");
        for (const link of value.externalLinks) {
          console.log(`  - ${formatExternalLinkLine(link)}`);
        }
      }

      // Every user's CLI runs on the task, newest activity first. Already on the
      // payload, so this costs no extra query.
      const runs = [...(value.agentThreadWork ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
      if (runs.length > 0) {
        console.log("\nRuns:");
        for (const run of runs) {
          console.log(`  - ${formatAgentThreadWorkLine(run)}`);
        }
      }

      console.log("\nArtifacts:");
      if (value.artifacts.length === 0) {
        console.log("  (none)");
      } else {
        for (const artifact of value.artifacts) {
          console.log(`  - ${formatArtifactSummaryLine(artifact)}`);
        }
      }

      if (value.comments !== undefined) {
        const moreSuffix = value.commentsHasMore === true ? "; more available" : "";
        console.log(`\nComments (showing latest ${value.comments.length}${moreSuffix}):`);
        if (value.comments.length === 0) {
          console.log("  (none)");
        } else {
          for (const comment of value.comments) {
            console.log(`  - ${formatCommentSummaryLine(comment)}`);
          }
        }
      }

      console.log();
    });
  });
});
