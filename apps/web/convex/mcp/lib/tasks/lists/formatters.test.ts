import { expect, test } from "vitest";
import type { Id } from "../../../../_generated/dataModel";
import { projectTaskListPage } from "./formatters";

test("List rows report their default board rows", () => {
  const list = {
    _id: "list_1" as Id<"taskLists">, _creationTime: 1, projectId: "project_1" as Id<"projects">,
    name: "Sprint", ref: "SPRINT", isArchived: false,
    defaultViewMode: "board", defaultBoardGroupBy: "status", defaultBoardRowGroupBy: "section",
  } as Parameters<typeof projectTaskListPage>[0]["page"][number];
  const page = projectTaskListPage({ page: [list], isDone: true, continueCursor: "" });
  expect(page.page[0]).toMatchObject({ defaultViewMode: "board", defaultBoardGroupBy: "status", defaultBoardRowGroupBy: "section" });
});
