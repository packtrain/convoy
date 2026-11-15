/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineSources } from "@/convex/tasks/lib/timeline/validators";
import type { TimelineSortDirection } from "@/lib/tasks/timeline/rows";
import { TimelineHeader } from "./timeline-header";

const ALL_ON: TimelineSources = { activity: true, comments: true, threads: true };

function renderHeader({
  sources = ALL_ON,
  sortDirection = "asc" as TimelineSortDirection,
  hasThreadSource = true,
}: {
  sources?: TimelineSources;
  sortDirection?: TimelineSortDirection;
  hasThreadSource?: boolean;
} = {}) {
  const onToggleSource = vi.fn();
  const onSortDirectionChange = vi.fn();

  render(
    <TimelineHeader
      sources={sources}
      sortDirection={sortDirection}
      onToggleSource={onToggleSource}
      onSortDirectionChange={onSortDirectionChange}
      hasThreadSource={hasThreadSource}
    />
  );

  return { onToggleSource, onSortDirectionChange };
}

/** Radix opens on `pointerdown`; `fireEvent.click` leaves the menu closed. */
async function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /^Filter timeline/ }), {
    button: 0,
    pointerType: "mouse",
  });
  await screen.findByRole("menuitemradio", { name: "Oldest first" });
}

afterEach(cleanup);

describe("TimelineHeader", () => {
  test("offers every source as an independent checkbox", async () => {
    renderHeader();
    await openMenu();

    // Checkboxes rather than a radio group: "comments + threads, activity off"
    // has to be expressible, and a mode switch cannot say it.
    for (const label of ["Comments", "Threads", "Activity"]) {
      expect(screen.getByRole("menuitemcheckbox", { name: label })).toBeTruthy();
    }
  });

  test("reports a source being turned off", async () => {
    const { onToggleSource } = renderHeader();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Activity" }));

    expect(onToggleSource).toHaveBeenCalledWith("activity", false);
  });

  test("reports a source being turned back on", async () => {
    const { onToggleSource } = renderHeader({ sources: { ...ALL_ON, comments: false } });
    await openMenu();

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Comments" }));

    expect(onToggleSource).toHaveBeenCalledWith("comments", true);
  });

  test("allows turning the last remaining source off", async () => {
    const { onToggleSource } = renderHeader({
      sources: { activity: true, comments: false, threads: false },
    });
    await openMenu();

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Activity" }));

    expect(onToggleSource).toHaveBeenCalledWith("activity", false);
  });

  test("hides the threads row where the thread source is unavailable", async () => {
    renderHeader({ hasThreadSource: false });
    await openMenu();

    expect(screen.queryByRole("menuitemcheckbox", { name: "Threads" })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: "Comments" })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "Activity" })).toBeTruthy();
  });

  test("marks the trigger when a source is hidden", () => {
    renderHeader({ sources: { ...ALL_ON, activity: false } });

    // Otherwise a narrowed feed just looks like a quiet task.
    expect(screen.getByRole("button", { name: "Filter timeline (filtered)" })).toBeTruthy();
  });

  test("leaves the trigger unmarked with every source on", () => {
    renderHeader();

    expect(screen.getByRole("button", { name: "Filter timeline" })).toBeTruthy();
  });

  // A stored-off `threads` pref survives navigating away from a project route,
  // where the toggle is not offered — flagging it would point at a control the
  // viewer cannot see, with nothing to restore.
  test("ignores a hidden source when deciding whether the feed is filtered", () => {
    renderHeader({ sources: { ...ALL_ON, threads: false }, hasThreadSource: false });

    expect(screen.getByRole("button", { name: "Filter timeline" })).toBeTruthy();
  });

  test("reports a sort direction change", async () => {
    const { onSortDirectionChange } = renderHeader();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Newest first" }));

    expect(onSortDirectionChange).toHaveBeenCalledWith("desc");
  });

  test("checks the active sort direction", async () => {
    renderHeader({ sortDirection: "desc" });
    await openMenu();

    expect(screen.getByRole("menuitemradio", { name: "Newest first" }).dataset.state).toBe(
      "checked"
    );
    expect(screen.getByRole("menuitemradio", { name: "Oldest first" }).dataset.state).toBe(
      "unchecked"
    );
  });
});
