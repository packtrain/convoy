// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { describeActivity, isRenderableActivity } from "./activity-item";
import type { Id } from "@/convex/_generated/dataModel";
import type { ActivityLog } from "@/lib/tasks/types";

/**
 * The module is the event catalog now — its two avatar-attributed renderers went
 * with the `All activity` tab (OS-1590), and the timeline's rail places the same
 * descriptor's glyph in a gutter instead. So these assert on `describeActivity`
 * directly rather than through a host, which is also what keeps them from
 * re-testing one surface's layout.
 */
function renderDescription(activity: ActivityLog) {
  const { icon, text } = describeActivity(activity);
  return render(
    <span>
      {icon}
      {text}
    </span>
  );
}

function activityLog(
  overrides: Partial<ActivityLog> = {}
): ActivityLog {
  return {
    _id: "activity_1",
    _creationTime: Date.now(),
    taskId: "task_1",
    userId: "user_1",
    userName: "Ada Lovelace",
    userAvatarUrl: null,
    eventType: "status_changed",
    changeDetails: {
      type: "status",
      oldValue: "Backlog",
      newValue: "Backlog",
    },
    createdAt: Date.now(),
    ...overrides,
  } as ActivityLog;
}

describe("describeActivity", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders historical Backlog status changes as plain status text", () => {
    renderDescription(activityLog());

    expect(screen.getByText("changed status from")).toBeTruthy();
    expect(screen.getAllByText("Backlog")).toHaveLength(2);
  });

  test("renders missing old status values without throwing", () => {
    renderDescription(
      activityLog({
        changeDetails: {
          type: "status",
          newValue: "To Do",
        },
      })
    );

    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("To Do")).toBeTruthy();
  });

  test("renders ID-only old assignee changes without a from value", () => {
    renderDescription(
      activityLog({
        eventType: "assignee_changed",
        changeDetails: {
          type: "assignee",
          oldUserId: "user_old" as Id<"users">,
        },
      })
    );

    expect(screen.getByText("changed assignee to")).toBeTruthy();
    expect(screen.getByText("No assignee")).toBeTruthy();
    expect(screen.queryByText("Assigned user")).toBeNull();
  });

  test("renders unassigned old assignee changes with a from value", () => {
    renderDescription(
      activityLog({
        eventType: "assignee_changed",
        changeDetails: {
          type: "assignee",
          newUserName: "Grace Hopper",
        },
      })
    );

    expect(screen.getByText("changed assignee from")).toBeTruthy();
    expect(screen.getByText("No assignee")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
  });

  // OS-1455: these events were emitted by the backend but missing from the
  // frontend union, so every row fell through to "performed an action".
  test("renders archive events", () => {
    renderDescription(activityLog({ eventType: "archived", changeDetails: undefined }));

    expect(screen.getByText("archived this task")).toBeTruthy();
    expect(screen.queryByText("performed an action")).toBeNull();
  });

  test("renders unarchive events distinctly from soft-delete restores", () => {
    renderDescription(activityLog({ eventType: "unarchived", changeDetails: undefined }));

    expect(screen.getByText("restored this task from the archive")).toBeTruthy();
    expect(screen.queryByText("performed an action")).toBeNull();
  });

  test("renders a tag addition as one row", () => {
    const { container } = renderDescription(
      activityLog({
        eventType: "tags_changed",
        changeDetails: { type: "tags", added: ["design"], removed: [] },
      })
    );

    expect(container.textContent).toContain("added tag");
    expect(screen.getByText("design")).toBeTruthy();
  });

  test("renders a tag removal as one row", () => {
    const { container } = renderDescription(
      activityLog({
        eventType: "tags_changed",
        changeDetails: { type: "tags", added: [], removed: ["draft", "wip"] },
      })
    );

    expect(container.textContent).toContain("removed tags");
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("wip")).toBeTruthy();
  });

  test("renders a tag swap as one row with +/- chips", () => {
    const { container } = renderDescription(
      activityLog({
        eventType: "tags_changed",
        changeDetails: { type: "tags", added: ["design"], removed: ["draft"] },
      })
    );

    expect(container.textContent).toContain("changed tags");
    expect(screen.getByText("+design")).toBeTruthy();
    expect(screen.getByText("−draft")).toBeTruthy();
  });

  test("renders task type changes with both type names", () => {
    const { container } = renderDescription(
      activityLog({
        eventType: "type_changed",
        changeDetails: {
          type: "task_type",
          oldKey: "task",
          oldName: "Task",
          newKey: "bug",
          newName: "Bug",
        },
      })
    );

    expect(container.textContent).toContain("changed type from");
    expect(screen.getByText("Task")).toBeTruthy();
    expect(screen.getByText("Bug")).toBeTruthy();
  });

  test("renders an added external link as an anchor", () => {
    const { container } = renderDescription(
      activityLog({
        eventType: "external_link_changed",
        changeDetails: {
          type: "external_link",
          op: "added",
          linkId: "pr:github:12",
          kind: "pull_request",
          label: "Fix flaky test",
          url: "https://github.com/acme/app/pull/12",
        },
      })
    );

    expect(container.textContent).toContain("added pull request");
    expect(screen.getByRole("link", { name: "Fix flaky test" })).toBeTruthy();
  });

  test("renders a removed external link as plain text", () => {
    const { container } = renderDescription(
      activityLog({
        eventType: "external_link_changed",
        changeDetails: {
          type: "external_link",
          op: "removed",
          linkId: "url:1",
          kind: "url",
          label: "Design doc",
          url: "https://example.com/doc",
        },
      })
    );

    expect(container.textContent).toContain("removed link");
    expect(screen.getByText("Design doc")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("renders an attached thread with its title", () => {
    const { container } = renderDescription(
      activityLog({
        eventType: "thread_attached",
        changeDetails: { type: "thread", threadId: "thread_1" as Id<"cliThreads">, threadTitle: "Spike" },
      })
    );

    expect(container.textContent).toBe("attached thread Spike");
  });

  test("value-change events carry no icon, because the value is the glyph", () => {
    // The rail substitutes a neutral glyph for these so the gutter column
    // survives; a host that assumed a non-null icon would drop the alignment.
    expect(describeActivity(activityLog()).icon).toBeNull();
    expect(describeActivity(activityLog({ eventType: "archived", changeDetails: undefined })).icon)
      .not.toBeNull();
  });
});

describe("isRenderableActivity", () => {
  test("a historical comment_added row renders as nothing at all", () => {
    // Retired event: the timeline renders the comment itself, so this row would
    // be a duplicate. Hosts gate on the predicate and skip the row's whole
    // chrome, not just its text — a bare avatar would still read as an entry.
    const retired = activityLog({
      eventType: "comment_added",
      changeDetails: { type: "comment", commentId: "comment_1" },
    });

    expect(isRenderableActivity(retired)).toBe(false);
    expect(describeActivity(retired).text).toBeNull();
  });

  test("a live event stays renderable", () => {
    expect(isRenderableActivity(activityLog({ eventType: "archived" }))).toBe(true);
  });
});
