import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

describe("userProjectPreferences", () => {
  test("get returns default false when no record exists", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const prefs = await asUser.query(api.users.projectPreferences.get, { projectId: project._id });

    expect(prefs).toEqual({ agentAutoStart: false, guideAutoStart: false });
  });

  test("upsert round-trips agentAutoStart", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: true });
    expect(await asUser.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: true,
      guideAutoStart: false,
    });

    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: false });
    expect(await asUser.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: false,
      guideAutoStart: false,
    });
  });

  test("each choice is set on its own and keeps the other (OS-2414)", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: project._id, guideAutoStart: true });
    expect(await asUser.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: false,
      guideAutoStart: true,
    });

    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: true });
    expect(await asUser.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: true,
      guideAutoStart: true,
    });
    expect(await asUser.query(api.users.projectPreferences.listForUser, {})).toEqual([
      { projectId: project._id, agentAutoStart: true, guideAutoStart: true },
    ]);
  });

  test("preference is scoped per project", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id);

    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: true });

    expect(await asUser.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: true,
      guideAutoStart: false,
    });
    expect(await asUser.query(api.users.projectPreferences.get, { projectId: otherProject._id })).toEqual({
      agentAutoStart: false,
      guideAutoStart: false,
    });
  });

  test("preference is scoped per user", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const user2 = await ctx.user();
    await ctx.orgMember(org._id, user2._id, "member");
    await ctx.projectMember(project._id, user2._id, "member");
    const asUser2 = ctx.asUser(user2);

    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: true });

    expect(await asUser2.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: false,
      guideAutoStart: false,
    });
  });

  test("listForUser returns only the user's stored rows", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id);

    expect(await asUser.query(api.users.projectPreferences.listForUser, {})).toEqual([]);

    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: true });
    await asUser.mutation(api.users.projectPreferences.upsert, { projectId: otherProject._id, agentAutoStart: false });

    const rows = await asUser.query(api.users.projectPreferences.listForUser, {});
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { projectId: project._id, agentAutoStart: true, guideAutoStart: false },
        { projectId: otherProject._id, agentAutoStart: false, guideAutoStart: false },
      ])
    );

    // Another user sees none of them.
    const user2 = await ctx.user();
    expect(await ctx.asUser(user2).query(api.users.projectPreferences.listForUser, {})).toEqual([]);
  });

  test("viewer can read preferences but not write them", async () => {
    const ctx = createTestContext();
    const { org, project } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);

    expect(await asViewer.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: false,
      guideAutoStart: false,
    });
    await expect(
      asViewer.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: true })
    ).rejects.toThrow();
  });

  test("reads defaults but rejects writes without project access", async () => {
    const ctx = createTestContext();
    const { project } = await ctx.setupProject();
    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);

    // A subscription outliving its access reads defaults, not the error boundary.
    expect(await asOutsider.query(api.users.projectPreferences.get, { projectId: project._id })).toEqual({
      agentAutoStart: false,
      guideAutoStart: false,
    });
    await expect(
      asOutsider.mutation(api.users.projectPreferences.upsert, { projectId: project._id, agentAutoStart: true })
    ).rejects.toThrow();
  });
});
