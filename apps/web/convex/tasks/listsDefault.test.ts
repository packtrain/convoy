/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import {
  INBOX_LIST_NAME,
  INBOX_LIST_REF,
} from "./lib/lists/resolution";

describe("default Inbox List (OS-842)", () => {
  describe("projects.create", () => {
    test("creates a persisted Inbox List and points defaultListId at it", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Inbox Project",
        alias: "INB",
      });

      const { project, lists } = await t.run(async (runCtx) => {
        const project = await runCtx.db.get("projects", projectId);
        const lists = await runCtx.db
          .query("taskLists")
          .withIndex("by_project_and_isArchived_and_rank", (q) =>
            q.eq("projectId", projectId).eq("isArchived", false)
          )
          .collect();
        return { project, lists };
      });

      expect(lists).toHaveLength(1);
      const inbox = lists[0];
      expect(inbox.name).toBe(INBOX_LIST_NAME);
      expect(inbox.ref).toBe(INBOX_LIST_REF);
      expect(inbox.isArchived).toBe(false);
      expect(project?.defaultListId).toBe(inbox._id);
    });

    test("still adds the creator as project admin", async () => {
      const ctx = createTestContext();
      const { user, org, asUser, t } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Inbox Project",
        alias: "INB",
      });

      const membership = await t.run(async (runCtx) =>
        runCtx.db
          .query("projectMembers")
          .withIndex("by_project_and_user", (q) =>
            q.eq("projectId", projectId).eq("userId", user._id)
          )
          .unique()
      );
      expect(membership?.role).toBe("project-admin");
    });
  });

  describe("taskLists.list isDefault", () => {
    test("marks only the default List as isDefault", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Inbox Project",
        alias: "INB",
      });
      await asUser.mutation(api.tasks.lists.create, {
        projectId,
        name: "Sprint 10",
      });

      const results = await asUser.query(api.tasks.lists.list, {
        projectId,
        paginationOpts: { numItems: 10, cursor: null },
      });

      const byRef = new Map(results.page.map((l) => [l.ref, l]));
      expect(byRef.get(INBOX_LIST_REF)?.isDefault).toBe(true);
      expect(byRef.get("SPRINT-10")?.isDefault).toBe(false);
    });

    test("setDefault marks a different active List as the default", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Inbox Project",
        alias: "INB",
      });
      const sprintId = await asUser.mutation(api.tasks.lists.create, {
        projectId,
        name: "Sprint 10",
      });

      await asUser.mutation(api.tasks.lists.setDefault, { id: sprintId });
      await asUser.mutation(api.tasks.lists.setDefault, { id: sprintId });

      const project = await t.run((runCtx) =>
        runCtx.db.get("projects", projectId)
      );
      expect(project?.defaultListId).toBe(sprintId);

      const results = await asUser.query(api.tasks.lists.list, {
        projectId,
        paginationOpts: { numItems: 10, cursor: null },
      });
      const byRef = new Map(results.page.map((l) => [l.ref, l]));
      expect(byRef.get(INBOX_LIST_REF)?.isDefault).toBe(false);
      expect(byRef.get("SPRINT-10")?.isDefault).toBe(true);
    });

    test("setDefault rejects archived Lists", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Inbox Project",
        alias: "INB",
      });
      const sprintId = await asUser.mutation(api.tasks.lists.create, {
        projectId,
        name: "Sprint 10",
      });
      await asUser.mutation(api.tasks.lists.archive, { id: sprintId });

      await expect(
        asUser.mutation(api.tasks.lists.setDefault, { id: sprintId })
      ).rejects.toThrow(/Archived Lists cannot be set as the default/);
    });

    test("setDefault requires List management permission", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      const viewer = await ctx.user();
      await ctx.projectMember(project._id, viewer._id, "viewer");
      const asViewer = ctx.asUser(viewer);
      const sprintId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 10",
      });

      await expect(
        asViewer.mutation(api.tasks.lists.setDefault, { id: sprintId })
      ).rejects.toThrow();
    });
  });

  describe("default / last-active protection", () => {
    test("rejects archiving and removing the default List", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Inbox Project",
        alias: "INB",
      });
      const inboxId = await t.run(async (runCtx) => {
        const project = await runCtx.db.get("projects", projectId);
        return project?.defaultListId;
      });
      if (!inboxId) throw new Error("expected a default List");

      await expect(
        asUser.mutation(api.tasks.lists.archive, { id: inboxId })
      ).rejects.toThrow(/default List cannot be archived or deleted/);
      await expect(
        asUser.mutation(api.tasks.lists.remove, { id: inboxId })
      ).rejects.toThrow(/default List cannot be archived or deleted/);
    });

    test("allows archiving a non-default, non-last active List", async () => {
      const ctx = createTestContext();
      const { org, asUser, t } = await ctx.setupOrg();

      const projectId = await asUser.mutation(api.projects.core.create, {
        organizationId: org._id,
        name: "Inbox Project",
        alias: "INB",
      });
      const sprintId = await asUser.mutation(api.tasks.lists.create, {
        projectId,
        name: "Sprint 10",
      });

      await asUser.mutation(api.tasks.lists.archive, { id: sprintId });

      const archived = await t.run(async (runCtx) =>
        runCtx.db.get("taskLists", sprintId)
      );
      expect(archived?.isArchived).toBe(true);
    });

    test("rejects archiving the only active List in a project", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject({
        project: { defaultListId: undefined },
      });

      const onlyListId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Only List",
      });

      await expect(
        asUser.mutation(api.tasks.lists.archive, { id: onlyListId })
      ).rejects.toThrow(/at least one active List/);
      await expect(
        asUser.mutation(api.tasks.lists.remove, { id: onlyListId })
      ).rejects.toThrow(/at least one active List/);
    });
  });
});
