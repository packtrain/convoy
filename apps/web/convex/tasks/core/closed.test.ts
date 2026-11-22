/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { createTestContext, gen } from "../../../convex-testing";

const T0 = Date.UTC(2026, 10, 1);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

async function readClosedAt(ctx: ReturnType<typeof createTestContext>, id: Id<"tasks">) {
  return ctx.t.run(async (runCtx) => (await runCtx.db.get("tasks", id))?.closedAt ?? null);
}

describe("closedAt (docs/specs/task-closed-at.md)", () => {
  test("update stamps on close, keeps on same-status writes, re-stamps on Canceled, clears on reopen", async () => {
    // Setup commits before T0, so convex-test doesn't bump the clock of the close.
    vi.setSystemTime(T0 - 1000);
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id, { status: "To Do" });
    expect(await readClosedAt(ctx, task._id)).toBeNull();
    vi.setSystemTime(T0);

    await asUser.mutation(api.tasks.core.update, { id: task._id, status: "Done" });
    expect(await readClosedAt(ctx, task._id)).toBe(T0);

    vi.setSystemTime(T0 + DAY - 1000);
    await asUser.mutation(api.tasks.core.update, { id: task._id, name: "Renamed" });
    await asUser.mutation(api.tasks.core.update, { id: task._id, status: "Done" });
    expect(await readClosedAt(ctx, task._id)).toBe(T0);

    vi.setSystemTime(T0 + DAY);

    await asUser.mutation(api.tasks.core.update, { id: task._id, status: "Canceled" });
    expect(await readClosedAt(ctx, task._id)).toBe(T0 + DAY);

    await asUser.mutation(api.tasks.core.update, { id: task._id, status: "In Progress" });
    expect(await readClosedAt(ctx, task._id)).toBeNull();
  });

  test("create with a closed status stamps closedAt", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Already shipped",
      priority: "None",
      status: "Done",
      tags: [],
      rank: gen.rank(),
    });

    expect(await readClosedAt(ctx, taskId)).toBe(T0);
  });

  test("bulk status update stamps closedAt", async () => {
    vi.setSystemTime(T0 - 1000);
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const [a, b] = await ctx.tasks(project._id, user._id, 2, { status: "To Do" });
    vi.setSystemTime(T0);

    await asUser.mutation(api.tasks.core.bulk.update, { ids: [a._id, b._id], status: "Done" });

    expect(await readClosedAt(ctx, a._id)).toBe(T0);
    expect(await readClosedAt(ctx, b._id)).toBe(T0);
  });
});

describe("tasks.core.listClosed", () => {
  async function setup() {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject({ project: { alias: "OS" } });
    const closeOn = async (name: string, day: number, status: "Done" | "Canceled" = "Done") => {
      const task = await ctx.task(project._id, user._id, { name, status: "To Do" });
      vi.setSystemTime(T0 + day * DAY);
      await asUser.mutation(api.tasks.core.update, { id: task._id, status });
      return task;
    };
    return { ctx, project, user, asUser, closeOn };
  }

  test("returns Done tasks newest closed first, capped by limit", async () => {
    const { project, asUser, closeOn } = await setup();
    await closeOn("first", 1);
    await closeOn("second", 2);
    await closeOn("third", 3);

    const rows = await asUser.query(api.tasks.core.listClosed, { projectId: project._id, limit: 2 });

    expect(rows.map((row) => [row.name, row.closedAt])).toEqual([
      ["third", T0 + 3 * DAY],
      ["second", T0 + 2 * DAY],
    ]);
  });

  test("since is inclusive and until is exclusive", async () => {
    const { project, asUser, closeOn } = await setup();
    await closeOn("day1", 1);
    await closeOn("day2", 2);
    await closeOn("day3", 3);

    const rows = await asUser.query(api.tasks.core.listClosed, {
      projectId: project._id,
      since: T0 + 2 * DAY,
      until: T0 + 3 * DAY,
    });

    expect(rows.map((row) => row.name)).toEqual(["day2"]);
  });

  test("filters by status, includes archived, excludes deleted and never-stamped tasks", async () => {
    const { ctx, project, user, asUser, closeOn } = await setup();
    await closeOn("done", 1);
    await closeOn("canceled", 2, "Canceled");
    const archived = await closeOn("archived", 3);
    await asUser.mutation(api.tasks.core.archive, { id: archived._id });
    const deleted = await closeOn("deleted", 4);
    await asUser.mutation(api.tasks.core.remove, { id: deleted._id });
    // Closed before the field shipped: written without closedAt.
    const legacy = await ctx.task(project._id, user._id, { name: "legacy", status: "To Do" });
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", legacy._id, { status: "Done" });
    });

    const done = await asUser.query(api.tasks.core.listClosed, { projectId: project._id });
    const canceled = await asUser.query(api.tasks.core.listClosed, {
      projectId: project._id,
      status: "Canceled",
    });

    expect(done.map((row) => row.name)).toEqual(["archived", "done"]);
    expect(canceled.map((row) => row.name)).toEqual(["canceled"]);
  });

  test("rejects an out-of-range limit", async () => {
    const { project, asUser } = await setup();

    await expect(
      asUser.query(api.tasks.core.listClosed, { projectId: project._id, limit: 201 })
    ).rejects.toThrow(/limit/);
  });

  test("returns nothing to callers without project access", async () => {
    const { ctx, project, closeOn } = await setup();
    await closeOn("done", 1);
    const outsider = await ctx.user();

    await expect(
      ctx.asUser(outsider).query(api.tasks.core.listClosed, { projectId: project._id })
    ).resolves.toEqual([]);
  });
});
