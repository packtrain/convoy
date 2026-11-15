import { expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { toTaskMutationArgs } from "./task-mutations";

test("sends section changes, including a clear", () => {
  const sectionId = "design" as Id<"taskSections">;
  expect(toTaskMutationArgs("t", { sectionId })).toEqual({ id: "t", sectionId });
  expect(toTaskMutationArgs("t", { sectionId: null })).toEqual({ id: "t", sectionId: null });
});
