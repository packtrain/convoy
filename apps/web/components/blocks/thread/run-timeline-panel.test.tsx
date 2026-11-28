/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { emptyRunsMessage, RunTimelinePanel } from "./run-timeline-panel";
import type { TimelineRun } from "@/lib/threads/run-timeline";

const run = (n: number, prompt: string): TimelineRun => ({
  diffSummary: {
    preRef: `refs/pre-${n}`,
    postRef: `refs/post-${n}`,
    files: [],
    fileCount: n,
    additions: n,
    deletions: 0,
  },
  createdAt: n,
  prompt,
  fileCount: n,
  additions: n,
  deletions: 0,
});

const runs = [run(1, "first run"), run(2, "second run"), run(3, "third run")];

describe("RunTimelinePanel", () => {
  afterEach(cleanup);

  test("an empty repo-scoped timeline says no run changed that repo (UX OS-2522 round 1)", () => {
    render(<RunTimelinePanel runs={[]} onOpenRange={vi.fn()} repoLabel="packages/api" />);
    expect(screen.getByText("No run has changed packages/api yet.")).toBeTruthy();
  });

  test("a worktree thread's empty main checkout says why its runs skip it (UX OS-2647 round 1)", () => {
    expect(emptyRunsMessage("new-app", "feat/x")).toBe("This thread works in the feat/x worktree, so its runs don't track the new-app checkout.");
  });

  test("click–hover–click commits the contiguous range and resets the selection", () => {
    const onOpenRange = vi.fn();
    render(
      <RunTimelinePanel runs={runs} onOpenRange={onOpenRange} onRevertRun={vi.fn()} />
    );

    // Newest-first ordering.
    const labels = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(labels[0]).toContain("third run");
    expect(labels[2]).toContain("first run");

    fireEvent.click(screen.getByText("third run"));
    fireEvent.mouseEnter(screen.getByText("first run").closest("li")!);
    expect(screen.getByText("3 runs selected — click to open the diff.")).toBeDefined();

    fireEvent.click(screen.getByText("first run"));
    expect(onOpenRange).toHaveBeenCalledWith(
      { preRef: "refs/pre-1", postRef: "refs/post-3", files: [] },
      { from: 1, to: 3 }
    );
    // The panel stays open, so the selection resets for the next range.
    expect(
      screen.getByText(
        "Click a run to start a range, click another to view the combined diff."
      )
    ).toBeDefined();
  });

  test("clicking the same run twice opens that single run's diff", () => {
    const onOpenRange = vi.fn();
    render(
      <RunTimelinePanel runs={runs} onOpenRange={onOpenRange} onRevertRun={vi.fn()} />
    );

    fireEvent.click(screen.getByText("second run"));
    fireEvent.click(screen.getByText("second run"));
    expect(onOpenRange).toHaveBeenCalledWith(
      { preRef: "refs/pre-2", postRef: "refs/post-2", files: [] },
      { from: 2, to: 2 }
    );
  });

  test("restore action reverts that run without committing a range", () => {
    const onOpenRange = vi.fn();
    const onRevertRun = vi.fn();
    render(
      <RunTimelinePanel runs={runs} onOpenRange={onOpenRange} onRevertRun={onRevertRun} />
    );

    // Rows are newest-first: index 1 is the second run.
    fireEvent.click(
      screen.getAllByRole("button", { name: "Restore to before this run" })[1]
    );
    expect(onRevertRun).toHaveBeenCalledWith(runs[1].diffSummary);
    expect(onOpenRange).not.toHaveBeenCalled();
  });

  // Reverting is owner-only (`cli.worktreeOps.enqueue`), so a read-only viewer
  // is passed no handler and must not be offered the action.
  test("hides the restore action when no revert handler is given", () => {
    render(<RunTimelinePanel runs={runs} onOpenRange={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Restore to before this run" })
    ).toBeNull();
    // The timeline itself still works — browsing runs is a read.
    expect(screen.getAllByRole("button", { name: /run/i }).length).toBeGreaterThan(0);
  });

  test("shows an empty state when the thread has no runs", () => {
    render(<RunTimelinePanel runs={[]} onOpenRange={vi.fn()} onRevertRun={vi.fn()} />);
    expect(screen.getByText("No runs yet.")).toBeDefined();
  });
});
