import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectIdFromCommand, type AccessibleProject } from "../../lib/project-resolution.js";
import { resolveOptionalStringInput } from "../../lib/text-input.js";
import { withThreadAttachments } from "../../lib/thread-attachments.js";
import { parseScopedTaskRef } from "../tasks/parsers.js";
import { resolveTaskIdOrRef } from "../tasks/resolve.js";
import type { ThreadRow } from "./formatters.js";
import { CLI_TYPES, parseCliType } from "./parsers.js";
import { resolveSpawnTarget } from "./spawn-target.js";

interface CreateThreadOptions extends OutputOptions {
  org?: string;
  profileId?: string;
  pathId?: string;
  cliType?: string;
  cliModel?: string;
  cliEffort?: string;
  content?: string;
  contentFile?: string;
  title?: string;
  task?: string;
  source?: string;
  attach?: string[];
  worktreeBranch?: string;
  baseRef?: string;
  fromOrigin?: boolean;
}

export const createThreadCommand = addGlobalOptions(
  addOutputOptions(
    new Command("create")
      .description("Create a CLI thread and queue its first message")
      .option("--profile-id <profileId>", "CLI profile to run on (see `profiles list`)")
      .option("--path-id <pathId>", "Working path on that profile")
      .option("--cli-type <type>", `Runtime: ${CLI_TYPES.join(", ")}`)
      .option("--cli-model <model>", "Model for the runtime (default: the machine's; never inherited from --source)")
      .option("--cli-effort <effort>", "Reasoning effort (default: the machine's; never inherited from --source)")
      .option("--content <text>", "First message")
      .option("--content-file <path>", "Read the first message from a file")
      .option("--title <title>", "Thread title (derived from the message when omitted)")
      .option("--task <taskId>", "Associate a task (ID or ref)")
      .option("--source <threadId>", "Spawn beside this thread or into this group; inherits its target")
      .option("--attach <file...>", "Files to attach to the first message")
      .option("--worktree-branch <branch>", "Run in a new git worktree on this new branch, branched from the path")
      .option("--base-ref <ref>", "Ref the worktree starts from (default: the repo's HEAD)")
      .option("--from-origin", "Start the worktree from the remote's copy of the base ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: CreateThreadOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    // Optional, not required: an attachment can carry the message on its own, so
    // the combined guard below owns the requirement.
    const content = resolveOptionalStringInput({
      inlineValue: options.content,
      filePath: options.contentFile,
      inlineLabel: "--content",
      fileLabel: "--content-file",
      displayName: "content",
    }).trim();
    const attach = options.attach ?? [];
    if (content.length === 0 && attach.length === 0) {
      throw new Error("Pass --content, --content-file, or --attach.");
    }
    if (!options.worktreeBranch && (options.baseRef !== undefined || options.fromOrigin)) {
      throw new Error("--base-ref and --from-origin need --worktree-branch.");
    }

    // Resolved lazily and memoized: with --source the target's project comes from
    // the source thread, so an unconfigured default must not fail the call — but a
    // scoped `--task org/REF-1` still needs the project list.
    let projects: AccessibleProject[] | undefined;
    const listProjects = async () => {
      projects ??= await client.query(api.projects.core.listAccessible, {});
      return projects;
    };
    const resolveDefaultProject = async () => resolveProjectIdFromCommand(await listProjects(), config, cmd, options.org);

    const target = await resolveSpawnTarget(
      client,
      {
        profileId: options.profileId ? parseId<"cliProfiles">(options.profileId, "profileId") : undefined,
        pathId: options.pathId,
        cliType: parseCliType(options.cliType),
      },
      options.source ? parseId<"cliThreads">(options.source, "source") : undefined,
      resolveDefaultProject
    );

    // Resolved against the *target's* project, not the configured default: with
    // --source that is the source thread's, so a bare `--task 1634` neither needs
    // a default nor silently queries a different project (OS-1634).
    const taskId = options.task
      ? await resolveTaskIdOrRef(client, {
          value: options.task,
          label: "task",
          projectId: target.projectId,
          // Only a scoped `org/REF-1` looks up its own project, so nothing else
          // pays for the project list.
          ...(parseScopedTaskRef(options.task) ? { projects: await listProjects() } : {}),
        })
      : undefined;

    const result = await withThreadAttachments(client, target.projectId, attach, async (attachments) => {
      const args = {
        profileId: target.profileId,
        pathId: target.pathId,
        cliType: target.cliType,
        ...(options.cliModel === undefined ? {} : { cliModel: options.cliModel }),
        ...(options.cliEffort === undefined ? {} : { cliEffort: options.cliEffort }),
        content,
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(taskId === undefined ? {} : { taskId }),
        ...(attachments.length === 0 ? {} : { attachments }),
        // The server validates the branch and that the parent is not a worktree (cli-worktrees.md).
        ...(options.worktreeBranch === undefined ? {} : {
          worktree: {
            parentPathId: target.pathId,
            branch: options.worktreeBranch,
            ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
            ...(options.fromOrigin ? { startFromOrigin: true } : {}),
          },
        }),
      };

      if (!target.addToGroup) {
        const threadId: Id<"cliThreads"> = await client.mutation(api.cli.threads.core.create, args);
        return { threadId, containerId: undefined as Id<"cliThreads"> | undefined };
      }

      const created: { threadId: Id<"cliThreads">; containerId: Id<"cliThreads"> } = await client.mutation(api.cli.threads.groups.addThreadToGroup, {
        ...args,
        ...target.addToGroup,
      });
      return created;
    });

    // Re-read: storage normalizes the selection per runtime and may drop it (OS-2569).
    // The thread is already queued, so a failed read warns instead of failing the command.
    let selection: { cliModel: string | null; cliEffort: string | null } | null = null;
    try {
      const summary: ThreadRow | null = await client.query(api.cli.threads.summaries.getSummary, { threadId: result.threadId });
      selection = summary && { cliModel: summary.cliModel ?? null, cliEffort: summary.cliEffort ?? null };
    } catch (error) {
      console.error(chalk.yellow(`Warning: could not read the stored model: ${error instanceof Error ? error.message : String(error)}`));
    }
    const output = { ...result, ...selection };

    printOutput(outputMode, output, (value) => {
      console.log(chalk.green("✓") + " Thread created");
      console.log(`  ID: ${value.threadId}`);
      if (value.containerId) {
        console.log(`  Group: ${value.containerId}`);
      }
      console.log(selection
        ? `  Model: ${selection.cliModel ?? "machine default"} (effort: ${selection.cliEffort ?? "machine default"})`
        : "  Model: unknown");
      console.log();
    });
  });
});
