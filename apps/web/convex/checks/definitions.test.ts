/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { MAX_CHECKS_PER_PROJECT } from "./lib/constants";

describe("checks.definitions", () => {
  test("creates checks and lists them in key order", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await asUser.mutation(api.checks.definitions.create, {
      projectId: project._id,
      key: "tests",
      label: "  All   tests pass ",
      instruction: " Run the suite ",
    });
    await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key: "lint", label: "Lint clean", instruction: "" });

    const list = await asUser.query(api.checks.definitions.list, { projectId: project._id });
    expect(list.map(({ key, label, instruction }) => ({ key, label, instruction }))).toEqual([
      { key: "lint", label: "Lint clean", instruction: "" },
      { key: "tests", label: "All tests pass", instruction: "Run the suite" },
    ]);
  });

  test("rejects invalid and duplicate keys, empty labels, and more than the cap", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const create = (key: string, label = "Label") =>
      asUser.mutation(api.checks.definitions.create, { projectId: project._id, key, label, instruction: "" });

    await expect(create("Tests")).rejects.toThrow("Check key must start with a lowercase letter or digit");
    await expect(create("-tests")).rejects.toThrow("Check key must start with a lowercase letter or digit");
    await expect(create("tests", "  ")).rejects.toThrow("Check label cannot be empty");
    await create("tests");
    await expect(create("tests")).rejects.toThrow("A check with this key already exists");

    for (let i = 1; i < MAX_CHECKS_PER_PROJECT; i++) {
      await create(`check-${i}`);
    }
    await expect(create("one-too-many")).rejects.toThrow(`up to ${MAX_CHECKS_PER_PROJECT} checks`);
  });

  test("updates label and instruction but never the key", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const checkId = await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key: "ui", label: "UI", instruction: "" });

    await asUser.mutation(api.checks.definitions.update, { checkId, label: "UI verified", instruction: "Attach screenshots" });

    const [check] = await asUser.query(api.checks.definitions.list, { projectId: project._id });
    expect(check).toMatchObject({ key: "ui", label: "UI verified", instruction: "Attach screenshots" });
  });

  test("delete drops the key from every checklist", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const testsId = await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key: "tests", label: "Tests", instruction: "" });
    await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key: "ui", label: "UI", instruction: "" });
    await asUser.mutation(api.checks.checklists.create, { projectId: project._id, name: "Feature", checkKeys: ["tests", "ui"], taskTypeKeys: [] });

    await asUser.mutation(api.checks.definitions.remove, { checkId: testsId });

    const [checklist] = await asUser.query(api.checks.checklists.list, { projectId: project._id });
    expect(checklist.checkKeys).toEqual(["ui"]);
    expect(await asUser.query(api.checks.definitions.list, { projectId: project._id })).toHaveLength(1);
  });

  test("requires project:update to manage the catalog; members can read it", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const asMember = ctx.asUser(member);

    await expect(
      asMember.mutation(api.checks.definitions.create, { projectId: project._id, key: "tests", label: "Tests", instruction: "" })
    ).rejects.toThrow();
    const checkId = await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key: "tests", label: "Tests", instruction: "" });
    await expect(asMember.mutation(api.checks.definitions.update, { checkId, label: "Nope" })).rejects.toThrow();
    await expect(asMember.mutation(api.checks.definitions.remove, { checkId })).rejects.toThrow();

    expect(await asMember.query(api.checks.definitions.list, { projectId: project._id })).toHaveLength(1);
    const outsider = ctx.asUser(await ctx.user());
    expect(await outsider.query(api.checks.definitions.list, { projectId: project._id })).toEqual([]);
  });
});
