// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { ActivityLog } from "@/lib/tasks/types";
import { format } from "date-fns";
import { TimelineActivityGroup } from "./timeline-activity-group";

function activityLog(overrides: Partial<ActivityLog> = {}): ActivityLog {
  return {
    _id: "activity_1" as Id<"taskActivityLogs">,
    _creationTime: Date.now(),
    taskId: "task_1" as Id<"tasks">,
    userId: "user_1" as Id<"users">,
    userName: "Ada Lovelace",
    userAvatarUrl: null,
    eventType: "archived",
    changeDetails: undefined,
    createdAt: Date.now(),
    ...overrides,
  } as ActivityLog;
}

describe("TimelineActivityGroup", () => {
  afterEach(() => {
    cleanup();
  });

  // The whole point of exporting `describeActivity`: the rail renders the same
  // copy as the activity log rather than reimplementing every event's wording.
  test("renders event copy from the shared catalog", () => {
    const { container } = render(<TimelineActivityGroup activities={[activityLog()]} />);

    expect(container.textContent).toContain("archived this task");
    expect(container.textContent).not.toContain("performed an action");
  });

  test("shows the absolute date on hover over the relative time", () => {
    const createdAt = Date.UTC(2026, 2, 5, 14, 30);
    render(<TimelineActivityGroup activities={[activityLog({ createdAt })]} />);

    const time = screen.getByText(/ago$/);
    expect(time.getAttribute("title")).toBe(format(new Date(createdAt), "PPpp"));
  });

  test("attributes every row, not just the group", () => {
    render(
      <TimelineActivityGroup
        activities={[
          activityLog({ _id: "activity_1" as Id<"taskActivityLogs">, userName: "Ada Lovelace" }),
          activityLog({
            _id: "activity_2" as Id<"taskActivityLogs">,
            userName: "Morgan Doe",
            eventType: "restored",
          }),
        ]}
      />
    );

    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Morgan Doe")).toBeTruthy();
  });

  test("renders one row per activity", () => {
    const { container } = render(
      <TimelineActivityGroup
        activities={[
          activityLog({ _id: "activity_1" as Id<"taskActivityLogs">, eventType: "archived" }),
          activityLog({ _id: "activity_2" as Id<"taskActivityLogs">, eventType: "unarchived" }),
        ]}
      />
    );

    expect(container.textContent).toContain("archived this task");
    expect(container.textContent).toContain("restored this task from the archive");
  });

  test("substitutes a gutter glyph for value-change events that carry their own", () => {
    // status_changed renders badges inside its text and no descriptor icon, so
    // the rail must still fill the gutter or the row loses its alignment.
    // Scoped to the gutter span itself — the row's own status badges also
    // contain svgs, and matching those would pass with no gutter glyph at all.
    const { container } = render(
      <TimelineActivityGroup
        activities={[
          activityLog({
            eventType: "status_changed",
            changeDetails: { type: "status", oldValue: "To Do", newValue: "Done" },
          }),
        ]}
      />
    );

    expect(container.textContent).toContain("changed status from");
    const gutter = container.querySelector("span.absolute.left-1");
    expect(gutter).toBeTruthy();
    expect(gutter?.querySelector("svg")).toBeTruthy();
  });

  test("puts the descriptor's own glyph in the gutter when it has one", () => {
    const { container } = render(<TimelineActivityGroup activities={[activityLog()]} />);

    expect(container.querySelector("span.absolute.left-1 svg")).toBeTruthy();
  });

  test("a group of only retired events renders nothing, rail included", () => {
    const { container } = render(
      <TimelineActivityGroup
        activities={[
          activityLog({
            eventType: "comment_added",
            changeDetails: { type: "comment", commentId: "comment_1" },
          }),
        ]}
      />
    );

    expect(container.innerHTML).toBe("");
  });

  test("a group mixing retired and live events renders only the live ones", () => {
    const { container } = render(
      <TimelineActivityGroup
        activities={[
          activityLog({
            _id: "activity_1" as Id<"taskActivityLogs">,
            eventType: "comment_added",
            changeDetails: { type: "comment", commentId: "comment_1" },
          }),
          activityLog({ _id: "activity_2" as Id<"taskActivityLogs">, eventType: "archived" }),
        ]}
      />
    );

    expect(container.textContent).toContain("archived this task");
    expect(container.textContent).not.toContain("added a comment");
  });
});
