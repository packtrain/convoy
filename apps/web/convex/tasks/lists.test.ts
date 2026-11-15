/// <reference types="vite/client" />
import { describe, expect, test, vi } from "vitest";
import { LexoRank } from "lexorank";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";
import {
  MAX_ACTIVE_TASK_LISTS,
  MAX_PINNED_TASK_LISTS,
} from "../../lib/task-lists/constants";

describe("taskLists", () => {
  test("creates active Lists with normalized names and refs", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "  Sprint   10 ",
    });

    const results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const created = results.page.find((list) => list._id === listId);
    if (!created) {
      throw new Error("expected created List");
    }
    expect(created.name).toBe("Sprint 10");
    expect(created.ref).toBe("SPRINT-10");
    expect(created.isArchived).toBe(false);
    expect("color" in created).toBe(false);
    expect("normalizedName" in created).toBe(false);
    expect("nameSortKey" in created).toBe(false);
    expect("searchText" in created).toBe(false);
    expect(created.rank).toEqual(expect.any(String));

    const storedList = await t.run(async (runCtx) =>
      runCtx.db.get("taskLists", listId)
    );
    expect(storedList?.normalizedName).toBe("sprint 10");
    expect(storedList?.rank).toBe(created.rank);
  });

  test("creates, updates, clears, and preserves List color", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
      color: "#ef4444",
    });

    let results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(results.page.find((list) => list._id === listId)?.color).toBe(
      "#ef4444"
    );

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Sprint Ten",
      color: "#3b82f6",
    });

    results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(results.page.find((list) => list._id === listId)?.color).toBe(
      "#3b82f6"
    );

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Sprint 10",
    });

    await t.run(async (runCtx) => {
      const storedList = await runCtx.db.get("taskLists", listId);
      expect(storedList?.color).toBe("#3b82f6");
    });

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Sprint 10",
      color: null,
    });

    results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    const created = results.page.find((list) => list._id === listId);
    if (!created) {
      throw new Error("expected created List");
    }
    expect("color" in created).toBe(false);
  });

  test("rejects List colors outside the selected palette", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 10",
        color: "#ffffff",
      })
    ).rejects.toThrow("List color must be one of the supported palette colors");

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
      color: "#ef4444",
    });

    await expect(
      asUser.mutation(api.tasks.lists.update, {
        id: listId,
        name: "Sprint Ten",
        color: "#ffffff",
      })
    ).rejects.toThrow("List color must be one of the supported palette colors");
  });

  test("suggests valid refs for short generated names", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "L.",
    });

    const results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const created = results.page.find((list) => list._id === listId);
    expect(created?._id).toBe(listId);
    expect(created?.ref).toBe("LIST");
  });

  test("rejects duplicate names and refs within the same project", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });

    await expect(
      asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "sprint 1",
        ref: "SPRINT-2",
      })
    ).rejects.toThrow("already exists");

    await expect(
      asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 2",
        ref: "SPRINT-1",
      })
    ).rejects.toThrow("already exists");
  });

  test("rejects creating more than the active List limit", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    for (let index = 1; index < MAX_ACTIVE_TASK_LISTS; index += 1) {
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: `List ${index}`,
        ref: `LIST-${index}`,
      });
    }

    await expect(
      asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Overflow",
        ref: "OVERFLOW",
      })
    ).rejects.toThrow(`up to ${MAX_ACTIVE_TASK_LISTS} active Lists`);
  });

  test("rejects invalid refs", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Bad ref",
        ref: "1-bad",
      })
    ).rejects.toThrow("List ref must be");

    await expect(
      asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Bad ref",
        ref: "BAD--REF",
      })
    ).rejects.toThrow("List ref must be");
  });

  test("rejects reserved system refs", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Backlog",
        ref: "BACKLOG",
      })
    ).rejects.toThrow("reserved system List key");

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });

    await expect(
      asUser.mutation(api.tasks.lists.update, {
        id: listId,
        name: "Archived",
        ref: "ARCHIVED",
      })
    ).rejects.toThrow("reserved system List key");
  });

  test("treats invalid read-side refs as missing Lists", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });

    const result = await asUser.query(api.tasks.lists.getByRef, {
      projectId: project._id,
      ref: "SPRINT-1".repeat(20),
    });

    expect(result).toBeNull();
  });

  test("lists Lists with apiKey authentication", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Lists",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    const listed = await t.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
      apiKey: key,
    });
    expect(listed.page.map((list) => list._id)).toContain(listId);
  });

  test("returns no Lists for an out-of-scope API key project", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other",
      alias: "OTHR",
    });

    await asUser.mutation(api.tasks.lists.create, {
      projectId: otherProject._id,
      name: "Other List",
    });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Scoped",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: {
        organizationId: org._id,
        projectIds: [project._id],
      },
    });

    const lists = await t.query(api.tasks.lists.list, {
      projectId: otherProject._id,
      paginationOpts: { numItems: 10, cursor: null },
      apiKey: key,
    });

    expect(lists.page).toEqual([]);
  });

  test("renames without changing the ref unless a new ref is provided", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Sprint One",
    });

    let results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    let updated = results.page.find((list) => list._id === listId);
    expect(updated?.name).toBe("Sprint One");
    expect(updated?.ref).toBe("SPRINT-1");

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Sprint One",
      ref: "SPRINT-ONE",
    });

    results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    updated = results.page.find((list) => list._id === listId);
    expect(updated?.ref).toBe("SPRINT-ONE");
  });

  test("archives, unarchives, and hard deletes Lists", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    // A project must keep at least one active List, so keep a separate List
    // active while exercising archive/unarchive/remove on another.
    const keeperId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Keeper",
    });
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Archive me",
    });

    await asUser.mutation(api.tasks.lists.archive, { id: listId });

    const activeResults = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(activeResults.page.map((list) => list._id)).toEqual(
      expect.arrayContaining([project.defaultListId, keeperId])
    );

    const archivedResults = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      archived: true,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(archivedResults.page.map((list) => list._id)).toEqual([listId]);

    await asUser.mutation(api.tasks.lists.unarchive, { id: listId });
    await asUser.mutation(api.tasks.lists.remove, { id: listId });

    const finalResults = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      archived: false,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(finalResults.page.map((list) => list._id)).toEqual(
      expect.arrayContaining([project.defaultListId, keeperId])
    );
  });

  test("archives but does not delete Lists referenced by tasks", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    // Keep a second active List so the List under test is not the last active
    // List; this isolates the empty-List check from the last-active invariant.
    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Keeper",
    });
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });

    await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: "task-1",
      name: "Listed task",
      priority: "Medium",
      status: "To Do",
      tags: [],
      listRef: "SPRINT-1",
    });

    await asUser.mutation(api.tasks.lists.archive, { id: listId });

    const archivedList = await asUser.query(api.tasks.lists.getByRef, {
      projectId: project._id,
      ref: "SPRINT-1",
    });
    expect(archivedList?.isArchived).toBe(true);

    const selectedTasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      archiveFilter: "active",
      status: "To Do",
      listRef: "SPRINT-1",
    });
    expect(selectedTasks.map((task) => task.name)).toEqual(["Listed task"]);
    expect(selectedTasks[0]?.list?.type).toBe("list");
    if (selectedTasks[0]?.list?.type !== "list") {
      throw new Error("Expected persisted List metadata");
    }
    expect(selectedTasks[0].list.isArchived).toBe(true);

    await expect(
      asUser.mutation(api.tasks.lists.remove, { id: listId })
    ).rejects.toThrow("Only Lists with no active tasks can be deleted");
  });

  test("deletes Lists that contain only archived tasks; those tasks render a removed List", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Keeper",
    });
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: "task-1",
      name: "Archived task",
      priority: "Medium",
      status: "To Do",
      tags: [],
      listRef: "SPRINT-1",
    });
    await asUser.mutation(api.tasks.core.archive, { id: taskId });

    // Archived tasks do not block deletion.
    await asUser.mutation(api.tasks.lists.remove, { id: listId });

    const removedList = await asUser.query(api.tasks.lists.getByRef, {
      projectId: project._id,
      ref: "SPRINT-1",
    });
    expect(removedList).toBeNull();

    // The archived task keeps its stale listKey and renders the removed marker.
    const archivedTasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      archiveFilter: "archived",
    });
    const archivedTask = archivedTasks.find((task) => task._id === taskId);
    expect(archivedTask?.list).toEqual({ type: "removed", name: "Deleted list" });
  });

  test("resolves archived Lists by ref", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Keeper",
    });
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Archived Sprint",
      ref: "ARCHIVED-SPRINT",
    });

    await asUser.mutation(api.tasks.lists.archive, { id: listId });

    const byRef = await asUser.query(api.tasks.lists.getByRef, {
      projectId: project._id,
      ref: "ARCHIVED-SPRINT",
    });

    expect(byRef?._id).toBe(listId);
    expect(byRef?.isArchived).toBe(true);
  });

  test("paginates and searches Lists within one project", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(project.organizationId, user._id, {
      alias: "OTH",
    });

    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Beta",
    });
    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Alpha",
    });
    await asUser.mutation(api.tasks.lists.create, {
      projectId: otherProject._id,
      name: "Alpha other",
    });

    const page1 = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(page1.page.map((list) => list.name)).toEqual(["Inbox"]);
    expect(page1.isDone).toBe(false);

    const page2 = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 2, cursor: page1.continueCursor },
    });
    expect(page2.page.map((list) => list.name)).toEqual(["Beta", "Alpha"]);

    const searched = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      query: "Alpha",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(searched.page.map((list) => list.name)).toEqual(["Alpha"]);
  });

  test("reorders Lists by rank and rejects invalid ranks", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const betaId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Beta",
    });
    const alphaId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Alpha",
    });

    const initial = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(initial.page.map((list) => list.name)).toEqual([
      "Inbox",
      "Beta",
      "Alpha",
    ]);

    const inbox = initial.page.find((list) => list.name === "Inbox");
    if (!inbox?.rank) {
      throw new Error("expected Inbox rank");
    }
    await asUser.mutation(api.tasks.lists.reorder, {
      id: alphaId,
      rank: LexoRank.parse(inbox.rank).genPrev().toString(),
    });

    const reordered = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(reordered.page.map((list) => list.name)).toEqual([
      "Alpha",
      "Inbox",
      "Beta",
    ]);

    await expect(
      asUser.mutation(api.tasks.lists.reorder, {
        id: betaId,
        rank: "not-a-rank",
      })
    ).rejects.toThrow("List rank is not a valid rank value");

    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    await expect(
      ctx.asUser(viewer).mutation(api.tasks.lists.reorder, {
        id: betaId,
        rank: LexoRank.middle().toString(),
      })
    ).rejects.toThrow("Permission denied");
  });

  test("allows project admins and members to manage Lists but rejects viewers", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const member = await ctx.user();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    const memberClient = ctx.asUser(member);
    const viewerClient = ctx.asUser(viewer);

    await memberClient.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Member List",
    });

    await expect(
      viewerClient.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Viewer List",
      })
    ).rejects.toThrow("Permission denied");

    const viewerResults = await viewerClient.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(viewerResults.page.map((list) => list.name)).toEqual([
      "Inbox",
      "Member List",
    ]);

    const adminResults = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(adminResults.page.map((list) => list.name)).toEqual([
      "Inbox",
      "Member List",
    ]);
  });

  test("pins and unpins Lists idempotently and exposes isPinned", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
    });

    await asUser.mutation(api.tasks.lists.pin, { id: listId });

    const results = await asUser.query(api.tasks.lists.list, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(
      results.page.find((list) => list._id === listId)?.isPinned
    ).toBe(true);

    const pinnedAt = await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("taskLists", listId);
      expect(stored?.isPinned).toBe(true);
      expect(stored?.pinnedBy).toBeDefined();
      return stored?.pinnedAt;
    });
    expect(pinnedAt).toBeDefined();

    // Idempotent: re-pinning keeps the original pin time.
    await asUser.mutation(api.tasks.lists.pin, { id: listId });
    await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("taskLists", listId);
      expect(stored?.pinnedAt).toBe(pinnedAt);
    });

    await asUser.mutation(api.tasks.lists.unpin, { id: listId });
    await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("taskLists", listId);
      expect(stored?.isPinned).toBeUndefined();
      expect(stored?.pinnedAt).toBeUndefined();
      expect(stored?.pinnedBy).toBeUndefined();
    });

    // Idempotent: unpinning a List that is not pinned is a no-op.
    await asUser.mutation(api.tasks.lists.unpin, { id: listId });

    const pinned = await asUser.query(api.tasks.lists.listPinnedForOrganization, {
      organizationId: org._id,
    });
    expect(pinned).toEqual([]);
  });

  test("create and update can save pin state with pin permission", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Pinned Sprint",
      isPinned: true,
    });

    const pinnedAt = await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("taskLists", listId);
      expect(stored?.isPinned).toBe(true);
      expect(stored?.pinnedBy).toBeDefined();
      return stored?.pinnedAt;
    });
    expect(pinnedAt).toBeDefined();

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Pinned Sprint",
      isPinned: false,
    });

    await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("taskLists", listId);
      expect(stored?.isPinned).toBeUndefined();
      expect(stored?.pinnedAt).toBeUndefined();
      expect(stored?.pinnedBy).toBeUndefined();
    });
  });

  test("create and update reject pin changes without pin permission", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const memberClient = ctx.asUser(member);

    await expect(
      memberClient.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Member Pinned",
        isPinned: true,
      })
    ).rejects.toThrow("Permission denied");

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Admin List",
    });

    await expect(
      memberClient.mutation(api.tasks.lists.update, {
        id: listId,
        name: "Member Rename",
        isPinned: true,
      })
    ).rejects.toThrow("Permission denied");
  });

  test("rejects pinning archived Lists", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
    });
    await asUser.mutation(api.tasks.lists.archive, { id: listId });

    await expect(
      asUser.mutation(api.tasks.lists.pin, { id: listId })
    ).rejects.toThrow("Archived Lists cannot be pinned");
  });

  test("rejects pinning beyond the pinned List limit", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    // The pinned cap equals the active-List cap, so fill every pin slot using
    // the default Inbox List plus new Lists, then exceed via the Backlog
    // system pin (which needs no List row).
    if (!project.defaultListId) {
      throw new Error("expected default List");
    }
    await asUser.mutation(api.tasks.lists.pin, { id: project.defaultListId });
    for (let i = 0; i < MAX_PINNED_TASK_LISTS - 1; i++) {
      const listId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: `Pinned ${i + 1}`,
      });
      await asUser.mutation(api.tasks.lists.pin, { id: listId });
    }

    await expect(
      asUser.mutation(api.tasks.lists.pinSystemList, {
        projectId: project._id,
        key: "backlog",
      })
    ).rejects.toThrow(
      `Projects can have up to ${MAX_PINNED_TASK_LISTS} pinned Lists`
    );
  });

  test("only project admins can pin/unpin, org role included (OS-1536)", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const member = await ctx.user();
    const viewer = await ctx.user();
    const orgAdmin = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.orgMember(org._id, orgAdmin._id, "admin");
    await ctx.projectMember(project._id, member._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
    });

    await expect(
      ctx.asUser(member).mutation(api.tasks.lists.pin, { id: listId })
    ).rejects.toThrow("Permission denied");
    await expect(
      ctx.asUser(viewer).mutation(api.tasks.lists.pin, { id: listId })
    ).rejects.toThrow("Permission denied");
    // The org admin needs a project row like anyone else.
    await expect(
      ctx.asUser(orgAdmin).mutation(api.tasks.lists.pin, { id: listId })
    ).rejects.toThrow("Not a member of this project");

    await ctx.projectMember(project._id, orgAdmin._id, "project-admin");
    await ctx.asUser(orgAdmin).mutation(api.tasks.lists.pin, { id: listId });

    await expect(
      ctx.asUser(member).mutation(api.tasks.lists.unpin, { id: listId })
    ).rejects.toThrow("Permission denied");

    await ctx.asUser(orgAdmin).mutation(api.tasks.lists.unpin, { id: listId });
  });

  test("archiving a pinned List removes the pin; unarchive does not restore it", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
    });
    await asUser.mutation(api.tasks.lists.pin, { id: listId });

    await asUser.mutation(api.tasks.lists.archive, { id: listId });
    await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("taskLists", listId);
      expect(stored?.isArchived).toBe(true);
      expect(stored?.isPinned).toBeUndefined();
      expect(stored?.pinnedAt).toBeUndefined();
      expect(stored?.pinnedBy).toBeUndefined();
    });

    await asUser.mutation(api.tasks.lists.unarchive, { id: listId });
    await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("taskLists", listId);
      expect(stored?.isArchived).toBe(false);
      expect(stored?.isPinned).toBeUndefined();
    });
  });

  test("listPinnedForOrganization returns rank-ordered Lists for accessible projects only", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();

    // Second project in the same org.
    const otherProject = await ctx.project(org._id, user._id);

    const firstListId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Beta",
    });
    const secondListId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Alpha",
    });
    const otherListId = await asUser.mutation(api.tasks.lists.create, {
      projectId: otherProject._id,
      name: "Hidden",
    });

    await asUser.mutation(api.tasks.lists.pin, { id: secondListId });
    await asUser.mutation(api.tasks.lists.pin, { id: firstListId });
    await asUser.mutation(api.tasks.lists.pin, { id: otherListId });

    const ownerView = await asUser.query(
      api.tasks.lists.listPinnedForOrganization,
      { organizationId: org._id }
    );
    expect(ownerView).toHaveLength(2);
    const projectEntry = ownerView.find(
      (entry) => entry.projectId === project._id
    );
    expect(projectEntry?.lists.map((list) => list.name)).toEqual([
      "Beta",
      "Alpha",
    ]);

    // A member of only the first project must not see the other project's pins.
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const memberView = await ctx
      .asUser(member)
      .query(api.tasks.lists.listPinnedForOrganization, {
        organizationId: org._id,
      });
    expect(memberView).toHaveLength(1);
    expect(memberView[0].projectId).toBe(project._id);

    // Unauthenticated callers get an empty result.
    const anonView = await t.query(api.tasks.lists.listPinnedForOrganization, {
      organizationId: org._id,
    });
    expect(anonView).toEqual([]);
  });

  test("pins and unpins the Backlog system List idempotently", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();

    await asUser.mutation(api.tasks.lists.pinSystemList, {
      projectId: project._id,
      key: "backlog",
    });

    expect(
      await asUser.query(api.tasks.lists.listPinnedSystemListKeys, {
        projectId: project._id,
      })
    ).toEqual(["backlog"]);

    const pinnedAt = await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("projects", project._id);
      const pin = stored?.pinnedSystemLists?.find((p) => p.key === "backlog");
      expect(pin?.pinnedBy).toBeDefined();
      return pin?.pinnedAt;
    });
    expect(pinnedAt).toBeDefined();

    // The Backlog surfaces in the sidebar query as a "system" entry.
    const pinned = await asUser.query(api.tasks.lists.listPinnedForOrganization, {
      organizationId: org._id,
    });
    const projectEntry = pinned.find((entry) => entry.projectId === project._id);
    expect(projectEntry?.lists).toEqual([
      { type: "system", key: "backlog", ref: "BACKLOG", name: "Backlog" },
    ]);

    // Idempotent: re-pinning keeps the original pin time and adds no duplicate.
    await asUser.mutation(api.tasks.lists.pinSystemList, {
      projectId: project._id,
      key: "backlog",
    });
    await t.run(async (runCtx) => {
      const stored = await runCtx.db.get("projects", project._id);
      expect(stored?.pinnedSystemLists).toHaveLength(1);
      expect(stored?.pinnedSystemLists?.[0].pinnedAt).toBe(pinnedAt);
    });

    await asUser.mutation(api.tasks.lists.unpinSystemList, {
      projectId: project._id,
      key: "backlog",
    });
    expect(
      await asUser.query(api.tasks.lists.listPinnedSystemListKeys, {
        projectId: project._id,
      })
    ).toEqual([]);

    // Idempotent: unpinning a system List that is not pinned is a no-op.
    await asUser.mutation(api.tasks.lists.unpinSystemList, {
      projectId: project._id,
      key: "backlog",
    });
  });

  test("renders system pins at the top, then persisted pins in List rank order", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();

    const betaId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Beta",
    });
    const alphaId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Alpha",
    });

    // Pin order is Alpha, then Beta. Persisted pins must still follow List
    // rank (Beta, Alpha), while Backlog remains fixed at the top.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await asUser.mutation(api.tasks.lists.pin, { id: alphaId });
      vi.advanceTimersByTime(1000);
      await asUser.mutation(api.tasks.lists.pinSystemList, {
        projectId: project._id,
        key: "backlog",
      });
      vi.advanceTimersByTime(1000);
      await asUser.mutation(api.tasks.lists.pin, { id: betaId });
    } finally {
      vi.useRealTimers();
    }

    const pinned = await asUser.query(api.tasks.lists.listPinnedForOrganization, {
      organizationId: org._id,
    });
    const projectEntry = pinned.find((entry) => entry.projectId === project._id);
    // Backlog (system) first, then persisted Lists in List rank order.
    expect(projectEntry?.lists.map((list) => list.name)).toEqual([
      "Backlog",
      "Beta",
      "Alpha",
    ]);
    expect(projectEntry?.lists.map((list) => list.type)).toEqual([
      "system",
      "list",
      "list",
    ]);
  });

  test("counts the Backlog system List toward the pinned List limit", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    // Fill all but one slot with persisted pins (starting from the default
    // Inbox so the active-List cap is not exceeded), take the last with
    // Backlog, and keep one unpinned List to attempt the overflow pin.
    if (!project.defaultListId) {
      throw new Error("expected default List");
    }
    await asUser.mutation(api.tasks.lists.pin, { id: project.defaultListId });
    for (let i = 0; i < MAX_PINNED_TASK_LISTS - 2; i++) {
      const listId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: `Pinned ${i + 1}`,
      });
      await asUser.mutation(api.tasks.lists.pin, { id: listId });
    }
    await asUser.mutation(api.tasks.lists.pinSystemList, {
      projectId: project._id,
      key: "backlog",
    });

    const extraListId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "One Too Many",
    });
    await expect(
      asUser.mutation(api.tasks.lists.pin, { id: extraListId })
    ).rejects.toThrow(
      `Projects can have up to ${MAX_PINNED_TASK_LISTS} pinned Lists`
    );
  });

  test("only project admins can pin/unpin the Backlog system List (OS-1536)", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();
    const member = await ctx.user();
    const viewer = await ctx.user();
    const orgAdmin = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.orgMember(org._id, orgAdmin._id, "admin");
    await ctx.projectMember(project._id, member._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    await expect(
      ctx.asUser(member).mutation(api.tasks.lists.pinSystemList, {
        projectId: project._id,
        key: "backlog",
      })
    ).rejects.toThrow("Permission denied");
    await expect(
      ctx.asUser(viewer).mutation(api.tasks.lists.pinSystemList, {
        projectId: project._id,
        key: "backlog",
      })
    ).rejects.toThrow("Permission denied");

    // The org admin needs a project row like anyone else (OS-1536).
    await expect(
      ctx.asUser(orgAdmin).mutation(api.tasks.lists.pinSystemList, {
        projectId: project._id,
        key: "backlog",
      })
    ).rejects.toThrow("Not a member of this project");

    await ctx.projectMember(project._id, orgAdmin._id, "project-admin");
    await ctx.asUser(orgAdmin).mutation(api.tasks.lists.pinSystemList, {
      projectId: project._id,
      key: "backlog",
    });
    await expect(
      ctx.asUser(member).mutation(api.tasks.lists.unpinSystemList, {
        projectId: project._id,
        key: "backlog",
      })
    ).rejects.toThrow("Permission denied");
    await ctx.asUser(orgAdmin).mutation(api.tasks.lists.unpinSystemList, {
      projectId: project._id,
      key: "backlog",
    });
  });

  test("stores, narrows, and clears a per-List default view override", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
    });

    const readList = async () => {
      const results = await asUser.query(api.tasks.lists.list, {
        projectId: project._id,
        paginationOpts: { numItems: 10, cursor: null },
      });
      const found = results.page.find((list) => list._id === listId);
      if (!found) {
        throw new Error("expected List");
      }
      return found;
    };

    // A fresh List inherits: neither key is present.
    const initial = await readList();
    expect("defaultViewMode" in initial).toBe(false);
    expect("defaultBoardGroupBy" in initial).toBe(false);

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
    });
    expect(await readList()).toMatchObject({
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
    });

    // Switching to List clears the stored grouping.
    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: "list",
    });
    const asList = await readList();
    expect(asList.defaultViewMode).toBe("list");
    expect("defaultBoardGroupBy" in asList).toBe(false);

    // Board with no grouping leaves it absent; the resolver normalizes to status.
    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: "board",
      defaultBoardGroupBy: "type",
    });
    const asBoard = await readList();
    expect(asBoard.defaultViewMode).toBe("board");
    expect(asBoard.defaultBoardGroupBy).toBe("type");

    // Omitting the field keeps the stored override — a rename must not clear it.
    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Renamed",
    });
    expect(await readList()).toMatchObject({
      name: "Renamed",
      defaultViewMode: "board",
      defaultBoardGroupBy: "type",
    });

    // null removes the fields outright rather than storing a sentinel.
    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: null,
    });
    const stored = await t.run(async (runCtx) =>
      runCtx.db.get("taskLists", listId)
    );
    expect(stored && "defaultViewMode" in stored).toBe(false);
    expect(stored && "defaultBoardGroupBy" in stored).toBe(false);
  });

  test("creates a List with its default view override in one transaction", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 11",
      defaultViewMode: "board",
      defaultBoardGroupBy: "priority",
    });

    const created = await asUser.query(api.tasks.lists.getByRef, {
      projectId: project._id,
      ref: "SPRINT-11",
    });
    expect(created?._id).toBe(listId);
    expect(created?.defaultViewMode).toBe("board");
    expect(created?.defaultBoardGroupBy).toBe("priority");
  });

  test("default view override surfaces on resolve and pinned sidebar entries", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 12",
      isPinned: true,
    });
    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: "board",
      defaultBoardGroupBy: "assignee",
    });
    await asUser.mutation(api.tasks.lists.pinSystemList, {
      projectId: project._id,
      key: "backlog",
    });

    const resolved = await asUser.query(api.tasks.lists.resolve, {
      projectId: project._id,
      identifier: "SPRINT-12",
    });
    expect(resolved?.defaultViewMode).toBe("board");
    expect(resolved?.defaultBoardGroupBy).toBe("assignee");

    const pinned = await asUser.query(
      api.tasks.lists.listPinnedForOrganization,
      { organizationId: org._id }
    );
    const entries = pinned.find((entry) => entry.projectId === project._id)?.lists ?? [];
    const pinnedList = entries.find(
      (entry) => entry.type === "list" && entry._id === listId
    );
    expect(pinnedList).toMatchObject({
      defaultViewMode: "board",
      defaultBoardGroupBy: "assignee",
    });
    // The Backlog system entry has no List row, so it carries no override.
    const backlog = entries.find((entry) => entry.type === "system");
    expect(backlog && "defaultViewMode" in backlog).toBe(false);
  });

  // Entry links that omit `list` land on the project's default List, so its
  // override rides along on the project nav rows (OS-1566).
  test("exposes the default List's override on project nav rows", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();

    const readNavRow = async () => {
      const rows = await asUser.query(api.projects.core.listByOrganization, {
        organizationId: org._id,
      });
      const row = rows.find((candidate) => candidate._id === project._id);
      if (!row) {
        throw new Error("expected project row");
      }
      return row;
    };

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
    });
    await asUser.mutation(api.tasks.lists.setDefault, { id: listId });

    // No override yet: the field stays absent so inheriting costs nothing.
    expect("defaultListView" in (await readNavRow())).toBe(false);

    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
    });
    expect((await readNavRow()).defaultListView).toEqual({
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
    });

    // An override on a non-default List does not leak onto the project row.
    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: null,
    });
    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 2",
      defaultViewMode: "board",
    });
    expect("defaultListView" in (await readNavRow())).toBe(false);
  });

  test("default List entry views are scoped to viewable projects", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const outsider = await ctx.user();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      defaultViewMode: "board",
    });
    await asUser.mutation(api.tasks.lists.setDefault, { id: listId });

    expect(
      await ctx
        .asUser(outsider)
        .query(api.projects.core.listByOrganization, { organizationId: org._id })
    ).toEqual([]);
  });

  test("setting a List default view requires list:manage", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const member = await ctx.user();
    const viewer = await ctx.user();
    const outsider = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 13",
    });

    // Members hold list:manage; viewers and non-members do not.
    await ctx.asUser(member).mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: "list",
    });
    await expect(
      ctx.asUser(viewer).mutation(api.tasks.lists.update, {
        id: listId,
        defaultViewMode: "list",
      })
    ).rejects.toThrow("Permission denied");
    await expect(
      ctx.asUser(outsider).mutation(api.tasks.lists.update, {
        id: listId,
        defaultViewMode: "list",
      })
    ).rejects.toThrow();
  });

  test("an archived List keeps its default view override", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Keeper",
    });
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 14",
    });
    await asUser.mutation(api.tasks.lists.archive, { id: listId });

    // Storing a view preference on an archived List is harmless and survives
    // unarchive, so there is deliberately no archived guard here.
    await asUser.mutation(api.tasks.lists.update, {
      id: listId,
      defaultViewMode: "board",
      defaultBoardGroupBy: "type",
    });
    await asUser.mutation(api.tasks.lists.unarchive, { id: listId });

    const restored = await asUser.query(api.tasks.lists.getByRef, {
      projectId: project._id,
      ref: "SPRINT-14",
    });
    expect(restored?.defaultViewMode).toBe("board");
    expect(restored?.defaultBoardGroupBy).toBe("type");
  });
});

describe("taskLists with apiKey auth (MCP/CLI)", () => {
  test("create, resolve, and update work with an API key of a project admin", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Lists",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    const listId = await t.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
      color: "#ef4444",
      apiKey: key,
    });

    const byRef = await t.query(api.tasks.lists.resolve, {
      projectId: project._id,
      identifier: "sprint-10",
      apiKey: key,
    });
    expect(byRef?._id).toBe(listId);
    const byId = await t.query(api.tasks.lists.resolve, {
      projectId: project._id,
      identifier: listId,
      apiKey: key,
    });
    expect(byId?._id).toBe(listId);

    await t.mutation(api.tasks.lists.update, {
      id: listId,
      name: "Sprint Ten",
      ref: "SPRINT-X",
      color: null,
      apiKey: key,
    });
    const updated = await t.query(api.tasks.lists.resolve, {
      projectId: project._id,
      identifier: "SPRINT-X",
      apiKey: key,
    });
    expect(updated?.name).toBe("Sprint Ten");
    expect(updated?.color).toBeUndefined();
  });

  test("resolve rejects scoped refs, system Lists, and unknown identifiers", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Lists",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    await t.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 10",
      apiKey: key,
    });

    for (const identifier of ["OTHER/SPRINT-10", "BACKLOG", "NOPE-1"]) {
      expect(
        await t.query(api.tasks.lists.resolve, {
          projectId: project._id,
          identifier,
          apiKey: key,
        })
      ).toBeNull();
    }
  });

  test("a viewer's API key cannot manage Lists", async () => {
    const ctx = createTestContext();
    const { org, project, t } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const { key } = await ctx.asUser(viewer).mutation(api.apiKeys.core.create, {
      name: "Viewer key",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    await expect(
      t.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Nope",
        apiKey: key,
      })
    ).rejects.toThrow("Permission denied");
  });
});

test("grouped list defaults persist and clear when switching layout or inheritance", async () => {
  const { project, asUser, t } = await createTestContext().setupProject();
  const id = await asUser.mutation(api.tasks.lists.create, { projectId: project._id, name: "Grouped", defaultViewMode: "list", defaultListGroupBy: "owner" });
  expect((await t.run(ctx => ctx.db.get("taskLists", id)))?.defaultListGroupBy).toBe("owner");
  await asUser.mutation(api.tasks.lists.update, { id, defaultViewMode: "list", defaultListGroupBy: "label" });
  const result = await asUser.query(api.tasks.lists.list, { projectId: project._id, paginationOpts: { numItems: 10, cursor: null } });
  expect(result.page.find(list => list._id === id)?.defaultListGroupBy).toBe("label");
  await asUser.mutation(api.tasks.lists.update, { id, defaultViewMode: "board", defaultBoardGroupBy: "owner" });
  expect((await t.run(ctx => ctx.db.get("taskLists", id)))?.defaultListGroupBy).toBeUndefined();
  await asUser.mutation(api.tasks.lists.update, { id, defaultViewMode: null });
  const inherited = await t.run(ctx => ctx.db.get("taskLists", id));
  expect(inherited?.defaultBoardGroupBy).toBeUndefined();
  expect(inherited?.defaultListGroupBy).toBeUndefined();
});


describe("List grouping argument contract", () => {
  const invalidCreateCases = [
    { defaultListGroupBy: "owner" },
    { defaultListGroupBy: "none" },
    { defaultViewMode: "board", defaultListGroupBy: "owner" },
    { defaultBoardGroupBy: "label" },
    { defaultViewMode: "list", defaultBoardGroupBy: "label" },
  ] as const;

  test.each(invalidCreateCases)("create rejects incompatible grouping %j", async fields => {
    const { project, asUser, t } = await createTestContext().setupProject();
    const before = await t.run(ctx => ctx.db.query("taskLists").collect());
    await expect(asUser.mutation(api.tasks.lists.create, {
      projectId: project._id, name: "Invalid grouping", ...fields,
    })).rejects.toThrow("requires defaultViewMode");
    expect(await t.run(ctx => ctx.db.query("taskLists").collect())).toEqual(before);
  });

  test.each([
    ...invalidCreateCases,
    { defaultViewMode: null, defaultListGroupBy: "owner" },
    { defaultViewMode: null, defaultBoardGroupBy: "label" },
  ] as const)("update rejects incompatible grouping without writes %j", async fields => {
    const { project, asUser, t } = await createTestContext().setupProject();
    const id = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id, name: "Existing", defaultViewMode: "list", defaultListGroupBy: "status",
    });
    const before = await t.run(ctx => ctx.db.get("taskLists", id));
    await expect(asUser.mutation(api.tasks.lists.update, {
      id, name: "Must not rename", ...fields,
    })).rejects.toThrow("requires defaultViewMode");
    expect(await t.run(ctx => ctx.db.get("taskLists", id))).toEqual(before);
  });

  test.each([undefined, "none"] as const)("create stores explicit none for list grouping %s", async grouping => {
    const { project, asUser, t } = await createTestContext().setupProject();
    const id = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id, name: "Ungrouped", defaultViewMode: "list", defaultListGroupBy: grouping,
    });
    expect((await t.run(ctx => ctx.db.get("taskLists", id)))?.defaultListGroupBy).toBe("none");
    await asUser.mutation(api.tasks.lists.update, { id, defaultViewMode: "list" });
    expect((await t.run(ctx => ctx.db.get("taskLists", id)))?.defaultListGroupBy).toBe("none");
  });
});

test("board row defaults persist with board mode and clear with list, inherit or a plain board reset", async () => {
  const { project, asUser, t } = await createTestContext().setupProject();
  const read = async (id: Id<"taskLists">) => (await t.run(ctx => ctx.db.get("taskLists", id)))?.defaultBoardRowGroupBy;
  const id = await asUser.mutation(api.tasks.lists.create, {
    projectId: project._id, name: "Rows", defaultViewMode: "board", defaultBoardGroupBy: "status", defaultBoardRowGroupBy: "section",
  });
  expect(await read(id)).toBe("section");
  const result = await asUser.query(api.tasks.lists.list, { projectId: project._id, paginationOpts: { numItems: 10, cursor: null } });
  expect(result.page.find(list => list._id === id)?.defaultBoardRowGroupBy).toBe("section");
  await asUser.mutation(api.tasks.lists.update, { id, name: "Renamed" });
  expect(await read(id)).toBe("section");
  await asUser.mutation(api.tasks.lists.update, { id, defaultViewMode: "board", defaultBoardGroupBy: "label" });
  expect(await read(id)).toBeUndefined();
  await asUser.mutation(api.tasks.lists.update, { id, defaultViewMode: "board", defaultBoardRowGroupBy: "owner" });
  expect(await read(id)).toBe("owner");
  await asUser.mutation(api.tasks.lists.update, { id, defaultViewMode: "list" });
  expect(await read(id)).toBeUndefined();
});

test.each([
  { defaultBoardRowGroupBy: "section" },
  { defaultViewMode: "list", defaultBoardRowGroupBy: "section" },
  { defaultViewMode: null, defaultBoardRowGroupBy: "section" },
] as const)("update rejects board rows without board mode %j", async fields => {
  const { project, asUser } = await createTestContext().setupProject();
  const id = await asUser.mutation(api.tasks.lists.create, { projectId: project._id, name: "Existing" });
  await expect(asUser.mutation(api.tasks.lists.update, { id, ...fields }))
    .rejects.toThrow("defaultBoardRowGroupBy requires defaultViewMode: board in the same call");
});
