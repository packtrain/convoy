/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliThreadBackgroundTasks } from "@/convex/lib/contracts/validators";
import { BackgroundTasksPill } from "./index";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const snapshot: CliThreadBackgroundTasks = {
  messageId: "message_1" as Id<"cliMessages">,
  sessionId: "process-1",
  totalCount: 2,
  tasks: [
    { id: "shell", type: "local_bash", description: "Run integration tests" },
    { id: "agent", type: "local_agent", description: "Review authentication changes" },
  ],
};

test("updates the open list, hides when empty, and reopens closed after a new process", () => {
  const { rerender } = render(<BackgroundTasksPill snapshot={snapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "2 jobs running" }));
  expect(screen.getByText("Run integration tests")).toBeTruthy();
  expect(screen.getByText("Shell command")).toBeTruthy();
  expect(screen.getByText("Review authentication changes")).toBeTruthy();
  rerender(<BackgroundTasksPill snapshot={{ ...snapshot, totalCount: 1, tasks: [snapshot.tasks[1]] }} />);
  expect(screen.queryByText("Run integration tests")).toBeNull();
  expect(screen.getByRole("button", { name: "1 job running" })).toBeTruthy();
  rerender(<BackgroundTasksPill snapshot={{ ...snapshot, sessionId: "process-2" }} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "2 jobs running" }));
  rerender(<BackgroundTasksPill snapshot={{ ...snapshot, totalCount: 0, tasks: [] }} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<BackgroundTasksPill snapshot={snapshot} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Escape closes the popover and returns focus to the trigger", async () => {
  render(<BackgroundTasksPill snapshot={snapshot} />);
  const trigger = screen.getByRole("button", { name: "2 jobs running" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("unknown types remain readable and bounded lists disclose the full count", () => {
  render(<BackgroundTasksPill snapshot={{ ...snapshot, totalCount: 201,
    tasks: [{ id: "new-type", type: "future_task", description: "Future background work" }] }} />);
  fireEvent.click(screen.getByRole("button", { name: "201 jobs running" }));
  expect(screen.getByText("Future background work")).toBeTruthy();
  expect(screen.getByText("Background task")).toBeTruthy();
  expect(screen.getByText("Showing the first 1 tasks.")).toBeTruthy();
});

test("absent snapshots render nothing", () => {
  const { container } = render(<BackgroundTasksPill />);
  expect(container.childElementCount).toBe(0);
});

test("uses short job labels and omits the duplicate popover count", () => {
  const { rerender } = render(<BackgroundTasksPill snapshot={snapshot} />);
  const trigger = screen.getByRole("button", { name: "2 jobs running" });
  expect(trigger.textContent).toBe("2jobs");
  fireEvent.click(trigger);
  expect(within(screen.getByRole("dialog")).queryByText("2")).toBeNull();
  rerender(<BackgroundTasksPill snapshot={{ ...snapshot, totalCount: 1, tasks: [snapshot.tasks[0]] }} />);
  expect(screen.getByRole("button", { name: "1 job running" }).textContent).toBe("1job");
});


test("retains jobs and distinguishes shutdown feedback from running jobs", () => {
  const stop = { runId: "run", messageId: snapshot.messageId, requestedAt: 1,
    status: "stopping" as const, jobs: snapshot };
  const { rerender } = render(<BackgroundTasksPill stopConfirmation={stop} />);
  fireEvent.click(screen.getByRole("button", { name: "Stopping…" }));
  expect(screen.getByText("Run integration tests")).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Running background tasks" })).toBeNull();
  rerender(<BackgroundTasksPill stopConfirmation={{ ...stop, status: "unconfirmed" }} />);
  expect(screen.getByRole("button", { name: "Couldn't confirm stopped" })).toBeTruthy();
  expect(screen.getByText("Run integration tests")).toBeTruthy();
  rerender(<BackgroundTasksPill stopConfirmation={{ ...stop, status: "stopped", acknowledgedAt: Date.now() }} />);
  expect(screen.getByRole("button", { name: "Runtime stopped" })).toBeTruthy();
  expect(screen.getByText(/Detached processes and remote jobs may still be running/)).toBeTruthy();
});

test.each(["stopping", "unconfirmed", "stopped"] as const)("current jobs replace the previous %s pill", (status) => {
  render(<BackgroundTasksPill snapshot={snapshot} stopConfirmation={{
    runId: "old", messageId: "old_message" as Id<"cliMessages">, requestedAt: 1,
    status, acknowledgedAt: Date.now(),
  }} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "2 jobs running" })).toBeTruthy();
});

test("dismisses confirmed shutdown five seconds after acknowledgment and stays hidden on remount", () => {
  vi.useFakeTimers();
  const stop = { runId: "old", messageId: snapshot.messageId, requestedAt: Date.now() - 1000,
    acknowledgedAt: Date.now(), status: "stopped" as const };
  const { unmount } = render(<BackgroundTasksPill stopConfirmation={stop} />);
  expect(screen.getByRole("button", { name: "Runtime stopped" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(4999));
  expect(screen.getByRole("button", { name: "Runtime stopped" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("button")).toBeNull();
  unmount();
  render(<BackgroundTasksPill stopConfirmation={stop} />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("keeps unresolved stops visible and starts dismissal only on acknowledgment", () => {
  vi.useFakeTimers();
  const stop = { runId: "old", messageId: snapshot.messageId, requestedAt: Date.now() };
  const { rerender } = render(<BackgroundTasksPill stopConfirmation={{ ...stop, status: "stopping" }} />);
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByRole("button", { name: "Stopping…" })).toBeTruthy();
  rerender(<BackgroundTasksPill stopConfirmation={{ ...stop, status: "unconfirmed" }} />);
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByRole("button", { name: "Couldn't confirm stopped" })).toBeTruthy();
  rerender(<BackgroundTasksPill stopConfirmation={{ ...stop, status: "stopped", acknowledgedAt: Date.now() }} />);
  expect(screen.getByRole("button", { name: "Runtime stopped" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<BackgroundTasksPill stopConfirmation={{ ...stop, runId: "next", status: "stopping" }} />);
  expect(screen.getByRole("button", { name: "Stopping…" })).toBeTruthy();
});
