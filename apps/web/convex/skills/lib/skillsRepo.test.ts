/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { createTestContext } from "../../../convex-testing";
import { insertOrganizationSkill } from "./skillsRepo";

describe("insertOrganizationSkill", () => {
  test("stamps its own scope over a scope the caller passed in", async () => {
    const ctx = createTestContext();
    const { org, user, t } = await ctx.setupOrg();
    // Columns spread off an existing Skill carry `scope` past excess-property
    // checking, and a mis-stamped scope has no `projectId` to recover from.
    const columns = { organizationId: org._id, name: "pdf-tools", normalizedName: "pdf-tools", scope: "project" as const };

    const skillId = await t.run((runCtx) => insertOrganizationSkill(runCtx, columns, user._id));

    expect((await t.run((runCtx) => runCtx.db.get("skills", skillId)))?.scope).toBe("organization");
  });
});
