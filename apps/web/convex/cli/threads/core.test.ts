import { expect, test, describe, vi } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildCliThread, createTestContext, setupFakeTimers } from "../../../convex-testing";
import { CHUNK_COPY_BATCH_CHARS, CHUNK_COPY_BATCH_SIZE } from "../lib/chunks/lifecycle";
import { errors } from "../errors";
import { getAppUrlBase } from "../../lib/shared/appUrl";
import { MAX_GROUP_CHILDREN } from "../../../lib/threads/constants";

setupFakeTimers();

describe("create", () => {
  test.each(["feat/execution", undefined])("keeps the initial branch until the CLI reports %s", async (reportedBranch) => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "repo", path: "/repo", label: "repo" }],
    });
    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id, pathId: "repo", cliType: "codex", content: "Hello",
      initialBranch: "feat/visible",
    });
    expect((await asUser.query(api.cli.threads.core.get, { threadId }))?.branch).toBe("feat/visible");

    const key = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI", expiresAt: Date.now() + 60_000,
    });
    const session = await ctx.cliSession(profile._id, key.id);
    await asUser.mutation(api.cli.threads.runControl.claimThread, { threadId, sessionId: session._id, leaseMs: 60_000 });
    expect((await asUser.query(api.cli.threads.core.get, { threadId }))?.branch).toBe("feat/visible");
    await asUser.mutation(api.cli.threads.runControl.reportExecutionBranch, {
      threadId, sessionId: session._id, branch: reportedBranch,
    });
    expect((await asUser.query(api.cli.threads.core.get, { threadId }))?.branch).toBe(reportedBranch);
  });

  test("a new worktree uses its target branch instead of the local display hint", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "repo", path: "/repo", label: "repo" }],
    });
    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id, pathId: "repo", cliType: "codex", content: "Hello",
      initialBranch: "feat/parent",
      worktree: { parentPathId: "repo", branch: "feat/worktree" },
    });
    expect((await asUser.query(api.cli.threads.core.get, { threadId }))?.branch).toBe("feat/worktree");
  });

  test("should create chat with default title and initial message", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Hello, this is my first message",
    });

    expect(threadId).toBeDefined();

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("Hello, this is my first message");
      expect(chat?.status).toBe("pending");
      expect(chat?.processingState).toBe("idle");
      expect(chat?.hasPendingUserMessages).toBe(true);
      expect(chat?.isDeleted).toBe(false);
      expect(chat?.readAt).toBeDefined();
      expect(chat?.profileId).toBe(profile._id);
      expect(chat?.pathId).toBe("path-1");
      expect(chat?.path).toBe("/home/user/myproject");
      expect(chat?.cliType).toBe("claude-code");

      // Check messages were created
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();
      expect(messages).toHaveLength(1);

      const userMessage = messages.find((m) => m.role === "user");
      expect(userMessage?.status).toBe("completed");
      expect(userMessage?.content).toEqual([]);
      expect(userMessage?.nextChunkOrder).toBe(1);

      const chunkRows = await runCtx.db
        .query("cliMessageChunks")
        .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
          q.eq("threadId", threadId).eq("messageId", userMessage!._id)
        )
        .order("asc")
        .collect();
      expect(chunkRows).toHaveLength(1);
      expect(chunkRows[0]?.data).toBe("Hello, this is my first message");
    });
  });

  test("expands slash command refs into processed initial user message content", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "client-summary",
      content: "Summarize the client context.",
      autoExpand: false,
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content:
        "Please ignore /client-summary and use [/client-summary](convoy://command/org:client-summary)",
      composerDocument: {
        version: 1,
        refs: [
          {
            type: "slash-command",
            id: slashCommandId,
            scope: "organization",
            key: "client-summary",
            canonicalKey: "org:client-summary",
            displayLabel: "/client-summary",
          },
        ],
      },
    });

    await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      expect(thread?.title).toBe(
        "Please ignore /client-summary and use /client-summary"
      );

      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();
      expect(messages[0]?.processedContent).toBe(
        "Please ignore /client-summary and use Summarize the client context."
      );

      const chunkRows = await runCtx.db
        .query("cliMessageChunks")
        .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
          q.eq("threadId", threadId).eq("messageId", messages[0]!._id)
        )
        .collect();
      expect(chunkRows[0]?.data).toBe(
        "Please ignore /client-summary and use [/client-summary](convoy://command/org:client-summary)"
      );
    });
  });

  test("stores runtimeCommand on the initial user message and skips ref expansion", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
      organizationId: org._id,
      key: "client-summary",
      content: "Summarize the client context.",
      autoExpand: false,
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "/security-review the login flow",
      runtimeCommand: true,
      composerDocument: {
        version: 1,
        refs: [
          {
            type: "slash-command",
            id: slashCommandId,
            scope: "organization",
            key: "client-summary",
            canonicalKey: "org:client-summary",
            displayLabel: "/client-summary",
          },
        ],
      },
    });

    await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();
      expect(messages[0]?.runtimeCommand).toBe(true);
      expect(messages[0]?.processedContent).toBeUndefined();
    });
  });

  // Cursor and OpenCode inject thread identity and the bound agent's prompt into the
  // first message of a fresh session, which a raw command would either displace or
  // skip forever. Spec: `docs/specs/cli-runtime-commands.md`.
  test("rejects a first-message runtime command on runtimes that bootstrap through it", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    for (const cliType of ["cursor", "opencode"] as const) {
      await expect(
        asUser.mutation(api.cli.threads.core.create, {
          profileId: profile._id,
          pathId: "path-1",
          cliType,
          content: "/security-review",
          runtimeCommand: true,
        })
      ).rejects.toThrow(/cannot start a thread/i);
    }

    // Codex appends its bootstrap over the RPC on every run, so it stays allowed.
    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "codex",
        content: "/compact",
        runtimeCommand: true,
      })
    ).resolves.toBeDefined();
  });

  test("drops runtimeCommand when the content is not a command", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "please review the login flow",
      runtimeCommand: true,
    });

    await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();
      expect(messages[0]?.runtimeCommand).toBeUndefined();
    });
  });

  test("should store cliMode on initial user message", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      cliMode: "plan",
      content: "Plan this feature",
    });

    await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();

      expect(messages).toHaveLength(1);
      const userMessage = messages.find((m) => m.role === "user");
      expect(userMessage?.cliMode).toBe("plan");
    });
  });

  test("should store cliModel on initial user message", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      cliMode: "plan",
      cliModel: "opus",
      content: "Plan this feature",
    });

    await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();

      expect(messages).toHaveLength(1);
      const userMessage = messages.find((m) => m.role === "user");
      expect(userMessage?.cliModel).toBe("opus");
    });
  });

  test("strips cliModel on initial user message for non-Claude threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "codex",
      cliMode: "plan",
      cliModel: "opus",
      content: "Plan this feature",
    });

    await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();

      expect(messages).toHaveLength(1);
      const userMessage = messages.find((m) => m.role === "user");
      expect(userMessage?.cliModel).toBeUndefined();
    });
  });

  test("strips invalid cliModel on initial user message for Claude threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      cliMode: "plan",
      cliModel: "not-real",
      content: "Plan this feature",
    });

    await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();

      const userMessage = messages.find((m) => m.role === "user");
      expect(userMessage?.cliModel).toBeUndefined();
    });
  });

  test("should allow cliMode to be undefined", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Hello",
    });

    await t.run(async (runCtx) => {
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .collect();

      const userMessage = messages.find((m) => m.role === "user");
      expect(userMessage?.cliMode).toBeUndefined();
    });
  });

  test("should create chat with custom title", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Hello",
      title: "My Custom Chat",
    });

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("My Custom Chat");
    });
  });

  test("should reject custom title longer than 120 characters", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
        title: "a".repeat(121),
      })
    ).rejects.toThrow("Title must be 120 characters or less");
  });

  test("should throw for non-existent profile", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    // Delete the profile
    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliProfiles", profile._id);
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
      }),
    ).rejects.toThrow("Profile not found");
  });

  test("should throw for a soft-deleted profile", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliProfiles", profile._id, {
        isDeleted: true,
        deletedAt: Date.now(),
        deletedBy: user._id,
      });
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
      })
    ).rejects.toThrow("Profile not found");
  });

  test("should throw for invalid pathId", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "nonexistent-path",
        cliType: "claude-code",
        content: "Hello",
      })
    ).rejects.toThrow("Path not found in profile");
  });

  test("should throw for another users profile", async () => {
    const ctx = createTestContext();
    const { project, org, asUser } = await ctx.setupProject();

    // Create another user with a profile
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id, {
      paths: [{ id: "path-1", path: "/home/other/project", label: "project" }],
    });

    // Try to create chat for other user's profile
    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: otherProfile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
      })
    ).rejects.toThrow("Cannot create chat for another user's profile");
  });

  test("should require project access", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const { asUser: asOtherUser } = await ctx.setupUser();

    await expect(
      asOtherUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
      })
    ).rejects.toThrow();
  });

  test("creates initial message attachments and derives title from first attachment when content is empty", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    let storageId!: Id<"_storage">;

    await t.run(async (runCtx) => {
      storageId = await runCtx.storage.store(new Blob(["image"]));
    });
    await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "",
      attachments: [
        {
          storageId,
          fileName: "mock-screenshot.png",
          fileSize: 5,
          contentType: "image/png",
          dimensions: { width: 800, height: 400 },
        },
      ],
    });

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("mock-screenshot.png");

      const message = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .first();
      expect(message?.attachments).toHaveLength(1);
      expect(message?.attachments?.[0]?.fileName).toBe("mock-screenshot.png");
      expect(message?.attachments?.[0]?.uploadedAt).toBeTypeOf("number");
      expect(message?.attachments?.[0]?.dimensions).toEqual({ width: 800, height: 400 });

      const refs = await runCtx.db
        .query("cliMessageAttachmentRefs")
        .withIndex("by_messageId", (q) => q.eq("messageId", message!._id))
        .collect();
      expect(refs).toHaveLength(1);
      expect(refs[0]?.storageId).toBe(storageId);
    });
  });

  test("accepts task-only create, stores task data, and derives title from task name", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const task = await ctx.task(project._id, user._id, {
      name: "Investigate flaky CLI reconnect",
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "",
      taskId: task._id,
    });

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("Investigate flaky CLI reconnect");
      expect(chat?.associatedTaskId).toBe(task._id);

      const message = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
        .first();
      expect(message?.taskId).toBe(task._id);
      expect(message?.attachments).toEqual([]);
    });
  });

  test("prefers task name over attachment filename when content is empty", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const task = await ctx.task(project._id, user._id, {
      name: "Preferred task title",
    });
    let storageId!: Id<"_storage">;

    await t.run(async (runCtx) => {
      storageId = await runCtx.storage.store(new Blob(["image"]));
    });
    await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "",
      taskId: task._id,
      attachments: [
        {
          storageId,
          fileName: "fallback-file-name.png",
          fileSize: 5,
          contentType: "image/png",
        },
      ],
    });

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("Preferred task title");
    });
  });

  test("prefers task name over message content when task is attached", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const task = await ctx.task(project._id, user._id, {
      name: "Task-backed thread title",
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Use this text as the prompt body",
      taskId: task._id,
    });

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("Task-backed thread title");
    });
  });

  test("prefers task name over message content and attachments when task is attached", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const task = await ctx.task(project._id, user._id, {
      name: "Task title wins",
    });
    let storageId!: Id<"_storage">;

    await t.run(async (runCtx) => {
      storageId = await runCtx.storage.store(new Blob(["image"]));
    });
    await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Use this text as the prompt body",
      taskId: task._id,
      attachments: [
        {
          storageId,
          fileName: "fallback-file-name.png",
          fileSize: 5,
          contentType: "image/png",
        },
      ],
    });

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("Task title wins");
    });
  });

  test("keeps explicit title precedence over attached task name", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const task = await ctx.task(project._id, user._id, {
      name: "Task-backed thread title",
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Use this text as the prompt body",
      taskId: task._id,
      title: "Custom thread title",
    });

    await t.run(async (runCtx) => {
      const chat = await runCtx.db.get("cliThreads", threadId);
      expect(chat?.title).toBe("Custom thread title");
    });
  });

  test("rejects task ids from another accessible project", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const otherProject = await ctx.project(org._id, user._id, {
      alias: "OTH",
      name: "Other",
    });
    const task = await ctx.task(otherProject._id, user._id, {
      name: "Wrong project task",
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "",
        taskId: task._id,
      }),
    ).rejects.toThrow("Task not found");
  });

  test("rejects inaccessible, missing, and deleted task ids", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const { user: otherUser, project: otherProject } = await ctx.setupProject();
    const inaccessibleTask = await ctx.task(otherProject._id, otherUser._id, {
      name: "Hidden task",
    });
    const missingTask = await ctx.task(project._id, user._id, {
      name: "Missing task",
    });
    const deletedTask = await ctx.task(project._id, user._id, {
      name: "Deleted task",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.delete("tasks", missingTask._id);
      await runCtx.db.patch("tasks", deletedTask._id, {
        isDeleted: true,
        deletedAt: Date.now(),
        deletedBy: user._id,
      });
    });

    for (const taskId of [
      inaccessibleTask._id,
      missingTask._id,
      deletedTask._id,
    ]) {
      await expect(
        asUser.mutation(api.cli.threads.core.create, {
          profileId: profile._id,
          pathId: "path-1",
          cliType: "claude-code",
          content: "",
          taskId,
        }),
      ).rejects.toThrow("Task not found");
    }
  });

  test("enforces maximum 10 attachments on create", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    const storageIds: Id<"_storage">[] = [];

    await t.run(async (runCtx) => {
      for (let index = 0; index < 11; index += 1) {
        storageIds.push(await runCtx.storage.store(new Blob([`file-${index}`])));
      }
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "",
        attachments: storageIds.map((storageId, index) => ({
          storageId,
          fileName: `file-${index}.txt`,
          fileSize: 8,
          contentType: "text/plain",
        })),
      })
    ).rejects.toThrow("A message can include at most 10 attachments");
  });
});

describe("title derivation from content", () => {
  async function createThreadWithContent(content: string) {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/test", label: "test" }],
    });
    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content,
    });
    let title = "";
    await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      title = thread!.title;
    });
    return title;
  }

  test("should use full content when single short line", async () => {
    const title = await createThreadWithContent("Fix the login bug");
    expect(title).toBe("Fix the login bug");
  });

  test("should use first non-empty line from multiline content", async () => {
    const title = await createThreadWithContent(
      "Fix the login bug\nThis is a detailed description\nWith multiple lines"
    );
    expect(title).toBe("Fix the login bug");
  });

  test("should skip leading empty lines", async () => {
    const title = await createThreadWithContent(
      "\n\n  \nActual first line\nSecond line"
    );
    expect(title).toBe("Actual first line");
  });

  test("should trim whitespace from the first line", async () => {
    const title = await createThreadWithContent(
      "  Hello world  \nMore content"
    );
    expect(title).toBe("Hello world");
  });

  test("should truncate long single line at word boundary with ellipsis", async () => {
    // 130 chars, well over the 120 limit
    const longLine =
      "This is a very long message that exceeds the maximum title length and should be truncated at a word boundary for readability";
    expect(longLine.length).toBeGreaterThan(120);

    const title = await createThreadWithContent(longLine);
    expect(title.length).toBeLessThanOrEqual(121); // 120 + ellipsis char
    expect(title).toMatch(/…$/);
    // Should end at a complete word ("for") rather than mid-word ("readab…")
    const textBeforeEllipsis = title.slice(0, -1);
    expect(textBeforeEllipsis).toMatch(/\bfor$/);
  });

  test("should hard-truncate when no good word boundary exists", async () => {
    // A single long "word" with no spaces after the 60% mark
    const longWord = "a".repeat(200);

    const title = await createThreadWithContent(longWord);
    expect(title.length).toBe(120); // 119 chars + ellipsis
    expect(title).toMatch(/…$/);
  });

  test("rejects whitespace-only content when no attachments are provided", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/test", label: "test" }],
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "   \n  \n   ",
      })
    ).rejects.toThrow("Message content or attachments are required");
  });

  test("should use first line even if later lines are longer", async () => {
    const title = await createThreadWithContent(
      "Short\n" + "x".repeat(200)
    );
    expect(title).toBe("Short");
  });

  test("should handle content that is exactly at max length", async () => {
    const exactLength = "a ".repeat(60).trimEnd(); // ~119 chars
    const padded = exactLength.padEnd(120, "z");
    expect(padded.length).toBe(120);

    const title = await createThreadWithContent(padded);
    expect(title).toBe(padded);
  });
});

describe("get", () => {
  test("should return null for an invalid raw thread id", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: "ms7c05dyhscwygj7bc0dp9rad5850dq4",
    });

    expect(result).toBeNull();
  });

  test("should return chat with profile info", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      name: "Test Profile",
    });
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Test Chat",
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Test Chat");
    expect(result?.profileName).toBe("Test Profile");
  });

  test("should return chat with soft-deleted profile info", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      name: "Deleted Profile",
    });
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Test Chat",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliProfiles", profile._id, {
        isDeleted: true,
        deletedAt: Date.now(),
        deletedBy: user._id,
      });
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    expect(result).not.toBeNull();
    expect(result?.profileName).toBe("Deleted Profile");
  });

  test("should return null for deleted chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      isDeleted: true,
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    expect(result).toBeNull();
  });

  test("should return null for non-member", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);
    const { asUser: asOtherUser } = await ctx.setupUser();

    const result = await asOtherUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    expect(result).toBeNull();
  });

  test("should compute hasUnread correctly", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);

    // Read chat (readAt >= lastActivityAt)
    const readChat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Read",
      readAt: Date.now(),
      lastActivityAt: Date.now() - 1000,
    });

    // Unread chat (readAt < lastActivityAt)
    const unreadChat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Unread",
      readAt: Date.now() - 2000,
      lastActivityAt: Date.now(),
    });

    const readResult = await asUser.query(api.cli.threads.core.get, {
      threadId: readChat._id,
    });
    const unreadResult = await asUser.query(api.cli.threads.core.get, {
      threadId: unreadChat._id,
    });

    expect(readResult?.hasUnread).toBe(false);
    expect(unreadResult?.hasUnread).toBe(true);
  });

  test("should compute requiresAttention correctly", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const now = Date.now();

    const acknowledgedChat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Acknowledged",
      status: "failed",
      readAt: now,
      attentionAcknowledgedAt: now,
      lastActivityAt: now - 1000,
    });
    const unacknowledgedChat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Needs attention",
      status: "waiting_input",
      readAt: now,
      attentionAcknowledgedAt: now - 2000,
      lastActivityAt: now - 1000,
    });

    const acknowledgedResult = await asUser.query(api.cli.threads.core.get, {
      threadId: acknowledgedChat._id,
    });
    const unacknowledgedResult = await asUser.query(api.cli.threads.core.get, {
      threadId: unacknowledgedChat._id,
    });

    expect(acknowledgedResult?.requiresAttention).toBe(false);
    expect(unacknowledgedResult?.requiresAttention).toBe(true);
  });

  test("should not require attention for completed status", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const now = Date.now();

    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Completed thread",
      status: "completed",
      readAt: now,
      attentionAcknowledgedAt: now - 2000,
      lastActivityAt: now - 1000,
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    expect(result?.requiresAttention).toBe(false);
  });

  test("returns associated task summary and omits unresolved task references", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const task = await ctx.task(project._id, user._id, {
      name: "Inspect task summary",
    });
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      associatedTaskId: task._id,
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    expect(result?.associatedTask).toEqual({
      _id: task._id,
      refId: `${project.alias}-${task.refNumber}`,
      name: "Inspect task summary",
      taskType: expect.objectContaining({ key: "task" }),
      isArchived: false,
    });

    await t.run(async (runCtx) => {
      await runCtx.db.delete("tasks", task._id);
    });

    const unresolvedResult = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });

    expect(unresolvedResult?.associatedTask).toBeUndefined();
  });
});

describe("updateTitle", () => {
  test("should update title", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Original",
    });

    await asUser.mutation(api.cli.threads.core.updateTitle, {
      threadId: chat._id,
      title: "Updated",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.title).toBe("Updated");
    });
  });

  test("should trim surrounding whitespace", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      title: "Original",
    });

    await asUser.mutation(api.cli.threads.core.updateTitle, {
      threadId: chat._id,
      title: "  Updated title  ",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.title).toBe("Updated title");
    });
  });

  test("should reject empty title", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await expect(
      asUser.mutation(api.cli.threads.core.updateTitle, {
        threadId: chat._id,
        title: "   ",
      })
    ).rejects.toThrow("Title is required");
  });

  test("should reject title longer than 120 characters", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await expect(
      asUser.mutation(api.cli.threads.core.updateTitle, {
        threadId: chat._id,
        title: "a".repeat(121),
      })
    ).rejects.toThrow("Title must be 120 characters or less");
  });

  test("should accept title with exactly 120 characters", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);
    const exactLengthTitle = "a".repeat(120);

    await asUser.mutation(api.cli.threads.core.updateTitle, {
      threadId: chat._id,
      title: exactLengthTitle,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.title).toBe(exactLengthTitle);
    });
  });

  test("should throw for non-existent chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    // Delete the chat
    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliThreads", chat._id);
    });

    await expect(
      asUser.mutation(api.cli.threads.core.updateTitle, {
        threadId: chat._id,
        title: "New Title",
      })
    ).rejects.toThrow("Thread not found");
  });

  test("should throw for soft-deleted chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      isDeleted: true,
    });

    await expect(
      asUser.mutation(api.cli.threads.core.updateTitle, {
        threadId: chat._id,
        title: "New Title",
      })
    ).rejects.toThrow("Thread not found");
  });
});

describe("markRead", () => {
  test("should set readAt to now", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      readAt: undefined,
    });

    const beforeMark = Date.now();
    await asUser.mutation(api.cli.threads.core.markRead, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.readAt).toBeGreaterThanOrEqual(beforeMark);
    });
  });

  test("acknowledges attention when requested", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      readAt: undefined,
      attentionAcknowledgedAt: undefined,
    });

    const beforeMark = Date.now();
    await asUser.mutation(api.cli.threads.core.markRead, {
      threadId: chat._id,
      acknowledgeAttention: true,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.readAt).toBeGreaterThanOrEqual(beforeMark);
      expect(updated?.attentionAcknowledgedAt).toBeGreaterThanOrEqual(beforeMark);
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });
    expect(result?.requiresAttention).toBe(false);
  });

  test("requires attention again after acknowledgment and newer activity", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      readAt: undefined,
      attentionAcknowledgedAt: undefined,
    });

    await asUser.mutation(api.cli.threads.core.markRead, {
      threadId: chat._id,
      acknowledgeAttention: true,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      if (!updated?.attentionAcknowledgedAt) {
        throw new Error("Expected attention acknowledgment timestamp");
      }

      await runCtx.db.patch("cliThreads", chat._id, {
        lastActivityAt: updated.attentionAcknowledgedAt + 1000,
      });
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });
    expect(result?.requiresAttention).toBe(true);
  });

  test("does not acknowledge attention during auto-read", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "waiting_input",
      readAt: undefined,
      attentionAcknowledgedAt: undefined,
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.readAt).toBeDefined();
      expect(updated?.attentionAcknowledgedAt).toBeUndefined();
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });
    expect(result?.requiresAttention).toBe(true);
  });

  // A redundant mark-read is a pure write-conflict source against the CLI's
  // run-lifecycle writes on the same thread doc.
  test("skips the write when the thread is already read", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const readAt = Date.now() - 1_000;
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      readAt,
      lastActivityAt: Date.now() - 5_000,
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.readAt).toBe(readAt);
    });
  });

  test("still writes when only the attention acknowledgment is missing", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    // Read, but attention still unacknowledged: the write must not be skipped.
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      readAt: Date.now(),
      lastActivityAt: Date.now() - 5_000,
      attentionAcknowledgedAt: undefined,
    });

    await asUser.mutation(api.cli.threads.core.markRead, {
      threadId: chat._id,
      acknowledgeAttention: true,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.attentionAcknowledgedAt).toBeDefined();
    });
  });

  test("should throw for non-existent chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    // Delete the chat
    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliThreads", chat._id);
    });

    await expect(
      asUser.mutation(api.cli.threads.core.markRead, { threadId: chat._id })
    ).rejects.toThrow("Thread not found");
  });

  test("should throw for soft-deleted chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      isDeleted: true,
    });

    await expect(
      asUser.mutation(api.cli.threads.core.markRead, { threadId: chat._id })
    ).rejects.toThrow("Thread not found");
  });
});

describe("markUnread", () => {
  test("should clear readAt", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      readAt: Date.now(),
      lastActivityAt: Date.now() - 1000,
    });

    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.readAt).toBeUndefined();
    });
  });

  test("clears attention acknowledgment", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "failed",
      readAt: Date.now(),
      attentionAcknowledgedAt: Date.now(),
      lastActivityAt: Date.now() - 1000,
    });

    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.readAt).toBeUndefined();
      expect(updated?.attentionAcknowledgedAt).toBeUndefined();
    });

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });
    expect(result?.requiresAttention).toBe(true);
  });

  test("should be idempotent when already unread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      readAt: undefined,
    });

    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: chat._id });
    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("cliThreads", chat._id);
      expect(updated?.readAt).toBeUndefined();
    });
  });

  test("should make hasUnread true after markUnread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      readAt: Date.now(),
      lastActivityAt: Date.now() - 1000,
    });

    await asUser.mutation(api.cli.threads.core.markUnread, { threadId: chat._id });

    const unreadResult = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });
    expect(unreadResult?.hasUnread).toBe(true);

    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", chat._id, {
        lastActivityAt: Date.now() - 2000,
      });
    });

    await asUser.mutation(api.cli.threads.core.markRead, { threadId: chat._id });

    const readResult = await asUser.query(api.cli.threads.core.get, {
      threadId: chat._id,
    });
    expect(readResult?.hasUnread).toBe(false);
  });

  test("should throw for non-existent chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliThreads", chat._id);
    });

    await expect(
      asUser.mutation(api.cli.threads.core.markUnread, { threadId: chat._id })
    ).rejects.toThrow("Thread not found");
  });

  test("should throw for soft-deleted chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      isDeleted: true,
    });

    await expect(
      asUser.mutation(api.cli.threads.core.markUnread, { threadId: chat._id })
    ).rejects.toThrow("Thread not found");
  });
});

describe("remove", () => {
  test("should soft delete chat", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await asUser.mutation(api.cli.threads.core.remove, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const deleted = await runCtx.db.get("cliThreads", chat._id);
      expect(deleted?.isDeleted).toBe(true);
      expect(deleted?.deletedAt).toBeDefined();
    });
  });

  test("fails active streaming response and clears claim state before soft delete", async () => {
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
    });
    const userMessage = await ctx.cliMessage(chat._id, profile._id, {
      role: "user",
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

    await asUser.mutation(api.cli.threads.core.remove, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const deleted = await runCtx.db.get("cliThreads", chat._id);
      const assistant = await runCtx.db.get(
        "cliMessages",
        started.assistantMessageId,
      );

      expect(deleted?.isDeleted).toBe(true);
      expect(deleted?.deletedAt).toBeDefined();
      expect(deleted?.status).toBe("failed");
      expect(deleted?.processingState).toBe("idle");
      expect(deleted?.hasPendingUserMessages).toBe(false);
      expect(deleted?.claimedBySessionId).toBeUndefined();
      expect(deleted?.claimedAt).toBeUndefined();
      expect(deleted?.claimLeaseExpiresAt).toBeUndefined();
      expect(deleted?.activeAssistantMessageId).toBeUndefined();
      expect(deleted?.streamWatchdogId).toBeUndefined();

      expect(assistant?.status).toBe("failed");
      expect(assistant?.errorMessage).toBe(
        "CLI thread deleted during response generation",
      );
      expect(assistant?.claimedBySessionId).toBeUndefined();
      expect(assistant?.claimedAt).toBeUndefined();
    });
  });

  test("should be idempotent", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliThreads", chat._id);
    });

    // Should not throw
    await asUser.mutation(api.cli.threads.core.remove, { threadId: chat._id });
  });
});

describe("ownership checks", () => {
  test("user cannot create chat for another users profile", async () => {
    const ctx = createTestContext();
    const { project, org, asUser } = await ctx.setupProject();

    // Create another user with their own profile
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id, {
      paths: [{ id: "path-1", path: "/home/other/project", label: "project" }],
    });

    // Try to create chat for other user's profile
    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: otherProfile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
      })
    ).rejects.toThrow("Cannot create chat for another user's profile");
  });

  test("user cannot see other users threads in listByProject", async () => {
    const ctx = createTestContext();
    const { user, project, org, asUser } = await ctx.setupProject();

    // Create another user with their own chat
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    await ctx.cliThread(otherUser._id, project._id, otherProfile._id, { title: "Other Chat" });

    // Create own chat
    const myProfile = await ctx.cliProfile(user._id, project._id);
    await ctx.cliThread(user._id, project._id, myProfile._id, { title: "My Chat" });

    const result = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    // Should only see own chat
    expect(result.page).toHaveLength(1);
    expect(result.page[0].title).toBe("My Chat");
  });

  test("user cannot get other users chat", async () => {
    const ctx = createTestContext();
    const { project, org, asUser } = await ctx.setupProject();

    // Create another user with their own chat
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);

    const result = await asUser.query(api.cli.threads.core.get, {
      threadId: otherChat._id,
    });

    expect(result).toBeNull();
  });

  test("user cannot update other users chat title", async () => {
    const ctx = createTestContext();
    const { project, org, asUser } = await ctx.setupProject();

    // Create another user with their own chat
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);

    await expect(
      asUser.mutation(api.cli.threads.core.updateTitle, {
        threadId: otherChat._id,
        title: "New Title",
      })
    ).rejects.toThrow("Not authorized");
  });

  test("user cannot mark other users chat as read", async () => {
    const ctx = createTestContext();
    const { project, org, asUser } = await ctx.setupProject();

    // Create another user with their own chat
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);

    await expect(
      asUser.mutation(api.cli.threads.core.markRead, { threadId: otherChat._id })
    ).rejects.toThrow("Not authorized");
  });

  test("user cannot mark other users chat as unread", async () => {
    const ctx = createTestContext();
    const { project, org, asUser } = await ctx.setupProject();

    // Create another user with their own chat
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);

    await expect(
      asUser.mutation(api.cli.threads.core.markUnread, { threadId: otherChat._id })
    ).rejects.toThrow("Not authorized");
  });

  test("user cannot remove other users chat", async () => {
    const ctx = createTestContext();
    const { project, org, asUser } = await ctx.setupProject();

    // Create another user with their own chat
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
    const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);

    await expect(
      asUser.mutation(api.cli.threads.core.remove, { threadId: otherChat._id })
    ).rejects.toThrow("Not authorized");
  });
});

describe("API key auth on create/addThreadToGroup (OS-1162)", () => {
  const PATHS = { paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }] };
  const threadArgs = (profileId: Id<"cliProfiles">) => ({
    profileId,
    pathId: "path-1",
    cliType: "claude-code" as const,
    content: "Spawned by an agent",
  });

  test("create accepts a valid API key with no Clerk identity", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Threads",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const threadId = await t.mutation(api.cli.threads.core.create, {
      ...threadArgs(profile._id),
      apiKey: key,
    });

    const thread = await t.run(async (runCtx) => runCtx.db.get("cliThreads", threadId));
    expect(thread?.userId).toBe(user._id);
    expect(thread?.status).toBe("pending");
  });

  test("create denies a key scoped to another organization", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    // A key the caller is entitled to hold, scoped away from this project:
    // the credential boundary must be applied, not merely resolved. Passing
    // `user._id` instead of `principal` would let this through.
    const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other-org key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: otherOrg._id, projectIds: [] },
    });

    await expect(
      t.mutation(api.cli.threads.core.create, { ...threadArgs(profile._id), apiKey: key })
    ).rejects.toThrow("Permission denied");
  });

  test("addThreadToGroup accepts a valid API key and records the spawner", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Threads",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const { containerId, threadId } = await t.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      spawnedByThreadId: source._id,
      ...threadArgs(profile._id),
      apiKey: key,
    });

    await t.run(async (runCtx) => {
      const groupChild = await runCtx.db.get("cliThreads", threadId);
      expect(groupChild?.userId).toBe(user._id);
      expect(groupChild?.parentThreadId).toBe(containerId);
      expect(groupChild?.spawnedByThreadId).toBe(source._id);
      // The lazy-container path ran for the API-key caller too.
      expect((await runCtx.db.get("cliThreads", containerId))?.kind).toBe("group");
    });
  });

  test("addThreadToGroup denies a key scoped to another organization", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });
    const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other-org key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: { organizationId: otherOrg._id, projectIds: [] },
    });

    await expect(
      t.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: source._id,
        ...threadArgs(profile._id),
        apiKey: key,
      })
    ).rejects.toThrow("Permission denied");
  });

  test("addThreadToGroup keeps its guards on the API key path", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Threads",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    // Plain groups resolve to a member; only workflow containers are direct targets.
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    await expect(
      t.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: container._id,
        ...threadArgs(profile._id),
        apiKey: key,
      })
    ).rejects.toThrow("Use a member thread when adding to a plain group");

    // Another user's thread stays off limits: the key resolves to its owner,
    // not to a service identity.
    const other = await ctx.user();
    const theirThread = await ctx.cliThread(other._id, project._id, profile._id, {
      status: "completed",
    });
    await expect(
      t.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: theirThread._id,
        ...threadArgs(profile._id),
        apiKey: key,
      })
    ).rejects.toThrow("Not authorized");
  });

  test("addThreadToGroup still rejects at MAX_GROUP_CHILDREN on the API key path", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Threads",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
      parentThreadId: container._id,
    });
    await t.run(async (runCtx) => {
      for (let i = 0; i < 99; i++) {
        await buildCliThread(runCtx.db, user._id, project._id, profile._id, {
          status: "completed",
          parentThreadId: container._id,
        });
      }
    });

    await expect(
      t.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: child._id,
        ...threadArgs(profile._id),
        apiKey: key,
      })
    ).rejects.toThrow("A thread group can contain at most 100 threads");
  });

  /** A group never spans projects: spec: docs/specs/thread-groups.md (OS-1629). */
  test("addThreadToGroup rejects a target profile in another project", async () => {
    const ctx = createTestContext();
    const { user, org, project: projectA, asUser, t } = await ctx.setupProject();
    const projectB = await ctx.project(org._id, user._id);
    const profileA = await ctx.cliProfile(user._id, projectA._id, PATHS);
    const profileB = await ctx.cliProfile(user._id, projectB._id, PATHS);
    const source = await ctx.cliThread(user._id, projectA._id, profileA._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });

    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: source._id,
        ...threadArgs(profileB._id),
      })
    ).rejects.toThrow("cannot span projects");

    // Nothing was written: no container, and the source is still ungrouped.
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", source._id))?.parentThreadId).toBeUndefined();
    });
  });

  test("addThreadToGroup rejects a container whose project differs from the source's", async () => {
    // A foreign child must not seed the next spawn.
    const ctx = createTestContext();
    const { user, org, project: projectA, asUser } = await ctx.setupProject();
    const projectB = await ctx.project(org._id, user._id);
    const profileA = await ctx.cliProfile(user._id, projectA._id, PATHS);
    const container = await ctx.cliThread(user._id, projectB._id, profileA._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, projectA._id, profileA._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
      parentThreadId: container._id,
    });

    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: child._id,
        ...threadArgs(profileA._id),
      })
    ).rejects.toThrow("cannot span projects");
  });

  /** A concurrent move-out must not silently build a second container (OS-1629). */
  test("addThreadToGroup rejects when the source left the expected container", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    // Already removed, as `moveChildOut` leaves it.
    const moved = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
    });

    await expect(
      asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
        sourceThreadId: moved._id,
        expectedContainerId: container._id,
        ...threadArgs(profile._id),
      })
    ).rejects.toThrow("left the group");

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", moved._id))?.parentThreadId).toBeUndefined();
    });
  });

  test("addThreadToGroup accepts the expected container when membership is unchanged", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, PATHS);
    const container = await ctx.cliThread(user._id, project._id, profile._id, {
      kind: "group",
      status: "completed",
    });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
      pathId: "path-1",
      path: "/repo/path-1",
      parentThreadId: container._id,
    });

    const { containerId, threadId } = await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: child._id,
      expectedContainerId: container._id,
      ...threadArgs(profile._id),
    });

    expect(containerId).toBe(container._id);
    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("cliThreads", threadId))?.parentThreadId).toBe(container._id);
    });
  });
});

describe("pin", () => {
  test("should pin a thread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await asUser.mutation(api.cli.threads.core.pin, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const pinned = await runCtx.db.get("cliThreads", chat._id);
      expect(pinned?.isPinned).toBe(true);
      expect(pinned?.pinnedAt).toBeDefined();
    });
  });

  test("should be idempotent for missing thread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliThreads", chat._id);
    });

    // Should not throw
    await asUser.mutation(api.cli.threads.core.pin, { threadId: chat._id });
  });

  test("user cannot pin another users thread", async () => {
    const ctx = createTestContext();
    const { project, org } = await ctx.setupProject();
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");
    const asOtherUser = ctx.asUser(otherUser);

    const owner = await ctx.user();
    await ctx.orgMember(org._id, owner._id, "member");
    await ctx.projectMember(project._id, owner._id, "member");
    const profile = await ctx.cliProfile(owner._id, project._id);
    const chat = await ctx.cliThread(owner._id, project._id, profile._id);

    await expect(
      asOtherUser.mutation(api.cli.threads.core.pin, { threadId: chat._id })
    ).rejects.toThrow("Not authorized");
  });
});

describe("unpin", () => {
  test("should unpin a thread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      isPinned: true,
      pinnedAt: Date.now(),
    });

    await asUser.mutation(api.cli.threads.core.unpin, { threadId: chat._id });

    await t.run(async (runCtx) => {
      const unpinned = await runCtx.db.get("cliThreads", chat._id);
      expect(unpinned?.isPinned).toBe(false);
      expect(unpinned?.pinnedAt).toBeUndefined();
    });
  });

  test("should be idempotent for missing thread", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id);

    await t.run(async (runCtx) => {
      await runCtx.db.delete("cliThreads", chat._id);
    });

    // Should not throw
    await asUser.mutation(api.cli.threads.core.unpin, { threadId: chat._id });
  });
});

describe("get: containerChildCount (OS-1558)", () => {
  test("a child carries its container's count; a root thread carries none", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/repo/path-1", label: "path-1" }],
    });
    const source = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
    });
    // Adding a thread builds the container and maintains its childCount.
    await asUser.mutation(api.cli.threads.groups.addThreadToGroup, {
      sourceThreadId: source._id,
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Group child task",
    });

    const child = await asUser.query(api.cli.threads.core.get, { threadId: source._id });
    expect(child?.containerChildCount).toBe(2);

    const root = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed",
    });
    expect(
      (await asUser.query(api.cli.threads.core.get, { threadId: root._id }))?.containerChildCount
    ).toBeUndefined();
  });
});

describe("project agent binding (OS-1138)", () => {
  type BindingContext = ReturnType<typeof createTestContext>;

  async function setupBindingFixture(ctx: BindingContext) {
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "path-1", path: "/home/user/myproject", label: "myproject" }],
    });
    return { user, org, project, asUser, t, profile };
  }

  test("create binds the agent and snapshots its prompt", async () => {
    const ctx = createTestContext();
    const { project, asUser, t, profile } = await setupBindingFixture(ctx);

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      prompt: "You are a meticulous reviewer.",
      appearance: { color: "#22c55e" },
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Review this",
      projectAgentId,
    });

    await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      expect(thread?.projectAgentId).toBe(projectAgentId);
      expect(thread?.agentPromptSnapshot).toBe("You are a meticulous reviewer.");
    });

    const item = await asUser.query(api.cli.threads.core.get, { threadId });
    expect(item?.agent).toEqual({
      projectAgentId,
      name: "Reviewer",
      color: "#22c55e",
      isDeleted: false,
    });
  });

  test("later agent prompt edits do not change the thread snapshot", async () => {
    const ctx = createTestContext();
    const { project, asUser, t, profile } = await setupBindingFixture(ctx);

    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      prompt: "Original prompt",
      appearance: { color: "#22c55e" },
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Review this",
      projectAgentId,
    });

    await asUser.mutation(api.agents.projectAgents.update, {
      projectAgentId,
      prompt: "Edited prompt",
    });

    await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      expect(thread?.agentPromptSnapshot).toBe("Original prompt");
    });
  });

  test("rejects an agent from another project", async () => {
    const ctx = createTestContext();
    const { user, org, asUser, profile } = await setupBindingFixture(ctx);
    const otherProject = await ctx.project(org._id, user._id, {
      alias: "OTH",
      name: "Other",
    });
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: otherProject._id,
      name: "Elsewhere",
      appearance: { color: "#22c55e" },
    });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
        projectAgentId,
      })
    ).rejects.toThrow("Project agent must belong to the thread's project");
  });

  test("rejects a deleted agent", async () => {
    const ctx = createTestContext();
    const { project, asUser, profile } = await setupBindingFixture(ctx);
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Gone",
      appearance: { color: "#22c55e" },
    });
    await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, { projectAgentId });

    await expect(
      asUser.mutation(api.cli.threads.core.create, {
        profileId: profile._id,
        pathId: "path-1",
        cliType: "claude-code",
        content: "Hello",
        projectAgentId,
      })
    ).rejects.toThrow("Project agent not found");
  });

  test("binds an agent without a prompt (attribution only, no snapshot)", async () => {
    const ctx = createTestContext();
    const { project, asUser, t, profile } = await setupBindingFixture(ctx);
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Silent",
      appearance: { color: "#22c55e" },
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Hello",
      projectAgentId,
    });

    await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      expect(thread?.projectAgentId).toBe(projectAgentId);
      expect(thread?.agentPromptSnapshot).toBeUndefined();
    });

    const item = await asUser.query(api.cli.threads.core.get, { threadId });
    expect(item?.agent?.name).toBe("Silent");
  });

  test("threads without an agent stay unchanged", async () => {
    const ctx = createTestContext();
    const { project, asUser, t, profile } = await setupBindingFixture(ctx);

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Hello",
    });

    await t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", threadId);
      expect(thread?.projectAgentId).toBeUndefined();
      expect(thread?.agentPromptSnapshot).toBeUndefined();
    });

    const item = await asUser.query(api.cli.threads.core.get, { threadId });
    expect(item?.agent).toBeUndefined();

    const page = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page[0]?.agent).toBeUndefined();
  });

  test("reads fall back to the deleted-agent placeholder when the agent is deleted", async () => {
    const ctx = createTestContext();
    const { project, asUser, profile } = await setupBindingFixture(ctx);
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      prompt: "Prompt",
      appearance: { color: "#22c55e" },
    });

    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Review this",
      projectAgentId,
    });

    await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, { projectAgentId });

    const item = await asUser.query(api.cli.threads.core.get, { threadId });
    expect(item?.agent).toMatchObject({
      projectAgentId,
      name: "Deleted agent",
      isDeleted: true,
    });

    const page = await asUser.query(api.cli.threads.lists.listByProject, {
      projectId: project._id,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page[0]?.agent).toMatchObject({
      projectAgentId,
      name: "Deleted agent",
      isDeleted: true,
    });
  });

  test("listPendingThreads exposes the agent name and prompt snapshot to the CLI", async () => {
    const ctx = createTestContext();
    const { project, asUser, profile } = await setupBindingFixture(ctx);
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      name: "Reviewer",
      prompt: "You are a meticulous reviewer.",
      appearance: { color: "#22c55e" },
    });

    const boundThreadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "Review this",
      projectAgentId,
    });
    const unboundThreadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id,
      pathId: "path-1",
      cliType: "claude-code",
      content: "No agent here",
    });

    const pending = await asUser.query(api.cli.threads.lists.listPendingThreads, {
      profileId: profile._id,
    });

    const bound = pending.find((item) => item._id === boundThreadId);
    expect(bound?.agentName).toBe("Reviewer");
    expect(bound?.agentPromptSnapshot).toBe("You are a meticulous reviewer.");

    const unbound = pending.find((item) => item._id === unboundThreadId);
    expect(unbound?.agentName).toBeUndefined();
    expect(unbound?.agentPromptSnapshot).toBeUndefined();
  });
});

/**
* The read behind MCP `get_thread` (OS-1162). A narrow projection, so these tests are
* about what an agent is and is not told: the target tuple it needs to spawn, container
* metadata with no member list, and `aggregateStatus` unprojected.
*
* Access comes from `getViewableThread`, whose full matrix lives in
* `threadSharing.test.ts` — but that suite does not cover this query, so both branches are
* exercised here: a thread shared on its own `sharedAt`, and a child covered by its
* container's.
*/

describe("markDone", () => {
  // An agent marks its own thread done mid-run (OS-2176).
  test.each(["streaming", "pending"] as const)("marks a %s thread done", async (status) => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { status });
    const { key } = await asUser.mutation(api.apiKeys.core.create, { name: "CLI", expiresAt: Date.now() + 60_000 });
    // convex-test bumps a transaction's clock past earlier commits in the same frozen ms.
    vi.setSystemTime(Date.now() + 1000);
    await t.mutation(api.cli.threads.core.markDone, { threadId: thread._id, apiKey: key });
    const result = await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id));
    expect(result).toMatchObject({ doneAt: Date.now(), isMarkedDone: true, statusProjection: { isDone: true } });
  });

  test("marks a container done while a child runs", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const group = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", status: "completed", childCount: 1 });
    const running = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: group._id, status: "streaming" });
    await asUser.mutation(api.cli.threads.core.markDone, { threadId: group._id });
    const docs = await t.run((dbCtx) => Promise.all([group._id, running._id].map((id) => dbCtx.db.get("cliThreads", id))));
    expect(docs.map((doc) => doc?.isMarkedDone)).toEqual([true, true]);
  });

  test.each([{ hasPendingInteraction: true }, { queueHeldAt: 1 }])("allows a paused thread: %j", async (pause) => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { status: "streaming", ...pause });
    // convex-test bumps a transaction's clock past earlier commits in the same frozen ms.
    vi.setSystemTime(Date.now() + 1000);
    await asUser.mutation(api.cli.threads.core.markDone, { threadId: thread._id });
    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id)))?.doneAt).toBe(Date.now());
  });

  test("API key marks done and read, acknowledges attention, and preserves execution fields", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { status: "failed", lastActivityAt: Date.now() - 1000 });
    const { key } = await asUser.mutation(api.apiKeys.core.create, { name: "CLI", expiresAt: Date.now() + 60_000 });
    // convex-test bumps a transaction's clock past earlier commits in the same frozen ms.
    vi.setSystemTime(Date.now() + 1000);
    await t.mutation(api.cli.threads.core.markDone, { threadId: thread._id, apiKey: key });
    const result = await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id));
    expect(result).toMatchObject({ doneAt: Date.now(), readAt: Date.now(), attentionAcknowledgedAt: Date.now(), status: "failed", lastActivityAt: thread.lastActivityAt });
    expect(result?.statusProjection?.isDone).toBe(true);
  });

  test("cascades to group members and newer activity keeps them done (OS-2176)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const group = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", childCount: 1 });
    const child = await ctx.cliThread(user._id, project._id, profile._id, {
      parentThreadId: group._id, status: "completed", lastActivityAt: Date.now() - 1000,
    });
    // convex-test bumps a transaction's clock past earlier commits in the same frozen ms.
    vi.setSystemTime(Date.now() + 1000);
    await asUser.mutation(api.cli.threads.core.markDone, { threadId: group._id });
    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", child._id)))?.doneAt).toBe(Date.now());
    await t.run((dbCtx) => dbCtx.db.patch("cliThreads", child._id, { lastActivityAt: Date.now() + 1000 }));
    const summary = await asUser.query(api.cli.threads.summaries.getSummary, { threadId: child._id });
    expect(summary?.isDone).toBe(true);
  });

  // Marks written before OS-2176 carry no `isMarkedDone` and keep expiring.
  test("a legacy mark still expires on newer activity", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "completed", doneAt: Date.now() - 1000, lastActivityAt: Date.now(),
    });
    const summary = await asUser.query(api.cli.threads.summaries.getSummary, { threadId: thread._id });
    expect(summary?.isDone).toBe(false);
  });

  test("rejects an API key scoped to another organization", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const org = await ctx.organization(user._id, { name: "Other", slug: "other" });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Scoped", expiresAt: Date.now() + 60_000, scope: { organizationId: org._id, projectIds: [] },
    });
    await expect(t.mutation(api.cli.threads.core.markDone, { threadId: thread._id, apiKey: key })).rejects.toThrow();
    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id)))?.doneAt).toBeUndefined();
  });

  test("rejects non-owners and unauthenticated callers", async () => {
    const ctx = createTestContext();
    const { user, project, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { sharedAt: Date.now() });
    const other = await ctx.user();
    await ctx.projectMember(project._id, other._id, "member");
    await expect(ctx.asUser(other).mutation(api.cli.threads.core.markDone, { threadId: thread._id })).rejects.toThrow("Not authorized");
    await expect(t.mutation(api.cli.threads.core.markDone, { threadId: thread._id })).rejects.toThrow();
  });

  test("rejects deleted threads", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { isDeleted: true });
    await expect(asUser.mutation(api.cli.threads.core.markDone, { threadId: thread._id })).rejects.toThrow("Thread not found");
  });
});

describe("markNotDone", () => {
  test("API key clears a sticky mark (OS-2176)", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
    const { key } = await asUser.mutation(api.apiKeys.core.create, { name: "CLI", expiresAt: Date.now() + 60_000 });
    // convex-test bumps a transaction's clock past earlier commits in the same frozen ms.
    vi.setSystemTime(Date.now() + 1000);
    await t.mutation(api.cli.threads.core.markDone, { threadId: thread._id, apiKey: key });
    await t.mutation(api.cli.threads.core.markNotDone, { threadId: thread._id, apiKey: key });
    const result = await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id));
    expect([result?.doneAt, result?.isMarkedDone, result?.statusProjection?.isDone]).toEqual([undefined, undefined, false]);
  });

  test("rejects non-owners", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { sharedAt: Date.now() });
    const other = await ctx.user();
    await ctx.projectMember(project._id, other._id, "member");
    await expect(ctx.asUser(other).mutation(api.cli.threads.core.markNotDone, { threadId: thread._id })).rejects.toThrow("Not authorized");
  });
});

describe("fork", () => {
  const BASE = 1_000;

  /** A Claude thread with two completed runs; run 2's user message carries an attachment. */
  async function seedTwoRunThread(options?: { cliType?: "claude-code" | "codex" | "cursor"; replyChunks?: number; replyChunkChars?: number; steered?: boolean }) {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id, {
      paths: [{ id: "repo", path: "/repo", label: "repo" }],
    });
    const task = await ctx.task(project._id, user._id);
    const parent = await ctx.cliThread(user._id, project._id, profile._id, {
      pathId: "repo",
      path: "/repo",
      cliType: options?.cliType ?? "claude-code",
      title: "Fix the bug",
      status: "completed",
      associatedTaskId: task._id,
      agentPromptSnapshot: "be terse",
      attachedPullRequest: FORK_PR,
    });

    const user1 = await ctx.cliMessage(parent._id, profile._id, {
      role: "user", content: [], nextChunkOrder: 1, processedAt: BASE + 1, runId: "run-1",
      createdAt: BASE, updatedAt: BASE,
    });
    await ctx.cliMessageChunks(user1._id, parent._id, profile._id, [{ type: "text", data: "first ask", timestamp: BASE }]);
    const reply1 = await ctx.cliMessage(parent._id, profile._id, {
      role: "assistant", content: [], status: "completed", runId: "run-1",
      cliContext: { continuationId: "session-1" }, createdAt: BASE + 10, updatedAt: BASE + 10,
    });

    let storageId!: Id<"_storage">;
    await t.run(async (runCtx) => {
      storageId = await runCtx.storage.store(new Blob(["img"]));
    });
    const user2 = await ctx.cliMessage(parent._id, profile._id, {
      role: "user", content: [], nextChunkOrder: 1, processedAt: BASE + 21, runId: "run-2",
      cliMode: "plan", cliModel: "opus",
      attachments: [{ storageId, fileName: "f.png", fileSize: 3, contentType: "image/png", uploadedAt: BASE + 20 }],
      pullRequest: FORK_PR,
      createdAt: BASE + 20, updatedAt: BASE + 20,
    });
    await t.run(async (runCtx) => {
      await runCtx.db.insert("cliMessageAttachmentRefs", { messageId: user2._id, threadId: parent._id, storageId, createdAt: BASE + 20 });
    });
    await ctx.cliMessageChunks(user2._id, parent._id, profile._id, [{ type: "text", data: "second ask", timestamp: BASE + 20 }]);
    // A steered message joins run 2 while its reply streams: same run id, hidden bubble,
    // and a marker chunk in the reply that names it (docs/specs/cli-steering.md).
    const steered = options?.steered
      ? await ctx.cliMessage(parent._id, profile._id, {
          role: "user", content: [], nextChunkOrder: 1, processedAt: BASE + 35, runId: "run-2", steeredAt: BASE + 35,
          attachments: [{ storageId, fileName: "steer.png", fileSize: 3, contentType: "image/png", uploadedAt: BASE + 34 }],
          createdAt: BASE + 34, updatedAt: BASE + 34,
        })
      : null;
    if (steered) {
      await ctx.cliMessageChunks(steered._id, parent._id, profile._id, [{ type: "text", data: "steer", timestamp: BASE + 34 }]);
    }
    const replyChunkCount = options?.replyChunks ?? 3;
    const reply2 = await ctx.cliMessage(parent._id, profile._id, {
      role: "assistant", content: [], status: "completed", runId: "run-2", nextChunkOrder: replyChunkCount + (steered ? 1 : 0),
      cliContext: { continuationId: "session-2" },
      diffSummary: { preRef: "a", postRef: "b", files: [{ path: "src/x.ts", kind: "modified", additions: 1, deletions: 0 }] },
      createdAt: BASE + 30, updatedAt: BASE + 30,
    });
    await ctx.cliMessageChunks(reply2._id, parent._id, profile._id, [
      ...Array.from({ length: replyChunkCount }, (_, index) => ({
        type: "text",
        data: options?.replyChunkChars ? "x".repeat(options.replyChunkChars) : `reply ${index}`,
        timestamp: BASE + 30 + index,
      })),
      ...(steered
        ? [{
            type: "convoy_notice",
            data: JSON.stringify({ code: "steered-message", title: "Steered", message: "steer", messageId: steered._id }),
            timestamp: BASE + 36,
          }]
        : []),
    ]);

    return { ctx, user, project, asUser, t, profile, task, parent, user1, reply1, user2, steered, reply2, storageId };
  }

  const FORK_PR = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };

  async function readFork(t: Awaited<ReturnType<typeof seedTwoRunThread>>["t"], forkId: Id<"cliThreads">) {
    return t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", forkId);
      const messages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", forkId))
        .order("asc")
        .collect();
      const chunks = await runCtx.db
        .query("cliMessageChunks")
        .withIndex("by_thread_and_createdAt_and_messageId_and_chunkOrder", (q) => q.eq("threadId", forkId))
        .order("asc")
        .collect();
      return { thread, messages, chunks };
    });
  }

  test("copies the picked run into a new idle thread that inherits the parent's selection", async () => {
    const { asUser, t, parent, task, user2, reply2, storageId } = await seedTwoRunThread();

    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const { thread, messages, chunks } = await readFork(t, forkId);

    expect(thread).toMatchObject({
      title: "Fix the bug",
      cliType: "claude-code",
      pathId: "repo",
      status: "completed",
      processingState: "idle",
      hasPendingUserMessages: false,
      associatedTaskId: task._id,
      agentPromptSnapshot: "be terse",
      attachedPullRequest: FORK_PR,
      forkedFrom: {
        threadId: parent._id,
        runStart: { messageId: user2._id, createdAt: BASE + 20 },
        reply: { messageId: reply2._id, createdAt: BASE + 30 },
        runId: "run-2",
        continuationId: "session-1",
      },
    });
    expect(thread?.parentThreadId).toBeUndefined();

    expect(messages).toHaveLength(2);
    const [copiedUser, copiedReply] = messages;
    expect(copiedUser).toMatchObject({ role: "user", runId: "run-2", cliMode: "plan", cliModel: "opus", nextChunkOrder: 1, pullRequest: FORK_PR });
    expect(copiedUser?.processedAt).toBeDefined();
    expect(copiedUser?.attachments?.[0]?.storageId).toBe(storageId);
    expect(copiedReply).toMatchObject({
      role: "assistant", status: "completed", runId: "run-2", nextChunkOrder: 3,
      cliContext: { continuationId: "session-2" },
    });
    expect(copiedReply?.diffSummary?.files[0]?.path).toBe("src/x.ts");
    expect(copiedReply?.claimedBySessionId).toBeUndefined();
    expect(copiedUser!.createdAt).toBeLessThan(copiedReply!.createdAt);

    expect(chunks.map((chunk) => [chunk.messageId, chunk.chunkOrder, chunk.data])).toEqual([
      [copiedUser!._id, 0, "second ask"],
      [copiedReply!._id, 0, "reply 0"],
      [copiedReply!._id, 1, "reply 1"],
      [copiedReply!._id, 2, "reply 2"],
    ]);

    await t.run(async (runCtx) => {
      const refs = await runCtx.db
        .query("cliMessageAttachmentRefs")
        .withIndex("by_messageId", (q) => q.eq("messageId", copiedUser!._id))
        .collect();
      expect(refs.map((ref) => ref.storageId)).toEqual([storageId]);
      // The parent is untouched.
      const parentMessages = await runCtx.db
        .query("cliMessages")
        .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", parent._id))
        .collect();
      expect(parentMessages).toHaveLength(4);
    });
    // The fork is attached to the same task.
    const taskDoc = await t.run((runCtx) => runCtx.db.get("tasks", task._id));
    expect(taskDoc?.agentThreadWork?.some((entry) => entry.threadId === forkId && entry.source === "manual_attachment")).toBe(true);
  });

  test("copies the reply's attachment refs, so deleting the source reply keeps the fork's blob (OS-2091)", async () => {
    const { asUser, t, parent, user2, reply2 } = await seedTwoRunThread();
    const replyBlob = await t.run(async (runCtx) => {
      const storageId = await runCtx.storage.store(new Blob(["shot"]));
      await runCtx.db.patch("cliMessages", reply2._id, {
        attachments: [{ storageId, fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: BASE + 31 }],
      });
      await runCtx.db.insert("cliMessageAttachmentRefs", { messageId: reply2._id, threadId: parent._id, storageId, createdAt: BASE + 31 });
      return storageId;
    });

    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const copiedReply = (await readFork(t, forkId)).messages.find((message) => message.role === "assistant");
    await asUser.mutation(api.cli.messages.editLastResend, { messageId: user2._id, content: "again" });

    await t.run(async (runCtx) => {
      const refs = await runCtx.db
        .query("cliMessageAttachmentRefs")
        .withIndex("by_storageId", (q) => q.eq("storageId", replyBlob))
        .collect();
      // The copy keeps its role, so the fork's Evidence tab lists it (OS-2289).
      expect(refs.map((ref) => [ref.messageId, ref.role])).toEqual([[copiedReply!._id, "assistant"]]);
      expect(await runCtx.storage.getUrl(replyBlob)).not.toBeNull();
    });
  });

  test("picking the run's user message forks the same run", async () => {
    const { asUser, t, user2, reply2 } = await seedTwoRunThread();
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: user2._id });
    const { thread } = await readFork(t, forkId);
    expect(thread?.forkedFrom?.reply.messageId).toBe(reply2._id);
  });

  test("resumes from the copied reply, then from the parent's previous turn once the copy is edited", async () => {
    const { asUser, t, reply2 } = await seedTwoRunThread();
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: forkId })).toBe("session-2");

    const { messages } = await readFork(t, forkId);
    const copiedUser = messages.find((message) => message.role === "user")!;
    await asUser.mutation(api.cli.messages.editLastResend, { messageId: copiedUser._id, content: "second ask, differently" });

    expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: forkId })).toBe("session-1");
    const after = await readFork(t, forkId);
    expect(after.messages.map((message) => message.role)).toEqual(["user"]);
    expect(after.thread?.hasPendingUserMessages).toBe(true);
  });

  test("forking the first run leaves no fallback continuation", async () => {
    const { asUser, t, reply1 } = await seedTwoRunThread();
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply1._id });
    const { thread, messages } = await readFork(t, forkId);
    expect(thread?.forkedFrom?.continuationId).toBeUndefined();
    expect(messages.map((message) => message.runId)).toEqual(["run-1", "run-1"]);
  });

  test("copies a long reply in batches after the first", async () => {
    const total = CHUNK_COPY_BATCH_SIZE * 2 + 1;
    const { asUser, t, reply2 } = await seedTwoRunThread({ replyChunks: total });
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });

    const inline = await readFork(t, forkId);
    const replyChunksInline = inline.chunks.filter((chunk) => chunk.messageId !== inline.messages[0]!._id);
    expect(replyChunksInline).toHaveLength(CHUNK_COPY_BATCH_SIZE);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const done = await readFork(t, forkId);
    const replyChunks = done.chunks.filter((chunk) => chunk.messageId !== done.messages[0]!._id);
    expect(replyChunks).toHaveLength(total);
    expect(replyChunks.map((chunk) => chunk.chunkOrder)).toEqual(Array.from({ length: total }, (_, index) => index));
    expect(new Set(replyChunks.map((chunk) => chunk.createdAt)).size).toBe(1);
  });

  test("refuses to branch a fork while its copy is in flight, then allows a full copy", async () => {
    const total = CHUNK_COPY_BATCH_SIZE * 2 + 1;
    const { asUser, t, reply2 } = await seedTwoRunThread({ replyChunks: total });
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const inline = await readFork(t, forkId);
    expect(inline.thread?.forkedFrom?.copiesInFlight).toBe(1);
    const copiedReply = inline.messages.find((message) => message.role === "assistant")!;

    await expect(asUser.mutation(api.cli.threads.core.fork, { messageId: copiedReply._id })).rejects.toThrow(errors.FORK_COPY_IN_PROGRESS);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const done = await readFork(t, forkId);
    expect(done.thread?.forkedFrom?.copiesInFlight).toBe(0);
    const { threadId: secondForkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: copiedReply._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const second = await readFork(t, secondForkId);
    expect(second.chunks.filter((chunk) => chunk.messageId !== second.messages[0]!._id)).toHaveLength(total);
  });

  test("cuts a copy batch on its character budget, not only its row count", async () => {
    const chars = Math.ceil(CHUNK_COPY_BATCH_CHARS / 2) + 1;
    const { asUser, t, reply2 } = await seedTwoRunThread({ replyChunks: 3, replyChunkChars: chars });
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });

    const inline = await readFork(t, forkId);
    expect(inline.chunks.filter((chunk) => chunk.messageId !== inline.messages[0]!._id)).toHaveLength(1);
    expect(inline.thread?.forkedFrom?.copiesInFlight).toBe(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const done = await readFork(t, forkId);
    expect(done.chunks.filter((chunk) => chunk.messageId !== done.messages[0]!._id).map((chunk) => chunk.chunkOrder)).toEqual([0, 1, 2]);
    expect(done.thread?.forkedFrom?.copiesInFlight).toBe(0);
  });

  test("stops copying when the copied reply was deleted mid-copy", async () => {
    const total = CHUNK_COPY_BATCH_SIZE + 1;
    const { asUser, t, reply2 } = await seedTwoRunThread({ replyChunks: total });
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const { messages } = await readFork(t, forkId);
    const copiedUser = messages.find((message) => message.role === "user")!;
    await asUser.mutation(api.cli.messages.editLastResend, { messageId: copiedUser._id, content: "changed" });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await readFork(t, forkId);
    expect(after.messages.map((message) => message.role)).toEqual(["user"]);
    expect(after.chunks.every((chunk) => chunk.messageId === copiedUser._id)).toBe(true);
  });

  test("a fork of a fork seeds from the grandparent's previous turn", async () => {
    const { asUser, t, reply2 } = await seedTwoRunThread();
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const first = await readFork(t, forkId);
    const copiedReply = first.messages.find((message) => message.role === "assistant")!;

    const { threadId: secondForkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: copiedReply._id });
    const second = await readFork(t, secondForkId);
    expect(second.thread?.forkedFrom?.continuationId).toBe("session-1");

    const copiedUser = second.messages.find((message) => message.role === "user")!;
    await asUser.mutation(api.cli.messages.editLastResend, { messageId: copiedUser._id, content: "again" });
    expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: secondForkId })).toBe("session-1");
  });

  test("orders a steered run's user rows before the reply by timestamp", async () => {
    const { asUser, t, reply2 } = await seedTwoRunThread({ steered: true });
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const { messages, chunks } = await readFork(t, forkId);

    expect(messages.map((message) => message.role)).toEqual(["user", "user", "assistant"]);
    const stamps = messages.map((message) => message.createdAt);
    expect(stamps[0]).toBeLessThan(stamps[1]!);
    expect(stamps[1]).toBeLessThan(stamps[2]!);
    expect(chunks.map((chunk) => chunk.data).slice(0, 3)).toEqual(["second ask", "steer", "reply 0"]);
  });

  test("rewrites steered markers to the copied user message ids", async () => {
    const { asUser, t, steered, reply2 } = await seedTwoRunThread({ steered: true });
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const { messages, chunks } = await readFork(t, forkId);

    const copiedSteered = messages.find((message) => message.role === "user" && message.steeredAt !== undefined)!;
    expect(copiedSteered._id).not.toBe(steered!._id);
    const marker = chunks.find((chunk) => chunk.type === "convoy_notice")!;
    expect(JSON.parse(marker.data)).toMatchObject({ code: "steered-message", messageId: copiedSteered._id });
    expect(marker.normalizedEvent).toMatchObject({ kind: "runtime-notice", detailsJson: JSON.stringify({ messageId: copiedSteered._id }) });
  });

  test("marks the copied reply when the parent's reply disappears mid-copy", async () => {
    const total = CHUNK_COPY_BATCH_SIZE + 1;
    const { asUser, t, user2, reply2 } = await seedTwoRunThread({ replyChunks: total });
    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    // The parent edits the forked run before the scheduled batches run: its reply and chunks go away.
    await asUser.mutation(api.cli.messages.editLastResend, { messageId: user2._id, content: "edited in parent" });
    expect(await t.run((runCtx) => runCtx.db.get("cliMessages", reply2._id))).toBeNull();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { messages, chunks } = await readFork(t, forkId);
    const copiedReply = messages.find((message) => message.role === "assistant")!;
    const replyChunks = chunks.filter((chunk) => chunk.messageId === copiedReply._id);
    expect(replyChunks).toHaveLength(CHUNK_COPY_BATCH_SIZE + 1);
    const notice = replyChunks[replyChunks.length - 1]!;
    expect(notice.type).toBe("convoy_notice");
    expect(JSON.parse(notice.data)).toMatchObject({ code: "fork-copy-incomplete" });
    expect(notice.chunkOrder).toBe(CHUNK_COPY_BATCH_SIZE);
  });

  test("branches a stopped reply that recorded a session, keeping its failure", async () => {
    const { asUser, t, reply2 } = await seedTwoRunThread();
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessages", reply2._id, { status: "failed", errorMessage: "Stopped by user" });
    });

    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });

    const { messages } = await readFork(t, forkId);
    const copiedReply = messages.find((message) => message.role === "assistant")!;
    expect(copiedReply.status).toBe("failed");
    expect(copiedReply.errorMessage).toBe("Stopped by user");
    expect(copiedReply.cliContext?.continuationId).toBe("session-2");
  });

  test("branches a Codex thread through the reply's turn and hands the fork the turn to cut at (OS-2073)", async () => {
    const { asUser, t, parent, reply1, reply2 } = await seedTwoRunThread({ cliType: "codex" });
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessages", reply1._id, { cliContext: { continuationId: "session-1", turnId: "turn-1" } });
      await runCtx.db.patch("cliMessages", reply2._id, { cliContext: { continuationId: "session-2", turnId: "turn-2" } });
    });

    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const { thread, messages } = await readFork(t, forkId);
    expect(thread?.forkedFrom).toMatchObject({ threadId: parent._id, continuationId: "session-1", turnId: "turn-1" });
    const copiedReply = messages.find((message) => message.role === "assistant")!;
    expect(copiedReply.cliContext).toEqual({ continuationId: "session-2", turnId: "turn-2" });

    // The copied reply's session is the parent's: the CLI must fork it, not resume it.
    expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: forkId })).toEqual({
      continuationId: "session-2", forkTurnId: "turn-2",
    });
    expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: forkId })).toBeNull();

    // After edit-last removes the copy, the seed is forked the same way.
    await t.run(async (runCtx) => { await runCtx.db.delete("cliMessages", copiedReply._id); });
    expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: forkId })).toEqual({
      continuationId: "session-1", forkTurnId: "turn-1",
    });

    // The fork's own reply is resumed as usual.
    await t.run(async (runCtx) => {
      await runCtx.db.insert("cliMessages", {
        threadId: forkId, role: "assistant", profileId: copiedReply.profileId, cliType: "codex", content: [],
        status: "completed", runId: "run-own", cliContext: { continuationId: "session-fork", turnId: "turn-3" },
        createdAt: Date.now() + 1_000, updatedAt: Date.now() + 1_000,
      });
    });
    expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: forkId })).toEqual({ continuationId: "session-fork" });
  });

  test("a Codex fork drops a seed that recorded no turn, so edit-last starts fresh instead of resuming the parent", async () => {
    const { asUser, t, reply2 } = await seedTwoRunThread({ cliType: "codex" });
    // reply1 predates turn ids: { continuationId: "session-1" } only.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessages", reply2._id, { cliContext: { continuationId: "session-2", turnId: "turn-2" } });
    });

    const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
    const { thread, messages } = await readFork(t, forkId);
    expect(thread?.forkedFrom?.continuationId).toBeUndefined();
    expect(thread?.forkedFrom?.turnId).toBeUndefined();

    const copiedReply = messages.find((message) => message.role === "assistant")!;
    await t.run(async (runCtx) => { await runCtx.db.delete("cliMessages", copiedReply._id); });
    expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: forkId })).toBeNull();
    expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: forkId })).toBeNull();
  });

  test("groupWithThreadId forms a group with the current thread and births the fork as its sibling", async () => {
    const { asUser, t, parent, reply2 } = await seedTwoRunThread();

    const result = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id, groupWithThreadId: parent._id });
    const { thread } = await readFork(t, result.threadId);
    const source = await t.run((runCtx) => runCtx.db.get("cliThreads", parent._id));

    // The container comes back so the workspace can adopt it before either doc lands.
    expect(result.containerId).toBeDefined();
    expect(thread?.parentThreadId).toBe(result.containerId);
    expect(source?.parentThreadId).toBe(result.containerId);
    const group = await asUser.query(api.cli.threads.groups.getGroup, { containerId: result.containerId! });
    expect(group?.children.map((child) => child._id)).toEqual([parent._id, result.threadId]);
  });

  test("a flat fork returns no container", async () => {
    const { asUser, reply2 } = await seedTwoRunThread();
    expect((await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id })).containerId).toBeUndefined();
  });

  test("a fork in a new tab is titled after the thread it came from, without stacking the prefix", async () => {
    const { asUser, t, parent, reply2 } = await seedTwoRunThread();

    const { threadId: tabId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id, groupWithThreadId: parent._id });
    expect((await readFork(t, tabId)).thread?.title).toBe("Forked from: Fix the bug");

    const copiedReply = (await readFork(t, tabId)).messages.find((message) => message.role === "assistant")!;
    const { threadId: secondTabId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: copiedReply._id, groupWithThreadId: tabId });
    expect((await readFork(t, secondTabId)).thread?.title).toBe("Forked from: Fix the bug");
  });

  test("groupWithThreadId on a grouped thread joins its container, even when branching an ancestor's run", async () => {
    const { asUser, parent, reply2 } = await seedTwoRunThread();
    const first = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id, groupWithThreadId: parent._id });

    // A history row on the fork names the parent's message; the tab still goes next to the fork.
    const second = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id, groupWithThreadId: first.threadId });

    expect(second.containerId).toBe(first.containerId);
  });

  test("rejects a groupWithThreadId the fork cannot join", async () => {
    const { ctx, user, project, asUser, t, profile, reply2 } = await seedTwoRunThread();
    const fork = (groupWithThreadId: Id<"cliThreads">) =>
      asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id, groupWithThreadId });

    const stranger = await ctx.user();
    await ctx.projectMember(project._id, stranger._id, "member");
    const strangerProfile = await ctx.cliProfile(stranger._id, project._id);
    const foreign = await ctx.cliThread(stranger._id, project._id, strangerProfile._id, { status: "completed" });
    await expect(fork(foreign._id)).rejects.toThrow("Not authorized");

    const deleted = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed", isDeleted: true });
    await expect(fork(deleted._id)).rejects.toThrow("Thread not found");

    const otherProject = await ctx.project(project.organizationId, user._id);
    const otherProfile = await ctx.cliProfile(user._id, otherProject._id);
    const elsewhere = await ctx.cliThread(user._id, otherProject._id, otherProfile._id, { status: "completed" });
    await expect(fork(elsewhere._id)).rejects.toThrow(errors.FORK_GROUP_CROSS_PROJECT);

    const container = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", status: "completed" });
    await expect(fork(container._id)).rejects.toThrow(errors.FORK_GROUP_TARGET_IS_CONTAINER);

    const child = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed", parentThreadId: container._id });
    await t.run(async (runCtx) => {
      for (let i = 0; i < MAX_GROUP_CHILDREN - 1; i++) {
        await buildCliThread(runCtx.db, user._id, project._id, profile._id, { status: "completed", parentThreadId: container._id });
      }
    });
    await expect(fork(child._id)).rejects.toThrow(`A thread group can contain at most ${MAX_GROUP_CHILDREN} threads`);
  });

  test("branches a runtime-command run such as /compact from its compacted session (OS-2337)", async () => {
    for (const cliType of ["claude-code", "codex"] as const) {
      const { asUser, t, user2, reply2 } = await seedTwoRunThread({ cliType });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessages", user2._id, { runtimeCommand: true });
        await runCtx.db.patch("cliMessages", reply2._id, { cliContext: { continuationId: "session-compacted", turnId: "turn-compact" } });
      });

      const { threadId: forkId } = await asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id });
      expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: forkId })).toMatchObject({
        continuationId: "session-compacted",
      });
    }
  });

  test("rejects runs that cannot be branched", async () => {
    const codex = await seedTwoRunThread({ cliType: "codex" });
    await expect(codex.asUser.mutation(api.cli.threads.core.fork, { messageId: codex.reply2._id })).rejects.toThrow(
      errors.FORK_RUNTIME_UNSUPPORTED
    );

    // An unsupported runtime is the more specific error, even for a message that never ran.
    const cursor = await seedTwoRunThread({ cliType: "cursor" });
    const cursorQueued = await cursor.ctx.cliMessage(cursor.parent._id, cursor.profile._id, { role: "user", content: [], nextChunkOrder: 0 });
    await expect(cursor.asUser.mutation(api.cli.threads.core.fork, { messageId: cursorQueued._id })).rejects.toThrow(
      errors.FORK_RUNTIME_UNSUPPORTED
    );

    const { ctx, asUser, t, profile, parent, reply2, user2 } = await seedTwoRunThread();
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessages", reply2._id, { status: "streaming" });
    });
    await expect(asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id })).rejects.toThrow(
      errors.FORK_RUN_NOT_RESUMABLE
    );
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessages", reply2._id, { status: "failed", cliContext: undefined });
    });
    await expect(asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id })).rejects.toThrow(
      errors.FORK_RUN_NOT_RESUMABLE
    );
    await t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessages", reply2._id, { status: "completed", cliContext: { continuationId: "session-2" } });
      await runCtx.db.patch("cliMessages", user2._id, { scriptRequest: { script: "pnpm lint", timeoutMs: 60_000 } });
    });
    await expect(asUser.mutation(api.cli.threads.core.fork, { messageId: reply2._id })).rejects.toThrow(
      errors.FORK_RUN_IS_SCRIPT
    );

    const queued = await ctx.cliMessage(parent._id, profile._id, { role: "user", content: [], nextChunkOrder: 0, status: "pending" });
    await expect(asUser.mutation(api.cli.threads.core.fork, { messageId: queued._id })).rejects.toThrow(
      errors.FORK_RUN_NOT_RESUMABLE
    );

    const stranger = await ctx.user();
    await ctx.projectMember(parent.projectId, stranger._id, "member");
    await expect(ctx.asUser(stranger).mutation(api.cli.threads.core.fork, { messageId: reply2._id })).rejects.toThrow(
      "Not authorized"
    );
  });
});

async function readThreadAttachedLogs(t: ReturnType<typeof createTestContext>["t"], taskId: Id<"tasks">) {
  const logs = await t.run((dbCtx) =>
    dbCtx.db.query("taskActivityLogs").withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId)).collect()
  );
  return logs.filter((log) => log.eventType === "thread_attached");
}

describe("attachTask (OS-1713)", () => {
  test("API key attaches a task to a task-less thread and mirrors it onto the task", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { status: "streaming" });
    const task = await ctx.task(project._id, user._id);
    const { key } = await asUser.mutation(api.apiKeys.core.create, { name: "CLI", expiresAt: Date.now() + 60_000 });

    await t.mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: task._id, apiKey: key });

    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id)))?.associatedTaskId).toBe(task._id);
    const updated = await t.run((dbCtx) => dbCtx.db.get("tasks", task._id));
    expect(updated?.agentThreadWork).toEqual([
      expect.objectContaining({ threadId: thread._id, source: "manual_attachment", status: "streaming", createdAt: thread.createdAt }),
    ]);
  });

  test("a group member's attach moves the group's task chip", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const group = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", childCount: 1 });
    const child = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: group._id });
    await t.run((dbCtx) => dbCtx.db.patch("cliThreads", group._id, { originThreadId: child._id }));
    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.cli.threads.core.attachTask, { threadId: child._id, taskId: task._id });

    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", group._id)))?.originTaskId).toBe(task._id);
  });

  test("logs one thread_attached row stamped at attach time; a retry adds none", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { title: "Spike", createdAt: 1 });
    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: task._id });
    await asUser.mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: task._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const logs = await readThreadAttachedLogs(t, task._id);
    expect(logs).toEqual([
      expect.objectContaining({
        userId: user._id,
        changeDetails: { type: "thread", threadId: thread._id, threadTitle: "Spike" },
      }),
    ]);
    expect(logs[0]!.createdAt).toBeGreaterThan(thread.createdAt);
  });

  test("re-attaching the same task writes nothing, even after the task is deleted", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const task = await ctx.task(project._id, user._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { associatedTaskId: task._id });
    await t.run((dbCtx) => dbCtx.db.patch("tasks", task._id, { isDeleted: true }));

    await asUser.mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: task._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.run((dbCtx) => dbCtx.db.get("tasks", task._id)))?.agentThreadWork).toBeUndefined();
    expect(await readThreadAttachedLogs(t, task._id)).toEqual([]);
  });

  test("denies a key scoped away from the thread's project", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const task = await ctx.task(project._id, user._id);
    const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Other-org key",
      expiresAt: Date.now() + 60_000,
      scope: { organizationId: otherOrg._id, projectIds: [] },
    });

    await expect(t.mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: task._id, apiKey: key }))
      .rejects.toThrow("Permission denied");
    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id)))?.associatedTaskId).toBeUndefined();
  });

  test("rejects a thread already attached to another task", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const first = await ctx.task(project._id, user._id);
    const second = await ctx.task(project._id, user._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { associatedTaskId: first._id });
    await expect(asUser.mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: second._id }))
      .rejects.toThrow(errors.THREAD_TASK_ALREADY_ATTACHED);
    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id)))?.associatedTaskId).toBe(first._id);
  });

  test("rejects a group container", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const group = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", childCount: 1 });
    const task = await ctx.task(project._id, user._id);
    await expect(asUser.mutation(api.cli.threads.core.attachTask, { threadId: group._id, taskId: task._id }))
      .rejects.toThrow(errors.ATTACH_TASK_TO_CONTAINER);
  });

  test("rejects a task from another project", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const otherProject = await ctx.project(org._id, user._id, { alias: "OTH" });
    const task = await ctx.task(otherProject._id, user._id);
    await expect(asUser.mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: task._id }))
      .rejects.toThrow("Task not found");
  });

  test("rejects non-owners", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { sharedAt: Date.now() });
    const task = await ctx.task(project._id, user._id);
    const other = await ctx.user();
    await ctx.projectMember(project._id, other._id, "member");
    await expect(ctx.asUser(other).mutation(api.cli.threads.core.attachTask, { threadId: thread._id, taskId: task._id }))
      .rejects.toThrow("Not authorized");
  });
});

describe("attached pull requests (docs/specs/github-integration.md → Pull requests in threads)", () => {
  const PR_482 = "https://github.com/Contoso/Convoy/pull/482";
  const PR_475 = "https://github.com/contoso/convoy/pull/475";
  const ATTACHED_482 = { owner: "Contoso", name: "Convoy", number: 482, ref: "contoso/convoy#482" };

  async function setup() {
    const ctx = createTestContext();
    const project = await ctx.setupProject();
    const profile = await ctx.cliProfile(project.user._id, project.project._id, { paths: [{ id: "repo", path: "/repo", label: "repo" }] });
    return { ctx, ...project, profile };
  }

  test("create stores the PR on the first message and the thread, and a PR alone is a message", async () => {
    const { asUser, t, profile } = await setup();
    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id, pathId: "repo", cliType: "codex", content: "", pullRequestUrl: PR_482,
    });

    const created = await asUser.query(api.cli.threads.core.get, { threadId });
    expect(created?.attachedPullRequest).toEqual(ATTACHED_482);
    expect(created?.title).toBe("Contoso/Convoy#482");
    const messages = await asUser.query(api.cli.messages.listUnprocessedUserMessages, { threadId });
    expect(messages.map((message) => message.pullRequest)).toEqual([ATTACHED_482]);
    const thread = await t.run((dbCtx) => dbCtx.db.get("cliThreads", threadId));
    expect(thread?.attachedPullRequest).toEqual(ATTACHED_482);
  });

  test("send carries the PR on its message; the thread keeps the first one", async () => {
    const { asUser, profile } = await setup();
    const threadId = await asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id, pathId: "repo", cliType: "codex", content: "Hello",
    });

    await asUser.mutation(api.cli.messages.send, { threadId, content: "Review", pullRequestUrl: PR_482 });
    await asUser.mutation(api.cli.messages.send, { threadId, content: "And this", pullRequestUrl: PR_475 });

    expect((await asUser.query(api.cli.threads.core.get, { threadId }))?.attachedPullRequest).toEqual(ATTACHED_482);
    const messages = await asUser.query(api.cli.messages.listUnprocessedUserMessages, { threadId });
    expect(messages.map((message) => message.pullRequest?.ref)).toEqual([undefined, "contoso/convoy#482", "contoso/convoy#475"]);
  });

  test("rejects a URL that is not a github.com pull request", async () => {
    const { asUser, profile } = await setup();
    await expect(asUser.mutation(api.cli.threads.core.create, {
      profileId: profile._id, pathId: "repo", cliType: "codex", content: "Hi", pullRequestUrl: "https://github.com/contoso/convoy/issues/9",
    })).rejects.toThrow(errors.PULL_REQUEST_URL_INVALID);
  });

  test("attachPullRequest fills an empty slot once; the same PR again is a no-op", async () => {
    const { ctx, user, project, asUser, t } = await setup();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const { key } = await asUser.mutation(api.apiKeys.core.create, { name: "CLI", expiresAt: Date.now() + 60_000 });

    await t.mutation(api.cli.threads.core.attachPullRequest, { threadId: thread._id, pullRequest: PR_482, apiKey: key });
    await asUser.mutation(api.cli.threads.core.attachPullRequest, { threadId: thread._id, pullRequest: "contoso/convoy#482" });
    await expect(asUser.mutation(api.cli.threads.core.attachPullRequest, { threadId: thread._id, pullRequest: PR_475 }))
      .rejects.toThrow(errors.THREAD_PULL_REQUEST_ALREADY_ATTACHED);

    expect((await t.run((dbCtx) => dbCtx.db.get("cliThreads", thread._id)))?.attachedPullRequest).toEqual(ATTACHED_482);
  });

  test("attachPullRequest returns the PR reader link to send in messages (docs/specs/cli-thread-message-links.md)", async () => {
    const { ctx, user, org, project, asUser } = await setup();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);

    const result = await asUser.mutation(api.cli.threads.core.attachPullRequest, { threadId: thread._id, pullRequest: "Contoso/Convoy#482" });
    expect(result).toEqual({
      url: `${getAppUrlBase()}/o/${org.slug}/${project.alias}/pull-requests?repo=Contoso%2FConvoy&pr=482`,
    });
  });

  test("attachPullRequest rejects containers and non-owners", async () => {
    const { ctx, user, project, asUser } = await setup();
    const profile = await ctx.cliProfile(user._id, project._id);
    const group = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", childCount: 1 });
    const shared = await ctx.cliThread(user._id, project._id, profile._id, { sharedAt: Date.now() });
    const other = await ctx.user();
    await ctx.projectMember(project._id, other._id, "member");

    await expect(asUser.mutation(api.cli.threads.core.attachPullRequest, { threadId: group._id, pullRequest: PR_482 }))
      .rejects.toThrow(errors.ATTACH_PULL_REQUEST_TO_CONTAINER);
    await expect(ctx.asUser(other).mutation(api.cli.threads.core.attachPullRequest, { threadId: shared._id, pullRequest: PR_482 }))
      .rejects.toThrow("Not authorized");
  });
});
