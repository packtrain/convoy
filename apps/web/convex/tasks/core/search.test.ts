/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { api } from "../../_generated/api";
import { createTestContext, gen } from "../../../convex-testing";
import { EMPTY_PAGE } from "../../lib/shared/pagination";
import {
  recentForSelector as listRecentForSelector,
  byProject as searchByProject,
} from "./search";

const validProjectAgentInput = {
  name: "Search Agent",
  description: "Finds matching tasks",
  prompt: "Search tasks.",
  category: "Search",
  appearance: { color: "#3b82f6" },
};

function exportReturns(definition: unknown): string {
  if (
    typeof definition !== "function" ||
    !("exportReturns" in definition) ||
    typeof definition.exportReturns !== "function"
  ) {
    throw new Error("Convex function definition does not expose exportReturns");
  }
  return definition.exportReturns();
}

describe("searchByProject", () => {
  test("returns validator includes Convex pagination metadata fields", () => {
    const returnsSchema = exportReturns(searchByProject);
    expect(returnsSchema).toContain('"continueCursor"');
    expect(returnsSchema).toContain('"pageStatus"');
    expect(returnsSchema).toContain('"splitCursor"');
  });

  test("should return empty results when not authenticated", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    const result = await t.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "task",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });

    expect(result).toEqual(EMPTY_PAGE);
  });

  test("should search by name, description, and tags", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject({ project: { alias: "SEA" } });

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Implement webhook validator",
      priority: "High",
      status: "To Do",
      tags: ["security", "api"],
      rank: gen.rank(),
    });

    await asUser.mutation(api.tasks.core.update, {
      id: taskId,
      description: "Validate webhook signatures and reject replay attacks",
    });

    const byName = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "webhook",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });
    const byDescription = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "replay",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });
    const byTag = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "security",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });

    expect(byName.page.map((task) => task._id)).toContain(taskId);
    expect(byDescription.page.map((task) => task._id)).toContain(taskId);
    expect(byTag.page.map((task) => task._id)).toContain(taskId);

    const createdTask = byName.page.find((task) => task._id === taskId);
    expect(createdTask).toBeDefined();
    if (!createdTask) {
      throw new Error("Expected created task to exist in search results");
    }
    expect(createdTask.createdByName).toBe(user.name);

    const byRef = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: createdTask.refId,
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });
    expect(byRef.page.map((task) => task._id)).toContain(taskId);
  });

  test("should include direct parent for matched subtasks", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject({ project: { alias: "HIE" } });

    const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Parent planning task",
      priority: "Medium",
      status: "To Do",
      tags: [],
      rank: gen.rank(),
    });
    const { taskId: childId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      parentId,
      clientId: gen.clientId(),
      name: "Child implementation task",
      priority: "Medium",
      status: "To Do",
      tags: [],
      rank: gen.rank(),
    });

    const result = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "implementation",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });

    const child = result.page.find((task) => task._id === childId);
    expect(child).toBeDefined();
    expect(child?.parentId).toBe(parentId);
  });

  test("should support archive mode tabs and API-level status/assignee filters", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const otherUser = await ctx.user();
    await ctx.orgMember(org._id, otherUser._id, "member");
    await ctx.projectMember(project._id, otherUser._id, "member");

    const { taskId: activeTodo } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Active TODO task",
      priority: "Low",
      status: "To Do",
      assigneeId: user._id,
      tags: [],
      rank: gen.rank(),
    });
    const { taskId: activeDone } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Active done task",
      priority: "Low",
      status: "Done",
      assigneeId: otherUser._id,
      tags: [],
      rank: gen.rank(),
    });

    await asUser.mutation(api.tasks.core.archive, { id: activeDone });

    const activeResults = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "active",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });
    const archivedResults = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "active",
      archiveMode: "archived",
      paginationOpts: { numItems: 8, cursor: null },
    });

    expect(activeResults.page.map((task) => task._id)).toContain(activeTodo);
    expect(activeResults.page.map((task) => task._id)).not.toContain(activeDone);
    expect(archivedResults.page.map((task) => task._id)).toContain(activeDone);

    const statusFiltered = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "active",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { status: "To Do" },
    });
    expect(statusFiltered.page.every((task) => task.status === "To Do")).toBe(true);

    const assigneeFiltered = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "active",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { assigneeId: user._id },
    });
    expect(
      assigneeFiltered.page.every((task) => task.assignee?.userId === user._id)
    ).toBe(true);

    const meFiltered = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "active",
      archiveMode: "archived",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { assigneeId: "me" },
    });
    expect(meFiltered.page.map((task) => task._id)).toEqual([]);
    const otherMeFiltered = await ctx.asUser(otherUser).query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "active",
      archiveMode: "archived",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { assigneeId: "me" },
    });
    expect(otherMeFiltered.page.map((task) => task._id)).toEqual([activeDone]);
  });

  test("should support delegation and owner filters for Project agents and unassigned tasks", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });

    const { taskId: agentTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Search typed assigned task",
      priority: "Low",
      status: "To Do",
      delegatedToAgentId: projectAgentId,
      tags: [],
      rank: gen.rank(),
    });
    const { taskId: unassignedTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Search typed unassigned task",
      priority: "Low",
      status: "To Do",
      tags: [],
      rank: gen.rank(),
    });

    const agentFiltered = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "typed",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { delegatedToAgentId: projectAgentId },
    });
    expect(agentFiltered.page.map((task) => task._id)).toEqual([agentTaskId]);
    expect(agentFiltered.page[0].delegatedToAgent).toMatchObject({
      type: "projectAgent",
      projectAgentId,
    });
    // Delegating without an explicit owner auto-set the creator as owner.
    expect(agentFiltered.page[0].assignee).toMatchObject({ type: "user" });

    const unassignedFiltered = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "typed",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { assigneeId: null },
    });
    expect(unassignedFiltered.page.map((task) => task._id)).toEqual([
      unassignedTaskId,
    ]);

    const notDelegatedFiltered = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "typed",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { delegatedToAgentId: null },
    });
    expect(notDelegatedFiltered.page.map((task) => task._id)).toEqual([
      unassignedTaskId,
    ]);

    // Ownerless delegated tasks count as unassigned for the owner filter.
    const { taskId: ownerlessTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Search typed ownerless task",
      priority: "Low",
      status: "To Do",
      assigneeId: null,
      delegatedToAgentId: projectAgentId,
      tags: [],
      rank: gen.rank(),
    });
    const unassignedWithOwnerless = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "typed",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { assigneeId: null },
    });
    expect(unassignedWithOwnerless.page.map((task) => task._id).sort()).toEqual(
      [unassignedTaskId, ownerlessTaskId].sort()
    );
  });

  test("should apply split filters on the exact-ref (in-memory) path", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });
    const { refId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Ref filtered task",
      priority: "Low",
      status: "To Do",
      delegatedToAgentId: projectAgentId,
      tags: [],
      rank: gen.rank(),
    });

    const matching = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: refId,
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { delegatedToAgentId: projectAgentId, assigneeId: user._id },
    });
    expect(matching.page.map((task) => task.refId)).toContain(refId);

    const nonMatching = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: refId,
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { delegatedToAgentId: null },
    });
    expect(nonMatching.page.map((task) => task.refId)).not.toContain(refId);
  });

  test("should support Triage and Plan Review status filters", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const { taskId: triageTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Triage search target",
      priority: "Low",
      status: "Triage",
      tags: [],
      rank: gen.rank(),
    });
    const { taskId: planReviewTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Plan review search target",
      priority: "Low",
      status: "Plan Review",
      tags: [],
      rank: gen.rank(),
    });

    const triageResults = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "target",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
      filters: { status: "Triage" },
    });
    const planReviewResults = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      status: "Plan Review",
    });

    expect(triageResults.page.map((task) => task._id)).toContain(triageTaskId);
    expect(triageResults.page.every((task) => task.status === "Triage")).toBe(true);
    expect(planReviewResults.map((task) => task._id)).toEqual([planReviewTaskId]);
    expect(planReviewResults[0]?.status).toBe("Plan Review");
  });

  test("should not return closed subtasks as root task-list rows", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Open parent",
      priority: "Medium",
      status: "To Do",
      tags: [],
      rank: "a",
    });
    await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      parentId,
      clientId: gen.clientId(),
      name: "Done child",
      priority: "Medium",
      status: "Done",
      tags: [],
      rank: "b",
    });
    await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      parentId,
      clientId: gen.clientId(),
      name: "Canceled child",
      priority: "Medium",
      status: "Canceled",
      tags: [],
      rank: "c",
    });
    const { taskId: doneRootId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Done root",
      priority: "Medium",
      status: "Done",
      tags: [],
      rank: "d",
    });
    const { taskId: canceledRootId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Canceled root",
      priority: "Medium",
      status: "Canceled",
      tags: [],
      rank: "e",
    });

    const doneResults = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      status: "Done",
    });
    const canceledResults = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      status: "Canceled",
    });

    expect(doneResults.map((task) => task._id)).toEqual([doneRootId]);
    expect(canceledResults.map((task) => task._id)).toEqual([canceledRootId]);
    expect(doneResults.every((task) => task.parentId === null)).toBe(true);
    expect(canceledResults.every((task) => task.parentId === null)).toBe(true);
  });

  test("should not return closed subtasks as root rows in a selected List", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint",
      ref: "SPRINT",
    });

    const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Listed open parent",
      priority: "Medium",
      status: "To Do",
      tags: [],
      rank: "a",
      listId,
    });
    await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      parentId,
      clientId: gen.clientId(),
      name: "Listed done child",
      priority: "Medium",
      status: "Done",
      tags: [],
      rank: "b",
      listId,
    });
    const { taskId: listedDoneRootId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Listed done root",
      priority: "Medium",
      status: "Done",
      tags: [],
      rank: "c",
      listId,
    });

    const doneResults = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      listRef: "SPRINT",
      status: "Done",
    });

    expect(doneResults.map((task) => task._id)).toEqual([listedDoneRootId]);
    expect(doneResults.every((task) => task.parentId === null)).toBe(true);
  });

  test("should paginate and enforce search term cap without failing", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    for (let i = 0; i < 3; i++) {
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: `Pagination target ${i}`,
        priority: "Medium",
        status: "To Do",
        tags: ["paging"],
        rank: gen.rank(),
      });
    }

    const paginated = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "Pagination",
      archiveMode: "active",
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(paginated.page).toHaveLength(2);
    expect(paginated.isDone).toBe(false);
    expect(paginated.continueCursor).not.toBe("");

    const secondPage = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "Pagination",
      archiveMode: "active",
      paginationOpts: { numItems: 2, cursor: paginated.continueCursor },
    });
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);

    const longQuery = Array.from({ length: 24 }, () => "Pagination").join(" ");
    const longQueryResult = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: longQuery,
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });
    expect(longQueryResult.page.length).toBeGreaterThan(0);
  });
});

describe("listRecentForSelector", () => {
  test("returns validator includes Convex pagination metadata fields", () => {
    const returnsSchema = exportReturns(listRecentForSelector);
    expect(returnsSchema).toContain('"continueCursor"');
    expect(returnsSchema).toContain('"pageStatus"');
    expect(returnsSchema).toContain('"splitCursor"');
  });

  test("returns empty results when not authenticated", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    const result = await t.query(api.tasks.core.search.recentForSelector, {
      projectId: project._id,
      paginationOpts: { numItems: 8, cursor: null },
    });

    expect(result).toEqual(EMPTY_PAGE);
  });

  test("paginates recent active tasks by createdAt descending", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject({ project: { alias: "BRD" } });
    const sprintListId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
      color: "#3b82f6",
    });

    const { taskId: firstTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "First task",
      priority: "Low",
      status: "To Do",
      tags: [],
      listRef: "BACKLOG",
      rank: gen.rank(),
    });
    const { taskId: secondTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Second task",
      priority: "Low",
      status: "To Do",
      listId: sprintListId,
      tags: [],
      rank: gen.rank(),
    });
    const { taskId: thirdTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Third task",
      priority: "Low",
      status: "In Progress",
      tags: [],
      rank: gen.rank(),
    });
    const { taskId: fourthTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Fourth task",
      priority: "Low",
      status: "Done",
      tags: [],
      rank: gen.rank(),
    });

    const page1 = await asUser.query(api.tasks.core.search.recentForSelector, {
      projectId: project._id,
      paginationOpts: { numItems: 2, cursor: null },
    });

    expect(page1.page.map((task) => task._id)).toEqual([fourthTaskId, thirdTaskId]);
    expect(page1.isDone).toBe(false);
    expect(page1.continueCursor).not.toBe("");

    const page2 = await asUser.query(api.tasks.core.search.recentForSelector, {
      projectId: project._id,
      paginationOpts: { numItems: 2, cursor: page1.continueCursor },
    });

    expect(page2.page.map((task) => task._id)).toEqual([secondTaskId, firstTaskId]);
    expect(page2.page[0].list).toMatchObject({
      type: "list",
      id: sprintListId,
      ref: "SPRINT-1",
      name: "Sprint 1",
      color: "#3b82f6",
      isArchived: false,
    });

    const page3 = await asUser.query(api.tasks.core.search.recentForSelector, {
      projectId: project._id,
      paginationOpts: { numItems: 2, cursor: page2.continueCursor },
    });

    expect(page3.page).toHaveLength(0);
    expect(page3.isDone).toBe(true);
  });

  test("returns archived List metadata for active tasks in archived Lists", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject({ project: { alias: "BRD" } });
    await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Keeper",
    });
    const sprintListId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 2",
      ref: "SPRINT-2",
    });
    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Listed task",
      priority: "Low",
      status: "To Do",
      listId: sprintListId,
      tags: [],
      rank: gen.rank(),
    });

    await asUser.mutation(api.tasks.lists.archive, { id: sprintListId });

    const result = await asUser.query(api.tasks.core.search.recentForSelector, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const task = result.page.find((item) => item._id === taskId);
    expect(task?.list).toMatchObject({
      type: "list",
      id: sprintListId,
      ref: "SPRINT-2",
      name: "Sprint 2",
      isArchived: true,
    });
  });
});

describe("byProjectForTable", () => {
  test("returns empty results when not authenticated", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    const result = await t.query(api.tasks.core.search.byProjectForTable, {
      projectId: project._id,
      query: "task",
      paginationOpts: { numItems: 8, cursor: null },
    });

    expect(result).toEqual(EMPTY_PAGE);
  });

  test("returns active hits from every List in the task table row shape", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint",
      ref: "SPRINT",
    });
    const create = (name: string, extra: { listId?: typeof listId } = {}) =>
      asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name,
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
        ...extra,
      });
    const { taskId: defaultListId } = await create("Rocket in default list");
    const { taskId: sprintId } = await create("Rocket in sprint", { listId });
    const { taskId: archivedId } = await create("Rocket archived");
    await asUser.mutation(api.tasks.core.archive, { id: archivedId });

    const result = await asUser.query(api.tasks.core.search.byProjectForTable, {
      projectId: project._id,
      query: "rocket",
      paginationOpts: { numItems: 8, cursor: null },
    });

    expect(result.page.map((task) => task._id).sort()).toEqual([defaultListId, sprintId].sort());
    const sprintTask = result.page.find((task) => task._id === sprintId);
    expect(sprintTask).toMatchObject({ clientId: expect.any(String), rank: expect.any(String) });
    expect(sprintTask?.list).toMatchObject({ ref: "SPRINT" });
  });
});
