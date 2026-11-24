import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";

/**
 * The thread's last-used runtime selection is denormalized onto
 * `metadata.cli` at user-message-write time (OS-1454) so the composer's pills
 * render from the thread document instead of a scan over every message. These
 * tests assert the stored fold, not a client derivation.
 */

type StoredSelection = {
  lastUsedModel: string | null;
  lastUsedEffort: string | null;
  lastUsedMode: string | null;
};

async function setup() {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id, {
    paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
  });

  const createThread = (args: {
    cliModel?: string;
    cliEffort?: string;
    cliMode?: string;
    content?: string;
  }) =>
    asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: args.content ?? "hello",
      cliModel: args.cliModel,
      cliEffort: args.cliEffort,
      cliMode: args.cliMode,
    });

  // Normalizes absent keys so assertions don't depend on how `t.run` serializes
  // `undefined` across the boundary.
  const readSelection = async (threadId: Id<"cliThreads">): Promise<StoredSelection | null> => {
    const cli = await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      return thread?.metadata?.cli ?? null;
    });
    if (!cli) {
      return null;
    }
    return {
      lastUsedModel: cli.lastUsedModel ?? null,
      lastUsedEffort: cli.lastUsedEffort ?? null,
      lastUsedMode: cli.lastUsedMode ?? null,
    };
  };

  const readPlanSteps = (threadId: Id<"cliThreads">) =>
    t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      return thread?.metadata?.plan?.steps ?? null;
    });

  return { ctx, user, project, profile, asUser, t, createThread, readSelection, readPlanSteps };
}

describe("thread last-used CLI selection", () => {
  test("threads.create stamps the initial user message's selection", async () => {
    const { createThread, readSelection } = await setup();

    const threadId = await createThread({
      cliModel: "opus",
      cliEffort: "high",
      cliMode: "plan",
    });

    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: "high",
      lastUsedMode: "plan",
    });
  });

  test("a thread created without any selection stores no bag", async () => {
    const { createThread, readSelection } = await setup();

    const threadId = await createThread({});

    expect(await readSelection(threadId)).toBeNull();
  });

  test("messages.send overwrites the stored selection", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({
      cliModel: "opus",
      cliEffort: "high",
      cliMode: "plan",
    });
    await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliModel: "sonnet",
      cliEffort: "low",
      cliMode: "default",
    });

    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: "low",
      lastUsedMode: "default",
    });
  });

  test("a send that names a model but no effort clears the stored effort", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high" });
    await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliModel: "sonnet",
    });

    // Effort is only meaningful against the model it was picked with, so the
    // pair moves atomically rather than leaving "high" stranded on "sonnet".
    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: null,
      lastUsedMode: null,
    });
  });

  test("a send that omits the model keeps the stored model and effort", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high" });
    await asUser.mutation(api.cli.messages.send, { threadId, content: "second" });

    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: "high",
      lastUsedMode: null,
    });
  });

  test("a send that names only an effort keeps the stored model and replaces the effort", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high" });
    await asUser.mutation(api.cli.messages.send, { threadId, content: "second", cliEffort: "low" });

    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: "low",
      lastUsedMode: null,
    });
  });

  test("a send that omits the mode keeps the stored mode", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliMode: "plan" });
    await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliModel: "sonnet",
    });

    // `send`'s `cliMode` arg is optional, so a caller that simply omits it must
    // not blank the thread's remembered mode.
    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: null,
      lastUsedMode: "plan",
    });
  });

  test("a blank mode does not overwrite the stored mode", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliMode: "plan" });
    await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliMode: "   ",
    });

    // `cliMode` is stored on the message unnormalized (no server-side mode
    // catalog), and the fold makes it sticky — so a blank from a public `send`
    // would otherwise pin the composer to the default forever.
    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: null,
      lastUsedMode: "plan",
    });
  });

  test("stamping preserves a plan already stored on the thread", async () => {
    const { asUser, t, createThread, readSelection, readPlanSteps } = await setup();

    const threadId = await createThread({ cliModel: "opus" });
    await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      await runCtx.db.patch("cliThreads", threadId, {
        metadata: {
          ...thread?.metadata,
          plan: { steps: [{ id: "1", text: "Alpha", status: "in-progress" }] },
        },
      });
    });

    await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliModel: "sonnet",
    });

    expect(await readPlanSteps(threadId)).toEqual([
      { id: "1", text: "Alpha", status: "in-progress" },
    ]);
    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: null,
      lastUsedMode: null,
    });
  });

  test("the plan fold preserves the stored selection", async () => {
    const { ctx, profile, asUser, t, createThread, readSelection, readPlanSteps } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high", cliMode: "plan" });

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const userMessageId = await t.run(async (runCtx) => {
      const message = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_role_and_createdAt", (q) =>
          q.eq("threadId", threadId).eq("role", "user")
        )
        .first();
      return message?._id;
    });
    expect(userMessageId).toBeDefined();

    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });
    const started = await t.mutation(api.cli.messages.startRunResponse, {
      threadId,
      sessionId: session._id,
      userMessageIds: [userMessageId as Id<"cliMessages">],
      apiKey: apiKeyResult.key,
    });
    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      apiKey: apiKeyResult.key,
      chunks: [
        {
          type: "assistant",
          data: JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "tool_todo",
                  name: "TodoWrite",
                  input: { todos: [{ content: "Alpha", status: "in_progress" }] },
                },
              ],
            },
          }),
        },
      ],
    });

    expect(await readPlanSteps(threadId)).not.toBeNull();
    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "opus",
      lastUsedEffort: "high",
      lastUsedMode: "plan",
    });
  });

  test("removeQueued leaves the stored selection untouched", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high", cliMode: "plan" });
    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliModel: "sonnet",
      cliEffort: "low",
      cliMode: "default",
    });

    await asUser.mutation(api.cli.messages.removeQueued, { messageId });

    // The bag is a composer preselection hint, not a projection of the current
    // message set: removing a queued message restores its text into the
    // composer, so resetting the pills at that moment would be wrong.
    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: "low",
      lastUsedMode: "default",
    });
  });

  test("a send that omits the model inherits the remembered selection onto the message (OS-1894)", async () => {
    const { asUser, t, createThread } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high", cliMode: "plan" });
    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "sent by another agent, no selection",
    });

    // Run-model resolution reads the latest user message, so a message that
    // names nothing must carry the thread's remembered selection — otherwise
    // the run falls back to the runtime's own default model.
    const message = await t.run((runCtx) => runCtx.db.get("cliMessages", messageId));
    expect(message?.cliModel).toBe("opus");
    expect(message?.cliEffort).toBe("high");
    expect(message?.cliMode).toBe("plan");
  });

  test("a send that names a model does not inherit the remembered effort", async () => {
    const { asUser, t, createThread } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high" });
    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliModel: "sonnet",
    });

    const message = await t.run((runCtx) => runCtx.db.get("cliMessages", messageId));
    expect(message?.cliModel).toBe("sonnet");
    expect(message?.cliEffort).toBeUndefined();
  });

  test("a send on a thread with no remembered selection stores none", async () => {
    const { asUser, t, createThread } = await setup();

    const threadId = await createThread({});
    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
    });

    const message = await t.run((runCtx) => runCtx.db.get("cliMessages", messageId));
    expect(message?.cliModel).toBeUndefined();
    expect(message?.cliEffort).toBeUndefined();
    expect(message?.cliMode).toBeUndefined();
  });

  test("editLastResend leaves the stored selection untouched", async () => {
    const { asUser, createThread, readSelection } = await setup();

    const threadId = await createThread({ cliModel: "opus", cliEffort: "high", cliMode: "plan" });
    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId,
      content: "second",
      cliModel: "sonnet",
    });

    await asUser.mutation(api.cli.messages.editLastResend, { messageId, content: "edited" });

    expect(await readSelection(threadId)).toEqual({
      lastUsedModel: "sonnet",
      lastUsedEffort: null,
      lastUsedMode: "plan",
    });
  });
});
