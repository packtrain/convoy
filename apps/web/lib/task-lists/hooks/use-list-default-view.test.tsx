/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import { BACKLOG_LIST_REF } from "@/lib/task-lists/system-lists";
import { useListDefaultViewNavigation } from "./use-list-default-view";

const listFixture: TaskListItem = {
  type: "list",
  _id: "list_1" as Id<"taskLists">,
  _creationTime: 1,
  projectId: "project_1" as Id<"projects">,
  name: "Sprint 1",
  ref: "SPRINT-1",
  isArchived: false,
  isDefault: false,
  isPinned: false,
  createdBy: "user_1" as Id<"users">,
  updatedBy: "user_1" as Id<"users">,
  createdAt: 1,
  updatedAt: 1,
};

const defaultListFixture: TaskListItem = {
  ...listFixture,
  _id: "list_default" as Id<"taskLists">,
  ref: "INBOX",
  name: "Inbox",
  isDefault: true,
  defaultViewMode: "board",
  defaultBoardGroupBy: "type",
};

function renderNavigation(
  project: Parameters<typeof useListDefaultViewNavigation>[0]["project"]
) {
  const setSelectedListRef = vi.fn();
  const selectedListHref = vi.fn(() => "/href");
  const { result } = renderHook(() =>
    useListDefaultViewNavigation({
      project,
      results: [defaultListFixture, listFixture],
      setSelectedListRef,
      selectedListHref,
    })
  );
  return { result, setSelectedListRef, selectedListHref };
}

describe("useListDefaultViewNavigation", () => {
  test("resolves the default-List row through the project pointer", () => {
    const { result, setSelectedListRef } = renderNavigation({
      defaultViewMode: "list",
      defaultListId: "list_default" as Id<"taskLists">,
    });

    // The default-List picker row carries no ref, so its override would be
    // silently skipped if it were only looked up by ref.
    result.current.selectList(null);

    expect(setSelectedListRef).toHaveBeenCalledWith(null, {
      viewMode: "board",
      boardGroupBy: "type",
      listGroupBy: "none",
      boardRowGroupBy: "none",
      fromList: true,
    });
  });

  test("a List that inherits keeps the on-screen view", () => {
    const { result, setSelectedListRef } = renderNavigation({
      defaultViewMode: "board",
      defaultBoardGroupBy: "priority",
    });

    // SPRINT-1 has no override. Applying the project default here would bounce
    // a user who switched to Table back to Board on every List switch.
    result.current.selectList("SPRINT-1");

    expect(setSelectedListRef).toHaveBeenCalledWith("SPRINT-1", undefined);
  });

  test("system refs and unknown refs keep the on-screen view", () => {
    const { result, setSelectedListRef } = renderNavigation({
      defaultViewMode: "board",
      defaultBoardGroupBy: "priority",
      defaultListId: "list_default" as Id<"taskLists">,
    });

    result.current.selectList(BACKLOG_LIST_REF);
    result.current.selectList("ARCHIVED-LIST");

    expect(setSelectedListRef).toHaveBeenNthCalledWith(
      1,
      BACKLOG_LIST_REF,
      undefined
    );
    expect(setSelectedListRef).toHaveBeenNthCalledWith(
      2,
      "ARCHIVED-LIST",
      undefined
    );
  });

  test("hrefs go through the same resolution", () => {
    const { result, selectedListHref } = renderNavigation({
      defaultViewMode: "list",
      defaultListId: "list_default" as Id<"taskLists">,
    });

    expect(result.current.getListHref(null)).toBe("/href");
    expect(selectedListHref).toHaveBeenCalledWith(null, {
      viewMode: "board",
      boardGroupBy: "type",
      listGroupBy: "none",
      boardRowGroupBy: "none",
      fromList: true,
    });
  });
});
