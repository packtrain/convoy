/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import type { Id } from "../_generated/dataModel";

const anchor = {
  text: "selected snippet",
  prefix: "before ",
  suffix: " after",
  startOffset: 10,
  endOffset: 26,
};

const ARTIFACT_CONTENT = "# Plan\n\nbefore selected snippet after";

async function setupArtifact() {
  const ctx = createTestContext();
  const setup = await ctx.setupProject();
  const task = await ctx.task(setup.project._id, setup.user._id);
  const artifactId: Id<"taskArtifacts"> = await setup.asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
    taskId: task._id,
    name: "Plan",
    content: ARTIFACT_CONTENT,
  });
  return { ctx, ...setup, task, artifactId };
}

describe("artifactComments", () => {
  describe("create + listByArtifact", () => {
    test("creates a root with anchor and open status, listed with author info and flags", async () => {
      const { asUser, user, artifactId } = await setupArtifact();

      await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Looks wrong",
        anchor,
      });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        content: "Looks wrong",
        anchor,
        status: "open",
        authorName: user.name,
        canEdit: true,
        canDelete: true,
        isEdited: false,
      });
      expect(comments[0].parentId).toBeUndefined();
    });

    test("derives the anchor server-side from anchorText", async () => {
      const { asUser, artifactId } = await setupArtifact();

      await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "From an agent",
        anchorText: "selected snippet",
      });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      const startOffset = ARTIFACT_CONTENT.indexOf("selected snippet");
      expect(comments[0].anchor).toEqual({
        text: "selected snippet",
        prefix: "# Plan\n\nbefore ",
        suffix: " after",
        startOffset,
        endOffset: startOffset + "selected snippet".length,
      });
    });

    test("anchorText occurrence picks the nth match", async () => {
      const ctx = createTestContext();
      const setup = await ctx.setupProject();
      const task = await ctx.task(setup.project._id, setup.user._id);
      const content = "dup one dup two dup three";
      const artifactId: Id<"taskArtifacts"> = await setup.asUser.mutation(
        api.tasks.artifacts.createTaskArtifact,
        { taskId: task._id, name: "Dup", content }
      );

      await setup.asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "second dup",
        anchorText: "dup",
        anchorOccurrence: 2,
      });

      const comments = await setup.asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments[0].anchor?.startOffset).toBe(content.indexOf("dup", 1));
    });

    test("rejects anchorText that is not in the content", async () => {
      const { asUser, artifactId } = await setupArtifact();

      await expect(
        asUser.mutation(api.tasks.artifactComments.create, {
          artifactId,
          content: "c",
          anchorText: "not present anywhere",
        })
      ).rejects.toThrow("Anchor text not found in the artifact content");

      await expect(
        asUser.mutation(api.tasks.artifactComments.create, {
          artifactId,
          content: "c",
          anchorText: "selected snippet",
          anchorOccurrence: 2,
        })
      ).rejects.toThrow("Anchor text not found in the artifact content");
    });

    test("rejects providing both anchor and anchorText", async () => {
      const { asUser, artifactId } = await setupArtifact();

      await expect(
        asUser.mutation(api.tasks.artifactComments.create, {
          artifactId,
          content: "c",
          anchor,
          anchorText: "selected snippet",
        })
      ).rejects.toThrow("Provide either anchor or anchorText, not both");
    });

    test("creates a root without an anchor (general comment)", async () => {
      const { asUser, artifactId } = await setupArtifact();

      await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "General note",
      });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({ content: "General note", status: "open" });
      expect(comments[0].anchor).toBeUndefined();
    });

    test("rejects a provided anchor with blank text", async () => {
      const { asUser, artifactId } = await setupArtifact();

      await expect(
        asUser.mutation(api.tasks.artifactComments.create, {
          artifactId,
          content: "Blank anchor",
          anchor: { ...anchor, text: "   " },
        })
      ).rejects.toThrow("Comment anchor text is required");
    });

    test("create and listByArtifact work with an apiKey", async () => {
      const { asUser, t, artifactId } = await setupArtifact();
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Agent",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      await t.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Via API key",
        anchorText: "selected snippet",
        apiKey: key,
      });

      const comments = await t.query(api.tasks.artifactComments.listByArtifact, {
        artifactId,
        apiKey: key,
      });
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toBe("Via API key");
    });

    test("listByArtifact returns [] when unauthenticated", async () => {
      const { t, artifactId, asUser } = await setupArtifact();
      await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "c", anchor });

      const result = await t.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(result).toEqual([]);
    });

    test("listByArtifact status filter keeps replies with their root", async () => {
      const { asUser, artifactId } = await setupArtifact();
      const openRoot = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Open root",
        anchor,
      });
      await asUser.mutation(api.tasks.artifactComments.reply, { parentId: openRoot, content: "Open reply" });
      const resolvedRoot = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Resolved root",
        anchor,
      });
      await asUser.mutation(api.tasks.artifactComments.setStatus, {
        commentIds: [resolvedRoot],
        status: "resolved",
      });

      const open = await asUser.query(api.tasks.artifactComments.listByArtifact, {
        artifactId,
        status: "open",
      });
      expect(open.map((c) => c.content).sort()).toEqual(["Open reply", "Open root"]);

      const resolved = await asUser.query(api.tasks.artifactComments.listByArtifact, {
        artifactId,
        status: "resolved",
      });
      expect(resolved.map((c) => c.content)).toEqual(["Resolved root"]);
    });

    test("listByArtifact hides canEdit and grants member no delete on others' comments", async () => {
      const { ctx, org, project, asUser, artifactId } = await setupArtifact();
      await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "By owner", anchor });

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      await ctx.projectMember(project._id, member._id, "member");
      const asMember = ctx.asUser(member);

      const comments = await asMember.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments).toHaveLength(1);
      expect(comments[0].canEdit).toBe(false);
      expect(comments[0].canDelete).toBe(false);
    });
  });

  describe("reply", () => {
    test("creates a flat reply without anchor or status", async () => {
      const { asUser, artifactId } = await setupArtifact();

      const rootId = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Root",
        anchor,
      });
      await asUser.mutation(api.tasks.artifactComments.reply, { parentId: rootId, content: "Reply" });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments).toHaveLength(2);
      const reply = comments.find((c) => c.parentId === rootId);
      expect(reply?.content).toBe("Reply");
      expect(reply?.anchor).toBeUndefined();
      expect(reply?.status).toBeUndefined();
    });

    test("rejects a reply to a reply", async () => {
      const { asUser, artifactId } = await setupArtifact();

      const rootId = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Root",
        anchor,
      });
      const replyId = await asUser.mutation(api.tasks.artifactComments.reply, {
        parentId: rootId,
        content: "Reply",
      });

      await expect(
        asUser.mutation(api.tasks.artifactComments.reply, { parentId: replyId, content: "Reply to reply" })
      ).rejects.toThrow("Replies cannot have their own replies");
    });

    test("works with an apiKey", async () => {
      const { asUser, t, artifactId } = await setupArtifact();
      const rootId = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Root",
        anchor,
      });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Agent",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      await t.mutation(api.tasks.artifactComments.reply, {
        parentId: rootId,
        content: "Agent reply",
        apiKey: key,
      });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments.find((c) => c.parentId === rootId)?.content).toBe("Agent reply");
    });
  });

  describe("update", () => {
    test("author edits content and comment is marked edited", async () => {
      const { asUser, artifactId } = await setupArtifact();
      const id = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "v1", anchor });

      await asUser.mutation(api.tasks.artifactComments.update, { commentId: id, content: "v2" });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments[0]).toMatchObject({ content: "v2", isEdited: true });
    });

    test("non-author cannot edit", async () => {
      const { ctx, org, project, asUser, artifactId } = await setupArtifact();
      const id = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "v1", anchor });

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      await ctx.projectMember(project._id, member._id, "member");

      await expect(
        ctx.asUser(member).mutation(api.tasks.artifactComments.update, { commentId: id, content: "hijack" })
      ).rejects.toThrow("Only the comment author can edit");
    });
  });

  describe("remove", () => {
    test("deleting a root cascades to its replies and is idempotent", async () => {
      const { asUser, artifactId } = await setupArtifact();
      const rootId = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "Root", anchor });
      await asUser.mutation(api.tasks.artifactComments.reply, { parentId: rootId, content: "Reply" });

      await asUser.mutation(api.tasks.artifactComments.remove, { commentId: rootId });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments).toEqual([]);

      // Idempotent: deleting again is a no-op.
      await asUser.mutation(api.tasks.artifactComments.remove, { commentId: rootId });
    });

    test("member cannot delete others' comments; org owner can", async () => {
      const { ctx, org, project, asUser, artifactId } = await setupArtifact();
      const id = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "c", anchor });

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      await ctx.projectMember(project._id, member._id, "member");

      await expect(
        ctx.asUser(member).mutation(api.tasks.artifactComments.remove, { commentId: id })
      ).rejects.toThrow();

      // The project owner (org owner) has COMMENT_DELETE_ANY.
      const memberCommentId = await ctx
        .asUser(member)
        .mutation(api.tasks.artifactComments.create, { artifactId, content: "by member", anchor });
      await asUser.mutation(api.tasks.artifactComments.remove, { commentId: memberCommentId });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments.map((c) => c._id)).toEqual([id]);
    });
  });

  describe("setStatus", () => {
    test("any project member can resolve and un-resolve a batch of roots", async () => {
      const { ctx, org, project, asUser, artifactId } = await setupArtifact();
      const first = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "a", anchor });
      const second = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "b", anchor });

      const member = await ctx.user();
      await ctx.orgMember(org._id, member._id, "member");
      await ctx.projectMember(project._id, member._id, "member");
      const asMember = ctx.asUser(member);

      await asMember.mutation(api.tasks.artifactComments.setStatus, {
        commentIds: [first, second],
        status: "resolved",
      });
      let comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments.map((c) => c.status)).toEqual(["resolved", "resolved"]);

      await asMember.mutation(api.tasks.artifactComments.setStatus, {
        commentIds: [first],
        status: "open",
      });
      comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments.find((c) => c._id === first)?.status).toBe("open");
      expect(comments.find((c) => c._id === second)?.status).toBe("resolved");
    });

    test("replies cannot be resolved and the whole batch fails atomically", async () => {
      const { asUser, artifactId } = await setupArtifact();
      const rootId = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "Root", anchor });
      const replyId = await asUser.mutation(api.tasks.artifactComments.reply, {
        parentId: rootId,
        content: "Reply",
      });

      await expect(
        asUser.mutation(api.tasks.artifactComments.setStatus, {
          commentIds: [rootId, replyId],
          status: "resolved",
        })
      ).rejects.toThrow("Only root comments can be resolved");

      // Atomic: the valid root in the failed batch stays open.
      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments.find((c) => c._id === rootId)?.status).toBe("open");
    });

    test("rejects an empty batch", async () => {
      const { asUser } = await setupArtifact();

      await expect(
        asUser.mutation(api.tasks.artifactComments.setStatus, { commentIds: [], status: "resolved" })
      ).rejects.toThrow("Status change accepts 1 to 100 comments");
    });

    test("works with an apiKey", async () => {
      const { asUser, t, artifactId } = await setupArtifact();
      const id = await asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "c", anchor });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Agent",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      await t.mutation(api.tasks.artifactComments.setStatus, {
        commentIds: [id],
        status: "resolved",
        apiKey: key,
      });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments[0].status).toBe("resolved");
    });
  });

  describe("content validation", () => {
    test("rejects blank content on create, reply, and update", async () => {
      const { asUser, artifactId } = await setupArtifact();
      const rootId = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "root",
        anchor,
      });

      await expect(
        asUser.mutation(api.tasks.artifactComments.create, { artifactId, content: "   ", anchor })
      ).rejects.toThrow("Comment text is required");
      await expect(
        asUser.mutation(api.tasks.artifactComments.reply, { parentId: rootId, content: " \n " })
      ).rejects.toThrow("Comment text is required");
      await expect(
        asUser.mutation(api.tasks.artifactComments.update, { commentId: rootId, content: "  " })
      ).rejects.toThrow("Comment text is required");
    });

    test("stores content trimmed", async () => {
      const { asUser, artifactId } = await setupArtifact();

      await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "  padded  ",
        anchor,
      });

      const comments = await asUser.query(api.tasks.artifactComments.listByArtifact, { artifactId });
      expect(comments[0].content).toBe("padded");
    });
  });

  describe("markdown-only", () => {
    test("rejects comments on html artifacts", async () => {
      const ctx = createTestContext();
      const { asUser, project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);
      const artifactId: Id<"taskArtifacts"> = await asUser.mutation(api.tasks.artifacts.createTaskArtifact, {
        taskId: task._id,
        name: "Page",
        content: "<p>before selected snippet after</p>",
        contentType: "html",
      });

      await expect(
        asUser.mutation(api.tasks.artifactComments.create, {
          artifactId,
          content: "On html",
          anchorText: "selected snippet",
        })
      ).rejects.toThrow("Comments are only supported on markdown artifacts");
    });
  });

  describe("artifact deletion cascade", () => {
    test("deleteTaskArtifact deletes the artifact's comments", async () => {
      const { asUser, t, artifactId } = await setupArtifact();
      const rootId = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "root",
        anchor,
      });
      await asUser.mutation(api.tasks.artifactComments.reply, { parentId: rootId, content: "reply" });

      await asUser.mutation(api.tasks.artifacts.deleteTaskArtifact, { artifactId });

      const remaining = await t.run(async (runCtx) => runCtx.db.query("artifactComments").collect());
      expect(remaining).toHaveLength(0);
    });

    test("permanentlyDelete removes comments of the task's artifacts", async () => {
      const { asUser, t, task, artifactId } = await setupArtifact();
      const rootId = await asUser.mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "root",
        anchor,
      });
      await asUser.mutation(api.tasks.artifactComments.reply, { parentId: rootId, content: "reply" });

      await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });

      const remaining = await t.run(async (runCtx) => runCtx.db.query("artifactComments").collect());
      expect(remaining).toHaveLength(0);
    });
  });
});

describe("project viewer artifact comments", () => {
  test("a viewer cannot comment on an artifact (docs/specs/read-only-viewer-ux.md)", async () => {
    const { ctx, org, project, artifactId } = await setupArtifact();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    await expect(
      ctx.asUser(viewer).mutation(api.tasks.artifactComments.create, {
        artifactId,
        content: "Viewer note",
        anchor,
      })
    ).rejects.toThrow("Permission denied");
  });
});
