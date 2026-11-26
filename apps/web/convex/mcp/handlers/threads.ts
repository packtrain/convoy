import { api } from "../../_generated/api";
import { should, throwInvalidParams } from "../lib/should";
import { resolveTaskIdOrRef } from "../lib/tasks/resolution";
import { resolveSpawnTarget } from "../lib/threads/resolution";
import type { ToolHandler } from "./context";

/**
* "What is this thread?" for any thread id an agent holds (OS-1162). The answer includes the
* runtime target, so an agent can discover where it is running and add a thread to its group.
*
* `getSummary` shapes the payload, so this is argument parsing plus a null-collapse: "no such
* thread", "not yours" and "wrong table" are all unactionable, so they share one message. No
* project argument — a thread id is globally unique and the query authorizes through the
* thread's own project.
*/
export const handleGetThread: ToolHandler = async ({ ctx, apiKey, args }) => {
  const threadId = should.beId<"cliThreads">(args, "threadId");
  const thread = await ctx.runQuery(api.cli.threads.summaries.getSummary, {
    threadId,
    apiKey,
  });
  if (!thread) {
    throwInvalidParams("Thread not found");
  }

  return thread;
};

/**
* "What threads are here?" (OS-1626) — the project's threads, or one group's members when
* `threadId` is passed. `threadId` (not `parentThreadId`) because every other thread tool
* calls the id it is handed `threadId`.
*
* The two call shapes are unified here and only here: the drill-down's array is wrapped in a
* page envelope rather than giving either query an argument it would ignore, so `limit`/
* `cursor` are documented as unused on it (slicing would make the tail unreachable). It also
* skips `getProjectId()`, since requiring a project would reject an answerable call.
*
* An unreadable or non-container id yields an empty page rather than throwing — an agent
* racing a delete shouldn't get an error. `get_thread` is where an id is diagnosed.
*/
export const handleListThreads: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const threadId = should.beOptionalId<"cliThreads">(args, "threadId");
    // Validated rather than `args.includeDone === true`: a model sending the string
    // `"true"` would otherwise have its done threads silently dropped.
  const includeDone = should.beOptionalBoolean(args, "includeDone") ?? false;

  if (threadId) {
    const page = await ctx.runQuery(api.cli.threads.summaries.listGroupSummaries, {
      parentThreadId: threadId,
      includeDone,
      apiKey,
    });
    // The whole group, always: it is capped at 100 rows and read in one scan.
    return { page, isDone: true, continueCursor: "" };
  }

  const limit = should.beOptionalInteger(args, "limit", 1, 50) ?? 20;
  const cursor = should.beNullableString(args, "cursor") ?? null;

  return ctx.runQuery(api.cli.threads.summaries.listSummaries, {
    projectId: await getProjectId(),
    includeDone,
    paginationOpts: { numItems: limit, cursor },
    apiKey,
  });
};

/**
 * "What was said in this thread?" (OS-1628) — the newest messages, oldest first.
 *
 * `limit` is validated 1–20 rather than passed through, so a caller asking for 50
 * hears the ceiling instead of silently reading 10 fewer messages than it thinks.
 * An unreadable id returns `[]` like `list_threads`; a container throws from the
 * query (a group has no transcript).
 */
export const handleListThreadMessages: ToolHandler = async ({ ctx, apiKey, args }) => {
  const threadId = should.beId<"cliThreads">(args, "threadId");
  const limit = should.beOptionalInteger(args, "limit", 1, 20);

  return ctx.runQuery(api.cli.messages.listRecentSummaries, {
    threadId,
    ...(limit === undefined ? {} : { limit }),
    apiKey,
  });
};

/**
 * Shape only (OS-1222). Branch legality, parent-is-a-repo, and parent-matches-`pathId`
 * are `createThreadCore`'s rules; re-checking them here would fork them.
 */
function parseWorktreeSpec(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const spec = should.beRecord(value, key);
  const baseRef = should.beOptionalString(spec, "baseRef")?.trim() || undefined;
  const startFromOrigin = should.beOptionalBoolean(spec, "startFromOrigin");
  return {
    parentPathId: should.beTrimmedString(spec, "parentPathId"),
    branch: should.beTrimmedString(spec, "branch"),
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(startFromOrigin === undefined ? {} : { startFromOrigin }),
  };
}

/**
 * "Start a thread" (OS-1629), via `create` or `addThreadToGroup`. Returns
 * `get_thread`'s payload so `targetOnline` answers "will it run, or queue?".
 * Spec: `docs/specs/mcp-server.md`.
 */
export const handleCreateThread: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  // Parsed before the first read, so a bad call costs no reads.
  const content = should.beTrimmedString(args, "content");
  const title = should.beOptionalString(args, "title")?.trim() || undefined;
  const taskIdentifier = should.beOptionalString(args, "taskId")?.trim() || undefined;
  // Free-form like the validators they feed; only `cliType` is enumerated.
  const cliModel = should.beOptionalString(args, "cliModel")?.trim() || undefined;
  const cliEffort = should.beOptionalString(args, "cliEffort")?.trim() || undefined;
  const cliMode = should.beOptionalString(args, "cliMode")?.trim() || undefined;
  // Both pass straight through to `createThreadCore`, which owns every rule they obey.
  const projectAgentId = should.beOptionalId<"projectAgents">(args, "projectAgentId");
  const worktree = parseWorktreeSpec(args, "worktree");
  // Same guard and reason as `send_thread_message`: the mutation drops the flag for
  // prose, which would read back as a command that ran (OS-1582).
  const runtimeCommand = should.beOptionalBoolean(args, "runtimeCommand");
  if (runtimeCommand && !content.startsWith("/")) {
    throwInvalidParams("runtimeCommand requires content starting with '/', e.g. '/security-review'");
  }

  const target = await resolveSpawnTarget(ctx, apiKey, args);
  // A bare ref needs a project, which is why `projectId` is on the schema.
  const taskId = taskIdentifier ? await resolveTaskIdOrRef(ctx, apiKey, taskIdentifier, "taskId", getProjectId) : undefined;

  const shared = {
    profileId: target.profileId,
    pathId: target.pathId,
    cliType: target.cliType,
    content,
    ...(title === undefined ? {} : { title }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(cliModel === undefined ? {} : { cliModel }),
    ...(cliEffort === undefined ? {} : { cliEffort }),
    ...(cliMode === undefined ? {} : { cliMode }),
    // One object feeds both mutations, so both creation paths get these fields.
    ...(projectAgentId === undefined ? {} : { projectAgentId }),
    ...(worktree === undefined ? {} : { worktree }),
    ...(runtimeCommand ? { runtimeCommand: true } : {}),
    apiKey,
  };

  const threadId = target.addToGroup
    ? (
        await ctx.runMutation(api.cli.threads.groups.addThreadToGroup, {
          ...shared,
          ...target.addToGroup,
        })
      ).threadId
    : await ctx.runMutation(api.cli.threads.core.create, shared);

  const thread = await ctx.runQuery(api.cli.threads.summaries.getSummary, { threadId, apiKey });
  if (!thread) {
    // Unreachable: `createThreadCore` requires the CLI_THREAD this read does.
    throwInvalidParams("Thread was created but could not be read back");
  }

  return thread;
};

/**
 * "Say something in that thread" (OS-1630) — closes the notify-back loop. Queues a
 * user message for the target's next run; it does not resume a paused agent.
 * `runtimeCommand` forwards the text to the runtime instead ("/compact").
 * Spec: `docs/specs/mcp-server.md`, `docs/specs/cli-runtime-commands.md`.
 */
export const handleSendThreadMessage: ToolHandler = async ({ ctx, apiKey, args }) => {
  const threadId = should.beId<"cliThreads">(args, "threadId");
  const content = should.beTrimmedString(args, "content");
  const sentByThreadId = should.beOptionalId<"cliThreads">(args, "sourceThreadId");
  const runtimeCommand = should.beOptionalBoolean(args, "runtimeCommand");
  const steer = should.beOptionalBoolean(args, "steer");

  // `send` silently drops the flag for non-slash content; here that would read as a
  // command that ran, which is the OS-1582 failure mode. Fail visibly instead.
  if (runtimeCommand && !content.startsWith("/")) {
    throwInvalidParams("runtimeCommand requires content starting with '/', e.g. '/compact'");
  }
  // Runtime commands are never steered (`send` drops the flag), so accepting the pair
  // would imply an injected command that cannot happen — the same failure mode.
  if (steer && runtimeCommand) {
    throwInvalidParams("steer cannot be combined with runtimeCommand");
  }

  const messageId = await ctx.runMutation(api.cli.messages.send, {
    threadId,
    content,
    ...(sentByThreadId ? { sentBy: { kind: "thread" as const, threadId: sentByThreadId } } : {}),
    ...(runtimeCommand ? { runtimeCommand: true } : {}),
    ...(steer ? { steer: true } : {}),
    apiKey,
  });

  // The message id is the only new fact; the thread's state is `get_thread`'s answer.
  return { messageId, threadId };
};

/**
 * Attach a task to a thread started without one (OS-1713); returns `get_thread`'s payload.
 * A bare ref resolves in the thread's project, never the connection's.
 */
export const handleAttachTaskToThread: ToolHandler = async ({ ctx, apiKey, args }) => {
  const threadId = should.beId<"cliThreads">(args, "threadId");
  const thread = await ctx.runQuery(api.cli.threads.summaries.getSummary, { threadId, apiKey });
  if (!thread) {
    throwInvalidParams("Thread not found");
  }
  const taskId = await resolveTaskIdOrRef(ctx, apiKey, should.beTrimmedString(args, "taskId"), "taskId", async () => thread.projectId);
  await ctx.runMutation(api.cli.threads.core.attachTask, { threadId, taskId, apiKey });
  return ctx.runQuery(api.cli.threads.summaries.getSummary, { threadId, apiKey });
};

/** Attach a PR to an owned thread, attach-once; returns `get_thread`'s payload. */
export const handleAttachPullRequestToThread: ToolHandler = async ({ ctx, apiKey, args }) => {
  const threadId = should.beId<"cliThreads">(args, "threadId");
  const pullRequest = should.beTrimmedString(args, "pullRequest");
  const { url } = await ctx.runMutation(api.cli.threads.core.attachPullRequest, { threadId, pullRequest, apiKey });
  const thread = await ctx.runQuery(api.cli.threads.summaries.getSummary, { threadId, apiKey });
  return { ...thread, pullRequestReaderUrl: url };
};

export const handleMarkThreadDone: ToolHandler = async ({ ctx, apiKey, args }) => {
  const threadId = should.beId<"cliThreads">(args, "threadId");
  const done = should.beOptionalBoolean(args, "done") ?? true;
  await ctx.runMutation(done ? api.cli.threads.core.markDone : api.cli.threads.core.markNotDone, { threadId, apiKey });
  return { threadId };
};
