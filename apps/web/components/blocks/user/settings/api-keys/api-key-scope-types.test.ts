import { expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { formatProjectSelectionTriggerText } from "./api-key-scope-types";

test("uses an ellipsis character while selected projects load", () => {
  expect(
    formatProjectSelectionTriggerText({
      projectIds: ["p1" as Id<"projects">],
      projects: [],
      isLoading: true,
    })
  ).toBe("Loading projects…");
});
