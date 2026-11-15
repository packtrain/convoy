import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

function claudeInitChunk(commands: string[]) {
  return {
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      slash_commands: commands,
      tools: ["Bash", "Read"],
    }),
  };
}

function claudeCommandsChangedChunk(commands: string[]) {
  return {
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "commands_changed",
      session_id: "sess-1",
      commands: commands.map((name) => ({ name, description: `${name} description`, argumentHint: "" })),
    }),
  };
}

function opencodeCommandsChunk(commands: string[]) {
  return {
    type: "convoy.commands",
    data: JSON.stringify({ commands }),
  };
}

/** What the claude-code runner reports from `supportedCommands()` (OS-1806). */
function claudeInventoryChunk(commands: { name: string; description?: string; argumentHint?: string }[]) {
  return {
    type: "convoy.commands",
    data: JSON.stringify({ commands }),
  };
}

/** A claimed thread with one started run, ready for appendRunContent. */
async function setupClaimedRun(cliType?: "claude-code" | "codex" | "opencode") {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);

  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
    name: "CLI Key",
    expiresAt,
  });
  const session = await ctx.cliSession(profile._id, apiKeyResult.id);
  const chat = await ctx.cliThread(user._id, project._id, profile._id, {
    hasPendingUserMessages: true,
    status: "pending",
    ...(cliType ? { cliType } : {}),
  });

  const userMessage = await ctx.cliMessage(chat._id, profile._id, {
    role: "user",
    content: [{ type: "text", data: "hello", timestamp: 1000 }],
    createdAt: 1000,
    updatedAt: 1000,
  });

  await t.mutation(api.cli.threads.runControl.claimThread, {
    threadId: chat._id,
    sessionId: session._id,
    leaseMs: 60_000,
    apiKey: apiKeyResult.key,
  });
  const started = await t.mutation(api.cli.messages.startRunResponse, {
    threadId: chat._id,
    sessionId: session._id,
    userMessageIds: [userMessage._id],
    apiKey: apiKeyResult.key,
  });

  return { ctx, user, project, asUser, t, profile, session, chat, apiKeyResult, started };
}

describe("cliRuntimeFacts", () => {
  test("appendRunContent captures slash commands from the claude init chunk", async () => {
    const { asUser, t, session, chat, apiKeyResult, started } = await setupClaimedRun();

    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [claudeInitChunk(["compact", "review", "my-skill"])],
      apiKey: apiKeyResult.key,
    });

    await t.run(async (runCtx) => {
      const facts = await runCtx.db.query("cliRuntimeFacts").collect();
      expect(facts).toHaveLength(1);
      expect(facts[0]?.profileId).toBe(chat.profileId);
      expect(facts[0]?.cliType).toBe("claude-code");
      expect(facts[0]?.pathId).toBe(chat.pathId);
      expect(facts[0]?.key).toBe("slashCommands");
      expect(JSON.parse(facts[0]?.payload ?? "{}")).toEqual({
        commands: [{ name: "compact" }, { name: "review" }, { name: "my-skill" }],
      });
    });

    const commands = await asUser.query(api.cli.facts.getThreadRuntimeCommands, {
      threadId: chat._id,
    });
    expect(commands).toEqual([{ name: "compact" }, { name: "review" }, { name: "my-skill" }]);
  });

  // OS-1806: the init event carries names only, so the runner reports the
  // descriptions and argument hints separately; that inventory wins the run.
  test("appendRunContent captures the claude inventory chunk over the init names", async () => {
    const { asUser, t, chat, session, apiKeyResult, started } = await setupClaimedRun();

    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [
        claudeInitChunk(["compact", "review"]),
        claudeInventoryChunk([
          { name: "compact", description: "Compact the conversation" },
          { name: "review", description: "Review a PR", argumentHint: "[pr-number]" },
        ]),
      ],
      apiKey: apiKeyResult.key,
    });

    const commands = await asUser.query(api.cli.facts.getThreadRuntimeCommands, {
      threadId: chat._id,
    });
    expect(commands).toEqual([
      { name: "compact", description: "Compact the conversation" },
      { name: "review", description: "Review a PR", argumentHint: "[pr-number]" },
    ]);
  });

  // Rows written before the payload widened hold bare names.
  test("getThreadRuntimeCommands reads a legacy names-only fact payload", async () => {
    const { asUser, t, chat } = await setupClaimedRun();

    await t.run(async (runCtx) => {
      await runCtx.db.insert("cliRuntimeFacts", {
        profileId: chat.profileId,
        cliType: "claude-code",
        pathId: chat.pathId,
        key: "slashCommands",
        payload: JSON.stringify({ commands: ["compact", "review"] }),
        reportedAt: Date.now(),
      });
    });

    const commands = await asUser.query(api.cli.facts.getThreadRuntimeCommands, {
      threadId: chat._id,
    });
    expect(commands).toEqual([{ name: "compact" }, { name: "review" }]);
  });

  test("repeated init chunks upsert one row; changed inventory replaces it", async () => {
    const { t, session, apiKeyResult, started } = await setupClaimedRun();

    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [claudeInitChunk(["compact"])],
      apiKey: apiKeyResult.key,
    });
    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [claudeInitChunk(["compact"])],
      apiKey: apiKeyResult.key,
    });
    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [claudeInitChunk(["compact", "new-command"])],
      apiKey: apiKeyResult.key,
    });

    await t.run(async (runCtx) => {
      const facts = await runCtx.db.query("cliRuntimeFacts").collect();
      expect(facts).toHaveLength(1);
      expect(JSON.parse(facts[0]?.payload ?? "{}")).toEqual({
        commands: [{ name: "compact" }, { name: "new-command" }],
      });
    });
  });

  test("commands_changed chunks update the inventory; the last event in a run wins", async () => {
    const { t, session, apiKeyResult, started } = await setupClaimedRun();

    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [claudeInitChunk(["compact"]), claudeCommandsChangedChunk(["compact", "reloaded-skill"])],
      apiKey: apiKeyResult.key,
    });

    await t.run(async (runCtx) => {
      const facts = await runCtx.db.query("cliRuntimeFacts").collect();
      expect(facts).toHaveLength(1);
      expect(JSON.parse(facts[0]?.payload ?? "{}")).toEqual({
        commands: [
          { name: "compact", description: "compact description" },
          { name: "reloaded-skill", description: "reloaded-skill description" },
        ],
      });
    });
  });

  test("getThreadRuntimeCommands falls back to a Group child path's inventory", async () => {
    const { ctx, user, project, asUser, t, profile, session, apiKeyResult, started } = await setupClaimedRun();

    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [claudeInitChunk(["compact"])],
      apiKey: apiKeyResult.key,
    });

    // A thread on a different path (e.g. a fresh worktree) with no fact of
    // its own reads the Group child path's inventory.
    const worktreeThread = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "other-path-id",
    });
    const commands = await asUser.query(api.cli.facts.getThreadRuntimeCommands, {
      threadId: worktreeThread._id,
    });
    expect(commands).toEqual([{ name: "compact" }]);
  });

  test("appendRunContent captures the opencode command inventory chunk", async () => {
    const { asUser, t, chat, session, apiKeyResult, started } = await setupClaimedRun("opencode");

    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [opencodeCommandsChunk(["init", "commit"])],
      apiKey: apiKeyResult.key,
    });

    await t.run(async (runCtx) => {
      const facts = await runCtx.db.query("cliRuntimeFacts").collect();
      expect(facts).toHaveLength(1);
      expect(facts[0]?.cliType).toBe("opencode");
      expect(JSON.parse(facts[0]?.payload ?? "{}")).toEqual({
        commands: [{ name: "init" }, { name: "commit" }],
      });
    });

    const commands = await asUser.query(api.cli.facts.getThreadRuntimeCommands, {
      threadId: chat._id,
    });
    expect(commands).toEqual([{ name: "init" }, { name: "commit" }]);
  });

  test("non-claude runtimes capture nothing", async () => {
    const { asUser, t, chat, session, apiKeyResult, started } = await setupClaimedRun("codex");

    await t.mutation(api.cli.messages.appendRunContent, {
      messageId: started.assistantMessageId,
      sessionId: session._id,
      chunks: [claudeInitChunk(["compact"])],
      apiKey: apiKeyResult.key,
    });

    await t.run(async (runCtx) => {
      const facts = await runCtx.db.query("cliRuntimeFacts").collect();
      expect(facts).toHaveLength(0);
    });

    const commands = await asUser.query(api.cli.facts.getThreadRuntimeCommands, {
      threadId: chat._id,
    });
    expect(commands).toEqual([]);
  });
});

describe("runtime command messages", () => {
  test("send stores the runtimeCommand flag and skips org-command expansion", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);
    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "compact",
      content: "This must never expand for runtime commands.",
      autoExpand: false,
    });

    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId: chat._id,
      content: "/compact keep the API design decisions",
      runtimeCommand: true,
      // Even a stray org-command ref must not expand a runtime command.
      composerDocument: {
        version: 1,
        refs: [
          {
            type: "slash-command",
            id: slashCommandId,
            scope: "organization",
            key: "compact",
            canonicalKey: "org:compact",
            displayLabel: "/compact",
          },
        ],
      },
    });

    await t.run(async (runCtx) => {
      const message = await runCtx.db.get("cliMessages", messageId);
      expect(message?.runtimeCommand).toBe(true);
      expect(message?.processedContent).toBeUndefined();
    });

    const unprocessed = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
      threadId: chat._id,
    });
    expect(unprocessed[0]?.runtimeCommand).toBe(true);
    expect(unprocessed[0]?.content[0]?.data).toBe("/compact keep the API design decisions");
  });

  test("send ignores the flag when the message is not slash-shaped", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId: chat._id,
      content: "just prose",
      runtimeCommand: true,
    });

    await t.run(async (runCtx) => {
      const message = await runCtx.db.get("cliMessages", messageId);
      expect(message?.runtimeCommand).toBeUndefined();
    });
  });

  test("requestSteer rejects queued runtime commands even on a steerable run", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt,
    });
    const session = await ctx.cliSession(profile._id, apiKeyResult.id, {
      supportsSteering: true,
    });
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      hasPendingUserMessages: true,
      status: "pending",
    });
    const runMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
      content: [{ type: "text", data: "initial", timestamp: 1000 }],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await t.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: session._id,
      leaseMs: 60_000,
      apiKey: apiKeyResult.key,
    });
    await t.mutation(api.cli.messages.startRunResponse, {
      threadId: chat._id,
      sessionId: session._id,
      userMessageIds: [runMessage._id],
      apiKey: apiKeyResult.key,
    });

    // A prose message on the same run steers fine...
    const proseMessageId = await asUser.mutation(api.cli.messages.send, {
      threadId: chat._id,
      content: "steer me",
    });
    await asUser.mutation(api.cli.messages.requestSteer, { messageId: proseMessageId });

    // ...but the queued runtime command is rejected.
    const commandMessageId = await asUser.mutation(api.cli.messages.send, {
      threadId: chat._id,
      content: "/compact",
      runtimeCommand: true,
    });
    await expect(
      asUser.mutation(api.cli.messages.requestSteer, { messageId: commandMessageId })
    ).rejects.toThrow();
  });
});
