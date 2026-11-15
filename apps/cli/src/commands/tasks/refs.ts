import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { parseOptionalCommentsLimit } from "./parsers.js";
import { fetchTaskResources } from "./hydrate.js";
import { formatArtifactSummaryLine, formatCommentSummaryLine, formatTaskSummaryLine } from "./formatters.js";
import type { FunctionReturnType } from "convex/server";

interface RefsTaskOptions extends OutputOptions {
  org?: string;
  comments?: string;
}

type RefLookupItem = FunctionReturnType<typeof api.tasks.core.getByRefs>["results"][number];
type FoundRefLookupItem = RefLookupItem & {
  task: NonNullable<RefLookupItem["task"]>;
};

export const refsTasksCommand = addGlobalOptions(
  addOutputOptions(
    new Command("refs")
      .description("Get tasks by refs (for example: ABC-1 ABC-2)")
      .argument("<refs...>", "Task refs")
      .option("--comments <n>", "Include latest comments (1-50)")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(
  async (refs: string[], options: RefsTaskOptions, cmd: Command) => {
    await runOneShotCommand(cmd, async ({ client, config }) => {
      const outputMode = resolveOutputMode(options);
      const commentLimit = parseOptionalCommentsLimit(options.comments);
      const { projectId } = await resolveProjectFromCommand(
        client,
        config,
        cmd,
        options.org
      );

      const refsResult = await client.query(api.tasks.core.getByRefs, {
        refs,
        projectId,
      });

      const enrichedResults = await Promise.all(
        refsResult.results.map(async (item: RefLookupItem) => {
          if (!item.task) {
            return item;
          }

          const resources = await fetchTaskResources(client, item.task._id, {
            commentLimit,
          });
          return {
            ...item,
            task: {
              ...item.task,
              ...resources,
            },
          };
        })
      );

      const payload = {
        results: enrichedResults,
      };

      printOutput(outputMode, payload, (value) => {
        const found = value.results.filter(
          (item: RefLookupItem): item is FoundRefLookupItem => item.task !== null
        );
        const missing = value.results.filter(
          (item: RefLookupItem) => item.task === null
        );
        const foundWithArtifacts = found.filter(
          (item: FoundRefLookupItem) => item.task.artifacts.length > 0
        );
        const foundWithComments = found.filter(
          (item: FoundRefLookupItem) => item.task.comments !== undefined
        );

        console.log(chalk.bold(`\nResolved ${found.length}/${value.results.length} ref(s).`));

        if (found.length > 0) {
          console.log("\nMatches:");
          for (const item of found) {
            console.log(`  ${formatTaskSummaryLine(item.task)}`);
          }
        }

        if (missing.length > 0) {
          console.log("\nMissing:");
          for (const item of missing) {
            console.log(`  - ${item.ref}${item.error ? ` (${item.error})` : ""}`);
          }
        }

        if (foundWithArtifacts.length > 0) {
          console.log("\nArtifact details:");
          for (const item of foundWithArtifacts) {
            console.log(`  ${item.task.refId} ${item.task.name}`);
            for (const artifact of item.task.artifacts) {
              console.log(`    - ${formatArtifactSummaryLine(artifact)}`);
            }
          }
        }

        if (foundWithComments.length > 0) {
          console.log("\nComments:");
          for (const item of foundWithComments) {
            const comments = item.task.comments ?? [];
            const moreSuffix = item.task.commentsHasMore === true ? "; more available" : "";
            console.log(
              `  ${item.task.refId} ${item.task.name} (showing latest ${comments.length}${moreSuffix})`
            );
            if (comments.length === 0) {
              console.log("    (none)");
            } else {
              for (const comment of comments) {
                console.log(`    - ${formatCommentSummaryLine(comment)}`);
              }
            }
          }
        }

        console.log();
      });
    });
  }
);
