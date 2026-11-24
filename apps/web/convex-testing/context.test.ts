import { describe, it, expect } from "vitest";
import { createTestContext } from "./context";

/** `ctx.project()` must match `projects.core.create`, which always seeds the creator (OS-1706). */
describe("ctx.project", () => {
  it("seeds the creator as project-admin by default", async () => {
    const ctx = createTestContext();
    const { user, org } = await ctx.setupProject();
    const project = await ctx.project(org._id, user._id);

    const members = await ctx.t.run((runCtx) =>
      runCtx.db
        .query("projectMembers")
        .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id))
        .collect()
    );

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: user._id, role: "project-admin" });
  });

  it("seeds no members when withCreatorMembership is false", async () => {
    const ctx = createTestContext();
    const { user, org } = await ctx.setupProject();
    const project = await ctx.project(org._id, user._id, undefined, {
      withCreatorMembership: false,
    });

    const members = await ctx.t.run((runCtx) =>
      runCtx.db
        .query("projectMembers")
        .withIndex("by_project_and_user", (q) => q.eq("projectId", project._id))
        .collect()
    );

    expect(members).toEqual([]);
  });
});
