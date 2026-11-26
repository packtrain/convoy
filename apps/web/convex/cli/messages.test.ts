import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { errors } from "./errors";
import { createTestContext, type TestContext } from "../../convex-testing";
import { STRANDED_ASSISTANT_SCAN_LIMIT } from "./lib/cliMessagesRepo";
import { CHUNK_DELETE_BATCH_SIZE } from "./lib/chunks/lifecycle";
import { ENVELOPE_WINDOW_LIMIT, PENDING_UPLOAD_RETENTION_MS } from "./lib/constants";
import { MAX_ATTACHMENT_CAPTION_LENGTH } from "../lib/constants";

/**
 * The live chunk cursor: on the head row while a run streams, back on the
 * envelope once it settles (OS-1729).
 */
async function readChunkCursor(t: TestContext["t"], messageId: Id<"cliMessages">): Promise<number | undefined> {
  return t.run(async (runCtx) => {
    const head = await runCtx.db
      .query("cliMessageStreamHeads")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .first();
    return head?.nextChunkOrder ?? (await runCtx.db.get("cliMessages", messageId))?.nextChunkOrder;
  });
}

describe("cliMessages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("does not expose batch-named run mutations", async () => {
    const ctx = createTestContext();
    const startBatchResponse = makeFunctionReference<"mutation">(
      "cli/messages:startBatchResponse"
    );
    const appendBatchContent = makeFunctionReference<"mutation">(
      "cli/messages:appendBatchContent"
    );

    await expect(ctx.t.mutation(startBatchResponse, {})).rejects.toThrow(
      /no such export/
    );
    await expect(ctx.t.mutation(appendBatchContent, {})).rejects.toThrow(
      /no such export/
    );
  });

  describe("send", () => {
    test("should create only user message and mark chat pending", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Hello, world!",
      });

      expect(userMessageId).toBeDefined();

      await t.run(async (runCtx) => {
        // Check user message
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.role).toBe("user");
        expect(userMessage?.status).toBe("completed");
        expect(userMessage?.content).toEqual([]);
        expect(userMessage?.nextChunkOrder).toBe(1);

        const chunkRows = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", userMessageId))
          .order("asc")
          .collect();
        expect(chunkRows).toHaveLength(1);
        expect(chunkRows[0]?.type).toBe("text");
        expect(chunkRows[0]?.data).toBe("Hello, world!");

        const messages = await runCtx.db
          .query("cliMessages")
          .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", chat._id))
          .collect();

        expect(messages).toHaveLength(1);
        expect(messages[0]?._id).toBe(userMessageId);

        // Check chat status updated
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("pending");
        expect(updatedChat?.hasPendingUserMessages).toBe(true);
        expect(updatedChat?.processingState).toBe("idle");
      });
    });

    test("reopens a done thread and its group (OS-2176)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const group = await ctx.cliThread(user._id, project._id, profile._id, { kind: "group", status: "completed", childCount: 1 });
      const child = await ctx.cliThread(user._id, project._id, profile._id, { parentThreadId: group._id, status: "completed" });
      await asUser.mutation(api.cli.threads.core.markDone, { threadId: group._id });

      await asUser.mutation(api.cli.messages.send, { threadId: child._id, content: "one more thing" });

      const docs = await t.run((runCtx) => Promise.all([group._id, child._id].map((id) => runCtx.db.get("cliThreads", id))));
      expect(docs.map((doc) => doc?.statusProjection?.isDone)).toEqual([false, false]);
    });

    test("rejects sending a message to a group container (OS-1476)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const container = await ctx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: container._id,
          content: "Hello?",
        })
      ).rejects.toThrow("Groups and workflow runs cannot receive messages");

      await t.run(async (runCtx) => {
        const doc = await runCtx.db.get("cliThreads", container._id);
        expect(doc?.hasPendingUserMessages).toBeFalsy();
      });
    });

    test("should store cliMode on user message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Plan this",
        cliMode: "plan",
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.cliMode).toBe("plan");

        const messages = await runCtx.db
          .query("cliMessages")
          .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", chat._id))
          .collect();

        expect(messages).toHaveLength(1);
      });
    });

    test("listUnprocessedUserMessages returns processed slash command content", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        key: "client-summary",
        content: "Summarize the client context.",
        autoExpand: false,
      });

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
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
        const chunkRows = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
            q.eq("threadId", chat._id).eq("messageId", userMessageId)
          )
          .collect();
        expect(chunkRows[0]?.data).toBe(
          "Please ignore /client-summary and use [/client-summary](convoy://command/org:client-summary)"
        );
      });

      const messages = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
        threadId: chat._id,
      });
      expect(messages[0]?.content[0]?.data).toBe(
        "Please ignore /client-summary and use Summarize the client context."
      );
    });

    test("project slash command refs expand only in their owning project", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const slashCommandId = await asUser.mutation(api.slashCommands.core.createInProject, {
        projectId: project._id,
        key: "client-summary",
        content: "Summarize this project's client context.",
      });

      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Use [/client-summary](convoy://command/project:client-summary)",
        composerDocument: {
          version: 1,
          refs: [
            {
              type: "slash-command",
              id: slashCommandId,
              scope: "project",
              key: "client-summary",
              canonicalKey: "project:client-summary",
              displayLabel: "/client-summary",
            },
          ],
        },
      });

      const messages = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
        threadId: chat._id,
      });
      expect(messages[0]?.content[0]?.data).toBe("Use Summarize this project's client context.");

      const otherProject = await ctx.project(org._id, user._id, { alias: "P02" });
      const otherProfile = await ctx.cliProfile(user._id, otherProject._id);
      const otherChat = await ctx.cliThread(user._id, otherProject._id, otherProfile._id);
      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: otherChat._id,
          content: "Use [/client-summary](convoy://command/project:client-summary)",
          composerDocument: {
            version: 1,
            refs: [
              {
                type: "slash-command",
                id: slashCommandId,
                scope: "project",
                key: "client-summary",
                canonicalKey: "project:client-summary",
                displayLabel: "/client-summary",
              },
            ],
          },
        })
      ).rejects.toThrow("Slash command not found");
    });

    // OS-1784: a Skill mention names the Skill and lets the agent load it, so the
    // body must never reach the message (docs/specs/skills.md#composer-mentions).
    test("skill refs resolve to a load_skill directive without the skill body", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const skillId = await asUser.mutation(api.skills.core.createInProject, {
        projectId: project._id,
        name: "pdf-tools",
        content: "# PDF tools\n\nFill and read PDF forms.",
      });

      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Use [/pdf-tools](convoy://skill/pdf-tools) on the invoice",
        composerDocument: {
          version: 1,
          refs: [
            {
              type: "skill",
              id: skillId,
              scope: "skill",
              key: "pdf-tools",
              canonicalKey: "skill:pdf-tools",
              displayLabel: "/pdf-tools",
            },
          ],
        },
      });

      const messages = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
        threadId: chat._id,
      });
      // A noun phrase, so it reads correctly wherever the pill sat.
      expect(messages[0]?.content[0]?.data).toBe(
        "Use the `pdf-tools` skill (load it with load_skill before acting) on the invoice"
      );
      expect(messages[0]?.content[0]?.data).not.toContain("Fill and read PDF forms.");
    });

    test("a mention of a deleted skill is rejected", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const skillId = await asUser.mutation(api.skills.core.createInProject, {
        projectId: project._id,
        name: "pdf-tools",
        content: "# PDF tools",
      });
      await asUser.mutation(api.skills.core.deleteSkill, { skillId });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "Use [/pdf-tools](convoy://skill/pdf-tools)",
          composerDocument: {
            version: 1,
            refs: [
              {
                type: "skill",
                id: skillId,
                scope: "skill",
                key: "pdf-tools",
                canonicalKey: "skill:pdf-tools",
                displayLabel: "/pdf-tools",
              },
            ],
          },
        })
      ).rejects.toThrow("Skill not found");
    });

    // The link is searched for as the stored record spells it, so a ref cannot
    // show one name to thread readers and point the agent at another.
    test("a skill ref whose display label disagrees with the skill is rejected", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const skillId = await asUser.mutation(api.skills.core.createInProject, {
        projectId: project._id,
        name: "pdf-tools",
        content: "# PDF tools",
      });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "Use [/review](convoy://skill/pdf-tools)",
          composerDocument: {
            version: 1,
            refs: [
              {
                type: "skill",
                id: skillId,
                scope: "skill",
                key: "pdf-tools",
                canonicalKey: "skill:pdf-tools",
                displayLabel: "/review",
              },
            ],
          },
        })
      ).rejects.toThrow("Skill not found");
    });

    test("a slash command ref whose display label disagrees with the command is rejected", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        key: "client-summary",
        content: "Summarize the client context.",
      });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "Use [/review](convoy://command/org:client-summary)",
          composerDocument: {
            version: 1,
            refs: [
              {
                type: "slash-command",
                id: slashCommandId,
                scope: "organization",
                key: "client-summary",
                canonicalKey: "org:client-summary",
                displayLabel: "/review",
              },
            ],
          },
        })
      ).rejects.toThrow("Slash command not found");
    });

    test("skill refs from another project are rejected", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser } = await ctx.setupProject();
      const skillId = await asUser.mutation(api.skills.core.createInProject, {
        projectId: project._id,
        name: "pdf-tools",
        content: "# PDF tools",
      });

      const otherProject = await ctx.project(org._id, user._id, { alias: "P02" });
      const otherProfile = await ctx.cliProfile(user._id, otherProject._id);
      const otherChat = await ctx.cliThread(user._id, otherProject._id, otherProfile._id);

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: otherChat._id,
          content: "Use [/pdf-tools](convoy://skill/pdf-tools)",
          composerDocument: {
            version: 1,
            refs: [
              {
                type: "skill",
                id: skillId,
                scope: "skill",
                key: "pdf-tools",
                canonicalKey: "skill:pdf-tools",
                displayLabel: "/pdf-tools",
              },
            ],
          },
        })
      ).rejects.toThrow("Skill not found");
    });

    test("slash command refs require the exact display markdown link", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const slashCommandId = await asUser.mutation(api.slashCommands.core.createInOrganization, {
        organizationId: org._id,
        key: "client-summary",
        content: "Summarize the client context.",
        autoExpand: false,
      });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "Please use /client-summary",
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
        })
      ).rejects.toThrow("Slash command not found");
    });

    test("should store cliModel on user message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Use Opus",
        cliMode: "agent",
        cliModel: "opus",
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.cliModel).toBe("opus");
      });
    });

    test("strips cliModel for non-Claude threads", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        cliType: "codex",
      });

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Use Opus",
        cliMode: "agent",
        cliModel: "opus",
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.cliModel).toBeUndefined();
      });
    });

    test("strips invalid cliModel values for Claude threads", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Use unknown model",
        cliMode: "agent",
        cliModel: "not-real",
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.cliModel).toBeUndefined();
      });
    });

    test("should allow cliMode to be undefined on send", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Hello",
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.cliMode).toBeUndefined();
      });
    });

    test("should throw for deleted chat", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        isDeleted: true,
      });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "Hello",
        })
      ).rejects.toThrow("Thread not found");
    });

    test("should require project access", async () => {
      const ctx = createTestContext();
      const { user, project } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const { asUser: asOtherUser } = await ctx.setupUser();

      await expect(
        asOtherUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "Hello",
        })
      ).rejects.toThrow();
    });

    test("persists attachments and creates attachment refs", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["image"]));
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        attachments: [
          {
            storageId,
            fileName: "screenshot.png",
            fileSize: 5,
            contentType: "image/png",
          },
        ],
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.attachments).toHaveLength(1);
        expect(userMessage?.attachments?.[0]?.fileName).toBe("screenshot.png");
        expect(userMessage?.attachments?.[0]?.uploadedAt).toBeTypeOf("number");

        const refs = await runCtx.db
          .query("cliMessageAttachmentRefs")
          .withIndex("by_messageId", (q) => q.eq("messageId", userMessageId))
          .collect();
        expect(refs).toHaveLength(1);
        expect(refs[0]?.storageId).toBe(storageId);
      });
    });

    test("accepts task-only send, stores taskId, and sets associatedTaskId when missing", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const task = await ctx.task(project._id, user._id, {
        name: "Attach this task",
      });

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        taskId: task._id,
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.taskId).toBe(task._id);
        expect(userMessage?.attachments).toEqual([]);

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.associatedTaskId).toBe(task._id);
      });
    });

    test("does not overwrite an existing associatedTaskId", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const existingTask = await ctx.task(project._id, user._id, {
        name: "Original task",
      });
      const newTask = await ctx.task(project._id, user._id, {
        name: "Later task",
      });
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        associatedTaskId: existingTask._id,
      });

      const userMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        taskId: newTask._id,
      });

      await t.run(async (runCtx) => {
        const userMessage = await runCtx.db.get("cliMessages", userMessageId);
        expect(userMessage?.taskId).toBe(newTask._id);

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.associatedTaskId).toBe(existingTask._id);
      });
    });

    test("rejects inaccessible, missing, deleted, and cross-project task ids", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const { user: otherUser, project: otherProject } = await ctx.setupProject();
      const inaccessibleTask = await ctx.task(otherProject._id, otherUser._id, {
        name: "Hidden task",
      });
      const crossProject = await ctx.project(org._id, user._id, {
        alias: "CRS",
        name: "Cross Project",
      });
      const crossProjectTask = await ctx.task(crossProject._id, user._id, {
        name: "Cross project task",
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

      for (const taskId of [inaccessibleTask._id, crossProjectTask._id, missingTask._id, deletedTask._id]) {
        await expect(
          asUser.mutation(api.cli.messages.send, {
            threadId: chat._id,
            content: "",
            taskId,
          })
        ).rejects.toThrow("Task not found");
      }
    });

    test("rejects attachment file names with path segments (OS-1902)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["file"]));
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "",
          attachments: [{ storageId, fileName: "../outside.txt", fileSize: 4, contentType: "text/plain" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_FILE_NAME_INVALID);
    });

    test("enforces maximum 10 attachments per message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const storageIds: Id<"_storage">[] = [];

      await t.run(async (runCtx) => {
        for (let index = 0; index < 11; index += 1) {
          storageIds.push(await runCtx.storage.store(new Blob([`file-${index}`])));
        }
      });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "",
          attachments: storageIds.map((storageId, index) => ({
            storageId,
            fileName: `file-${index}.txt`,
            fileSize: 6,
            contentType: "text/plain",
          })),
        })
      ).rejects.toThrow("A message can include at most 10 attachments");
    });
  });

  describe("API key auth and sentBy on send (OS-1162)", () => {
    const apiKeyFor = async (
      asUser: Awaited<ReturnType<TestContext["setupProject"]>>["asUser"],
      scope?: { organizationId: Id<"organizations">; projectIds: Id<"projects">[] }
    ) => {
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: scope ? "Other-org key" : "MCP Threads",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        ...(scope ? { scope } : {}),
      });
      return key;
    };

    test("queues a message with a valid API key and no Clerk identity", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const apiKey = await apiKeyFor(asUser);

      const messageId = await t.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "From an agent",
        apiKey,
      });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", messageId);
        expect(message?.role).toBe("user");
        expect(message?.processedAt).toBeUndefined();
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.hasPendingUserMessages).toBe(true);
        expect(thread?.status).toBe("pending");
      });
    });

    test("denies a key scoped to another organization", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      // A key the caller is entitled to hold, scoped away from this project:
      // the credential boundary must be applied, not merely resolved. Passing
      // `user._id` instead of `principal` would let this through.
      const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
      const apiKey = await apiKeyFor(asUser, { organizationId: otherOrg._id, projectIds: [] });

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "From an agent",
          apiKey,
        })
      ).rejects.toThrow("Permission denied");
    });

    test("round-trips sentBy onto the message and its envelope", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const sender = await ctx.cliThread(user._id, project._id, profile._id);
      const apiKey = await apiKeyFor(asUser);

      const messageId = await t.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Spawned agent reporting back",
        sentBy: { kind: "thread", threadId: sender._id },
        apiKey,
      });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", messageId);
        expect(message?.sentBy).toEqual({ kind: "thread", threadId: sender._id });
      });

      const { envelopes } = await asUser.query(api.cli.messages.listEnvelopesByThread, {
        threadId: chat._id,
      });
      expect(envelopes.find((envelope) => envelope._id === messageId)?.sentBy).toEqual({
        kind: "thread",
        threadId: sender._id,
      });
    });

    test("omits sentBy for a composer send, keeping absence as 'a human sent it'", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const messageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Typed by a person",
      });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", messageId))?.sentBy).toBeUndefined();
      });
    });

    test("still rejects a container on the API key path", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      // The shared claim gate cannot cover `send` — it needs a `sessionId` and
      // only guards paths that advance a claimed run. `isContainerThread` is
      // this mutation's own invariant, and it must hold for the agent caller.
      const container = await ctx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });
      const apiKey = await apiKeyFor(asUser);

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: container._id,
          content: "Hello?",
          apiKey,
        })
      ).rejects.toThrow("Groups and workflow runs cannot receive messages");

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliThreads", container._id))?.hasPendingUserMessages).toBeFalsy();
      });
    });

    test("does not post to another user's thread", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const other = await ctx.user();
      const theirThread = await ctx.cliThread(other._id, project._id, profile._id);
      const apiKey = await apiKeyFor(asUser);

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: theirThread._id,
          content: "From an agent",
          apiKey,
        })
      ).rejects.toThrow("Not authorized");
    });

    test("queues for the next run when the target is mid-stream", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        processingState: "streaming",
        status: "streaming",
      });
      const apiKey = await apiKeyFor(asUser);

      const messageId = await t.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Follow-up while it runs",
        apiKey,
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", messageId)).not.toBeNull();
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.hasPendingUserMessages).toBe(true);
        // A running thread keeps its streaming status: the queued message is
        // picked up by the next run instead of erroring.
        expect(thread?.status).toBe("streaming");
      });
    });

    // The source's errors are its own: over MCP both ids are arguments, so the
    // target's "Thread not found" would send an agent chasing a healthy target.
    test("rejects a sentBy naming another user's thread (OS-1630)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const other = await ctx.user();
      const theirThread = await ctx.cliThread(other._id, project._id, profile._id);
      const apiKey = await apiKeyFor(asUser);

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: thread._id,
          content: "Reporting back",
          sentBy: { kind: "thread", threadId: theirThread._id },
          apiKey,
        })
      ).rejects.toThrow("Source thread not found");

      // Nothing was written: the badge target is validated before the insert.
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliThreads", thread._id))?.hasPendingUserMessages).toBeFalsy();
      });
    });

    test("rejects a sentBy naming a deleted thread (OS-1630)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const sender = await ctx.cliThread(user._id, project._id, profile._id, { isDeleted: true });
      const apiKey = await apiKeyFor(asUser);

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: thread._id,
          content: "Reporting back",
          sentBy: { kind: "thread", threadId: sender._id },
          apiKey,
        })
      ).rejects.toThrow("Source thread not found");
    });

    /**
     * A key scoped to project A must not write a project B thread's id into an A
     * message, nor learn B's liveness from the error channel. One
     * `requireAuthorizedProject` covers both threads only because they share a project.
     */
    test("rejects a sentBy from another project, which a scoped key cannot read (OS-1630)", async () => {
      const ctx = createTestContext();
      const { user, project: projectA, org, asUser, t } = await ctx.setupProject();
      const projectB = await ctx.project(org._id, user._id, { name: "B", alias: "prj-b" });
      const profileA = await ctx.cliProfile(user._id, projectA._id);
      const profileB = await ctx.cliProfile(user._id, projectB._id);
      const threadA = await ctx.cliThread(user._id, projectA._id, profileA._id);
      const threadB = await ctx.cliThread(user._id, projectB._id, profileB._id);
      const apiKey = await apiKeyFor(asUser, {
        organizationId: org._id,
        projectIds: [projectA._id],
      });

      // The premise: this key cannot read thread B at all.
      expect(
        await t.query(api.cli.threads.summaries.getSummary, { threadId: threadB._id, apiKey })
      ).toBeNull();

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: threadA._id,
          content: "Cross-project provenance",
          sentBy: { kind: "thread", threadId: threadB._id },
          apiKey,
        })
      ).rejects.toThrow("another project");
    });

    // A container never runs an agent, so it cannot be the thread that spoke —
    // `addThreadToGroup` refuses one as lineage for the same reason.
    test("rejects a container as the sentBy source (OS-1630)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);

      const container = await ctx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });
      const apiKey = await apiKeyFor(asUser);

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: thread._id,
          content: "From a container?",
          sentBy: { kind: "thread", threadId: container._id },
          apiKey,
        })
      ).rejects.toThrow("cannot send messages");
    });

    test("rejects a sentBy naming the target thread itself (OS-1890)", async () => {
      // A self-send lands as a fresh user turn on the sender's own thread, which the
      // next run answers with another self-send: an unbounded loop until Stop.
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const apiKey = await apiKeyFor(asUser);

      await expect(
        t.mutation(api.cli.messages.send, {
          threadId: thread._id,
          content: "Hey! I'm here and ready to help.",
          sentBy: { kind: "thread", threadId: thread._id },
          apiKey,
        })
      ).rejects.toThrow("its own thread");
    });
  });

  describe("listEnvelopesByThread", () => {
    test("caps the window at the newest ENVELOPE_WINDOW_LIMIT messages and flags older history", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const total = ENVELOPE_WINDOW_LIMIT + 25;
      const createdIds: Id<"cliMessages">[] = [];
      for (let index = 0; index < total; index += 1) {
        const message = await ctx.cliMessage(chat._id, profile._id, {
          role: "user",
          createdAt: 1_000 + index,
        });
        createdIds.push(message._id);
      }

      const result = await asUser.query(api.cli.messages.listEnvelopesByThread, {
        threadId: chat._id,
      });

      expect(result.envelopes).toHaveLength(ENVELOPE_WINDOW_LIMIT);
      expect(result.hasOlderEnvelopes).toBe(true);
      // Newest-first, anchored at the newest message.
      expect(result.envelopes[0]._id).toBe(createdIds[total - 1]);
      expect(result.envelopes.at(-1)?._id).toBe(
        createdIds[total - ENVELOPE_WINDOW_LIMIT]
      );
      // Nothing older than the window leaks in.
      const windowIds = new Set(result.envelopes.map((envelope) => envelope._id));
      expect(windowIds.has(createdIds[0])).toBe(false);
    });

    test("reports no older history for a thread inside the window", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await ctx.cliMessage(chat._id, profile._id, { role: "user" });

      const result = await asUser.query(api.cli.messages.listEnvelopesByThread, {
        threadId: chat._id,
      });

      expect(result.envelopes).toHaveLength(1);
      expect(result.hasOlderEnvelopes).toBe(false);
    });

    test("an image's dimensions ride the envelope and the url read", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["image"]));
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });
      const dimensions = { width: 800, height: 400 };

      const messageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        attachments: [{ storageId, fileName: "shot.png", fileSize: 5, contentType: "image/png", dimensions }],
      });

      const { envelopes } = await asUser.query(api.cli.messages.listEnvelopesByThread, { threadId: chat._id });
      expect(envelopes[0]?.attachments[0]?.dimensions).toEqual(dimensions);
      const resolved = await asUser.query(api.cli.messages.getMessageAttachmentUrls, { messageId });
      expect(resolved[0]?.dimensions).toEqual(dimensions);
    });

    test("ships attachment metadata without resolving signed urls", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["hello"]));
      });

      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        attachments: [
          {
            storageId,
            fileName: "notes.txt",
            fileSize: 5,
            contentType: "text/plain",
            uploadedAt: Date.now(),
          },
        ],
      });

      const { envelopes } = await asUser.query(
        api.cli.messages.listEnvelopesByThread,
        { threadId: chat._id }
      );

      const attachment = envelopes[0].attachments[0];
      expect(attachment.fileName).toBe("notes.txt");
      expect(attachment).not.toHaveProperty("url");

      // The URL is served by the lazy query instead.
      const resolved = await asUser.query(
        api.cli.messages.getMessageAttachmentUrls,
        { messageId: message._id }
      );
      expect(resolved[0].storageId).toBe(storageId);
      expect(resolved[0].url).toBeTruthy();
    });

    test("the envelope carries the sender of an agent-sent message (OS-1162)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const sender = await ctx.cliThread(user._id, project._id, profile._id);

      const fromAgent = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        createdAt: 2_000,
        sentBy: { kind: "thread", threadId: sender._id },
      });
      const fromHuman = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        createdAt: 1_000,
      });

      const { envelopes } = await asUser.query(
        api.cli.messages.listEnvelopesByThread,
        { threadId: chat._id }
      );

      const byId = new Map(envelopes.map((envelope) => [envelope._id, envelope]));
      expect(byId.get(fromAgent._id)?.sentBy).toEqual({
        kind: "thread",
        threadId: sender._id,
      });
      // Absence is the pre-existing "a human sent it" meaning — no backfill.
      expect(byId.get(fromHuman._id)?.sentBy).toBeUndefined();
    });

    test("compacts the run diff summary into totals plus a preview slice", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "completed",
      });

      const files = Array.from({ length: 40 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        kind: "modified" as const,
        additions: 2,
        deletions: 1,
      }));
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessages", message._id, {
          diffSummary: {
            preRef: "refs/pre",
            postRef: "refs/post",
            files,
          },
        });
      });

      const { envelopes } = await asUser.query(
        api.cli.messages.listEnvelopesByThread,
        { threadId: chat._id }
      );

      const preview = envelopes[0].diffSummary;
      expect(preview?.fileCount).toBe(40);
      // Roll-up totals cover every file, not just the previewed rows.
      expect(preview?.additions).toBe(80);
      expect(preview?.deletions).toBe(40);
      expect(preview?.files.length).toBeLessThan(40);
      expect(preview?.files[0].path).toBe("src/file-0.ts");

      const full = await asUser.query(api.cli.messages.getRunDiffSummary, {
        messageId: message._id,
      });
      expect(full?.files).toHaveLength(40);
    });

    test("denies the lazy readers to a user without thread access", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["secret"]));
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        attachments: [
          {
            storageId,
            fileName: "secret.txt",
            fileSize: 6,
            contentType: "text/plain",
            uploadedAt: Date.now(),
          },
        ],
      });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessages", message._id, {
          diffSummary: {
            preRef: "refs/pre",
            postRef: "refs/post",
            files: [{ path: "a.ts", kind: "modified", additions: 1, deletions: 0 }],
          },
        });
      });

      const outsider = await ctx.user();
      const asOutsider = ctx.asUser(outsider);

      expect(
        await asOutsider.query(api.cli.messages.getMessageAttachmentUrls, {
          messageId: message._id,
        })
      ).toEqual([]);
      expect(
        await asOutsider.query(api.cli.messages.getRunDiffSummary, {
          messageId: message._id,
        })
      ).toBeNull();
    });
  });

  describe("listByThread", () => {
    test("should return messages sorted by createdAt descending", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      let assistantId!: Id<"cliMessages">;
      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "user",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "text", data: "First", timestamp: 1000 }],
          status: "completed",
          createdAt: 1000,
          updatedAt: 1000,
        });
        assistantId = await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          nextChunkOrder: 0,
          content: [],
          status: "completed",
          createdAt: 2000,
          updatedAt: 2000,
        });
      });
      await ctx.cliMessageChunks(assistantId, chat._id, profile._id, [
        {
          type: "text",
          data: "Second",
          timestamp: 2000,
          createdAt: 2000,
        },
      ]);

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(2);
      expect(result.page[0].content).toEqual([]);
      expect(result.page[1].content[0].data).toBe("First");
    });

    test("the message item carries the sender of an agent-sent message (OS-1162)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const sender = await ctx.cliThread(user._id, project._id, profile._id);

      const fromAgent = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        createdAt: 2_000,
        sentBy: { kind: "thread", threadId: sender._id },
      });
      const fromHuman = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        createdAt: 1_000,
      });

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      // Keyed by id, not position: the assertion is about the mapper, not about
      // which way this query happens to sort.
      const byId = new Map(result.page.map((message) => [message._id, message]));
      expect(byId.get(fromAgent._id)?.sentBy).toEqual({
        kind: "thread",
        threadId: sender._id,
      });
      expect(byId.get(fromHuman._id)?.sentBy).toBeUndefined();
    });

    test("returns empty assistant content when chunks are stored separately", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      let assistantId!: Id<"cliMessages">;
      await t.run(async (runCtx) => {
        assistantId = await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          nextChunkOrder: 0,
          content: [],
          status: "streaming",
          createdAt: 1000,
          updatedAt: 1000,
        });
      });
      await ctx.cliMessageChunks(assistantId, chat._id, profile._id, [
        {
          type: "assistant",
          data: '{"type":"assistant","message":{"content":[{"type":"text","text":"A"}]}}',
          timestamp: 1001,
          createdAt: 1001,
        },
        {
          type: "assistant",
          data: '{"type":"assistant","message":{"content":[{"type":"text","text":"B"}]}}',
          timestamp: 1002,
          createdAt: 1002,
        },
      ]);

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0]?.content).toEqual([]);
    });

    test("returns empty assistant content even when inline assistant content exists", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          nextChunkOrder: 1,
          content: [{ type: "assistant", data: "legacy-inline", timestamp: 1000 }],
          status: "completed",
          createdAt: 1000,
          updatedAt: 1000,
        });
      });

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0]?.content).toEqual([]);
    });

    test("should return empty for deleted chat", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        isDeleted: true,
      });

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(0);
    });

    test("should return empty for non-member", async () => {
      const ctx = createTestContext();
      const { user, project } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const { asUser: asOtherUser } = await ctx.setupUser();

      const result = await asOtherUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(0);
    });

    test("returns attachment summaries with signed URLs", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["image"]));
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "with file",
        attachments: [
          {
            storageId,
            fileName: "photo.png",
            fileSize: 5,
            contentType: "image/png",
          },
        ],
      });

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0]?.attachments).toHaveLength(1);
      expect(result.page[0]?.attachments[0]?.url).toEqual(expect.any(String));
      expect(result.page[0]?.attachments[0]?.uploadedAt).toBeTypeOf("number");
    });

    test("returns task summaries and omits unresolved task references", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const task = await ctx.task(project._id, user._id, {
        name: "Inspect message task",
      });

      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        taskId: task._id,
      });

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page[0]?.task).toEqual({
        _id: task._id,
        refId: `${project.alias}-${task.refNumber}`,
        name: "Inspect message task",
        taskType: expect.objectContaining({ key: "task" }),
        isArchived: false,
      });

      await t.run(async (runCtx) => {
        await runCtx.db.delete("tasks", task._id);
      });

      const unresolvedResult = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(unresolvedResult.page[0]?.task).toBeUndefined();
    });
  });

  describe("listEnvelopesByThread before", () => {
    test("returns only messages older than the cutoff, newest first", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const first = await ctx.cliMessage(chat._id, profile._id, { role: "user", content: [], nextChunkOrder: 0, createdAt: 1000, updatedAt: 1000 });
      const second = await ctx.cliMessage(chat._id, profile._id, { role: "assistant", content: [], createdAt: 2000, updatedAt: 2000 });
      await ctx.cliMessage(chat._id, profile._id, { role: "user", content: [], nextChunkOrder: 0, createdAt: 3000, updatedAt: 3000 });

      const result = await asUser.query(api.cli.messages.listEnvelopesByThread, { threadId: chat._id, before: 3000 });

      expect(result.envelopes.map((envelope) => envelope._id)).toEqual([second._id, first._id]);
      expect(result.hasOlderEnvelopes).toBe(false);
    });
  });

  describe("getLatestContinuationForThread", () => {
    test("falls back to the fork seed when the thread has no resumable assistant", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const parent = await ctx.cliThread(user._id, project._id, profile._id);
      const parentReply = await ctx.cliMessage(parent._id, profile._id, { role: "assistant", content: [], status: "completed" });
      const fork = await ctx.cliThread(user._id, project._id, profile._id, {
        forkedFrom: {
          threadId: parent._id,
          runStart: { messageId: parentReply._id, createdAt: 1 },
          reply: { messageId: parentReply._id, createdAt: 2 },
          runId: "run-copied",
          continuationId: "session-seed",
        },
      });

      expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: fork._id })).toBe("session-seed");
      // A Claude seed resumes with forkSession, so nothing to fork through.
      expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: fork._id })).toEqual({ continuationId: "session-seed" });
    });

    test("never resumes another thread's Codex session without the turn to fork through (OS-2073)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const parent = await ctx.cliThread(user._id, project._id, profile._id, { cliType: "codex" });
      const parentReply = await ctx.cliMessage(parent._id, profile._id, { role: "assistant", content: [], status: "completed" });
      const fork = await ctx.cliThread(user._id, project._id, profile._id, {
        cliType: "codex",
        forkedFrom: {
          threadId: parent._id,
          runStart: { messageId: parentReply._id, createdAt: 1 },
          reply: { messageId: parentReply._id, createdAt: 2 },
          runId: "run-copied",
          continuationId: "session-seed",
        },
      });
      expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: fork._id })).toBeNull();
      expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: fork._id })).toBeNull();

      // Same for a copied reply that carries the parent's session but no turn.
      await ctx.cliMessage(fork._id, profile._id, {
        role: "assistant", content: [], status: "completed", runId: "run-copied", cliType: "codex",
        cliContext: { continuationId: "session-parent" },
      });
      expect(await asUser.query(api.cli.messages.getResumeHandleForThread, { threadId: fork._id })).toBeNull();
      expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: fork._id })).toBeNull();
    });

    test("returns the newest assistant continuation id across assistant statuses", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "old", timestamp: 1000 }],
          status: "completed",
          cliContext: { continuationId: "session-old" },
          createdAt: 1000,
          updatedAt: 1000,
        });
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "new", timestamp: 2000 }],
          status: "completed",
          cliContext: { continuationId: "session-new" },
          createdAt: 2000,
          updatedAt: 2000,
        });
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "streaming", timestamp: 3000 }],
          status: "streaming",
          cliContext: { continuationId: "session-streaming" },
          createdAt: 3000,
          updatedAt: 3000,
        });
      });

      const continuationId = await asUser.query(api.cli.messages.getLatestContinuationForThread, {
        threadId: chat._id,
      });

      expect(continuationId).toBe("session-streaming");
    });

    test("looks through completed script turns to the agent's continuation (OS-1886)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "implemented", timestamp: 1000 }],
          status: "completed",
          cliContext: { continuationId: "session-agent" },
          createdAt: 1000,
          updatedAt: 1000,
        });
        const results = [
          { exitCode: 0, timedOut: false, outputTail: "ok" },
          { exitCode: 1, timedOut: false, outputTail: "lint failed" },
          { exitCode: 143, timedOut: true, outputTail: "" },
        ];
        for (const [index, scriptResult] of results.entries()) {
          await runCtx.db.insert("cliMessages", {
            threadId: chat._id,
            role: "assistant",
            profileId: profile._id,
            cliType: "claude-code",
            content: [{ type: "text", data: scriptResult.outputTail, timestamp: 2000 + index }],
            status: "completed",
            runId: `script-${index}`,
            scriptResult,
            createdAt: 2000 + index,
            updatedAt: 2000 + index,
          });
        }
      });

      expect(await asUser.query(api.cli.messages.getLatestContinuationForThread, { threadId: chat._id })).toBe(
        "session-agent"
      );
    });

    test("prefers the latest failed assistant continuation over earlier completed ones", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "old", timestamp: 1000 }],
          status: "completed",
          cliContext: { continuationId: "session-old" },
          createdAt: 1000,
          updatedAt: 1000,
        });
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "failed", timestamp: 2000 }],
          status: "failed",
          cliContext: { continuationId: "session-failed" },
          createdAt: 2000,
          updatedAt: 2000,
        });
      });

      const continuationId = await asUser.query(api.cli.messages.getLatestContinuationForThread, {
        threadId: chat._id,
      });

      expect(continuationId).toBe("session-failed");
    });

    // A turn with no persisted continuation is stranded, not a dead end: resume
    // walks past it to the newest session that actually exists (OS-1672).
    test("walks past assistants with no persisted continuation", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      const completedAssistant = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "completed",
        cliContext: { continuationId: "session-old" },
      });
      await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "failed",
        cliContext: undefined,
        content: [],
        createdAt: completedAssistant.createdAt + 1000,
        updatedAt: completedAssistant.updatedAt + 1000,
      });

      const continuationId = await asUser.query(api.cli.messages.getLatestContinuationForThread, {
        threadId: chat._id,
      });

      expect(continuationId).toBe("session-old");
    });

    test("ignores newer user messages when resolving the latest assistant continuation", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "assistant", timestamp: 1000 }],
          status: "failed",
          cliContext: { continuationId: "session-assistant" },
          createdAt: 1000,
          updatedAt: 1000,
        });

        for (let index = 0; index < 25; index += 1) {
          await runCtx.db.insert("cliMessages", {
            threadId: chat._id,
            role: "user",
            profileId: profile._id,
            cliType: "claude-code",
            content: [{ type: "user", data: `follow-up-${index}`, timestamp: 2000 + index }],
            status: "completed",
            createdAt: 2000 + index,
            updatedAt: 2000 + index,
          });
        }
      });

      const continuationId = await asUser.query(api.cli.messages.getLatestContinuationForThread, {
        threadId: chat._id,
      });

      expect(continuationId).toBe("session-assistant");
    });

    test("returns null when no assistant continuation exists", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "streaming", timestamp: 1000 }],
          status: "streaming",
          createdAt: 1000,
          updatedAt: 1000,
        });
      });

      const continuationId = await asUser.query(api.cli.messages.getLatestContinuationForThread, {
        threadId: chat._id,
      });

      expect(continuationId).toBeNull();
    });

    test("returns null for users without thread access", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const { asUser: asOtherUser } = await ctx.setupUser();

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "assistant", data: "hidden", timestamp: 1000 }],
          status: "completed",
          cliContext: { continuationId: "session-hidden" },
          createdAt: 1000,
          updatedAt: 1000,
        });
      });

      const continuationId = await asOtherUser.query(api.cli.messages.getLatestContinuationForThread, {
        threadId: chat._id,
      });

      expect(continuationId).toBeNull();
    });
  });

  describe("run processing", () => {
    test("listUnprocessedUserMessages returns only unprocessed user messages in order", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "user",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "text", data: "first", timestamp: 1000 }],
          status: "completed",
          createdAt: 1000,
          updatedAt: 1000,
        });
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "assistant",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "text", data: "ignore assistant", timestamp: 1100 }],
          status: "completed",
          createdAt: 1100,
          updatedAt: 1100,
        });
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "user",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "text", data: "processed", timestamp: 1200 }],
          status: "completed",
          processedAt: 1300,
          createdAt: 1200,
          updatedAt: 1300,
        });
        await runCtx.db.insert("cliMessages", {
          threadId: chat._id,
          role: "user",
          profileId: profile._id,
          cliType: "claude-code",
          content: [{ type: "text", data: "second", timestamp: 1400 }],
          status: "completed",
          createdAt: 1400,
          updatedAt: 1400,
        });
      });

      const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
        threadId: chat._id,
      });

      expect(result).toHaveLength(2);
      expect(result[0]?.content[0]?.data).toBe("first");
      expect(result[1]?.content[0]?.data).toBe("second");
    });

    test("a queueFirst runtime command is delivered ahead of the queue (OS-2339)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);

      await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "first" });
      vi.advanceTimersByTime(1);
      await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "/compact", runtimeCommand: true, queueFirst: true });
      vi.advanceTimersByTime(1);
      // Only a runtime command may jump the queue.
      await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "prose", queueFirst: true });

      const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, { threadId: chat._id });
      expect(result.map((message) => [message.content[0]?.data, message.queueFirst])).toEqual([
        ["/compact", true],
        ["first", undefined],
        ["prose", undefined],
      ]);
    });

    test("startRunResponse rejects a stale selection that skips a queue-first command (OS-2339)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 86_400_000 });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);

      const proseId = await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "first" });
      await t.mutation(api.cli.threads.runControl.claimThread, { threadId: chat._id, sessionId: session._id, leaseMs: 60_000, apiKey: apiKeyResult.key });
      // The CLI read [first]; Compact lands before it starts the run.
      const compactId = await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "/compact", runtimeCommand: true, queueFirst: true });

      await expect(t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id, sessionId: session._id, userMessageIds: [proseId], apiKey: apiKeyResult.key,
      })).rejects.toThrow("One or more user messages are no longer pending");
      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id, sessionId: session._id, userMessageIds: [compactId], apiKey: apiKeyResult.key,
      });
      expect(started.runId).toBeTruthy();
    });

    test("listUnprocessedUserMessages returns attachment summaries with URLs", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["image"]));
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        attachments: [
          {
            storageId,
            fileName: "diagram.png",
            fileSize: 5,
            contentType: "image/png",
          },
        ],
      });

      const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
        threadId: chat._id,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.attachments).toHaveLength(1);
      expect(result[0]?.attachments[0]?.url).toEqual(expect.any(String));
    });

    test("listUnprocessedUserMessages returns task summaries", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const task = await ctx.task(project._id, user._id, {
        name: "Unprocessed task",
      });

      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        taskId: task._id,
      });

      const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
        threadId: chat._id,
      });

      expect(result[0]?.task).toEqual({
        _id: task._id,
        refId: `${project.alias}-${task.refNumber}`,
        name: "Unprocessed task",
        taskType: expect.objectContaining({ key: "task" }),
        isArchived: false,
      });
    });

    /**
     * Stranded tail (OS-1672): a run whose response persisted no continuation id
     * was never seen by an agent, so the next claim re-delivers it.
     */
    describe("stranded tail re-delivery", () => {
      async function setupStrandedThread(
        ctx: TestContext,
        opts?: {
          continuationId?: string;
          queueFollowUp?: boolean;
          assistantStatus?: "failed" | "completed";
          stoppedRuntime?: "claude-code" | "codex";
          /** Extra user rows in the stopped run, e.g. a trailing runtime command. */
          extraRunMessages?: { content: string; runtimeCommand?: boolean }[];
        }
      ) {
        const { user, project, asUser, t } = await ctx.setupProject();
        const hasQueue = opts?.queueFollowUp !== false;
        const profile = await ctx.cliProfile(user._id, project._id);
        const chat = await ctx.cliThread(user._id, project._id, profile._id, {
          ...(hasQueue ? { hasPendingUserMessages: true, status: "pending" as const } : {}),
        });

        const strandedUser = await ctx.cliMessage(chat._id, profile._id, {
          role: "user",
          content: [{ type: "text", data: "My name is Robin", timestamp: 1000 }],
          processedAt: 1100,
          runId: "run-stranded",
          createdAt: 1000,
          updatedAt: 1100,
        });
        const extraRunMessages = await Promise.all(
          (opts?.extraRunMessages ?? []).map((extra, index) =>
            ctx.cliMessage(chat._id, profile._id, {
              role: "user",
              content: [{ type: "text", data: extra.content, timestamp: 1010 + index }],
              ...(extra.runtimeCommand ? { runtimeCommand: true } : {}),
              processedAt: 1100,
              runId: "run-stranded",
              createdAt: 1010 + index,
              updatedAt: 1100,
            })
          )
        );
        await ctx.cliMessage(chat._id, profile._id, {
          role: "assistant",
          content: [],
          status: opts?.assistantStatus ?? "failed",
          ...(opts?.stoppedRuntime ? { cliType: opts.stoppedRuntime } : {}),
          ...(opts?.assistantStatus === "completed" ? {} : { errorMessage: opts?.stoppedRuntime ? "Response stopped by user" : "Launch failed" }),
          runId: "run-stranded",
          ...(opts?.continuationId ? { cliContext: { continuationId: opts.continuationId } } : {}),
          createdAt: 1100,
          updatedAt: 1200,
        });

        const followUp = !hasQueue
          ? null
          : await ctx.cliMessage(chat._id, profile._id, {
                role: "user",
                content: [{ type: "text", data: "What is my name", timestamp: 2000 }],
                createdAt: 2000,
                updatedAt: 2000,
              });

        return { user, project, asUser, t, profile, chat, strandedUser, extraRunMessages, followUp };
      }

      /** Claimed thread + api key, ready for `startRunResponse`. */
      async function claimAs(ctx: TestContext, setup: Awaited<ReturnType<typeof setupStrandedThread>>) {
        const apiKeyResult = await setup.asUser.mutation(api.apiKeys.core.create, {
          name: "CLI Key",
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });
        const session = await ctx.cliSession(setup.profile._id, apiKeyResult.id);
        await setup.t.mutation(api.cli.threads.runControl.claimThread, {
          threadId: setup.chat._id,
          sessionId: session._id,
          leaseMs: 60_000,
          apiKey: apiKeyResult.key,
        });
        return { session, apiKey: apiKeyResult.key };
      }

      test.each(["claude-code", "codex"] as const)("does not replay a cancelled %s run when the user continues", async (stoppedRuntime) => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { stoppedRuntime });
        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, { threadId: setup.chat._id });
        expect(result.map((message) => message._id)).toEqual([setup.followUp!._id]);
        const { session, apiKey } = await claimAs(ctx, setup);
        await expect(setup.t.mutation(api.cli.messages.startRunResponse, {
          threadId: setup.chat._id, sessionId: session._id, userMessageIds: [setup.strandedUser._id], apiKey,
        })).rejects.toThrow();
      });

      test.each([
        ["claude-code", undefined], ["claude-code", "session-created"],
        ["codex", undefined], ["codex", "session-created"],
      ] as const)("preserves stopped %s input as history with continuation %s", async (stoppedRuntime, continuationId) => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { stoppedRuntime, continuationId });
        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        });
        expect(result.map((message) => ({ id: message._id, contextOnly: message.contextOnly }))).toEqual([
          { id: setup.strandedUser._id, contextOnly: true },
          { id: setup.followUp!._id, contextOnly: undefined },
        ]);
        expect((await setup.t.run((dbCtx) => dbCtx.db.get("cliMessages", setup.strandedUser._id)))?.runId).toBe("run-stranded");
      });

      test("successful delivery checkpoints history while a later stop remains recoverable", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { stoppedRuntime: "codex" });
        const { session, apiKey } = await claimAs(ctx, setup);
        const started = await setup.t.mutation(api.cli.messages.startRunResponse, {
          threadId: setup.chat._id, sessionId: session._id, userMessageIds: [setup.followUp!._id], apiKey,
        });
        await setup.t.mutation(api.cli.messages.complete, {
          messageId: started.assistantMessageId, sessionId: session._id, apiKey,
          cliContext: { continuationId: "delivered", interruptedContextIncluded: true },
        });
        const now = Date.now() + 100;
        const later = await ctx.cliMessage(setup.chat._id, setup.profile._id, {
          role: "user", runId: "later-stop", processedAt: now, createdAt: now, updatedAt: now,
          content: [{ type: "text", data: "Another interrupted message", timestamp: now }],
        });
        await ctx.cliMessage(setup.chat._id, setup.profile._id, {
          role: "assistant", cliType: "codex", status: "failed", runId: "later-stop",
          errorMessage: "Response stopped by user", createdAt: now + 1, updatedAt: now + 1,
          cliContext: { continuationId: "created-but-not-delivered" },
        });
        await ctx.cliMessage(setup.chat._id, setup.profile._id, {
          role: "user", createdAt: now + 2, updatedAt: now + 2,
        });
        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        });
        expect(result.filter((message) => message.contextOnly).map((message) => message._id)).toEqual([later._id]);
      });

      test.each(["completed", "failed"] as const)("checkpoints interrupted history only after a resumable %s turn", async (status) => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { stoppedRuntime: "codex" });
        await ctx.cliMessage(setup.chat._id, setup.profile._id, {
          role: "assistant", status, createdAt: 1500, updatedAt: 1500,
          cliContext: { continuationId: "resumed", interruptedContextIncluded: true },
        });
        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        });
        expect(result.filter((message) => message.contextOnly).map((message) => message._id))
          .toEqual(status === "completed" ? [] : [setup.strandedUser._id]);
      });

      test("session markers and command completion do not acknowledge interrupted history", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { stoppedRuntime: "claude-code", continuationId: "created" });
        await ctx.cliMessage(setup.chat._id, setup.profile._id, {
          role: "assistant", status: "completed", createdAt: 1500, updatedAt: 1500,
          cliContext: { continuationId: "command-session" },
        });
        await ctx.cliMessage(setup.chat._id, setup.profile._id, {
          role: "assistant", status: "completed", createdAt: 1600, updatedAt: 1600,
          cliContext: { interruptedContextIncluded: true },
        });
        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        });
        expect(result.filter((message) => message.contextOnly).map((message) => message._id)).toEqual([setup.strandedUser._id]);
      });

      test("interrupted history never schedules itself or leaks to another owner", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { stoppedRuntime: "codex", queueFollowUp: false });
        expect(await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        })).toEqual([]);
        const other = await ctx.user();
        expect(await ctx.asUser(other).query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        })).toEqual([]);
      });

      test("keeps stopped runtime commands as history and lets explicit Retry requeue input", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, {
          stoppedRuntime: "codex", extraRunMessages: [{ content: "/compact", runtimeCommand: true }],
        });
        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        });
        expect(result.filter((message) => message.contextOnly).map((message) => message._id))
          .toEqual([setup.strandedUser._id, setup.extraRunMessages[0]._id]);
        const assistant = await setup.t.run(async (dbCtx) =>
          (await dbCtx.db.query("cliMessages").collect()).find((m) => m.threadId === setup.chat._id && m.role === "assistant")!);
        await setup.asUser.mutation(api.cli.messages.retry, { messageId: assistant._id });
        const retried = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id, includeInterruptedContext: true,
        });
        expect(retried.filter((message) => message.contextOnly)).toEqual([]);
        expect(retried.map((message) => message._id)).toContain(setup.strandedUser._id);
      });

      test("prepends a stranded run's user messages to the queue", async () => {
        const ctx = createTestContext();
        const { asUser, chat } = await setupStrandedThread(ctx);

        const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: chat._id,
        });

        expect(result.map((message) => message.content[0]?.data)).toEqual(["My name is Robin", "What is my name"]);
      });

      test("leaves a run with a persisted continuation settled", async () => {
        const ctx = createTestContext();
        const { asUser, chat } = await setupStrandedThread(ctx, { continuationId: "thread-42" });

        const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: chat._id,
        });

        expect(result.map((message) => message.content[0]?.data)).toEqual(["What is my name"]);
      });

      test("does not re-deliver with an empty queue — healing never self-claims", async () => {
        const ctx = createTestContext();
        const { asUser, chat } = await setupStrandedThread(ctx, { queueFollowUp: false });

        const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: chat._id,
        });

        expect(result).toEqual([]);
      });

      // A first run legitimately completes with no continuation id, so completion
      // is its own delivery proof — re-running it would repeat the user's work.
      test("leaves a completed run with no continuation settled", async () => {
        const ctx = createTestContext();
        const { asUser, chat } = await setupStrandedThread(ctx, { assistantStatus: "completed" });

        const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: chat._id,
        });

        expect(result.map((message) => message.content[0]?.data)).toEqual(["What is my name"]);
      });

      test("startRunResponse rejects a completed run's message", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { assistantStatus: "completed" });
        const { session, apiKey } = await claimAs(ctx, setup);

        await expect(
          setup.t.mutation(api.cli.messages.startRunResponse, {
            threadId: setup.chat._id,
            sessionId: session._id,
            userMessageIds: [setup.strandedUser._id],
            apiKey,
          })
        ).rejects.toThrow("One or more user messages are no longer pending");
      });

      /** Continuation-less `failed` assistants stacked above the settled run. */
      async function addFailedHistory(ctx: TestContext, setup: Awaited<ReturnType<typeof setupStrandedThread>>, count: number) {
        for (let index = 0; index < count; index += 1) {
          await ctx.cliMessage(setup.chat._id, setup.profile._id, {
            role: "assistant",
            content: [],
            status: "failed",
            errorMessage: "boom",
            runId: `run-retry-${index}`,
            createdAt: 3000 + index,
            updatedAt: 3000 + index,
          });
        }
        await ctx.cliMessage(setup.chat._id, setup.profile._id, {
          role: "user",
          content: [{ type: "text", data: "What is my name", timestamp: 9000 }],
          createdAt: 9000,
          updatedAt: 9000,
        });
      }

      test("does not strand a settled run buried under a failed history", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { assistantStatus: "completed", queueFollowUp: false });

        await addFailedHistory(ctx, setup, 20);

        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id,
        });

        // The completed run below the failures stays settled.
        expect(result.map((message) => message.content[0]?.data)).toEqual(["What is my name"]);
      });

      // Past the scan limit the walk cannot know what is settled, so it must fall
      // back to delivering nothing extra — never to re-running delivered work.
      test("reports nothing stranded when the scan limit is exhausted", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, { queueFollowUp: false });

        await addFailedHistory(ctx, setup, STRANDED_ASSISTANT_SCAN_LIMIT + 1);

        const result = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id,
        });

        expect(result.map((message) => message.content[0]?.data)).toEqual(["What is my name"]);
      });

      // The CLI stops a run at a runtime command, so a recovered run can be
      // consumed in pieces; untaken members must not depend on staying stranded.
      test("returns an untaken run member to the queue after partial recovery", async () => {
        const ctx = createTestContext();
        const setup = await setupStrandedThread(ctx, {
          extraRunMessages: [{ content: "/compact", runtimeCommand: true }],
        });
        const { session, apiKey } = await claimAs(ctx, setup);
        const runtimeCommandMessage = setup.extraRunMessages[0]!;

        // The CLI takes only the prose prefix, leaving "/compact" for its own run.
        await setup.t.mutation(api.cli.messages.startRunResponse, {
          threadId: setup.chat._id,
          sessionId: session._id,
          userMessageIds: [setup.strandedUser._id],
          apiKey,
        });

        await setup.t.run(async (runCtx) => {
          const untaken = await runCtx.db.get("cliMessages", runtimeCommandMessage._id);
          expect(untaken?.processedAt).toBeUndefined();
          expect(untaken?.runId).toBeUndefined();
        });

        const remaining = await setup.asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: setup.chat._id,
        });
        expect(remaining.map((message) => message.content[0]?.data)).toEqual(["/compact", "What is my name"]);
      });

      test("treats a live run's run as owned, not stranded", async () => {
        const ctx = createTestContext();
        const { asUser, chat, profile } = await setupStrandedThread(ctx);

        // The stopped run's assistant is still streaming — a run in flight has
        // simply not reported its session yet.
        await ctx.cliMessage(chat._id, profile._id, {
          role: "assistant",
          content: [],
          status: "streaming",
          runId: "run-live",
          createdAt: 1500,
          updatedAt: 1500,
        });

        const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: chat._id,
        });

        expect(result.map((message) => message.content[0]?.data)).toEqual(["What is my name"]);
      });

      test("getLatestContinuationForThread skips the stranded tail", async () => {
        const ctx = createTestContext();
        const { asUser, chat, profile } = await setupStrandedThread(ctx, { queueFollowUp: false });

        // Older resumable turn below the stranded one.
        await ctx.cliMessage(chat._id, profile._id, {
          role: "assistant",
          content: [],
          status: "completed",
          runId: "run-older",
          cliContext: { continuationId: "thread-older" },
          createdAt: 500,
          updatedAt: 500,
        });

        const continuationId = await asUser.query(api.cli.messages.getLatestContinuationForThread, {
          threadId: chat._id,
        });

        expect(continuationId).toBe("thread-older");
      });

      test("startRunResponse re-stamps a stranded message into the new run", async () => {
        const ctx = createTestContext();
        const { asUser, t, profile, chat, strandedUser, followUp } = await setupStrandedThread(ctx);

        const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
          name: "CLI Key",
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });
        const session = await ctx.cliSession(profile._id, apiKeyResult.id);

        // A stranded message may carry stale steer state from its lost run.
        await t.run(async (runCtx) => {
          await runCtx.db.patch("cliMessages", strandedUser._id, { steeredAt: 1050 });
        });

        expect(
          await t.mutation(api.cli.threads.runControl.claimThread, {
            threadId: chat._id,
            sessionId: session._id,
            leaseMs: 60_000,
            apiKey: apiKeyResult.key,
          })
        ).toBe(true);

        const started = await t.mutation(api.cli.messages.startRunResponse, {
          threadId: chat._id,
          sessionId: session._id,
          userMessageIds: [strandedUser._id, followUp!._id],
          apiKey: apiKeyResult.key,
        });

        await t.run(async (runCtx) => {
          const restamped = await runCtx.db.get("cliMessages", strandedUser._id);
          expect(restamped?.runId).toBe(started.runId);
          expect(restamped?.steeredAt).toBeUndefined();
        });
      });

      test("stranded recovery still leads a queue-first command (OS-2339)", async () => {
        const ctx = createTestContext();
        const { asUser, t, profile, chat, strandedUser } = await setupStrandedThread(ctx);
        const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, { name: "CLI Key", expiresAt: Date.now() + 86_400_000 });
        const session = await ctx.cliSession(profile._id, apiKeyResult.id);
        await t.mutation(api.cli.threads.runControl.claimThread, { threadId: chat._id, sessionId: session._id, leaseMs: 60_000, apiKey: apiKeyResult.key });
        await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "/compact", runtimeCommand: true, queueFirst: true });

        const started = await t.mutation(api.cli.messages.startRunResponse, {
          threadId: chat._id, sessionId: session._id, userMessageIds: [strandedUser._id], apiKey: apiKeyResult.key,
        });
        expect(started.runId).toBeTruthy();
      });

      test("startRunResponse still rejects a settled message", async () => {
        const ctx = createTestContext();
        const { asUser, t, profile, chat, strandedUser } = await setupStrandedThread(ctx, {
          continuationId: "thread-42",
        });

        const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
          name: "CLI Key",
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });
        const session = await ctx.cliSession(profile._id, apiKeyResult.id);

        await t.mutation(api.cli.threads.runControl.claimThread, {
          threadId: chat._id,
          sessionId: session._id,
          leaseMs: 60_000,
          apiKey: apiKeyResult.key,
        });

        await expect(
          t.mutation(api.cli.messages.startRunResponse, {
            threadId: chat._id,
            sessionId: session._id,
            userMessageIds: [strandedUser._id],
            apiKey: apiKeyResult.key,
          })
        ).rejects.toThrow();
      });
    });

    // The catalog lives off the session row now (OS-1721), so this guard is the
    // one server-side reader that has to fetch it.
    test("startRunResponse resolves the opencode effort against the profile's catalog", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id, {
        availableClis: [{ type: "opencode", version: "1.17.13" }],
      });
      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliRuntimeCatalogs", {
          profileId: profile._id,
          projectId: project._id,
          userId: user._id,
          cliType: "opencode",
          models: [{ slug: "openai/gpt-5", name: "GPT-5", variants: ["high"] }],
          reportedAt: Date.now(),
        });
      });

      const startWithEffort = async (cliEffort: string) => {
        const chat = await ctx.cliThread(user._id, project._id, profile._id, {
          cliType: "opencode",
          hasPendingUserMessages: true,
          status: "pending",
        });
        const message = await ctx.cliMessage(chat._id, profile._id, {
          role: "user",
          cliModel: "openai/gpt-5",
          cliEffort,
          content: [{ type: "text", data: "hi", timestamp: 1000 }],
          createdAt: 1000,
          updatedAt: 1000,
        });
        await t.mutation(api.cli.threads.runControl.claimThread, {
          threadId: chat._id,
          sessionId: session._id,
          leaseMs: 60_000,
          apiKey: apiKeyResult.key,
        });
        return t.mutation(api.cli.messages.startRunResponse, {
          threadId: chat._id,
          sessionId: session._id,
          userMessageIds: [message._id],
          apiKey: apiKeyResult.key,
        });
      };

      expect((await startWithEffort("high")).resolvedCliEffort).toBe("high");
      // A variant the advertised model does not offer never reaches the run.
      expect((await startWithEffort("low")).resolvedCliEffort).toBeUndefined();
    });

    test("startRunResponse marks selected user messages processed and creates assistant message", async () => {
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

      const userMessage1 = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        content: [{ type: "text", data: "m1", timestamp: 1000 }],
        createdAt: 1000,
        updatedAt: 1000,
      });
      const userMessage2 = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        cliModel: "opus",
        content: [{ type: "text", data: "m2", timestamp: 2000 }],
        createdAt: 2000,
        updatedAt: 2000,
      });

      const claimed = await t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: chat._id,
        sessionId: session._id,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      });
      expect(claimed).toBe(true);

      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session._id,
        userMessageIds: [userMessage1._id, userMessage2._id],
        apiKey: apiKeyResult.key,
      });

      expect(started.assistantMessageId).toBeDefined();
      expect(started.runId).toBeDefined();

      await t.run(async (runCtx) => {
        const updatedUser1 = await runCtx.db.get("cliMessages", userMessage1._id);
        const updatedUser2 = await runCtx.db.get("cliMessages", userMessage2._id);
        const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);

        expect(updatedUser1?.processedAt).toBeDefined();
        expect(updatedUser2?.processedAt).toBeDefined();
        expect(updatedUser1?.runId).toBe(started.runId);
        expect(updatedUser2?.runId).toBe(started.runId);
        expect(assistant?.role).toBe("assistant");
        expect(assistant?.status).toBe("streaming");
        expect(assistant?.runId).toBe(started.runId);
        expect(assistant?.cliModel).toBe("opus");
        expect(updatedChat?.activeAssistantMessageId).toBe(started.assistantMessageId);
        expect(updatedChat?.streamWatchdogId).toBeDefined();
        expect(updatedChat?.processingState).toBe("streaming");
      });
    });

    test("startRunResponse rejects a container even with a forced claim (OS-1556)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const container = await ctx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });
      const userMessage = await ctx.cliMessage(container._id, profile._id, {
        role: "user",
        content: [{ type: "text", data: "m1", timestamp: 1000 }],
        createdAt: 1000,
        updatedAt: 1000,
      });

      // `claimThread` rejects containers, so hand-write the claim: the stream
      // gate has to reject on `kind` alone.
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", container._id, {
          claimedBySessionId: session._id,
          claimedAt: Date.now(),
          claimLeaseExpiresAt: Date.now() + 60_000,
          processingState: "claimed",
        });
      });

      await expect(
        t.mutation(api.cli.messages.startRunResponse, {
          threadId: container._id,
          sessionId: session._id,
          userMessageIds: [userMessage._id],
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("Groups and workflow runs cannot be processed by a CLI");
    });

    test("startRunResponse stores cliVersion from session availableClis", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const session = await ctx.cliSession(profile._id, apiKeyResult.id, {
        availableClis: [{ type: "claude-code", version: "1.2.3", provider: "bedrock" }],
      });
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
        cliType: "claude-code",
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

      await t.run(async (runCtx) => {
        const processedUser = await runCtx.db.get("cliMessages", userMessage._id);
        const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);

        expect(processedUser?.cliVersion).toBe("1.2.3");
        expect(assistant?.cliVersion).toBe("1.2.3");
      });

      expect(started.resolvedCliModel).toBeUndefined();
    });

    test.each([
      ["opus-1m", "us.anthropic.claude-opus-4-8[1m]"],
      ["opus-5-5", "us.anthropic.claude-opus-5-5"],
    ])("startRunResponse resolves stored Claude model %s from session provider", async (cliModel, resolvedModel) => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const session = await ctx.cliSession(profile._id, apiKeyResult.id, {
        availableClis: [{ type: "claude-code", version: "1.2.3", provider: "bedrock" }],
      });
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
        cliType: "claude-code",
      });

      const userMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        cliModel,
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

      expect(started.resolvedCliModel).toBe(resolvedModel);
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", userMessage._id))?.cliModel).toBe(cliModel);
      });
    });

    test("startRunResponse resolves exact Claude Opus 4.7 model from session provider", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const session = await ctx.cliSession(profile._id, apiKeyResult.id, {
        availableClis: [{ type: "claude-code", version: "1.2.3", provider: "bedrock" }],
      });
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
        cliType: "claude-code",
      });

      const userMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        cliModel: "opus-4-7-1m",
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

      expect(started.resolvedCliModel).toBe("us.anthropic.claude-opus-4-7[1m]");
    });

    test.each([
      ["mantle", "gpt-6-sol", "openai.gpt-6-sol"],
      ["bedrock", "gpt-6-astra", "global.openai.gpt-6-astra"],
      ["mantle", "default", undefined],
    ] as const)("startRunResponse resolves Codex on %s from the session inventory (OS-2105)", async (provider, cliModel, expected) => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id, {
        availableClis: [{ type: "codex", version: "0.156.1", provider, region: "us-east-1" }],
      });
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
        cliType: "codex",
      });
      const userMessage = await ctx.cliMessage(chat._id, profile._id, { role: "user", cliModel });

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

      expect(started.resolvedCliModel).toBe(expected);
    });

    test("startRunResponse fails when messages are stale", async () => {
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

      await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session._id,
        userMessageIds: [userMessage._id],
        apiKey: apiKeyResult.key,
      });

      await expect(
        t.mutation(api.cli.messages.startRunResponse, {
          threadId: chat._id,
          sessionId: session._id,
          userMessageIds: [userMessage._id],
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("One or more user messages are no longer pending");
    });
  });

  describe("appendRunContent", () => {
    /** A claimed streaming assistant message, plus a one-chunk flush helper. */
    async function setupFlushTarget(overrides?: { nextChunkOrder?: number }) {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        runId: "run-flush",
        claimedBySessionId: session._id,
        nextChunkOrder: overrides?.nextChunkOrder ?? 0,
        content: [],
      });

      const flush = (data: string, type = "assistant") =>
        t.mutation(api.cli.messages.appendRunContent, {
          messageId: message._id,
          sessionId: session._id,
          chunks: [{ type, data }],
          apiKey: apiKeyResult.key,
        });

      return { t, asUser, chat, session, message, apiKey: apiKeyResult.key, flush };
    }

    test("only a run's continuation-bearing flush writes the cliMessages doc (OS-1729)", async () => {
      const { t, message, flush } = await setupFlushTarget();
      const readDoc = () => t.run((runCtx) => runCtx.db.get("cliMessages", message._id));

      // Time must move between flushes: with the suite's clock frozen, a stray
      // `updatedAt` restamp would rewrite the same value and pass anyway.
      vi.advanceTimersByTime(1_000);
      await flush(
        JSON.stringify({ type: "system", subtype: "init", session_id: "session-1" }),
        "system"
      );

      // The one transition a flush still writes, at most once per run.
      const afterInit = await readDoc();
      expect(afterInit?.cliContext?.continuationId).toBe("session-1");
      expect(afterInit?.updatedAt).toBeGreaterThan(message.updatedAt);

      vi.advanceTimersByTime(1_000);
      await flush("chunk-a");
      vi.advanceTimersByTime(1_000);
      await flush("chunk-b");

      expect(await readDoc()).toEqual(afterInit);
      expect(await readChunkCursor(t, message._id)).toBe(3);
    });

    test("a run streaming across the deploy keeps its envelope cursor (OS-1729)", async () => {
      const { t, chat, message, flush } = await setupFlushTarget({ nextChunkOrder: 3 });

      await flush("chunk-after-deploy");

      const chunkRows = await t.run((runCtx) =>
        runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
            q.eq("threadId", chat._id).eq("messageId", message._id)
          )
          .collect()
      );
      expect(chunkRows).toHaveLength(1);
      expect(chunkRows[0]?.chunkOrder).toBe(3);
      expect(await readChunkCursor(t, message._id)).toBe(4);
    });

    test("complete folds the streaming cursor back onto the message (OS-1729)", async () => {
      const { t, message, session, apiKey, flush } = await setupFlushTarget();
      await flush("chunk-a");
      await flush("chunk-b");
      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toHaveLength(1);
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey,
      });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", message._id))?.nextChunkOrder).toBe(2);
        expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toEqual([]);
      });
    });

    test("fail folds the streaming cursor back onto the message (OS-1729)", async () => {
      const { t, message, session, apiKey, flush } = await setupFlushTarget();
      await flush("chunk-a");
      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toHaveLength(1);
      });

      await t.mutation(api.cli.messages.fail, {
        messageId: message._id,
        sessionId: session._id,
        errorMessage: "boom",
        apiKey,
      });

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", message._id))?.nextChunkOrder).toBe(1);
        expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toEqual([]);
      });
    });

    test("retry drops the stream head with the assistant row (OS-1729)", async () => {
      const { t, asUser, message, flush } = await setupFlushTarget();
      await flush("chunk-a");
      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toHaveLength(1);
      });

      await asUser.mutation(api.cli.messages.retry, { messageId: message._id });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", message._id)).toBeNull();
        expect(await runCtx.db.query("cliMessageStreamHeads").collect()).toEqual([]);
      });
    });

    test("should append multiple chunks to user chunk rows", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        nextChunkOrder: 1,
        status: "streaming",
        claimedBySessionId: session._id,
        content: [],
      });
      await ctx.cliMessageChunks(message._id, chat._id, profile._id, [{ type: "text", data: "First chunk", createdAt: 1000 }]);

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [
          { type: "text", data: " Second chunk" },
          { type: "text", data: " Third chunk" },
        ],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("cliMessages", message._id);
        expect(updated?.content).toEqual([]);
        expect(updated?.nextChunkOrder).toBe(3);
        const chunkRows = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", message._id))
          .order("asc")
          .collect();
        expect(chunkRows).toHaveLength(3);
        expect(chunkRows[0]?.data).toBe("First chunk");
        expect(chunkRows[1]?.data).toBe(" Second chunk");
        expect(chunkRows[2]?.data).toBe(" Third chunk");
        expect(chunkRows[1]?.timestamp).toBeDefined();
        expect(chunkRows[2]?.timestamp).toBeDefined();
      });
    });

    test("accumulates assistant chunks across multiple append calls in order", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        nextChunkOrder: 0,
        content: [],
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [{ type: "assistant", data: "chunk-a" }],
        apiKey: apiKeyResult.key,
      });
      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [{ type: "assistant", data: "chunk-b" }],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const chunkRows = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", message._id))
          .order("asc")
          .collect();

        expect(chunkRows).toHaveLength(2);
        expect(chunkRows[0]?.chunkOrder).toBe(0);
        expect(chunkRows[1]?.chunkOrder).toBe(1);
        expect(chunkRows[0]?.data).toBe("chunk-a");
        expect(chunkRows[1]?.data).toBe("chunk-b");
      });

      const listed = await asUser.query(api.cli.messages.listByThread, {
        threadId: chat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });
      const assistantMessage = listed.page.find((item) => item._id === message._id);
      expect(assistantMessage?.content).toEqual([]);
    });

    test("prefers the agent-side chunk timestamp but keeps createdAt server-side", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        nextChunkOrder: 0,
        content: [],
      });

      const agentTimestamp = Date.now() - 5_000;
      const skewedTimestamp = Date.now() + 48 * 60 * 60 * 1000;

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [
          { type: "assistant", data: "stamped", timestamp: agentTimestamp },
          { type: "assistant", data: "unstamped" },
          { type: "assistant", data: "skewed", timestamp: skewedTimestamp },
        ],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const chunkRows = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", message._id))
          .order("asc")
          .collect();

        expect(chunkRows).toHaveLength(3);
        expect(chunkRows[0]?.timestamp).toBe(agentTimestamp);
        // No stamp and an implausible stamp both fall back to append time.
        expect(chunkRows[1]?.timestamp).toBeGreaterThan(agentTimestamp);
        expect(chunkRows[2]?.timestamp).toBeLessThan(skewedTimestamp);
        // The read cursor must not follow the agent's clock.
        for (const row of chunkRows) {
          expect(row.createdAt).toBeGreaterThan(agentTimestamp);
        }
      });
    });

    test("does not require the live session row after a stream is claimed", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        nextChunkOrder: 0,
        content: [],
      });

      await t.run(async (runCtx) => {
        await runCtx.db.delete("cliSessions", session._id);
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [{ type: "assistant", data: "chunk-after-session-update" }],
        apiKey: apiKeyResult.key,
      });

      expect(await readChunkCursor(t, message._id)).toBe(1);
    });

    test("throws when assistant message is missing nextChunkOrder", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        content: [{ type: "assistant", data: "legacy-inline", timestamp: 1000 }],
      });

      await expect(
        t.mutation(api.cli.messages.appendRunContent, {
          messageId: message._id,
          sessionId: session._id,
          chunks: [{ type: "assistant", data: "new-inline" }],
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("Assistant message missing nextChunkOrder");
    });

    test("persists continuation id as soon as a session-bearing chunk arrives", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        nextChunkOrder: 0,
        content: [],
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [
          {
            type: "system",
            data: JSON.stringify({
              type: "system",
              subtype: "init",
              session_id: "session-from-append",
            }),
          },
        ],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("cliMessages", message._id);
        expect(updated?.cliContext?.continuationId).toBe("session-from-append");
      });
    });

    test("does not overwrite an existing continuation id during append", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        cliContext: { continuationId: "session-existing" },
        nextChunkOrder: 0,
        content: [],
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [
          {
            type: "system",
            data: JSON.stringify({
              type: "system",
              subtype: "init",
              session_id: "session-new",
            }),
          },
        ],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("cliMessages", message._id);
        expect(updated?.cliContext?.continuationId).toBe("session-existing");
      });
    });

    test("should not fail appendRunContent when chunk data is invalid JSON", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        nextChunkOrder: 0,
        content: [],
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [
          {
            type: "assistant",
            data: "{not-valid-json",
          },
        ],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updated = await runCtx.db.get("cliMessages", message._id);
        expect(updated?.status).toBe("streaming");
        expect(updated?.content).toHaveLength(0);
        const storedChunks = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", message._id))
          .order("asc")
          .collect();
        expect(storedChunks).toHaveLength(1);
        expect(storedChunks[0]?.data).toBe("{not-valid-json");
      });
    });

    test("should throw if message not claimed by session", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "streaming",
        // Not claimed by this session
      });

      await expect(
        t.mutation(api.cli.messages.appendRunContent, {
          messageId: message._id,
          sessionId: session._id,
          chunks: [{ type: "text", data: "chunk" }],
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("Message not claimed by this session");
    });
  });

  describe("partial streaming (ephemeral chunks)", () => {
    const textDeltaStreamEvent = JSON.stringify({
      type: "stream_event",
      session_id: "s1",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hel" },
      },
    });
    const wholeAssistantMessage = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    });

    async function setupStreamingAssistantMessage() {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        nextChunkOrder: 0,
        content: [],
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [
          { type: "stream_event", data: textDeltaStreamEvent },
          { type: "assistant", data: wholeAssistantMessage },
        ],
        apiKey: apiKeyResult.key,
      });

      return { t, chat, message, session, apiKey: apiKeyResult.key };
    }

    async function listChunkRows(
      t: Awaited<ReturnType<typeof setupStreamingAssistantMessage>>["t"],
      threadId: Id<"cliThreads">,
      messageId: Id<"cliMessages">
    ) {
      return t.run(async (runCtx) =>
        runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
            q.eq("threadId", threadId).eq("messageId", messageId)
          )
          .order("asc")
          .collect()
      );
    }

    test("stream_event chunks are stored as ephemeral with delta events", async () => {
      const { t, chat, message } = await setupStreamingAssistantMessage();

      const chunkRows = await listChunkRows(t, chat._id, message._id);
      expect(chunkRows).toHaveLength(2);
      expect(chunkRows[0]?.ephemeral).toBe(true);
      expect(chunkRows[0]?.normalizedEvent).toEqual({
        kind: "text-delta",
        text: "Hel",
      });
      expect(chunkRows[1]?.ephemeral).toBeUndefined();
      expect(chunkRows[1]?.normalizedEvent).toEqual({
        kind: "text",
        text: "Hello",
      });
    });

    test("complete deletes ephemeral chunk rows and keeps final chunks", async () => {
      const { t, chat, message, session, apiKey } =
        await setupStreamingAssistantMessage();

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const chunkRows = await listChunkRows(t, chat._id, message._id);
      expect(chunkRows).toHaveLength(1);
      expect(chunkRows[0]?.type).toBe("assistant");
    });

    test("oversized coalesced stream_event delta is split into rows under the storage budget", async () => {
      const { t, chat, message, session, apiKey } =
        await setupStreamingAssistantMessage();

      const bigText = "a".repeat(250_000);
      const oversizedDelta = JSON.stringify({
        type: "stream_event",
        session_id: "s1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: bigText },
        },
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [{ type: "stream_event", data: oversizedDelta }],
        apiKey,
      });

      const chunkRows = await listChunkRows(t, chat._id, message._id);
      const splitRows = chunkRows.slice(2);
      expect(splitRows.length).toBeGreaterThan(1);
      for (const row of splitRows) {
        expect(row.data.length).toBeLessThanOrEqual(100_000);
        expect(row.ephemeral).toBe(true);
        expect(row.normalizedEvent?.kind).toBe("text-delta");
      }
      const reassembled = splitRows
        .map((row) => {
          const parsed = JSON.parse(row.data) as {
            event: { delta: { text: string } };
          };
          return parsed.event.delta.text;
        })
        .join("");
      expect(reassembled).toBe(bigText);

      expect(await readChunkCursor(t, message._id)).toBe(2 + splitRows.length);
    });

    test("oversized tool_result chunk is scrubbed into a valid smaller row", async () => {
      const { t, chat, message, session, apiKey } =
        await setupStreamingAssistantMessage();

      const oversizedToolResult = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_img",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: "a".repeat(300_000),
                  },
                },
              ],
            },
          ],
        },
        session_id: "s1",
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [{ type: "user", data: oversizedToolResult }],
        apiKey,
      });

      const chunkRows = await listChunkRows(t, chat._id, message._id);
      expect(chunkRows).toHaveLength(3);
      const row = chunkRows[2]!;
      expect(row.data.length).toBeLessThanOrEqual(100_000);
      expect(row.normalizedEvent?.kind).toBe("tool-output");
      const parsed = JSON.parse(row.data) as {
        message: {
          content: Array<{
            tool_use_id: string;
            content: Array<{ source: { media_type: string; data: string } }>;
          }>;
        };
      };
      const source = parsed.message.content[0].content[0].source;
      expect(source.data).toBe("");
      expect(source.media_type).toBe("image/png");
      expect(parsed.message.content[0].tool_use_id).toBe("toolu_img");
    });

    test("oversized unsplittable chunk is truncated to the storage budget", async () => {
      const { t, chat, message, session, apiKey } =
        await setupStreamingAssistantMessage();

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        chunks: [{ type: "assistant", data: "x".repeat(250_000) }],
        apiKey,
      });

      const chunkRows = await listChunkRows(t, chat._id, message._id);
      expect(chunkRows).toHaveLength(3);
      expect(chunkRows[2]?.data.length).toBe(100_000);
    });

    test("fail keeps ephemeral chunk rows as the only record of partial output", async () => {
      const { t, chat, message, session, apiKey } =
        await setupStreamingAssistantMessage();

      await t.mutation(api.cli.messages.fail, {
        messageId: message._id,
        sessionId: session._id,
        errorMessage: "boom",
        apiKey,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const chunkRows = await listChunkRows(t, chat._id, message._id);
      expect(chunkRows).toHaveLength(2);
    });
  });

  describe("complete", () => {
    test("should mark message completed and update chat", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        cliContext: { continuationId: "session-123" },
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("completed");
        expect(updatedMessage?.cliContext?.continuationId).toBe("session-123");

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("completed");
      });
    });

    test("stores the diff summary and caps it at 200 files", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      const files = Array.from({ length: 250 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        kind: "modified" as const,
        additions: 1,
        deletions: 0,
      }));

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        diffSummary: {
          preRef: "refs/convoy/checkpoints/thread/run/pre",
          postRef: "refs/convoy/checkpoints/thread/run/post",
          files,
        },
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.diffSummary?.files).toHaveLength(200);
        expect(updatedMessage?.diffSummary?.truncated).toBe(true);
        expect(updatedMessage?.diffSummary?.postRef).toBe(
          "refs/convoy/checkpoints/thread/run/post"
        );
      });

      const { envelopes } = await asUser.query(api.cli.messages.listEnvelopesByThread, {
        threadId: chat._id,
      });
      const assistantEnvelope = envelopes.find((envelope) => envelope._id === message._id);
      // The envelope carries only the preview slice; `fileCount` reports the
      // stored total and the full list comes from `getRunDiffSummary`.
      expect(assistantEnvelope?.diffSummary?.fileCount).toBe(200);
      expect(assistantEnvelope?.diffSummary?.files.length).toBeLessThan(200);

      const full = await asUser.query(api.cli.messages.getRunDiffSummary, {
        messageId: message._id,
      });
      expect(full?.files).toHaveLength(200);
    });

    test("accumulates thread line totals across runs from uncapped summaries", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const firstMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      // 250 files: beyond the 200-file storage cap, so totals must come from
      // the uncapped payload.
      const files = Array.from({ length: 250 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        kind: "modified" as const,
        additions: 1,
        deletions: 0,
      }));

      await t.mutation(api.cli.messages.complete, {
        messageId: firstMessage._id,
        sessionId: session._id,
        diffSummary: {
          preRef: "refs/convoy/checkpoints/thread/run-1/pre",
          postRef: "refs/convoy/checkpoints/thread/run-1/post",
          files,
        },
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.git?.linesAdded).toBe(250);
        expect(updatedChat?.git?.linesRemoved).toBe(0);
      });

      const secondMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: secondMessage._id,
        sessionId: session._id,
        diffSummary: {
          preRef: "refs/convoy/checkpoints/thread/run-2/pre",
          postRef: "refs/convoy/checkpoints/thread/run-2/post",
          files: [
            { path: "src/a.ts", kind: "modified" as const, additions: 5, deletions: 3 },
            { path: "src/b.ts", kind: "deleted" as const, additions: 0, deletions: 7 },
          ],
        },
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.git?.linesAdded).toBe(255);
        expect(updatedChat?.git?.linesRemoved).toBe(10);
      });
    });

    test("leaves diffSummary absent when complete omits it", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.diffSummary).toBeUndefined();

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.git?.linesAdded).toBeUndefined();
        expect(updatedChat?.git?.linesRemoved).toBeUndefined();
      });
    });

    test("stores generic continuation id regardless of cli type", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        cliType: "codex",
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        cliContext: { continuationId: "codex-thread-123" },
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("completed");
        expect(updatedMessage?.cliContext?.continuationId).toBe("codex-thread-123");
      });
    });

    test("preserves an existing continuation id when complete is called without cliContext", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        cliContext: { continuationId: "session-existing" },
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.cliContext?.continuationId).toBe("session-existing");
      });
    });

    test("does not require the live session row when completing a claimed stream", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.run(async (runCtx) => {
        await runCtx.db.delete("cliSessions", session._id);
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("completed");
      });
    });

    test("sets chat to waiting_input for AskUserQuestion tool prompts", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const messageChunks = [
        {
          type: "assistant",
          data: JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_ask_1",
                  name: "AskUserQuestion",
                  input: {
                    questions: [
                      {
                        question: "Which testing frameworks do you prefer to use?",
                        header: "Testing",
                        multiSelect: true,
                        options: [{ label: "Vitest" }, { label: "Jest" }],
                      },
                    ],
                  },
                },
              ],
            },
          }),
          timestamp: 1000,
        },
        {
          type: "user",
          data: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_ask_1",
                  content: "Answer questions?",
                  is_error: true,
                },
              ],
            },
          }),
          timestamp: 1001,
        },
      ];
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        content: [],
      });
      await ctx.cliMessageChunks(message._id, chat._id, profile._id, messageChunks);

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        chatStatus: "waiting_input",
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("waiting_input");
      });
    });

    test("detects waiting_input server-side without chatStatus arg", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const messageChunks = [
        {
          type: "assistant",
          data: JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_ask_serverside",
                  name: "AskUserQuestion",
                  input: {
                    questions: [
                      {
                        question: "Pick a color?",
                        header: "Color",
                        multiSelect: false,
                        options: [{ label: "Red" }, { label: "Blue" }],
                      },
                    ],
                  },
                },
              ],
            },
          }),
          timestamp: 1000,
        },
        {
          type: "user",
          data: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_ask_serverside",
                  content: "Awaiting user response",
                  is_error: true,
                },
              ],
            },
          }),
          timestamp: 1001,
        },
      ];
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        content: [],
      });
      await ctx.cliMessageChunks(message._id, chat._id, profile._id, messageChunks);

      // Call complete WITHOUT chatStatus — server should detect waiting_input
      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("waiting_input");
      });
    });

    test("detects waiting_input at the end of a long run", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });

      // `complete` only scans the tail of the stream, so a run long enough to
      // blow the transaction read limits must still end in waiting_input.
      const filler = Array.from({ length: 600 }, (_, index) => ({
        type: "assistant",
        data: JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `step ${index}` }],
          },
        }),
        timestamp: 1000 + index,
      }));
      const messageChunks = [
        ...filler,
        {
          type: "assistant",
          data: JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_ask_long_run",
                  name: "AskUserQuestion",
                  input: {
                    questions: [
                      {
                        question: "Pick a color?",
                        header: "Color",
                        multiSelect: false,
                        options: [{ label: "Red" }, { label: "Blue" }],
                      },
                    ],
                  },
                },
              ],
            },
          }),
          timestamp: 2000,
        },
        {
          type: "user",
          data: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_ask_long_run",
                  content: "Awaiting user response",
                  is_error: true,
                },
              ],
            },
          }),
          timestamp: 2001,
        },
      ];
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        content: [],
      });
      await ctx.cliMessageChunks(message._id, chat._id, profile._id, messageChunks);

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("waiting_input");
      });
    });

    test("sets chat to waiting_input for ExitPlanMode tool prompts", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const messageChunks = [
        {
          type: "assistant",
          data: JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_exit_1",
                  name: "ExitPlanMode",
                  input: {
                    plan: "# Dummy Plan\n\n## Summary\nRun this plan.",
                  },
                },
              ],
            },
          }),
          timestamp: 1000,
        },
        {
          type: "user",
          data: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_exit_1",
                  content: "Exit plan mode?",
                  is_error: true,
                },
              ],
            },
          }),
          timestamp: 1001,
        },
      ];
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        content: [],
      });
      await ctx.cliMessageChunks(message._id, chat._id, profile._id, messageChunks);

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        chatStatus: "waiting_input",
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("waiting_input");
      });
    });

    test("does not set waiting_input for non-AskUserQuestion tool errors", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const messageChunks = [
        {
          type: "assistant",
          data: JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_read_1",
                  name: "Read",
                  input: {
                    filePath: "README.md",
                  },
                },
              ],
            },
          }),
          timestamp: 1000,
        },
        {
          type: "user",
          data: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_read_1",
                  content: "File not found",
                  is_error: true,
                },
              ],
            },
          }),
          timestamp: 1001,
        },
      ];
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        content: [],
      });
      await ctx.cliMessageChunks(message._id, chat._id, profile._id, messageChunks);

      await t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("completed");
      });
    });

    test("should clear streamWatchdogId when completing a streaming run", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
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

      await t.run(async (runCtx) => {
        const beforeComplete = await runCtx.db.get("cliThreads", chat._id);
        expect(beforeComplete?.streamWatchdogId).toBeDefined();
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.streamWatchdogId).toBeUndefined();
      });
    });

    test("should throw if message not claimed by session", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "streaming",
        // Not claimed by this session
      });

      await expect(
        t.mutation(api.cli.messages.complete, {
          messageId: message._id,
          sessionId: session._id,
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("Message not claimed by this session");
    });
  });

  describe("fail", () => {
    test("should mark message failed and update chat", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.mutation(api.cli.messages.fail, {
        messageId: message._id,
        sessionId: session._id,
        errorMessage: "Something went wrong",
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("failed");
        expect(updatedMessage?.errorMessage).toBe("Something went wrong");

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("failed");
      });
    });

    test("softens thread to waiting_input when the run was parked on the user (OS-1463)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.mutation(api.cli.interactionRequests.create, {
        threadId: chat._id,
        messageId: message._id,
        sessionId: session._id,
        requestId: "req-plan",
        kind: "plan-approval",
        payloadJson: JSON.stringify({ toolName: "ExitPlanMode", plan: "# Plan" }),
        expiresAt: Date.now() + 120_000,
        apiKey: apiKeyResult.key,
      });

      await t.mutation(api.cli.messages.fail, {
        messageId: message._id,
        sessionId: session._id,
        errorMessage: "CLI crashed while parked",
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        // The CLI reported a real failure: keep the message error for
        // diagnosis, but the thread reads as waiting on the user, not failed.
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("failed");
        expect(updatedMessage?.errorMessage).toBe("CLI crashed while parked");

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("waiting_input");
      });
    });

    test("persists cliContext when failing a message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.mutation(api.cli.messages.fail, {
        messageId: message._id,
        sessionId: session._id,
        errorMessage: "Something went wrong",
        cliContext: { continuationId: "session-failed" },
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.cliContext?.continuationId).toBe("session-failed");
      });
    });

    test("preserves an existing continuation id when fail is called without cliContext", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        cliContext: { continuationId: "session-existing" },
      });

      await t.mutation(api.cli.messages.fail, {
        messageId: message._id,
        sessionId: session._id,
        errorMessage: "Something went wrong",
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.cliContext?.continuationId).toBe("session-existing");
      });
    });

    test("should throw if message not claimed by session", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "streaming",
        // Not claimed by this session
      });

      await expect(
        t.mutation(api.cli.messages.fail, {
          messageId: message._id,
          sessionId: session._id,
          errorMessage: "Error",
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("Message not claimed by this session");
    });

    test("does not require the live session row when failing a claimed stream", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "streaming",
        claimedBySessionId: session._id,
        claimLeaseExpiresAt: Date.now() + 60_000,
        processingState: "streaming",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
      });

      await t.run(async (runCtx) => {
        await runCtx.db.delete("cliSessions", session._id);
      });

      await t.mutation(api.cli.messages.fail, {
        messageId: message._id,
        sessionId: session._id,
        errorMessage: "Something went wrong",
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("failed");
      });
    });

    test("should clear streamWatchdogId when failing a streaming run", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
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

      await t.run(async (runCtx) => {
        const beforeFail = await runCtx.db.get("cliThreads", chat._id);
        expect(beforeFail?.streamWatchdogId).toBeDefined();
      });

      await t.mutation(api.cli.messages.fail, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        errorMessage: "run failed",
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.streamWatchdogId).toBeUndefined();
      });
    });
  });

  describe("steering", () => {
    /**
     * A claimed, streaming claude-code run with one consumed run message and
     * one freshly queued (unprocessed) user message — the steering scenario.
     */
    async function setupStreamingRun(options?: {
      supportsSteering?: boolean;
      steeringCliTypes?: string[];
      cliType?: "claude-code" | "codex" | "opencode";
    }) {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id, {
        supportsSteering: options?.supportsSteering ?? true,
        ...(options?.steeringCliTypes ? { steeringCliTypes: options.steeringCliTypes } : {}),
      });
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
        ...(options?.cliType ? { cliType: options.cliType } : {}),
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
      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session._id,
        userMessageIds: [runMessage._id],
        apiKey: apiKeyResult.key,
      });

      const queuedMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "steer me",
      });

      return { ctx, user, project, asUser, t, profile, session, chat, apiKeyResult, started, queuedMessageId };
    }

    test("requestSteer marks a queued message and is idempotent", async () => {
      const { asUser, t, queuedMessageId } = await setupStreamingRun();

      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      const steerRequestedAt = await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", queuedMessageId);
        expect(message?.steerRequestedAt).toBeDefined();
        expect(message?.processedAt).toBeUndefined();
        return message?.steerRequestedAt;
      });

      // Second click is a no-op, not an error.
      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });
      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", queuedMessageId);
        expect(message?.steerRequestedAt).toBe(steerRequestedAt);
      });
    });

    test("requestSteer rejects processed and assistant messages", async () => {
      const { asUser, t, started, queuedMessageId } = await setupStreamingRun();

      await expect(
        asUser.mutation(api.cli.messages.requestSteer, { messageId: started.assistantMessageId })
      ).rejects.toThrow("Message is not a queued user message");

      // Mark processed directly to isolate the processed-message rejection.
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessages", queuedMessageId, { processedAt: Date.now() });
      });
      await expect(asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId })).rejects.toThrow(
        "Message is not a queued user message"
      );
    });

    test("requestSteer rejects when the thread is not streaming", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
      });

      const queuedMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "steer me",
      });

      await expect(asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId })).rejects.toThrow(
        "Steering is not available for this thread right now"
      );
    });

    test("requestSteer rejects when the claim lease expired", async () => {
      const { asUser, t, chat, queuedMessageId } = await setupStreamingRun();

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", chat._id, { claimLeaseExpiresAt: Date.now() - 1000 });
      });

      await expect(asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId })).rejects.toThrow(
        "Steering is not available for this thread right now"
      );
    });

    test("requestSteer rejects when the claiming session lacks steering support", async () => {
      const { asUser, queuedMessageId } = await setupStreamingRun({ supportsSteering: false });

      await expect(asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId })).rejects.toThrow(
        "Steering is not available for this thread right now"
      );
    });

    test("requestSteer rejects runtimes without steering support", async () => {
      const { asUser, queuedMessageId } = await setupStreamingRun({ cliType: "opencode" });

      await expect(asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId })).rejects.toThrow(
        "Steering is not available for this thread right now"
      );
    });

    test("requestSteer allows codex threads when the session steers codex", async () => {
      const { asUser, t, queuedMessageId } = await setupStreamingRun({
        cliType: "codex",
        steeringCliTypes: ["claude-code", "codex"],
      });

      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", queuedMessageId);
        expect(message?.steerRequestedAt).toBeDefined();
      });
    });

    test("requestSteer rejects codex threads when the session cannot steer codex", async () => {
      // Legacy session (boolean flag only) means Claude Code steering.
      const legacy = await setupStreamingRun({ cliType: "codex" });
      await expect(
        legacy.asUser.mutation(api.cli.messages.requestSteer, { messageId: legacy.queuedMessageId })
      ).rejects.toThrow("Steering is not available for this thread right now");

      // Exec-transport connection: codex absent from steeringCliTypes.
      const execTransport = await setupStreamingRun({
        cliType: "codex",
        steeringCliTypes: ["claude-code"],
      });
      await expect(
        execTransport.asUser.mutation(api.cli.messages.requestSteer, {
          messageId: execTransport.queuedMessageId,
        })
      ).rejects.toThrow("Steering is not available for this thread right now");
    });

    test("requestSteer rejects non-owners", async () => {
      const { ctx, queuedMessageId } = await setupStreamingRun();
      const otherUser = await ctx.user();
      const asOtherUser = ctx.asUser(otherUser);

      await expect(asOtherUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId })).rejects.toThrow();
    });

    test("send with steer stamps the message when the run can consume it (OS-1873)", async () => {
      const { asUser, t, chat, session, apiKeyResult } = await setupStreamingRun();

      const messageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "steer at send",
        steer: true,
      });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", messageId);
        expect(message?.steerRequestedAt).toBeDefined();
        expect(message?.processedAt).toBeUndefined();
      });

      // Visible to the claiming CLI's per-run subscription — the delivery path.
      const steerable = await t.query(api.cli.messages.listSteerRequestedUserMessages, {
        threadId: chat._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });
      expect(steerable.map((message) => message._id)).toContain(messageId);
    });

    test("send with steer queues plainly when steering is unavailable", async () => {
      // Idle thread: no active run to inject into.
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        status: "pending",
      });

      const idleMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "steer me",
        steer: true,
      });
      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", idleMessageId);
        expect(message?.steerRequestedAt).toBeUndefined();
      });

      // Streaming, but the claiming session cannot steer.
      const noSteering = await setupStreamingRun({ supportsSteering: false });
      const unsteeredMessageId = await noSteering.asUser.mutation(api.cli.messages.send, {
        threadId: noSteering.chat._id,
        content: "steer me",
        steer: true,
      });
      await noSteering.t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", unsteeredMessageId);
        expect(message?.steerRequestedAt).toBeUndefined();
      });
    });

    test("send drops steer for runtime commands", async () => {
      const { asUser, t, chat } = await setupStreamingRun();

      const messageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "/compact",
        runtimeCommand: true,
        steer: true,
      });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", messageId);
        expect(message?.runtimeCommand).toBe(true);
        expect(message?.steerRequestedAt).toBeUndefined();
      });
    });

    test("listSteerRequestedUserMessages returns only steer-requested queued messages for the claiming session", async () => {
      const { asUser, t, chat, session, apiKeyResult, ctx, queuedMessageId } = await setupStreamingRun();

      // A second queued message without a steer request stays invisible.
      await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "just queued" });

      const before = await t.query(api.cli.messages.listSteerRequestedUserMessages, {
        threadId: chat._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });
      expect(before).toEqual([]);

      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      const after = await t.query(api.cli.messages.listSteerRequestedUserMessages, {
        threadId: chat._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });
      expect(after).toHaveLength(1);
      expect(after[0]?._id).toBe(queuedMessageId);

      // Another session (not the claimant) sees nothing.
      const otherSession = await ctx.cliSession(session.profileId, apiKeyResult.id, { supportsSteering: true });
      const otherView = await t.query(api.cli.messages.listSteerRequestedUserMessages, {
        threadId: chat._id,
        sessionId: otherSession._id,
        apiKey: apiKeyResult.key,
      });
      expect(otherView).toEqual([]);

      // Claim expiry silences the query for the old claimant.
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", chat._id, { claimLeaseExpiresAt: Date.now() - 1000 });
      });
      const expiredView = await t.query(api.cli.messages.listSteerRequestedUserMessages, {
        threadId: chat._id,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });
      expect(expiredView).toEqual([]);
    });

    test("consumeSteeredMessages stamps messages into the active run and recomputes pending flag", async () => {
      const { asUser, t, chat, session, apiKeyResult, started, queuedMessageId } = await setupStreamingRun();
      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      await t.mutation(api.cli.messages.consumeSteeredMessages, {
        threadId: chat._id,
        sessionId: session._id,
        assistantMessageId: started.assistantMessageId,
        userMessageIds: [queuedMessageId],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", queuedMessageId);
        expect(message?.processedAt).toBeDefined();
        expect(message?.processedBySessionId).toBe(session._id);
        expect(message?.runId).toBe(started.runId);
        expect(message?.steerRequestedAt).toBeUndefined();
        expect(message?.steeredAt).toBeDefined();

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.hasPendingUserMessages).toBe(false);
        expect(updatedChat?.processingState).toBe("streaming");
        expect(updatedChat?.activeAssistantMessageId).toBe(started.assistantMessageId);

        // The marker chunk renders the steered text inline in the assistant
        // stream at the injection position.
        const assistantChunks = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
            q.eq("threadId", chat._id).eq("messageId", started.assistantMessageId)
          )
          .collect();
        const marker = assistantChunks.find((chunk) => chunk.type === "convoy_notice");
        expect(marker).toBeDefined();
        expect(marker?.data).toContain("steered-message");
        expect(marker?.data).toContain("steer me");

        // The marker carries the steered user message id so the inline bubble
        // can resolve that message's attachments at render time.
        const markerData = JSON.parse(marker?.data ?? "{}") as { messageId?: string };
        expect(markerData.messageId).toBe(queuedMessageId);
        expect(marker?.normalizedEvent).toMatchObject({
          kind: "runtime-notice",
          code: "steered-message",
          detailsJson: JSON.stringify({ messageId: queuedMessageId }),
        });

        const head = await runCtx.db
          .query("cliMessageStreamHeads")
          .withIndex("by_message", (q) => q.eq("messageId", started.assistantMessageId))
          .first();
        expect(head?.nextChunkOrder).toBe(assistantChunks.length);
      });
    });

    test("consumeSteeredMessages keeps pending flag when other queued messages remain", async () => {
      const { asUser, t, chat, session, apiKeyResult, started, queuedMessageId } = await setupStreamingRun();
      await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "still queued" });
      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      await t.mutation(api.cli.messages.consumeSteeredMessages, {
        threadId: chat._id,
        sessionId: session._id,
        assistantMessageId: started.assistantMessageId,
        userMessageIds: [queuedMessageId],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.hasPendingUserMessages).toBe(true);
      });
    });

    test("consumeSteeredMessages rejects messages that are not steer-requested or already processed", async () => {
      const { t, chat, session, apiKeyResult, started, queuedMessageId } = await setupStreamingRun();

      await expect(
        t.mutation(api.cli.messages.consumeSteeredMessages, {
          threadId: chat._id,
          sessionId: session._id,
          assistantMessageId: started.assistantMessageId,
          userMessageIds: [queuedMessageId],
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("One or more steered messages are no longer pending");
    });

    test("consumeSteeredMessages rejects a non-streaming assistant target", async () => {
      const { asUser, t, chat, session, apiKeyResult, started, queuedMessageId } = await setupStreamingRun();
      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      await t.mutation(api.cli.messages.complete, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });

      await expect(
        t.mutation(api.cli.messages.consumeSteeredMessages, {
          threadId: chat._id,
          sessionId: session._id,
          assistantMessageId: started.assistantMessageId,
          userMessageIds: [queuedMessageId],
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow();
    });

    test("startRunResponse absorbs an unconsumed steer request and clears the flag", async () => {
      const { asUser, t, chat, session, apiKeyResult, started, queuedMessageId } = await setupStreamingRun();
      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      // Run ends without consuming the steer; the next run picks it up.
      await t.mutation(api.cli.messages.complete, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        apiKey: apiKeyResult.key,
      });
      const nextRun = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session._id,
        userMessageIds: [queuedMessageId],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", queuedMessageId);
        expect(message?.processedAt).toBeDefined();
        expect(message?.runId).toBe(nextRun.runId);
        expect(message?.steerRequestedAt).toBeUndefined();
      });
    });

    test("retry of a run containing steered messages requeues them without steer state", async () => {
      const { asUser, t, chat, session, apiKeyResult, started, queuedMessageId } = await setupStreamingRun();
      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });
      await t.mutation(api.cli.messages.consumeSteeredMessages, {
        threadId: chat._id,
        sessionId: session._id,
        assistantMessageId: started.assistantMessageId,
        userMessageIds: [queuedMessageId],
        apiKey: apiKeyResult.key,
      });
      await t.mutation(api.cli.messages.fail, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        errorMessage: "boom",
        apiKey: apiKeyResult.key,
      });

      await asUser.mutation(api.cli.messages.retry, { messageId: started.assistantMessageId });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", queuedMessageId);
        expect(message?.processedAt).toBeUndefined();
        expect(message?.runId).toBeUndefined();
        expect(message?.steerRequestedAt).toBeUndefined();
        expect(message?.steeredAt).toBeUndefined();
      });
    });

    test("removeQueued deletes a queued message and recomputes the pending flag", async () => {
      const { asUser, t, chat, queuedMessageId } = await setupStreamingRun();

      await asUser.mutation(api.cli.messages.removeQueued, { messageId: queuedMessageId });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", queuedMessageId)).toBeNull();
        const chunks = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
            q.eq("threadId", chat._id).eq("messageId", queuedMessageId)
          )
          .collect();
        expect(chunks).toHaveLength(0);
        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.hasPendingUserMessages).toBe(false);
        // The active run is untouched.
        expect(updatedChat?.processingState).toBe("streaming");
      });
    });

    test("removeQueued emptying an unclaimed queue settles the pending thread (OS-2311)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, { status: "completed" });
      const messageId = await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "offline" });

      await asUser.mutation(api.cli.messages.removeQueued, { messageId });

      const updatedChat = await t.run((runCtx) => runCtx.db.get("cliThreads", chat._id));
      expect(updatedChat?.hasPendingUserMessages).toBe(false);
      expect(updatedChat?.status).toBe("completed");
    });

    test("removeQueued rejects processed and steer-requested messages", async () => {
      const { asUser, t, queuedMessageId } = await setupStreamingRun();

      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });
      await expect(asUser.mutation(api.cli.messages.removeQueued, { messageId: queuedMessageId })).rejects.toThrow(
        "Message is not a queued user message"
      );

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessages", queuedMessageId, {
          steerRequestedAt: undefined,
          processedAt: Date.now(),
        });
      });
      await expect(asUser.mutation(api.cli.messages.removeQueued, { messageId: queuedMessageId })).rejects.toThrow(
        "Message is not a queued user message"
      );
    });

    test("removeQueued deletes attachment refs and unreferenced blobs", async () => {
      const { asUser, t, chat } = await setupStreamingRun();
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["img"]));
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: chat.projectId, storageId });
      const messageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "with file",
        attachments: [{ storageId, fileName: "f.png", fileSize: 3, contentType: "image/png" }],
      });

      await asUser.mutation(api.cli.messages.removeQueued, { messageId });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", messageId)).toBeNull();
        const refs = await runCtx.db
          .query("cliMessageAttachmentRefs")
          .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
          .collect();
        expect(refs).toHaveLength(0);
        expect(await runCtx.storage.getUrl(storageId)).toBeNull();
      });
    });

    test("removeQueued with preserveAttachments keeps blobs as pending uploads and returns summaries", async () => {
      const { user, asUser, t, chat } = await setupStreamingRun();
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["img"]));
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: chat.projectId, storageId });
      const messageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "with file",
        attachments: [{ storageId, fileName: "f.png", fileSize: 3, contentType: "image/png" }],
      });

      const restored = await asUser.mutation(api.cli.messages.removeQueued, {
        messageId,
        preserveAttachments: true,
      });

      // Edit restores this text, not the client's possibly unloaded copy (OS-2422).
      expect(restored.text).toBe("with file");
      expect(restored.attachments).toHaveLength(1);
      expect(restored.attachments[0]).toMatchObject({
        storageId,
        fileName: "f.png",
        fileSize: 3,
        contentType: "image/png",
      });
      expect(restored.attachments[0]?.url).toBeTruthy();

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", messageId)).toBeNull();
        // Refs are gone but the blob survives, now owned by a pending-upload
        // row so composer abandon/remove cleanup can delete it.
        const refs = await runCtx.db
          .query("cliMessageAttachmentRefs")
          .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
          .collect();
        expect(refs).toHaveLength(0);
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
        const pendingRows = await runCtx.db
          .query("cliMessagePendingUploads")
          .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
          .collect();
        expect(pendingRows).toHaveLength(1);
        expect(pendingRows[0]?.userId).toBe(user._id);
        expect(pendingRows[0]?.projectId).toBe(chat.projectId);
      });

      // The pending-upload row lets the standard composer cleanup delete the
      // preserved blob when the user discards the restored attachment.
      await asUser.mutation(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: chat.projectId,
        storageId,
      });
      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).toBeNull();
      });
    });

    test("cancelProcessing keeps steer-requested queued messages, clears the flag, and holds the queue", async () => {
      const { asUser, t, chat, queuedMessageId } = await setupStreamingRun();
      await asUser.mutation(api.cli.messages.requestSteer, { messageId: queuedMessageId });

      await asUser.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: chat._id });

      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", queuedMessageId);
        expect(message?.processedAt).toBeUndefined();
        expect(message?.steerRequestedAt).toBeUndefined();

        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.hasPendingUserMessages).toBe(true);
        expect(thread?.queueHeldAt).toBeDefined();
      });
    });
  });

  describe("editLastResend", () => {
    /**
     * A run that ran and was stopped: user message(s) processed into a
     * run, assistant failed by cancelProcessing, thread idle. Optional
     * extras: a second run message (run-peer-requeue case) and a message
     * queued after the run started (held-queue case).
     */
    async function setupStoppedRun(options?: {
      secondRunMessage?: boolean;
      queuedAfterStart?: boolean;
    }) {
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

      const firstMessageId = options?.secondRunMessage
        ? await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "first part" })
        : null;
      const lastMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "fix the bug",
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
        userMessageIds: firstMessageId ? [firstMessageId, lastMessageId] : [lastMessageId],
        apiKey: apiKeyResult.key,
      });

      const queuedMessageId = options?.queuedAfterStart
        ? await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "queued later" })
        : null;

      await asUser.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: chat._id });

      return {
        ctx,
        user,
        asUser,
        t,
        profile,
        session,
        chat,
        apiKeyResult,
        started,
        firstMessageId,
        lastMessageId,
        queuedMessageId,
      };
    }

    async function getMessageTextChunks(
      t: Awaited<ReturnType<typeof setupStoppedRun>>["t"],
      threadId: Id<"cliThreads">,
      messageId: Id<"cliMessages">
    ) {
      return await t.run(async (runCtx) => {
        const chunks = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_createdAt_and_messageId_and_chunkOrder", (q) =>
            q.eq("threadId", threadId)
          )
          .collect();
        return chunks.filter((chunk) => chunk.messageId === messageId);
      });
    }

    test("keeps, replaces, or removes the message's PR; the thread's Attached pull request stays", async () => {
      const { asUser, t, chat, lastMessageId } = await setupStoppedRun();
      const readPullRequest = async () => (await t.run((runCtx) => runCtx.db.get("cliMessages", lastMessageId)))?.pullRequest?.ref;
      await t.run((runCtx) => runCtx.db.patch("cliMessages", lastMessageId, {
        pullRequest: { owner: "contoso", name: "convoy", number: 482, ref: "contoso/convoy#482" },
      }));

      await asUser.mutation(api.cli.messages.editLastResend, { messageId: lastMessageId, content: "again" });
      expect(await readPullRequest()).toBe("contoso/convoy#482");
      await asUser.mutation(api.cli.messages.editLastResend, { messageId: lastMessageId, content: "again", pullRequestUrl: "contoso/convoy#475" });
      expect(await readPullRequest()).toBe("contoso/convoy#475");
      await asUser.mutation(api.cli.messages.editLastResend, { messageId: lastMessageId, content: "again", pullRequestUrl: null });
      expect(await readPullRequest()).toBeUndefined();
      expect((await t.run((runCtx) => runCtx.db.get("cliThreads", chat._id)))?.attachedPullRequest).toBeUndefined();
    });

    test("reopens a done thread (OS-2176)", async () => {
      const { asUser, t, chat, lastMessageId } = await setupStoppedRun();
      await asUser.mutation(api.cli.threads.core.markDone, { threadId: chat._id });
      await asUser.mutation(api.cli.messages.editLastResend, { messageId: lastMessageId, content: "fix it differently" });
      expect((await t.run((runCtx) => runCtx.db.get("cliThreads", chat._id)))?.statusProjection?.isDone).toBe(false);
    });

    test("resends with edited composer settings and runtime command", async () => {
      const { asUser, t, chat, lastMessageId } = await setupStoppedRun();
      await asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId,
        content: "/compact",
        cliMode: "plan",
        cliModel: "opus",
        cliEffort: "high",
        runtimeCommand: true,
      });
      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", lastMessageId)).toMatchObject({
          cliMode: "plan", cliModel: "opus", cliEffort: "high", runtimeCommand: true,
        });
        expect((await runCtx.db.get("cliThreads", chat._id))?.metadata?.cli).toMatchObject({
          lastUsedMode: "plan", lastUsedModel: "opus", lastUsedEffort: "high",
        });
      });
    });

    test("editing a queue-first command into prose drops its priority (OS-2339)", async () => {
      const { asUser, t, chat } = await setupStoppedRun();
      const compactId = await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "/compact", runtimeCommand: true, queueFirst: true });
      await asUser.mutation(api.cli.messages.editLastResend, { messageId: compactId, content: "/compact focus on tests" });
      expect((await t.run((runCtx) => runCtx.db.get("cliMessages", compactId)))?.queueFirst).toBe(true);

      await asUser.mutation(api.cli.messages.editLastResend, { messageId: compactId, content: "just prose", runtimeCommand: false });
      const edited = await t.run((runCtx) => runCtx.db.get("cliMessages", compactId));
      expect(edited?.runtimeCommand).toBeUndefined();
      expect(edited?.queueFirst).toBeUndefined();
    });

    test("edit composer expands commands and can clear model, effort and task", async () => {
      const { asUser, t, chat, lastMessageId } = await setupStoppedRun();
      const commandId = await asUser.mutation(api.slashCommands.core.createInProject, {
        projectId: chat.projectId, key: "review", content: "Review the implementation.", autoExpand: false,
      });
      await asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId,
        content: "[/review](convoy://command/project:review)",
        cliModel: null, cliEffort: null, taskId: null,
        composerDocument: { version: 1, refs: [{ type: "slash-command", id: commandId, scope: "project", key: "review", canonicalKey: "project:review", displayLabel: "/review" }] },
      });
      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", lastMessageId);
        expect(message?.processedContent).toContain("Review the implementation.");
        expect(message?.cliModel).toBeUndefined();
        expect(message?.cliEffort).toBeUndefined();
        expect(message?.taskId).toBeUndefined();
      });
    });

    test("edit composer retains existing blobs, claims new uploads and removes old refs", async () => {
      const { asUser, t, chat, lastMessageId } = await setupStoppedRun();
      const stored = await t.run(async (runCtx) => {
        const old = await runCtx.storage.store(new Blob(["old"]));
        const keep = await runCtx.storage.store(new Blob(["kep"]));
        const added = await runCtx.storage.store(new Blob(["new"]));
        for (const storageId of [old, keep]) {
          await runCtx.db.insert("cliMessageAttachmentRefs", { messageId: lastMessageId, threadId: chat._id, storageId, createdAt: Date.now() });
        }
        await runCtx.db.patch("cliMessages", lastMessageId, { attachments: [old, keep].map((storageId) => ({ storageId, fileName: "file.txt", fileSize: 3, contentType: "text/plain", uploadedAt: 1 })) });
        return { old, keep, added };
      });
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: chat.projectId, storageId: stored.added });
      await asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId, content: "",
        attachments: [stored.keep, stored.added].map((storageId) => ({ storageId, fileName: "file.txt", fileSize: 3, contentType: "text/plain" })),
      });
      await t.run(async (runCtx) => {
        const message = await runCtx.db.get("cliMessages", lastMessageId);
        expect(message?.attachments?.map((item) => item.storageId)).toEqual([stored.keep, stored.added]);
        const refs = await runCtx.db.query("cliMessageAttachmentRefs").withIndex("by_messageId", (q) => q.eq("messageId", lastMessageId)).collect();
        expect(new Set(refs.map((item) => item.storageId))).toEqual(new Set([stored.keep, stored.added]));
        expect(await runCtx.storage.getUrl(stored.old)).toBeNull();
        expect(await runCtx.storage.getUrl(stored.keep)).not.toBeNull();
      });
    });

    test("edit composer rejects a forged fileSize on a retained attachment (OS-1676)", async () => {
      const { asUser, t, chat, lastMessageId } = await setupStoppedRun();
      const storageId = await t.run(async (runCtx) => {
        const id = await runCtx.storage.store(new Blob(["kep"]));
        await runCtx.db.insert("cliMessageAttachmentRefs", { messageId: lastMessageId, threadId: chat._id, storageId: id, createdAt: Date.now() });
        await runCtx.db.patch("cliMessages", lastMessageId, { attachments: [{ storageId: id, fileName: "file.txt", fileSize: 3, contentType: "text/plain", uploadedAt: 1 }] });
        return id;
      });
      await expect(asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId, content: "",
        attachments: [{ storageId, fileName: "file.txt", fileSize: -1, contentType: "text/plain" }],
      })).rejects.toThrow(errors.ATTACHMENT_SIZE_MISMATCH);
    });

    test("edit composer rejects foreign uploads atomically", async () => {
      const { asUser, t, lastMessageId, started } = await setupStoppedRun();
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob(["unclaimed"])));
      await expect(asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId, content: "changed",
        attachments: [{ storageId, fileName: "other.txt", fileSize: 9, contentType: "text/plain" }],
      })).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", started.assistantMessageId)).not.toBeNull();
        expect((await runCtx.db.get("cliMessages", lastMessageId))?.processedAt).toBeDefined();
      });
    });

    test("edits a stopped turn in place and resends it", async () => {
      const { asUser, t, chat, started, lastMessageId } = await setupStoppedRun();

      await asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId,
        content: "fix the bug properly",
      });

      const textChunks = await getMessageTextChunks(t, chat._id, lastMessageId);
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0]?.data).toBe("fix the bug properly");
      expect(textChunks[0]?.normalizedEvent).toEqual({
        kind: "text",
        text: "fix the bug properly",
      });

      await t.run(async (runCtx) => {
        // The discarded response is gone; the message rejoined the queue.
        expect(await runCtx.db.get("cliMessages", started.assistantMessageId)).toBeNull();
        const message = await runCtx.db.get("cliMessages", lastMessageId);
        expect(message?.processedAt).toBeUndefined();
        expect(message?.processedBySessionId).toBeUndefined();
        expect(message?.runId).toBeUndefined();
        expect(message?.nextChunkOrder).toBe(1);

        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.status).toBe("pending");
        expect(thread?.processingState).toBe("idle");
        expect(thread?.hasPendingUserMessages).toBe(true);
        expect(thread?.queueHeldAt).toBeUndefined();
        expect(thread?.activeAssistantMessageId).toBeUndefined();
      });
    });

    test("rejects an edit while a response is in flight", async () => {
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
      const messageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "original ask",
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
        userMessageIds: [messageId],
        apiKey: apiKeyResult.key,
      });

      // Mid-stream edit with no Stop first: rejected, run untouched.
      await expect(
        asUser.mutation(api.cli.messages.editLastResend, {
          messageId,
          content: "changed my mind",
        })
      ).rejects.toThrow("Stop the response before editing the message");

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", started.assistantMessageId)).not.toBeNull();
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.claimedBySessionId).toBe(session._id);
        expect(thread?.processingState).not.toBe("idle");
      });
    });

    test("requeues other messages from the run alongside the edited message", async () => {
      const { asUser, t, chat, started, firstMessageId, lastMessageId } = await setupStoppedRun({
        secondRunMessage: true,
      });

      await asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId,
        content: "second part, edited",
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", started.assistantMessageId)).toBeNull();

        const runPeer = await runCtx.db.get("cliMessages", firstMessageId!);
        expect(runPeer?.processedAt).toBeUndefined();
        expect(runPeer?.runId).toBeUndefined();

        // Resend releases the queue: everything reruns in original order.
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.hasPendingUserMessages).toBe(true);
        expect(thread?.queueHeldAt).toBeUndefined();
        expect(thread?.status).toBe("pending");
      });
    });

    test("resending clears a held queue and keeps queued messages", async () => {
      const { asUser, t, chat, queuedMessageId } = await setupStoppedRun({
        queuedAfterStart: true,
      });

      await t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.queueHeldAt).toBeDefined();
      });

      await asUser.mutation(api.cli.messages.editLastResend, {
        messageId: queuedMessageId!,
        content: "go again",
      });

      await t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.queueHeldAt).toBeUndefined();
        expect(thread?.hasPendingUserMessages).toBe(true);
        expect(thread?.status).toBe("pending");
      });
    });

    test("rewinding a completed turn falls back to the previous continuation", async () => {
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

      // Earlier completed turn whose continuation the rewound thread should
      // resume from.
      await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "completed",
        runId: "run-earlier",
        createdAt: 100,
        updatedAt: 100,
        cliContext: { continuationId: "cont-previous" },
      });

      const lastMessageId = await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "follow-up",
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
        userMessageIds: [lastMessageId],
        apiKey: apiKeyResult.key,
      });
      // Complete the run through the real lifecycle so the rewind operates on
      // the exact state a finished run leaves behind.
      await t.mutation(api.cli.messages.complete, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        cliContext: { continuationId: "cont-discarded" },
        apiKey: apiKeyResult.key,
      });

      await asUser.mutation(api.cli.messages.editLastResend, {
        messageId: lastMessageId,
        content: "follow-up, edited",
      });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", started.assistantMessageId)).toBeNull();
      });
      const continuation = await t.query(api.cli.messages.getLatestContinuationForThread, {
        threadId: chat._id,
        apiKey: apiKeyResult.key,
      });
      expect(continuation).toBe("cont-previous");
    });

    test("rejects a message that is not the latest user message", async () => {
      const { asUser, lastMessageId, queuedMessageId } = await setupStoppedRun({
        queuedAfterStart: true,
      });
      expect(queuedMessageId).not.toBeNull();

      await expect(
        asUser.mutation(api.cli.messages.editLastResend, {
          messageId: lastMessageId,
          content: "too old",
        })
      ).rejects.toThrow("Only the latest user message can be edited");
    });

    test("rejects a processed legacy message without a run", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "completed",
        processingState: "idle",
        hasPendingUserMessages: false,
      });
      // Legacy pre-run rows: processed user message with no run identity, and an
      // assistant reply that can't be tied back to it.
      const legacyUserMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        status: "completed",
        processedAt: 100,
        runId: undefined,
        createdAt: 100,
        updatedAt: 100,
      });
      const legacyAssistant = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "completed",
        runId: undefined,
        createdAt: 200,
        updatedAt: 200,
      });

      await expect(
        asUser.mutation(api.cli.messages.editLastResend, {
          messageId: legacyUserMessage._id,
          content: "edited legacy",
        })
      ).rejects.toThrow("This message predates editing and can't be edited");

      // Nothing was half-rewound.
      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("cliMessages", legacyUserMessage._id)).not.toBeNull();
        expect(await runCtx.db.get("cliMessages", legacyAssistant._id)).not.toBeNull();
      });
    });

    test("rejects empty content for a text-only message", async () => {
      const { asUser, lastMessageId } = await setupStoppedRun();

      await expect(
        asUser.mutation(api.cli.messages.editLastResend, {
          messageId: lastMessageId,
          content: "   ",
        })
      ).rejects.toThrow();
    });

    test("retry of the stopped turn clears the held queue", async () => {
      const { asUser, t, chat, started, queuedMessageId } = await setupStoppedRun({
        queuedAfterStart: true,
      });

      await t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.queueHeldAt).toBeDefined();
      });

      await asUser.mutation(api.cli.messages.retry, {
        messageId: started.assistantMessageId,
      });

      await t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.queueHeldAt).toBeUndefined();
        expect(thread?.hasPendingUserMessages).toBe(true);

        const queued = await runCtx.db.get("cliMessages", queuedMessageId!);
        expect(queued?.processedAt).toBeUndefined();
      });
    });

    test("deleting the last held message clears the hold", async () => {
      const { asUser, t, chat, queuedMessageId } = await setupStoppedRun({
        queuedAfterStart: true,
      });

      await asUser.mutation(api.cli.messages.removeQueued, {
        messageId: queuedMessageId!,
      });

      await t.run(async (runCtx) => {
        const thread = await runCtx.db.get("cliThreads", chat._id);
        expect(thread?.hasPendingUserMessages).toBe(false);
        expect(thread?.queueHeldAt).toBeUndefined();
      });
    });
  });

  describe("retry", () => {
    test("reopens a done thread (OS-2176)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, { status: "failed" });
      const message = await ctx.cliMessage(chat._id, profile._id, { status: "failed" });
      await asUser.mutation(api.cli.threads.core.markDone, { threadId: chat._id });

      await asUser.mutation(api.cli.messages.retry, { messageId: message._id });

      expect((await t.run((runCtx) => runCtx.db.get("cliThreads", chat._id)))?.statusProjection?.isDone).toBe(false);
    });

    test("should reset failed message to pending", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });

      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "failed",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "failed",
        claimedBySessionId: session._id,
        errorMessage: "Something went wrong",
      });

      await asUser.mutation(api.cli.messages.retry, {
        messageId: message._id,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("pending");
        expect(updatedMessage?.claimedBySessionId).toBeUndefined();
        expect(updatedMessage?.claimedAt).toBeUndefined();
        expect(updatedMessage?.errorMessage).toBeUndefined();

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.status).toBe("pending");
      });
    });

    test("should keep pending status when retrying a pending message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "pending",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "pending",
      });

      await asUser.mutation(api.cli.messages.retry, {
        messageId: message._id,
      });

      await t.run(async (runCtx) => {
        const updatedMessage = await runCtx.db.get("cliMessages", message._id);
        expect(updatedMessage?.status).toBe("pending");
      });
    });

    test("should delete failed assistant run message and requeue its user messages", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "pending",
        hasPendingUserMessages: true,
      });
      const userMessage1 = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
      });
      const userMessage2 = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
      });

      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt,
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);

      await t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: chat._id,
        sessionId: session._id,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      });

      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session._id,
        userMessageIds: [userMessage1._id, userMessage2._id],
        apiKey: apiKeyResult.key,
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        chunks: [{ type: "assistant", data: '{"type":"assistant"}' }],
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessages", started.assistantMessageId, {
          status: "failed",
          errorMessage: "Runner failed",
        });
        await runCtx.db.patch("cliThreads", chat._id, {
          status: "failed",
        });
      });

      await asUser.mutation(api.cli.messages.retry, {
        messageId: started.assistantMessageId,
      });

      await t.run(async (runCtx) => {
        const deletedAssistant = await runCtx.db.get("cliMessages", started.assistantMessageId);
        expect(deletedAssistant).toBeNull();
        const assistantChunkRows = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", started.assistantMessageId))
          .collect();
        expect(assistantChunkRows).toHaveLength(0);

        const requeuedMessage1 = await runCtx.db.get("cliMessages", userMessage1._id);
        const requeuedMessage2 = await runCtx.db.get("cliMessages", userMessage2._id);
        expect(requeuedMessage1?.processedAt).toBeUndefined();
        expect(requeuedMessage1?.processedBySessionId).toBeUndefined();
        expect(requeuedMessage1?.runId).toBeUndefined();
        expect(requeuedMessage2?.processedAt).toBeUndefined();
        expect(requeuedMessage2?.processedBySessionId).toBeUndefined();
        expect(requeuedMessage2?.runId).toBeUndefined();

        const updatedChat = await runCtx.db.get("cliThreads", chat._id);
        expect(updatedChat?.hasPendingUserMessages).toBe(true);
        expect(updatedChat?.status).toBe("pending");
        expect(updatedChat?.activeAssistantMessageId).toBeUndefined();
        expect(updatedChat?.streamWatchdogId).toBeUndefined();
      });
    });

    test("retry re-derives the projection from post-cancellation state, keeping the container aggregate live", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);

      const container = await ctx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "pending",
        hasPendingUserMessages: true,
        parentThreadId: container._id,
      });
      const userMessage = await ctx.cliMessage(chat._id, profile._id, { role: "user" });

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

      // The run parks on an approval: the child reads `waiting_input`, so the
      // group row reads `needs_attention`.
      await t.mutation(api.cli.interactionRequests.create, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        requestId: "req-1",
        kind: "tool-approval",
        payloadJson: JSON.stringify({ toolName: "Bash" }),
        expiresAt: Date.now() + 120_000,
        apiKey: apiKeyResult.key,
      });

      await t.run(async (runCtx) => {
        const parked = await runCtx.db.get("cliThreads", chat._id);
        expect(parked?.hasPendingInteraction).toBe(true);
        expect(parked?.statusProjection?.watchTowerStatus).toBe("waiting_input");
        const group = await runCtx.db.get("cliThreads", container._id);
        expect(group?.aggregateStatus).toBe("needs_attention");
      });

      // Retry cancels the pending request before requeueing, so the requeued
      // thread is running again — not still parked on an approval nobody holds.
      await asUser.mutation(api.cli.messages.retry, {
        messageId: started.assistantMessageId,
      });

      await t.run(async (runCtx) => {
        const requeued = await runCtx.db.get("cliThreads", chat._id);
        expect(requeued?.status).toBe("pending");
        expect(requeued?.hasPendingInteraction).toBe(false);
        expect(requeued?.statusProjection?.watchTowerStatus).toBe("running");

        const group = await runCtx.db.get("cliThreads", container._id);
        expect(group?.aggregateStatus).toBe("running");
      });
    });

    test("retry of a long run deletes its chunk rows in scheduled batches (OS-1840)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        status: "failed",
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        content: [],
        status: "failed",
        runId: "run-long",
      });
      const chunkCount = CHUNK_DELETE_BATCH_SIZE + 100;
      await ctx.cliMessageChunks(
        message._id,
        chat._id,
        profile._id,
        Array.from({ length: chunkCount }, (_, index) => ({
          type: "text",
          data: `chunk-${index}`,
        }))
      );

      const countChunks = async () =>
        t.run(async (runCtx) => (await runCtx.db.query("cliMessageChunks").collect()).length);

      await asUser.mutation(api.cli.messages.retry, { messageId: message._id });

      // One transaction deletes at most a batch — collecting and deleting every
      // row of a long run exceeds Convex's per-mutation read limit.
      expect(await countChunks()).toBe(chunkCount - CHUNK_DELETE_BATCH_SIZE);

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      expect(await countChunks()).toBe(0);
    });

    test("should reject retry on completed message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "completed",
      });

      await expect(asUser.mutation(api.cli.messages.retry, { messageId: message._id })).rejects.toThrow("Cannot retry completed message");
    });

    test("should throw for deleted chat", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, {
        isDeleted: true,
      });
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "failed",
      });

      await expect(asUser.mutation(api.cli.messages.retry, { messageId: message._id })).rejects.toThrow("Thread not found");
    });

    test("should require project access", async () => {
      const ctx = createTestContext();
      const { user, project } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(chat._id, profile._id, {
        status: "failed",
      });
      const { asUser: asOtherUser } = await ctx.setupUser();

      await expect(asOtherUser.mutation(api.cli.messages.retry, { messageId: message._id })).rejects.toThrow();
    });
  });

  describe("attachment upload helpers", () => {
    test("generateMessageAttachmentUploadUrl returns a URL for project members", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      const uploadUrl = await asUser.mutation(api.cli.messages.generateMessageAttachmentUploadUrl, { projectId: project._id });

      expect(uploadUrl).toEqual(expect.any(String));
    });

    test("registerPendingUploadedAttachment creates pending upload record", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["pending"]));
      });

      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        const rows = await runCtx.db
          .query("cliMessagePendingUploads")
          .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
          .collect();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.projectId).toBe(project._id);
        expect(rows[0]?.userId).toBe(user._id);
      });
    });

    test("deletePendingUploadedAttachment deletes only registered unreferenced storage", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["pending"]));
      });

      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await asUser.mutation(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        const url = await runCtx.storage.getUrl(storageId);
        expect(url).toBeNull();
        const rows = await runCtx.db
          .query("cliMessagePendingUploads")
          .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
          .collect();
        expect(rows).toHaveLength(0);
      });
    });

    test("deletePendingUploadedAttachment does not delete unregistered storage", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["pending"]));
      });

      await asUser.mutation(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        const url = await runCtx.storage.getUrl(storageId);
        expect(url).toBeTruthy();
      });
    });

    test("deletePendingUploadedAttachment keeps storage referenced by a message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["attached"]));
      });

      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "keep attachment",
        attachments: [
          {
            storageId,
            fileName: "attached.txt",
            fileSize: 8,
            contentType: "text/plain",
          },
        ],
      });

      await asUser.mutation(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        const url = await runCtx.storage.getUrl(storageId);
        expect(url).toBeTruthy();
      });
    });

    test("deletePendingUploadedAttachment cannot delete another users pending upload", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const asOtherUser = ctx.asUser(otherUser);
      let storageId!: Id<"_storage">;

      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["pending"]));
      });

      await asOtherUser.mutation(api.cli.messages.registerPendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await asUser.mutation(api.cli.messages.deletePendingUploadedAttachment, {
        projectId: project._id,
        storageId,
      });

      await t.run(async (runCtx) => {
        const url = await runCtx.storage.getUrl(storageId);
        expect(url).toBeTruthy();
      });
    });

    /**
     * The CLI's `--attach` (OS-1634) has no Clerk identity and no cron reclaimer, so
     * all three steps must work on a key and the register/delete pair must round-trip
     * for its `finally` to reclaim the blob.
     */
    describe("API key auth (OS-1632)", () => {
      const apiKeyFor = async (
        asUser: Awaited<ReturnType<TestContext["setupProject"]>>["asUser"],
        scope?: { organizationId: Id<"organizations">; projectIds: Id<"projects">[] }
      ) => {
        const { key } = await asUser.mutation(api.apiKeys.core.create, {
          name: scope ? "Other-org key" : "CLI attach",
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          ...(scope ? { scope } : {}),
        });
        return key;
      };

      test("generates an upload URL with a valid key and no Clerk identity", async () => {
        const ctx = createTestContext();
        const { project, asUser, t } = await ctx.setupProject();
        const apiKey = await apiKeyFor(asUser);

        expect(
          await t.mutation(api.cli.messages.generateMessageAttachmentUploadUrl, { projectId: project._id, apiKey })
        ).toEqual(expect.any(String));
      });

      test("registers then deletes a pending upload on the key path", async () => {
        const ctx = createTestContext();
        const { user, project, asUser, t } = await ctx.setupProject();
        const apiKey = await apiKeyFor(asUser);
        let storageId!: Id<"_storage">;

        await t.run(async (runCtx) => {
          storageId = await runCtx.storage.store(new Blob(["pending"]));
        });

        await t.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId, apiKey });

        await t.run(async (runCtx) => {
          const rows = await runCtx.db
            .query("cliMessagePendingUploads")
            .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
            .collect();
          expect(rows).toHaveLength(1);
          // The key resolves to its owning user; the row must be owned so the same
          // caller can reclaim it.
          expect(rows[0]?.userId).toBe(user._id);
        });

        await t.mutation(api.cli.messages.deletePendingUploadedAttachment, { projectId: project._id, storageId, apiKey });

        await t.run(async (runCtx) => {
          expect(await runCtx.storage.getUrl(storageId)).toBeNull();
          const rows = await runCtx.db
            .query("cliMessagePendingUploads")
            .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
            .collect();
          expect(rows).toHaveLength(0);
        });
      });

      // Each denial catches a `user._id` regression: the key would resolve and its
      // scope then be ignored.
      test("denies all three with a key scoped to another organization", async () => {
        const ctx = createTestContext();
        const { user, project, asUser, t } = await ctx.setupProject();
        const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
        const apiKey = await apiKeyFor(asUser, { organizationId: otherOrg._id, projectIds: [] });
        let storageId!: Id<"_storage">;

        await t.run(async (runCtx) => {
          storageId = await runCtx.storage.store(new Blob(["pending"]));
        });

        await expect(
          t.mutation(api.cli.messages.generateMessageAttachmentUploadUrl, { projectId: project._id, apiKey })
        ).rejects.toThrow("Permission denied");
        await expect(
          t.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId, apiKey })
        ).rejects.toThrow("Permission denied");
        await expect(
          t.mutation(api.cli.messages.deletePendingUploadedAttachment, { projectId: project._id, storageId, apiKey })
        ).rejects.toThrow("Permission denied");

        await t.run(async (runCtx) => {
          expect(await runCtx.storage.getUrl(storageId)).toBeTruthy();
        });
      });
    });

    test("registerPendingUploadedAttachment returns the owned blob's URL for draft persistence (OS-2141)", async () => {
      const ctx = createTestContext();
      const { project, org, asUser, t } = await ctx.setupProject();
      const { user: otherUser, asUser: asOtherUser } = await ctx.setupUser();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      let storageId!: Id<"_storage">;
      let expectedUrl: string | null = null;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["pending"]));
        expectedUrl = await runCtx.storage.getUrl(storageId);
      });

      const url = await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });
      expect(url).toBe(expectedUrl);
      // Re-registering (draft restore) refreshes and still returns it.
      expect(await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId })).toBe(expectedUrl);
      // Someone else's blob stays opaque.
      expect(await asOtherUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId })).toBeNull();
    });

    test("pendingUploadRetentionSweep deletes stale unsent uploads and keeps fresh or sent ones (OS-2141)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const store = () => t.run((runCtx) => runCtx.storage.store(new Blob(["pending"])));
      const stale = await store();
      const staleSent = await store();
      const fresh = await store();

      for (const storageId of [stale, staleSent]) {
        await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });
      }
      await asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "",
        attachments: [{ storageId: staleSent, fileName: "sent.png", fileSize: 7, contentType: "image/png" }],
      });
      // Re-pend the sent blob the way a queued-message edit does, then age both rows out.
      await t.run(async (runCtx) => {
        await runCtx.db.insert("cliMessagePendingUploads", { projectId: project._id, userId: user._id, storageId: staleSent, createdAt: Date.now() });
      });
      vi.setSystemTime(Date.now() + PENDING_UPLOAD_RETENTION_MS + 1000);
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId: fresh });

      await t.mutation(internal.cli.messages.pendingUploadRetentionSweep, {});

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(stale)).toBeNull();
        expect(await runCtx.storage.getUrl(staleSent)).toBeTruthy();
        expect(await runCtx.storage.getUrl(fresh)).toBeTruthy();
        const rows = await runCtx.db.query("cliMessagePendingUploads").collect();
        expect(rows.map((row) => row.storageId)).toEqual([fresh]);
      });
    });
  });

  describe("ownership checks", () => {
    test("user cannot send message to other users chat", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      // Create another user with their own chat
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
      const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: otherChat._id,
          content: "Hello",
        })
      ).rejects.toThrow("Not authorized");
    });

    test("user cannot see messages in other users chat", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      // Create another user with their own chat
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
      const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);
      await ctx.cliMessage(otherChat._id, otherProfile._id, { status: "completed" });

      const result = await asUser.query(api.cli.messages.listByThread, {
        threadId: otherChat._id,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.page).toHaveLength(0);
    });

    test("user cannot see unprocessed user messages in other users chat", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      // Create another user with their own profile and chat
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
      const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);
      await ctx.cliMessage(otherChat._id, otherProfile._id, {
        role: "user",
        status: "completed",
      });

      const result = await asUser.query(api.cli.messages.listUnprocessedUserMessages, {
        threadId: otherChat._id,
      });

      expect(result).toEqual([]);
    });

    test("user cannot retry message in other users chat", async () => {
      const ctx = createTestContext();
      const { project, org, asUser } = await ctx.setupProject();

      // Create another user with their own chat
      const otherUser = await ctx.user();
      await ctx.orgMember(org._id, otherUser._id, "member");
      await ctx.projectMember(project._id, otherUser._id, "member");
      const otherProfile = await ctx.cliProfile(otherUser._id, project._id);
      const otherChat = await ctx.cliThread(otherUser._id, project._id, otherProfile._id);
      const message = await ctx.cliMessage(otherChat._id, otherProfile._id, {
        status: "failed",
      });

      await expect(asUser.mutation(api.cli.messages.retry, { messageId: message._id })).rejects.toThrow("Not authorized");
    });
  });

  describe("project permission checks on CLI worker mutations", () => {
    test("startRunResponse rejects when the API key scope no longer covers the thread project", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const profile = await ctx.cliProfile(user._id, project._id);
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id, {
        hasPendingUserMessages: true,
        processingState: "claimed",
        status: "pending",
        claimedBySessionId: session._id,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 60_000,
      });
      const userMessage = await ctx.cliMessage(thread._id, profile._id, {
        role: "user",
        content: [{ type: "text", data: "hello", timestamp: 1000 }],
        createdAt: 1000,
        updatedAt: 1000,
      });
      await asUser.mutation(api.apiKeys.core.update, {
        id: apiKeyResult.id,
        name: "Scoped CLI Key",
        scope: {
          organizationId: org._id,
          projectIds: [otherProject._id],
        },
      });

      await expect(
        t.mutation(api.cli.messages.startRunResponse, {
          threadId: thread._id,
          sessionId: session._id,
          userMessageIds: [userMessage._id],
          apiKey: apiKeyResult.key,
        })
      ).rejects.toThrow("Permission denied");
    });

    test("appendRunContent stays claim-based when the API key scope no longer covers the thread project", async () => {
      const ctx = createTestContext();
      const { user, org, project, asUser, t } = await ctx.setupProject();
      const otherProject = await ctx.project(org._id, user._id, {
        name: "Other",
        alias: "OTHR",
      });
      const profile = await ctx.cliProfile(user._id, project._id);
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "Scoped CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        scope: {
          organizationId: org._id,
          projectIds: [project._id],
        },
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id, {
        processingState: "streaming",
        status: "streaming",
        claimedBySessionId: session._id,
        claimedAt: Date.now(),
        claimLeaseExpiresAt: Date.now() + 60_000,
      });
      const assistantMessage = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session._id,
        nextChunkOrder: 0,
        content: [],
      });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", thread._id, {
          activeAssistantMessageId: assistantMessage._id,
        });
      });
      await asUser.mutation(api.apiKeys.core.update, {
        id: apiKeyResult.id,
        name: "Scoped CLI Key",
        scope: {
          organizationId: org._id,
          projectIds: [otherProject._id],
        },
      });

      await t.mutation(api.cli.messages.appendRunContent, {
        messageId: assistantMessage._id,
        sessionId: session._id,
        chunks: [{ type: "assistant", data: "hello" }],
        apiKey: apiKeyResult.key,
      });

      expect(await readChunkCursor(t, assistantMessage._id)).toBe(1);
    });

    test("startRunResponse rejects user without project access", async () => {
      const ctx = createTestContext();
      const { org, project, t } = await ctx.setupProject();

      // Create user2 with org membership but NO project membership
      const user2 = await ctx.user();
      await ctx.orgMember(org._id, user2._id, "member");
      const asUser2 = ctx.asUser(user2);

      const profile2 = await ctx.cliProfile(user2._id, project._id);
      const apiKeyResult = await asUser2.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session2 = await ctx.cliSession(profile2._id, apiKeyResult.id);

      const thread = await ctx.cliThread(user2._id, project._id, profile2._id, {
        hasPendingUserMessages: true,
        processingState: "idle",
        status: "pending",
      });
      const userMessage = await ctx.cliMessage(thread._id, profile2._id, {
        role: "user",
        content: [{ type: "text", data: "hello", timestamp: 1000 }],
        createdAt: 1000,
        updatedAt: 1000,
      });

      // Claim the thread first (via direct DB patch to bypass permission check)
      const now = Date.now();
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", thread._id, {
          claimedBySessionId: session2._id,
          claimedAt: now,
          claimLeaseExpiresAt: now + 60_000,
          processingState: "claimed",
        });
      });

      await expect(
        asUser2.mutation(api.cli.messages.startRunResponse, {
          threadId: thread._id,
          sessionId: session2._id,
          userMessageIds: [userMessage._id],
        })
      ).rejects.toThrow();
    });

    test("appendRunContent stays claim-based for an already claimed message", async () => {
      const ctx = createTestContext();
      const { org, project, t } = await ctx.setupProject();

      const user2 = await ctx.user();
      await ctx.orgMember(org._id, user2._id, "member");
      const asUser2 = ctx.asUser(user2);

      const profile2 = await ctx.cliProfile(user2._id, project._id);
      const apiKeyResult = await asUser2.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session2 = await ctx.cliSession(profile2._id, apiKeyResult.id);

      const now = Date.now();
      const thread = await ctx.cliThread(user2._id, project._id, profile2._id, {
        hasPendingUserMessages: false,
        processingState: "streaming",
        status: "streaming",
        claimedBySessionId: session2._id,
        claimedAt: now,
        claimLeaseExpiresAt: now + 60_000,
      });

      // Create a streaming assistant message claimed by session2
      const assistantMessage = await ctx.cliMessage(thread._id, profile2._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session2._id,
        claimedAt: now,
        nextChunkOrder: 0,
        content: [],
        createdAt: now,
        updatedAt: now,
      });

      // Update thread to point to assistant message
      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", thread._id, {
          activeAssistantMessageId: assistantMessage._id,
        });
      });

      await asUser2.mutation(api.cli.messages.appendRunContent, {
        messageId: assistantMessage._id,
        sessionId: session2._id,
        chunks: [{ type: "assistant", data: "hello" }],
      });

      expect(await readChunkCursor(t, assistantMessage._id)).toBe(1);
    });

    test("complete rejects user without project access", async () => {
      const ctx = createTestContext();
      const { org, project, t } = await ctx.setupProject();

      const user2 = await ctx.user();
      await ctx.orgMember(org._id, user2._id, "member");
      const asUser2 = ctx.asUser(user2);

      const profile2 = await ctx.cliProfile(user2._id, project._id);
      const apiKeyResult = await asUser2.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session2 = await ctx.cliSession(profile2._id, apiKeyResult.id);

      const now = Date.now();
      const thread = await ctx.cliThread(user2._id, project._id, profile2._id, {
        hasPendingUserMessages: false,
        processingState: "streaming",
        status: "streaming",
        claimedBySessionId: session2._id,
        claimedAt: now,
        claimLeaseExpiresAt: now + 60_000,
      });

      const assistantMessage = await ctx.cliMessage(thread._id, profile2._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session2._id,
        claimedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", thread._id, {
          activeAssistantMessageId: assistantMessage._id,
        });
      });

      await expect(
        asUser2.mutation(api.cli.messages.complete, {
          messageId: assistantMessage._id,
          sessionId: session2._id,
        })
      ).rejects.toThrow();
    });

    test("fail rejects user without project access", async () => {
      const ctx = createTestContext();
      const { org, project, t } = await ctx.setupProject();

      const user2 = await ctx.user();
      await ctx.orgMember(org._id, user2._id, "member");
      const asUser2 = ctx.asUser(user2);

      const profile2 = await ctx.cliProfile(user2._id, project._id);
      const apiKeyResult = await asUser2.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session2 = await ctx.cliSession(profile2._id, apiKeyResult.id);

      const now = Date.now();
      const thread = await ctx.cliThread(user2._id, project._id, profile2._id, {
        hasPendingUserMessages: false,
        processingState: "streaming",
        status: "streaming",
        claimedBySessionId: session2._id,
        claimedAt: now,
        claimLeaseExpiresAt: now + 60_000,
      });

      const assistantMessage = await ctx.cliMessage(thread._id, profile2._id, {
        role: "assistant",
        status: "streaming",
        claimedBySessionId: session2._id,
        claimedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliThreads", thread._id, {
          activeAssistantMessageId: assistantMessage._id,
        });
      });

      await expect(
        asUser2.mutation(api.cli.messages.fail, {
          messageId: assistantMessage._id,
          sessionId: session2._id,
          errorMessage: "Something went wrong",
        })
      ).rejects.toThrow();
    });
  });

  describe("backfillLegacyContentForThread", () => {
    test("migrates legacy inline content into chunk rows and sets nextChunkOrder", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const userMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        content: [{ type: "text", data: "hello", timestamp: 1000 }],
      });
      const assistantMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        content: [{ type: "assistant", data: "chunk-a", timestamp: 2000 }],
        status: "completed",
      });

      const result = await asUser.mutation(api.cli.messages.backfillLegacyContentForThread, {
        threadId: chat._id,
      });

      expect(result.migratedMessageCount).toBe(2);

      await t.run(async (runCtx) => {
        const migratedUser = await runCtx.db.get("cliMessages", userMessage._id);
        const migratedAssistant = await runCtx.db.get("cliMessages", assistantMessage._id);

        expect(migratedUser?.nextChunkOrder).toBe(1);
        expect(migratedAssistant?.nextChunkOrder).toBe(1);

        const userChunks = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", userMessage._id))
          .order("asc")
          .collect();
        const assistantChunks = await runCtx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) => q.eq("threadId", chat._id).eq("messageId", assistantMessage._id))
          .order("asc")
          .collect();

        expect(userChunks.map((chunk) => chunk.data)).toEqual(["hello"]);
        expect(assistantChunks.map((chunk) => chunk.data)).toEqual(["chunk-a"]);
      });
    });
  });

  describe("listRecentSummaries (OS-1627)", () => {
    /** A chunk the Claude Code normalizer resolves to a `text` event. */
    function assistantText(text: string, createdAt?: number) {
      return {
        type: "assistant",
        data: JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text }] },
        }),
        ...(createdAt !== undefined ? { createdAt } : {}),
      };
    }

    /** An assistant message carrying one text chunk, at a fixed `createdAt`. */
    async function assistantMessage(
      ctx: TestContext,
      thread: { _id: Id<"cliThreads"> },
      profileId: Id<"cliProfiles">,
      text: string,
      createdAt: number
    ) {
      const message = await ctx.cliMessage(thread._id, profileId, {
        role: "assistant",
        content: [],
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      });
      await ctx.cliMessageChunks(message._id, thread._id, profileId, [assistantText(text, createdAt)]);
      return message;
    }

    const apiKeyFor = async (
      asUser: Awaited<ReturnType<TestContext["setupProject"]>>["asUser"],
      scope?: { organizationId: Id<"organizations">; projectIds: Id<"projects">[] }
    ) => {
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: scope ? "Other-org key" : "MCP Messages",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        ...(scope ? { scope } : {}),
      });
      return key;
    };

    test("returns the newest window newest-last, with composed text", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      await assistantMessage(ctx, thread, profile._id, "Oldest", 1_000);
      await assistantMessage(ctx, thread, profile._id, "Middle", 2_000);
      await assistantMessage(ctx, thread, profile._id, "Newest", 3_000);

      const result = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
        limit: 2,
      });

      // The window is taken from the newest end and returned in conversation
      // order — the order text has to be read in to mean anything.
      expect(result.map((row) => row.text)).toEqual(["Middle", "Newest"]);
      expect(result[0]).toMatchObject({ role: "assistant", status: "completed", createdAt: 2_000 });
      // Nothing was cut, so the flag is absent rather than `false`.
      expect(result[0]?.truncated).toBeUndefined();
    });

    test("clamps limit at both ends rather than rejecting it", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      for (let index = 0; index < 25; index++) {
        await assistantMessage(ctx, thread, profile._id, `Message ${index}`, 1_000 + index);
      }

      const tooSmall = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
        limit: 0,
      });
      const tooLarge = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
        limit: 100,
      });

      // A bad `limit` has an obvious intent, so the domain floors and ceilings it
      // instead of erroring — the CLI command will rely on the same behavior.
      expect(tooSmall).toHaveLength(1);
      expect(tooSmall[0]?.text).toBe("Message 24");
      expect(tooLarge).toHaveLength(20);
      expect(tooLarge.at(-1)?.text).toBe("Message 24");
    });

    test("defaults to the ten most recent messages", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      for (let index = 0; index < 12; index++) {
        await assistantMessage(ctx, thread, profile._id, `Message ${index}`, 1_000 + index);
      }

      const result = await asUser.query(api.cli.messages.listRecentSummaries, { threadId: thread._id });

      expect(result).toHaveLength(10);
      expect(result[0]?.text).toBe("Message 2");
    });

    test("composes a user message's text the same way as an assistant's", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      await asUser.mutation(api.cli.messages.send, {
        threadId: thread._id,
        content: "Please review the diff",
      });

      const result = await asUser.query(api.cli.messages.listRecentSummaries, { threadId: thread._id });

      // A user message's text is stored as one `text` chunk, so there is one code
      // path and a user row cannot drift from an assistant row's rendering.
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ role: "user", text: "Please review the diff" });
    });

    test("carries sentBy on a thread-originated message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const sender = await ctx.cliThread(user._id, project._id, profile._id);
      const apiKey = await apiKeyFor(asUser);
      await t.mutation(api.cli.messages.send, {
        threadId: thread._id,
        content: "Spawned agent reporting back",
        sentBy: { kind: "thread", threadId: sender._id },
        apiKey,
      });

      const result = await asUser.query(api.cli.messages.listRecentSummaries, { threadId: thread._id });

      // How a reader distinguishes an agent's message from a hand-typed one.
      expect(result[0]?.sentBy).toEqual({ kind: "thread", threadId: sender._id });
    });

    test("carries a failed run's error message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "failed",
        errorMessage: "Runtime crashed",
        createdAt: 1_000,
        updatedAt: 1_000,
      });

      const result = await asUser.query(api.cli.messages.listRecentSummaries, { threadId: thread._id });

      // A failed run is often chunkless: the status and the reason are the whole
      // answer, and an empty `text` beside them is honest rather than a gap.
      expect(result[0]).toMatchObject({ status: "failed", errorMessage: "Runtime crashed", text: "" });
    });

    test("rejects a container target instead of answering with an empty transcript", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const container = await ctx.cliThread(user._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
      });

      // The one readable id that throws. A group has no transcript and never
      // will, so `[]` would be a permanent lie inviting the same call again; the
      // message points at the useful next move.
      await expect(
        asUser.query(api.cli.messages.listRecentSummaries, { threadId: container._id })
      ).rejects.toThrow("Groups and workflow runs have no messages");
    });

    test("returns nothing for a non-owner, a missing id, and another table's id", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const { asUser: asStranger } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      await assistantMessage(ctx, thread, profile._id, "Private", 1_000);
      const deleted = await ctx.cliThread(user._id, project._id, profile._id, { isDeleted: true });

      // Every access answer is "nothing here" — an agent racing a delete should
      // not get an error, and a well-formed id from another table must not reach
      // the argument validator (which is why `threadId` is `v.string()`).
      expect(await asStranger.query(api.cli.messages.listRecentSummaries, { threadId: thread._id })).toEqual([]);
      expect(await asUser.query(api.cli.messages.listRecentSummaries, { threadId: deleted._id })).toEqual([]);
      expect(await asUser.query(api.cli.messages.listRecentSummaries, { threadId: project._id })).toEqual([]);
      expect(await asUser.query(api.cli.messages.listRecentSummaries, { threadId: "not-an-id" })).toEqual([]);
    });

    test("lets a teammate read a shared thread, and a child of a shared group", async () => {
      const ctx = createTestContext();
      const { user: owner, org, project } = await ctx.setupProject();
      const profile = await ctx.cliProfile(owner._id, project._id);
      const shared = await ctx.cliThread(owner._id, project._id, profile._id, { sharedAt: 1_000 });
      await assistantMessage(ctx, shared, profile._id, "Shared thread text", 1_000);
      // The child carries no `sharedAt` of its own — the group's covers it — so
      // this exercises `isSharedForViewer`'s container lookup, a branch
      // `threadSharing.test.ts` does not cover for this query.
      const container = await ctx.cliThread(owner._id, project._id, profile._id, {
        kind: "group",
        status: "completed",
        sharedAt: 1_000,
      });
      const child = await ctx.cliThread(owner._id, project._id, profile._id, {
        parentThreadId: container._id,
      });
      await assistantMessage(ctx, child, profile._id, "Group child text", 1_000);

      const teammate = await ctx.user();
      await ctx.orgMember(org._id, teammate._id, "member");
      await ctx.projectMember(project._id, teammate._id, "member");
      const asTeammate = ctx.asUser(teammate);

      expect(
        (await asTeammate.query(api.cli.messages.listRecentSummaries, { threadId: shared._id }))[0]?.text
      ).toBe("Shared thread text");
      expect(
        (await asTeammate.query(api.cli.messages.listRecentSummaries, { threadId: child._id }))[0]?.text
      ).toBe("Group child text");
      // Unshared stays unshared: sharing is per-thread, not per-project.
      const unshared = await ctx.cliThread(owner._id, project._id, profile._id);
      await assistantMessage(ctx, unshared, profile._id, "Private", 1_000);
      expect(await asTeammate.query(api.cli.messages.listRecentSummaries, { threadId: unshared._id })).toEqual([]);
    });

    test("reads with an api key, and denies one scoped to another organization", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      await assistantMessage(ctx, thread, profile._id, "Agent readable", 1_000);
      const apiKey = await apiKeyFor(asUser);
      const otherOrg = await ctx.organization(user._id, { name: "Other Org", slug: "other-org" });
      const scopedAway = await apiKeyFor(asUser, { organizationId: otherOrg._id, projectIds: [] });

      const allowed = await t.query(api.cli.messages.listRecentSummaries, { threadId: thread._id, apiKey });
      // A key the caller is entitled to hold, scoped away from this project. This
      // passes only because the handler forwards `auth.principal`; `user._id`
      // would resolve the scope and then ignore it.
      const denied = await t.query(api.cli.messages.listRecentSummaries, { threadId: thread._id, apiKey: scopedAway });

      expect(allowed[0]?.text).toBe("Agent readable");
      expect(denied).toEqual([]);
    });

    test("marks a message truncated when its chunk window overflows", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      // 20 messages in the page ⇒ a 20-row scan cap per message; 25 overflows it.
      for (let index = 0; index < 19; index++) {
        await assistantMessage(ctx, thread, profile._id, `Filler ${index}`, 1_000 + index);
      }
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
        createdAt: 2_000,
        updatedAt: 2_000,
      });
      await ctx.cliMessageChunks(
        message._id,
        thread._id,
        profile._id,
        Array.from({ length: 25 }, (_, index) => assistantText(`Line ${index}`, 2_000 + index))
      );

      const result = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
        limit: 20,
      });

      // The cap tightens with the page returned, so a large page cannot multiply
      // the rows scanned (`agentTextChunkScan`).
      expect(result).toHaveLength(20);
      expect(result.at(-1)?.truncated).toBe(true);
      expect(result.at(-1)?.text).toContain("Line 24");
      expect(result.at(-1)?.text).not.toContain("Line 4");
    });

    test("does not tighten the per-message scan when the thread is shorter than the limit", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
        createdAt: 1_000,
        updatedAt: 1_000,
      });
      await ctx.cliMessageChunks(
        message._id,
        thread._id,
        profile._id,
        Array.from({ length: 25 }, (_, index) => assistantText(`Line ${index}`, 1_000 + index))
      );

      const result = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
        limit: 20,
      });

      // Cap derived from the one message found, not the 20 requested: 25 rows fit
      // a single message's 40-row scan.
      expect(result).toHaveLength(1);
      expect(result[0]?.truncated).toBeUndefined();
      expect(result[0]?.text).toContain("Line 0");
      expect(result[0]?.text).toContain("Line 24");
    });

    test("clamps a non-integer or NaN limit instead of failing the read", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      for (let index = 0; index < 12; index++) {
        await assistantMessage(ctx, thread, profile._id, `Message ${index}`, 1_000 + index);
      }

      // `v.number()` admits both; `.take()` then fails opaquely.
      const fractional = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
        limit: 2.5,
      });
      const notANumber = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
        limit: Number.NaN,
      });

      expect(fractional).toHaveLength(2);
      expect(fractional.at(-1)?.text).toBe("Message 11");
      expect(notANumber).toHaveLength(10); // no preference expressed → default
    });

    test("never splits a surrogate pair at the char cap", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
        createdAt: 1_000,
        updatedAt: 1_000,
      });
      // The emoji straddles the 4000-char cap.
      await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
        assistantText(`${"a".repeat(3_999)}\u{1F600}tail`, 1_000),
      ]);

      const result = await asUser.query(api.cli.messages.listRecentSummaries, {
        threadId: thread._id,
      });

      // A lone surrogate is not valid Unicode, and this crosses JSON-RPC.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result[0]?.text ?? "")).toBe(false);
      expect(result[0]?.text).toHaveLength(3_999);
      expect(result[0]?.truncated).toBe(true);
    });
  });

  describe("attachment size (OS-1676)", () => {
    test("reports a registered blob that no longer exists as not found", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob(["image"])));
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });
      await t.run((runCtx) => runCtx.storage.delete(storageId));

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "",
          attachments: [{ storageId, fileName: "gone.png", fileSize: 5, contentType: "image/png" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("deletes a blob over the limit instead of registering it", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob([new Uint8Array(50 * 1024 * 1024 + 1)])));

      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

      await t.run(async (runCtx) => {
        expect(await runCtx.db.system.get("_storage", storageId)).toBeNull();
        expect(await runCtx.db.query("cliMessagePendingUploads").collect()).toEqual([]);
      });
    });

    test("rejects a claimed fileSize that disagrees with the stored blob", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob(["image"])));
      await asUser.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "",
          attachments: [{ storageId, fileName: "liar.png", fileSize: 1, contentType: "image/png" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_SIZE_MISMATCH);
    });
  });

  describe("storage ownership across families (OS-1901)", () => {
    test("send rejects a storage id the caller did not register", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const chat = await ctx.cliThread(user._id, project._id, profile._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["unregistered"]));
      });

      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "",
          attachments: [{ storageId, fileName: "u.txt", fileSize: 12, contentType: "text/plain" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
    });

    test("register refuses a blob saved as a task attachment, so cleanup cannot delete it", async () => {
      const ctx = createTestContext();
      const { project: victimProject, user: victim, asUser: asVictim, t } = await ctx.setupProject();
      const victimTask = await ctx.task(victimProject._id, victim._id);
      let storageId!: Id<"_storage">;
      await t.run(async (runCtx) => {
        storageId = await runCtx.storage.store(new Blob(["victim file"]));
      });
      await asVictim.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });
      await asVictim.mutation(api.tasks.attachments.saveTaskAttachment, {
        taskId: victimTask._id,
        storageId,
        fileName: "victim.txt",
        fileSize: 11,
        contentType: "text/plain",
      });
      const { project, asUser: asAttacker } = await ctx.setupProject();

      await asAttacker.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId });
      await asAttacker.mutation(api.cli.messages.deletePendingUploadedAttachment, { projectId: project._id, storageId });

      await t.run(async (runCtx) => {
        expect(await runCtx.storage.getUrl(storageId)).not.toBeNull();
        expect(await runCtx.db.query("cliMessagePendingUploads").collect()).toEqual([]);
      });
    });
  });

  describe("script requests (OS-1886)", () => {
    /** A pending thread whose queued message is a bash step's script request, claimed by a session. */
    async function setupClaimedScriptThread() {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const session = await ctx.cliSession(profile._id, apiKeyResult.id, {});
      const chat = await ctx.cliThread(user._id, project._id, profile._id, { hasPendingUserMessages: true, status: "pending" });
      const scriptMessage = await ctx.cliMessage(chat._id, profile._id, {
        role: "user",
        content: [{ type: "text", data: "pnpm lint", timestamp: Date.now() }],
        scriptRequest: { script: "pnpm lint", timeoutMs: 60_000 },
      });
      const claimed = await t.mutation(api.cli.threads.runControl.claimThread, {
        threadId: chat._id,
        sessionId: session._id,
        leaseMs: 60_000,
        apiKey: apiKeyResult.key,
      });
      return { t, chat, session, scriptMessage, claimed, apiKey: apiKeyResult.key };
    }

    test("startRunResponse serves a script request", async () => {
      const { t, chat, session, scriptMessage, apiKey } = await setupClaimedScriptThread();
      const queued = await t.query(api.cli.messages.listUnprocessedUserMessages, { threadId: chat._id, apiKey });
      expect(queued.map((item) => item.scriptRequest)).toEqual([{ script: "pnpm lint", timeoutMs: 60_000 }]);

      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session._id,
        userMessageIds: [scriptMessage._id],
        apiKey,
      });
      expect(started.assistantMessageId).toBeDefined();
      expect(await t.query(api.cli.messages.listUnprocessedUserMessages, { threadId: chat._id, apiKey })).toEqual([]);
    });

    test("complete stores the script result with the output tail clamped", async () => {
      const { t, chat, session, scriptMessage, apiKey } = await setupClaimedScriptThread();
      const started = await t.mutation(api.cli.messages.startRunResponse, {
        threadId: chat._id,
        sessionId: session._id,
        userMessageIds: [scriptMessage._id],
        apiKey,
      });

      await t.mutation(api.cli.messages.complete, {
        messageId: started.assistantMessageId,
        sessionId: session._id,
        scriptResult: { exitCode: 1, timedOut: false, outputTail: "x".repeat(9_000) },
        apiKey,
      });

      await t.run(async (runCtx) => {
        const assistant = await runCtx.db.get("cliMessages", started.assistantMessageId);
        expect(assistant?.status).toBe("completed");
        expect(assistant?.scriptResult).toMatchObject({ exitCode: 1, timedOut: false });
        expect(assistant?.scriptResult?.outputTail).toHaveLength(8_000);
      });
    });
  });

  describe("attachToResponse (OS-2091)", () => {
    async function setupLiveRun() {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const { key: apiKey, id: apiKeyId } = await asUser.mutation(api.apiKeys.core.create, {
        name: "CLI Key",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const profile = await ctx.cliProfile(user._id, project._id);
      const session = await ctx.cliSession(profile._id, apiKeyId);
      const chat = await ctx.cliThread(user._id, project._id, profile._id, { status: "pending", hasPendingUserMessages: true });
      const startRun = async () => {
        const userMessageId = await asUser.mutation(api.cli.messages.send, { threadId: chat._id, content: "send a screenshot" });
        await t.mutation(api.cli.threads.runControl.claimThread, { threadId: chat._id, sessionId: session._id, leaseMs: 60_000, apiKey });
        return await t.mutation(api.cli.messages.startRunResponse, {
          threadId: chat._id,
          sessionId: session._id,
          userMessageIds: [userMessageId],
          apiKey,
        });
      };
      const upload = async (body: string, fileName = `${body}.png`, contentType = "image/png") => {
        const storageId = await t.run((runCtx) => runCtx.storage.store(new Blob([body])));
        await t.mutation(api.cli.messages.registerPendingUploadedAttachment, { projectId: project._id, storageId, apiKey });
        return { storageId, fileName, fileSize: body.length, contentType };
      };
      const started = await startRun();
      return { ctx, user, project, asUser, t, apiKey, profile, session, chat, started, startRun, upload };
    }

    async function refsFor(t: TestContext["t"], messageId: Id<"cliMessages">) {
      return await t.run((runCtx) =>
        runCtx.db.query("cliMessageAttachmentRefs").withIndex("by_messageId", (q) => q.eq("messageId", messageId)).collect()
      );
    }

    test("appends files to the live reply in command order and spends the pending claims", async () => {
      const { t, apiKey, session, chat, started, upload } = await setupLiveRun();
      const first = await upload("one");
      const second = await upload("notes", "notes.txt", "text/plain");

      const result = await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [first, second],
        apiKey,
      });
      expect(result).toEqual({ messageId: started.assistantMessageId, storageIds: [first.storageId, second.storageId] });

      const third = await upload("three");
      await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [third],
        apiKey,
      });

      await t.run(async (runCtx) => {
        const reply = await runCtx.db.get("cliMessages", started.assistantMessageId);
        expect(reply?.attachments?.map((attachment) => attachment.fileName)).toEqual(["one.png", "notes.txt", "three.png"]);
        const pending = await runCtx.db.query("cliMessagePendingUploads").collect();
        expect(pending).toHaveLength(0);
      });
      expect((await refsFor(t, started.assistantMessageId)).map((ref) => ref.storageId)).toEqual([
        first.storageId,
        second.storageId,
        third.storageId,
      ]);
    });

    test("a repeated batch is idempotent and conflicting metadata for an attached id is rejected", async () => {
      const { t, apiKey, session, chat, started, upload } = await setupLiveRun();
      const file = await upload("one");
      const args = { threadId: chat._id, messageId: started.assistantMessageId, sessionId: session._id, apiKey };

      await t.mutation(api.cli.messages.attachToResponse, { ...args, attachments: [file, file] });
      await t.mutation(api.cli.messages.attachToResponse, { ...args, attachments: [file] });
      await expect(
        t.mutation(api.cli.messages.attachToResponse, { ...args, attachments: [{ ...file, fileName: "renamed.png" }] })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);

      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", started.assistantMessageId))?.attachments).toHaveLength(1);
      });
      expect(await refsFor(t, started.assistantMessageId)).toHaveLength(1);
    });

    test("rejects a batch that would push the reply past the cumulative cap", async () => {
      const { t, apiKey, session, chat, started, upload } = await setupLiveRun();
      const args = { threadId: chat._id, messageId: started.assistantMessageId, sessionId: session._id, apiKey };
      const firstNine = await Promise.all(Array.from({ length: 9 }, (_, index) => upload(`file-${index}`)));
      await t.mutation(api.cli.messages.attachToResponse, { ...args, attachments: firstNine });

      const overflow = [await upload("ten"), await upload("eleven")];
      await expect(t.mutation(api.cli.messages.attachToResponse, { ...args, attachments: overflow })).rejects.toThrow(
        /at most 10 attachments/
      );
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", started.assistantMessageId))?.attachments).toHaveLength(9);
      });
    });

    test("persists display inline on an html file and returns it on reads (OS-2220)", async () => {
      const { t, asUser, apiKey, session, chat, started, upload } = await setupLiveRun();
      const page = { ...(await upload("<p>chart</p>", "chart.html", "text/html")), display: "inline" as const };
      const plain = await upload("export", "export.html", "text/html");

      await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [page, plain],
        apiKey,
      });

      const rows = await asUser.query(api.cli.messages.getMessageAttachmentUrls, { messageId: started.assistantMessageId });
      expect(rows.map((row) => [row.fileName, row.display])).toEqual([
        ["chart.html", "inline"],
        ["export.html", undefined],
      ]);
      const { envelopes } = await asUser.query(api.cli.messages.listEnvelopesByThread, { threadId: chat._id });
      const reply = envelopes.find((envelope) => envelope._id === started.assistantMessageId);
      expect(reply?.attachments.map((attachment) => attachment.display)).toEqual(["inline", undefined]);
    });

    test("persists a caption, returns it on reads, and carries it to the check result (OS-2587)", async () => {
      const { t, asUser, apiKey, session, chat, started, upload } = await setupLiveRun();
      const shot = { ...(await upload("shot")), caption: "The red badge in the header" };
      const plain = await upload("plain");

      await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [shot, plain],
        check: { key: "ui", status: "passed", label: "UI" },
        apiKey,
      });

      const rows = await asUser.query(api.cli.messages.getMessageAttachmentUrls, { messageId: started.assistantMessageId });
      expect(rows.map((row) => row.caption)).toEqual(["The red badge in the header", undefined]);
      const { envelopes } = await asUser.query(api.cli.messages.listEnvelopesByThread, { threadId: chat._id });
      const reply = envelopes.find((envelope) => envelope._id === started.assistantMessageId);
      expect(reply?.attachments.map((attachment) => attachment.caption)).toEqual(["The red badge in the header", undefined]);
      const [result] = await t.run((runCtx) => runCtx.db.query("checkResults").collect());
      expect(result?.files.map((file) => file.caption)).toEqual(["The red badge in the header", undefined]);
    });

    test("rejects a caption longer than the limit (OS-2587)", async () => {
      const { t, apiKey, session, chat, started, upload } = await setupLiveRun();
      const shot = { ...(await upload("shot")), caption: "x".repeat(MAX_ATTACHMENT_CAPTION_LENGTH + 1) };

      await expect(
        t.mutation(api.cli.messages.attachToResponse, {
          threadId: chat._id,
          messageId: started.assistantMessageId,
          sessionId: session._id,
          attachments: [shot],
          apiKey,
        })
      ).rejects.toThrow(errors.attachmentCaptionTooLong(MAX_ATTACHMENT_CAPTION_LENGTH));
    });

    test("listAgentAttachmentsByThread returns agent replies' files newest first, not user uploads (OS-2289)", async () => {
      const { ctx, t, asUser, apiKey, profile, session, chat, started, upload } = await setupLiveRun();
      const insertRef = (messageId: Id<"cliMessages">, storageId: Id<"_storage">, role: "user" | "assistant") =>
        t.run((runCtx) => runCtx.db.insert("cliMessageAttachmentRefs", { threadId: chat._id, messageId, storageId, role, createdAt: Date.now() }));
      const old = await upload("old");
      const olderReply = await ctx.cliMessage(chat._id, profile._id, {
        role: "assistant",
        status: "completed",
        attachments: [{ ...old, uploadedAt: 1 }],
      });
      await insertRef(olderReply._id, old.storageId, "assistant");
      const pasted = await upload("pasted");
      const userMessage = await ctx.cliMessage(chat._id, profile._id, { role: "user", attachments: [{ ...pasted, uploadedAt: 2 }] });
      await insertRef(userMessage._id, pasted.storageId, "user");
      const shot = await upload("shot");
      await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [shot],
        apiKey,
      });

      const groups = await asUser.query(api.cli.messages.listAgentAttachmentsByThread, { threadId: chat._id });
      expect(groups.map((group) => [group.messageId, group.attachments.map((attachment) => attachment.fileName)])).toEqual([
        [started.assistantMessageId, ["shot.png"]],
        [olderReply._id, ["old.png"]],
      ]);

      const asOutsider = ctx.asUser(await ctx.user());
      expect(await asOutsider.query(api.cli.messages.listAgentAttachmentsByThread, { threadId: chat._id })).toEqual([]);
    });

    test("listAgentAttachmentsByThread still finds agent files behind 500 newer user uploads (OS-2289)", async () => {
      const { ctx, t, asUser, apiKey, profile, session, chat, started, upload } = await setupLiveRun();
      const shot = await upload("shot");
      await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [shot],
        apiKey,
      });
      const userMessage = await ctx.cliMessage(chat._id, profile._id, { role: "user" });
      await t.run(async (runCtx) => {
        for (let index = 0; index < 500; index++) {
          const storageId = await runCtx.storage.store(new Blob([`pasted-${index}`]));
          await runCtx.db.insert("cliMessageAttachmentRefs", { threadId: chat._id, messageId: userMessage._id, storageId, role: "user", createdAt: Date.now() });
        }
      });

      const groups = await asUser.query(api.cli.messages.listAgentAttachmentsByThread, { threadId: chat._id });
      expect(groups.map((group) => group.messageId)).toEqual([started.assistantMessageId]);
    });

    test("rejects display inline on a file that is not html (OS-2220)", async () => {
      const { t, apiKey, session, chat, started, upload } = await setupLiveRun();
      const image = await upload("one");

      await expect(
        t.mutation(api.cli.messages.attachToResponse, {
          threadId: chat._id,
          messageId: started.assistantMessageId,
          sessionId: session._id,
          attachments: [{ ...image, display: "inline" }],
          apiKey,
        })
      ).rejects.toThrow(errors.ATTACHMENT_INLINE_NOT_HTML);
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", started.assistantMessageId))?.attachments ?? []).toHaveLength(0);
      });
    });

    test("rejects unregistered uploads and a size that disagrees with the stored blob", async () => {
      const { t, apiKey, session, chat, started, upload } = await setupLiveRun();
      const args = { threadId: chat._id, messageId: started.assistantMessageId, sessionId: session._id, apiKey };
      const unregistered = await t.run((runCtx) => runCtx.storage.store(new Blob(["loose"])));

      await expect(
        t.mutation(api.cli.messages.attachToResponse, {
          ...args,
          attachments: [{ storageId: unregistered, fileName: "loose.png", fileSize: 5, contentType: "image/png" }],
        })
      ).rejects.toThrow(errors.ATTACHMENT_UPLOAD_NOT_OWNED);

      const file = await upload("sized");
      await expect(
        t.mutation(api.cli.messages.attachToResponse, { ...args, attachments: [{ ...file, fileSize: 999 }] })
      ).rejects.toThrow(errors.ATTACHMENT_SIZE_MISMATCH);
    });

    test("rejects another user's key even with the right ids", async () => {
      const { ctx, t, session, chat, started, upload } = await setupLiveRun();
      const { asUser: asOther } = await ctx.setupUser();
      const { key: otherKey } = await asOther.mutation(api.apiKeys.core.create, {
        name: "Other",
        expiresAt: Date.now() + 60_000,
      });
      const file = await upload("one");

      await expect(
        t.mutation(api.cli.messages.attachToResponse, {
          threadId: chat._id,
          messageId: started.assistantMessageId,
          sessionId: session._id,
          attachments: [file],
          apiKey: otherKey,
        })
      ).rejects.toThrow();
    });

    test("rejects a reply whose run has completed", async () => {
      const { t, apiKey, session, chat, started, upload } = await setupLiveRun();
      await t.mutation(api.cli.messages.complete, { messageId: started.assistantMessageId, sessionId: session._id, apiKey });
      const file = await upload("late");

      await expect(
        t.mutation(api.cli.messages.attachToResponse, {
          threadId: chat._id,
          messageId: started.assistantMessageId,
          sessionId: session._id,
          attachments: [file],
          apiKey,
        })
      ).rejects.toThrow();
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", started.assistantMessageId))?.attachments ?? []).toHaveLength(0);
      });
    });

    test("an old run's reply id fails after the thread starts a newer run", async () => {
      const { t, apiKey, session, chat, started, startRun, upload } = await setupLiveRun();
      await t.mutation(api.cli.messages.complete, { messageId: started.assistantMessageId, sessionId: session._id, apiKey });
      const next = await startRun();
      const file = await upload("stale");

      await expect(
        t.mutation(api.cli.messages.attachToResponse, {
          threadId: chat._id,
          messageId: started.assistantMessageId,
          sessionId: session._id,
          attachments: [file],
          apiKey,
        })
      ).rejects.toThrow(errors.SELECTED_RUN_CHANGED);
      await t.run(async (runCtx) => {
        expect((await runCtx.db.get("cliMessages", next.assistantMessageId))?.attachments ?? []).toHaveLength(0);
      });
    });

    test("retrying a failed reply deletes its refs and unreferenced blobs", async () => {
      const { t, asUser, apiKey, session, chat, started, upload } = await setupLiveRun();
      const file = await upload("shot");
      await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [file],
        apiKey,
      });
      await t.mutation(api.cli.messages.fail, { messageId: started.assistantMessageId, sessionId: session._id, errorMessage: "boom", apiKey });

      await asUser.mutation(api.cli.messages.retry, { messageId: started.assistantMessageId });

      expect(await refsFor(t, started.assistantMessageId)).toHaveLength(0);
      expect(await t.run((runCtx) => runCtx.storage.getUrl(file.storageId))).toBeNull();
    });

    test("edit-last deletes the replaced reply's refs and unreferenced blobs", async () => {
      const { t, asUser, apiKey, session, chat, started, upload } = await setupLiveRun();
      const file = await upload("shot");
      await t.mutation(api.cli.messages.attachToResponse, {
        threadId: chat._id,
        messageId: started.assistantMessageId,
        sessionId: session._id,
        attachments: [file],
        apiKey,
      });
      await t.mutation(api.cli.messages.complete, { messageId: started.assistantMessageId, sessionId: session._id, apiKey });
      const lastUser = await t.run(async (runCtx) =>
        (await runCtx.db.query("cliMessages").collect()).find((message) => message.role === "user")
      );

      await asUser.mutation(api.cli.messages.editLastResend, { messageId: lastUser!._id, content: "try again" });

      expect(await refsFor(t, started.assistantMessageId)).toHaveLength(0);
      expect(await t.run((runCtx) => runCtx.storage.getUrl(file.storageId))).toBeNull();
    });
  });
});


describe("Codex proposed plans", () => {
  async function setupPlanRun() {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const key = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI",
      expiresAt: Date.now() + 86_400_000,
    });
    const profile = await ctx.cliProfile(user._id, project._id);
    const session = await ctx.cliSession(profile._id, key.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      cliType: "codex",
      status: "streaming",
      processingState: "streaming",
      claimedBySessionId: session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
    });
    const message = await ctx.cliMessage(chat._id, profile._id, {
      cliType: "codex",
      cliMode: "plan",
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
      content: [],
      nextChunkOrder: 0,
    });
    await t.run((runCtx) =>
      runCtx.db.patch("cliThreads", chat._id, {
        activeAssistantMessageId: message._id,
      })
    );
    const append = (chunks: Array<{ type: string; data: string }>) =>
      t.mutation(api.cli.messages.appendRunContent, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: key.key,
        chunks,
      });
    const finish = () =>
      t.mutation(api.cli.messages.complete, {
        messageId: message._id,
        sessionId: session._id,
        apiKey: key.key,
      });
    return {
      ctx,
      user,
      project,
      asUser,
      t,
      chat,
      message,
      append,
      finish,
      session,
      apiKey: key.key,
    };
  }
  const planChunk = {
    type: "item/completed",
    data: JSON.stringify({
      threadId: "codex-thread",
      turnId: "turn-1",
      item: { type: "plan", id: "plan-1", text: "# Approved text" },
    }),
  };
  const turnChunk = (status: string) => ({
    type: "turn/completed",
    data: JSON.stringify({ threadId: "codex-thread", turn: { id: "turn-1", status } }),
  });

  test.each(["fail", "stop", "watchdog"] as const)(
    "clears a completed proposal when its run ends through %s",
    async (end) => {
      const { t, asUser, chat, message, append, session, apiKey } = await setupPlanRun();
      await append([planChunk, turnChunk("completed")]);
      expect(
        (await t.run((ctx) => ctx.db.get("cliThreads", chat._id)))?.metadata?.proposedPlan?.ready
      ).toBe(true);
      if (end === "fail") {
        await t.mutation(api.cli.messages.fail, {
          messageId: message._id,
          sessionId: session._id,
          apiKey,
          errorMessage: "connection lost",
        });
      } else if (end === "stop") {
        await asUser.mutation(api.cli.threads.runControl.cancelProcessing, { threadId: chat._id });
      } else {
        await t.run((ctx) =>
          ctx.db.patch("cliThreads", chat._id, { claimLeaseExpiresAt: Date.now() - 1 })
        );
        await t.mutation(internal.cli.threads.runControl.streamingWatchdogTick, {
          threadId: chat._id,
          messageId: message._id,
          intervalMs: 60_000,
        });
      }
      expect(
        (await t.run((ctx) => ctx.db.get("cliThreads", chat._id)))?.metadata?.proposedPlan
      ).toBeUndefined();
    }
  );

  test("releasing a claim preserves a completed proposal awaiting approval", async () => {
    const { t, chat, message, append, finish, session, apiKey } = await setupPlanRun();
    await append([planChunk, turnChunk("completed")]);
    await finish();
    await t.mutation(api.cli.threads.runControl.releaseClaim, {
      threadId: chat._id,
      sessionId: session._id,
      apiKey,
    });
    const thread = await t.run((ctx) => ctx.db.get("cliThreads", chat._id));
    expect(thread?.status).toBe("waiting_input");
    expect(thread?.metadata?.proposedPlan).toMatchObject({ messageId: message._id, ready: true });
  });

  test("keeps a completed native proposal actionable after its turn ends", async () => {
    const { t, chat, message, append, finish } = await setupPlanRun();
    await append([planChunk]);
    await append([turnChunk("completed")]);
    await finish();
    const thread = await t.run((ctx) => ctx.db.get("cliThreads", chat._id));
    expect(thread?.status).toBe("waiting_input");
    expect(thread?.metadata?.proposedPlan).toMatchObject({
      messageId: message._id,
      itemId: "plan-1",
      turnId: "turn-1",
      ready: true,
    });
  });

  test.each(["auto", "default", "agent"])(
    "approval in %s sends the stored plan, consumes it once, and preserves the continuation",
    async (cliMode) => {
      const { t, asUser, chat, message, append, finish } = await setupPlanRun();
      await append([
        { type: "thread/started", data: JSON.stringify({ thread: { id: "codex-continuation" } }) },
        planChunk,
        turnChunk("completed"),
      ]);
      await finish();
      const sourceProposedPlan = { messageId: message._id, itemId: "plan-1", turnId: "turn-1" };
      const args = {
        threadId: chat._id,
        content: "Client text must not replace the plan",
        sourceProposedPlan,
        cliMode,
      };
      const sentId = await asUser.mutation(api.cli.messages.send, args);
      await t.run(async (ctx) => {
        const sent = await ctx.db.get("cliMessages", sentId);
        expect(sent?.cliMode).toBe(cliMode);
        const chunk = await ctx.db
          .query("cliMessageChunks")
          .withIndex("by_thread_and_message_and_chunkOrder", (q) =>
            q.eq("threadId", chat._id).eq("messageId", sentId)
          )
          .first();
        expect(chunk?.data).toBe("Implement the approved plan.\n\n# Approved text");
        expect((await ctx.db.get("cliMessages", message._id))?.cliContext?.continuationId).toBe(
          "codex-continuation"
        );
        expect((await ctx.db.get("cliThreads", chat._id))?.metadata?.proposedPlan).toBeUndefined();
      });
      await expect(asUser.mutation(api.cli.messages.send, args)).rejects.toThrow(
        "This plan is no longer awaiting approval"
      );
    }
  );

  test("rejects a proposal identity from an older revision", async () => {
    const { asUser, chat, message, append, finish } = await setupPlanRun();
    await append([planChunk, turnChunk("completed")]);
    await finish();
    await expect(
      asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Implement",
        cliMode: "default",
        sourceProposedPlan: { messageId: message._id, itemId: "old-plan", turnId: "turn-1" },
      })
    ).rejects.toThrow("This plan is no longer awaiting approval");
  });

  test("rejects approval while the provider turn is still running", async () => {
    const { asUser, chat, message, append } = await setupPlanRun();
    await append([planChunk]);
    await expect(
      asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Implement",
        cliMode: "auto",
        sourceProposedPlan: { messageId: message._id, itemId: "plan-1", turnId: "turn-1" },
      })
    ).rejects.toThrow("This plan is no longer awaiting approval");
  });

  test.each(["", "   "])("does not make an empty completed plan actionable: %j", async (text) => {
    const { t, chat, append, finish } = await setupPlanRun();
    await append([
      {
        type: "item/completed",
        data: JSON.stringify({ turnId: "turn-1", item: { type: "plan", id: "plan-1", text } }),
      },
      turnChunk("completed"),
    ]);
    await finish();
    const thread = await t.run((ctx) => ctx.db.get("cliThreads", chat._id));
    expect(thread?.status).toBe("completed");
    expect(thread?.metadata?.proposedPlan).toBeUndefined();
  });

  test("a draft or question-only turn never enables approval", async () => {
    const { t, chat, append, finish } = await setupPlanRun();
    await append([
      {
        type: "item/plan/delta",
        data: JSON.stringify({ turnId: "turn-1", itemId: "plan-1", delta: "draft" }),
      },
      {
        type: "item/completed",
        data: JSON.stringify({
          turnId: "turn-1",
          item: { type: "agentMessage", id: "question", text: "Which scope?" },
        }),
      },
      turnChunk("completed"),
    ]);
    await finish();
    expect((await t.run((ctx) => ctx.db.get("cliThreads", chat._id)))?.status).toBe("completed");
  });

  test("approval identity survives a long tail and is available from the thread query", async () => {
    const { t, asUser, chat, message, append, finish } = await setupPlanRun();
    await append([planChunk]);
    await append(
      Array.from({ length: 205 }, () => ({
        type: "item/completed",
        data: JSON.stringify({ item: { type: "reasoning", id: "reason", summary: ["Reviewing"] } }),
      }))
    );
    await append([turnChunk("completed")]);
    await finish();
    const thread = await t.run((ctx) => ctx.db.get("cliThreads", chat._id));
    expect(thread?.metadata?.proposedPlan?.messageId).toBe(message._id);
    await expect(
      asUser.mutation(api.cli.messages.send, {
        threadId: chat._id,
        content: "Approve",
        cliMode: "default",
        sourceProposedPlan: { messageId: message._id, itemId: "plan-1", turnId: "turn-1" },
      })
    ).resolves.toBeDefined();
  });

  test("ordinary feedback consumes a ready proposal and preserves plan mode", async () => {
    const { t, asUser, chat, append, finish } = await setupPlanRun();
    await append([planChunk, turnChunk("completed")]);
    await finish();
    const sentId = await asUser.mutation(api.cli.messages.send, {
      threadId: chat._id,
      content: "Change step one",
      cliMode: "plan",
    });
    await t.run(async (ctx) => {
      expect((await ctx.db.get("cliThreads", chat._id))?.metadata?.proposedPlan).toBeUndefined();
      expect((await ctx.db.get("cliMessages", sentId))?.cliMode).toBe("plan");
    });
  });

  test.each(["plan", "acceptEdits", undefined])(
    "does not approve into an unsupported mode: %s",
    async (cliMode) => {
      const { asUser, chat, message, append, finish } = await setupPlanRun();
      await append([planChunk, turnChunk("completed")]);
      await finish();
      await expect(
        asUser.mutation(api.cli.messages.send, {
          threadId: chat._id,
          content: "Approve",
          cliMode,
          sourceProposedPlan: { messageId: message._id, itemId: "plan-1", turnId: "turn-1" },
        })
      ).rejects.toThrow("Choose an implementation mode");
    }
  );

  test.each(["interrupted", "failed"])(
    "does not offer approval after a %s turn",
    async (status) => {
      const { t, chat, append, finish } = await setupPlanRun();
      await append([planChunk, turnChunk(status)]);
      await finish();
      const thread = await t.run((ctx) => ctx.db.get("cliThreads", chat._id));
      expect(thread?.status).toBe("completed");
      expect(thread?.metadata?.proposedPlan).toBeUndefined();
    }
  );

  test("queued feedback takes precedence and clears the previous proposal", async () => {
    const { t, asUser, chat, append, finish } = await setupPlanRun();
    await append([planChunk]);
    await asUser.mutation(api.cli.messages.send, {
      threadId: chat._id,
      content: "Revise it",
      cliMode: "plan",
    });
    await append([turnChunk("completed")]);
    await finish();
    const thread = await t.run((ctx) => ctx.db.get("cliThreads", chat._id));
    expect(thread?.status).toBe("pending");
    expect(thread?.metadata?.proposedPlan).toBeUndefined();
  });
});
