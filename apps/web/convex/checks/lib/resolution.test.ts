import { describe, expect, test } from "vitest";
import { retypeTaskChecks } from "./resolution";

const result = { _id: "result_1", status: "failed" as const };
const base = {
  checklists: [
    { _id: "feature", name: "Feature", isDefault: true, checkKeys: ["tests", "ui"], taskTypeKeys: ["feature"] },
    { _id: "bug", name: "Bug fix", isDefault: false, checkKeys: ["regression", "tests"], taskTypeKeys: ["bug"] },
  ],
  checklistId: "feature",
  followsTypeDefault: true,
  catalog: [
    { key: "tests", label: "All tests pass", instruction: "Run them" },
    { key: "ui", label: "UI verified", instruction: "" },
    { key: "regression", label: "Regression test", instruction: "" },
  ],
  checks: [
    { key: "tests", label: "All tests pass", instruction: "Run them", added: false, results: [] },
    { key: "ui", label: "UI verified", instruction: "", added: false, results: [result] },
  ],
};

describe("retypeTaskChecks", () => {
  test("a task on its type default switches to the new type's checklist and keeps reported checks", () => {
    expect(retypeTaskChecks(base, "bug")).toMatchObject({
      checklistId: "bug",
      checklists: [{ isDefault: false }, { isDefault: true }],
      checks: [
        { key: "regression", label: "Regression test", added: false, results: [] },
        { key: "tests", instruction: "Run them", added: false, results: [] },
        { key: "ui", added: true, results: [result] },
      ],
    });
  });

  test("a type with no checklist leaves only reported checks", () => {
    const retyped = retypeTaskChecks(base, "chore");
    expect(retyped.checklistId).toBeNull();
    expect(retyped.checks.map((check) => check.key)).toEqual(["ui"]);
  });

  test("a picked checklist stays; only the Default mark moves", () => {
    const retyped = retypeTaskChecks({ ...base, followsTypeDefault: false }, "bug");
    expect(retyped.checklistId).toBe("feature");
    expect(retyped.checks).toBe(base.checks);
    expect(retyped.checklists.map((checklist) => checklist.isDefault)).toEqual([false, true]);
  });
});
