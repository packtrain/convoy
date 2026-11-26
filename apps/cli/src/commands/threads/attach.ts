import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { getContentType } from "../../lib/content-type.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { requireThreadProject, withThreadAttachments } from "../../lib/thread-attachments.js";

type CheckStatus = "passed" | "warning" | "failed" | "not_performed";

/** Status flag → reported status; every status but passed needs --note (docs/specs/task-checks.md). */
const STATUS_FLAGS: Record<CheckStatus, { option: "passed" | "warning" | "failed" | "notPerformed"; flag: string }> = {
  passed: { option: "passed", flag: "--passed" },
  warning: { option: "warning", flag: "--warning" },
  failed: { option: "failed", flag: "--failed" },
  not_performed: { option: "notPerformed", flag: "--not-performed" },
};

interface AttachToResponseOptions extends OutputOptions {
  messageId: string;
  sessionId: string;
  inline?: boolean;
  caption?: string[];
  check?: string;
  passed?: boolean;
  warning?: boolean;
  failed?: boolean;
  notPerformed?: boolean;
  note?: string;
  label?: string;
  value?: string;
  artifact?: string;
}

function parseCheck(files: string[], options: AttachToResponseOptions) {
  const statuses = (Object.keys(STATUS_FLAGS) as CheckStatus[]).filter((status) => options[STATUS_FLAGS[status].option]);
  const flags = Object.values(STATUS_FLAGS).map(({ flag }) => flag).join(", ");
  if (options.check === undefined) {
    if (options.value !== undefined) throw new Error("--value needs --check");
    if (options.artifact !== undefined) throw new Error("--artifact needs --check");
    if (statuses.length > 0 || options.note !== undefined || options.label !== undefined) {
      throw new Error(`${flags}, --note and --label need --check <key>.`);
    }
    if (files.length === 0) {
      throw new Error("Pass at least one file, or --check <key> to report a check.");
    }
    return undefined;
  }
  const [status, ...extra] = statuses;
  if (!status || extra.length > 0) {
    throw new Error(`--check needs exactly one of ${flags}.`);
  }
  const note = options.note?.trim();
  if (status !== "passed" && !note) {
    throw new Error(`${STATUS_FLAGS[status].flag} needs --note with the reason.`);
  }
  const value = options.value?.trim();
  return {
    key: options.check,
    status,
    ...(note ? { note } : {}),
    ...(options.label ? { label: options.label } : {}),
    ...(value ? { value } : {}),
    ...(options.artifact ? { artifactId: options.artifact } : {}),
  };
}

/** The nth `--caption` goes to the nth file; an empty one skips its file (OS-2587). */
function parseCaptions(files: string[], captions: string[] = []): Array<string | undefined> {
  if (captions.length > files.length) {
    throw new Error(`Got ${captions.length} --caption values for ${files.length} file${files.length === 1 ? "" : "s"}. Pass at most one per file, in file order.`);
  }
  return files.map((_, index) => captions[index]?.trim() || undefined);
}

/** The running agent attaches files to its own live reply (OS-2091), optionally answering a Check. Specs: docs/specs/cli-message-attachments.md, docs/specs/task-checks.md. */
export const attachToResponseCommand = addGlobalOptions(
  addOutputOptions(
    new Command("attach")
      .description("Attach files to the agent's current reply in a CLI thread, optionally reporting a check")
      .argument("<threadId>", "Thread ID")
      .argument("[file...]", "Files to attach; optional with --check")
      .requiredOption("--message-id <messageId>", "The live reply's message ID, from the run instructions")
      .requiredOption("--session-id <sessionId>", "The running session's ID, from the run instructions")
      .option("--inline", "Show .html files expanded in the reply instead of as download cards")
      .option(
        "--caption <text>",
        "What to look at in a file, shown under it in the image viewer; repeat once per file, in file order (\"\" skips one)",
        (value: string, previous: string[] = []) => [...previous, value]
      )
      .option("--check <key>", "Report these files as evidence for a check (see `convoy threads checks`)")
      .option("--passed", "The check passed")
      .option("--warning", "The check passed, but a human should look; needs --note")
      .option("--failed", "The check failed; needs --note")
      .option("--not-performed", "The check was not performed; needs --note")
      .option("--note <text>", "Justification for the result")
      .option("--label <label>", "Label for a check key outside the project's catalog")
      .option("--value <text>", "The check's answer, e.g. High or +3 (max 500 characters)")
      .option("--artifact <artifactId>", "A task artifact in this project to show with the result")
  )
).action(async (threadId: string, files: string[], options: AttachToResponseOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const check = parseCheck(files, options);
    const captions = parseCaptions(files, options.caption);
    const notHtml = options.inline ? files.filter((file) => getContentType(file) !== "text/html") : [];
    if (notHtml.length > 0) {
      throw new Error(`--inline works only on .html files: ${notHtml.join(", ")}`);
    }
    const parsedThreadId = parseId<"cliThreads">(threadId, "threadId");
    const projectId = await requireThreadProject(client, parsedThreadId);

    const result = await withThreadAttachments(client, projectId, files, (attachments) =>
      client.mutation(api.cli.messages.attachToResponse, {
        threadId: parsedThreadId,
        messageId: parseId<"cliMessages">(options.messageId, "messageId"),
        sessionId: parseId<"cliSessions">(options.sessionId, "sessionId"),
        attachments: attachments.map((attachment, index) => ({
          ...attachment,
          ...(options.inline ? { display: "inline" as const } : {}),
          ...(captions[index] ? { caption: captions[index] } : {}),
        })),
        ...(check ? { check } : {}),
      })
    );

    printOutput(outputMode, { threadId: parsedThreadId, ...result }, (value) => {
      if (value.storageIds.length > 0) {
        console.log(chalk.green("✓") + ` Attached ${value.storageIds.length} file${value.storageIds.length === 1 ? "" : "s"} to the reply`);
      }
      if (check) {
        console.log(chalk.green("✓") + ` Reported check ${check.key}: ${check.status.replace("_", " ")}${check.value ? ` (${check.value})` : ""}`);
      }
      console.log();
    });
  });
});
