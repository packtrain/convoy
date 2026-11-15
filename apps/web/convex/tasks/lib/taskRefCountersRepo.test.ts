/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { createTestContext } from "../../../convex-testing";
import { reserveTaskRefNumbers } from "./taskRefCountersRepo";

describe("reserveTaskRefNumbers", () => {
  test("fresh project (no counter row) starts at 1", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    const reserved = await t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 1));
    expect(reserved).toBe(1);

    await t.run(async (runCtx) => {
      const counter = await runCtx.db
        .query("taskRefCounters")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .unique();
      expect(counter?.nextRefNumber).toBe(2);
    });
  });

  test("continues from an existing counter row", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    await t.run(async (runCtx) => {
      await runCtx.db.insert("taskRefCounters", { projectId: project._id, nextRefNumber: 5 });
    });

    const reserved = await t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 1));
    expect(reserved).toBe(5);

    await t.run(async (runCtx) => {
      const counter = await runCtx.db
        .query("taskRefCounters")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .unique();
      expect(counter?.nextRefNumber).toBe(6);
    });
  });

  test("reserves a contiguous range in a single counter write", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    const start = await t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 3));
    expect(start).toBe(1);

    await t.run(async (runCtx) => {
      const counters = await runCtx.db
        .query("taskRefCounters")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      expect(counters).toHaveLength(1);
      expect(counters[0].nextRefNumber).toBe(4);
    });
  });

  test("sequential reservations hand out contiguous, monotonic numbers", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    const first = await t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 1));
    const second = await t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 2));
    const third = await t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 1));

    expect(first).toBe(1);
    expect(second).toBe(2); // 2 reserved → [2, 3]
    expect(third).toBe(4);
  });

  test("does not patch the project document (OS-934 isolation)", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    await t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 1));

    await t.run(async (runCtx) => {
      const after = await runCtx.db.get("projects", project._id);
      expect(after?.updatedAt).toBe(project.updatedAt);
    });
  });

  test("rejects non-positive or non-integer counts", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    await expect(
      t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 0))
    ).rejects.toThrow();
    await expect(
      t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, -1))
    ).rejects.toThrow();
    await expect(
      t.run((runCtx) => reserveTaskRefNumbers(runCtx, project._id, 1.5))
    ).rejects.toThrow();
  });
});
