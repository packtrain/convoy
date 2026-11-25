import chalk from "chalk";
import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

type MessageSummary = FunctionReturnType<typeof api.cli.messages.listRecentSummaries>[number];

const MAX_MESSAGE_LIMIT = 20;

interface ListThreadMessagesOptions extends OutputOptions {
  limit?: string;
}

/**
 * Validated here even though the query clamps the same range: a caller asking
 * for 50 should hear the ceiling, not read 20 rows as the whole thread.
 */
function parseMessageLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  const limit = Number(normalized);
  if (!/^\d+$/.test(normalized) || limit < 1 || limit > MAX_MESSAGE_LIMIT) {
    throw new Error(`Invalid limit "${value}". Use an integer from 1 to ${MAX_MESSAGE_LIMIT}.`);
  }

  return limit;
}

function formatMessage(message: MessageSummary): string {
  const who =
    message.sentBy?.kind === "thread" ? `${message.role} (from thread)` : message.sentBy?.kind === "pullRequestWatch" ? `${message.role} (from GitHub)` : message.role;
  const flags = [message.status, message.truncated ? "truncated" : undefined]
    .filter(Boolean)
    .join(" ");
  const header = `${chalk.cyan(who)} ${chalk.dim(`${new Date(message.createdAt).toISOString()} [${flags}]`)}`;
  const body = message.text.length > 0 ? message.text : chalk.dim("(no text)");
  const error = message.errorMessage ? `\n  ${chalk.red(message.errorMessage)}` : "";
  return `${header}\n  ${body}${error}`;
}

export const listThreadMessagesCommand = addGlobalOptions(
  addOutputOptions(
    new Command("messages")
      .description("Read a CLI thread's most recent messages, oldest first")
      .argument("<threadId>", "Thread ID")
      .option("--limit <n>", `Messages to read, 1 to ${MAX_MESSAGE_LIMIT} (default 10)`)
  )
).action(async (threadId: string, options: ListThreadMessagesOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const limit = parseMessageLimit(options.limit);
    const messages: MessageSummary[] = await client.query(
      api.cli.messages.listRecentSummaries,
      {
        threadId: parseId<"cliThreads">(threadId, "threadId"),
        ...(limit === undefined ? {} : { limit }),
      }
    );

    printOutput(outputMode, messages, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("\nNo messages found."));
        return;
      }

      console.log(chalk.bold(`\nLast ${value.length} message(s):\n`));
      // Printed in the order returned — the query already composes newest-last.
      for (const message of value) {
        console.log(formatMessage(message));
        console.log();
      }
    });
  });
});
