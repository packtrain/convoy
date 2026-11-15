// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { TimelineThreadRow } from "@/lib/tasks/timeline/rows";
import { THREAD_CARD_RAIL_OFFSET_CLASS } from "./rail-geometry";
import { TimelineThreadRowCard } from "./timeline-thread-row";

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation")>();
  return {
    ...actual,
    AppLink: ({
      children,
      href: linkHref,
      ...props
    }: {
      children: ReactNode;
      href: string | ReturnType<typeof actual.routeTarget>;
    }) => (
      <a href={typeof linkHref === "string" ? linkHref : actual.href(linkHref)} {...props}>
        {children}
      </a>
    ),
  };
});

function threadRow(overrides: Partial<TimelineThreadRow> = {}): TimelineThreadRow {
  return {
    threadId: "thread_1" as Id<"cliThreads">,
    title: "Audit the PaymentGuard call sites",
    status: "completed",
    cliType: "claude-code",
    createdAt: 1_000,
    lastActivityAt: Date.now() - 20 * 60_000,
    hasUnread: false,
    isDone: false,
    isOwn: true,
    isWorkflowRun: false,
    ...overrides,
  };
}

function renderRow(thread: TimelineThreadRow) {
  return render(
    <TimelineThreadRowCard thread={thread} organizationSlug="acme" projectAlias="OS" />
  );
}

describe("TimelineThreadRowCard", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the title and links the whole row to the thread route", () => {
    renderRow(threadRow());

    expect(screen.getByText("Audit the PaymentGuard call sites")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open thread/ });
    expect(link.getAttribute("href")).toContain("/threads/thread_1");
    // Positioned overlay, not a wrapper — the row content stays outside the
    // anchor so interactive children can opt back into pointer events.
    expect(link.className).toContain("absolute");
  });

  // Asserts the card applies the shared offset, not a literal class: the
  // arithmetic behind it is guarded in `rail-geometry.test.ts`, so moving the
  // value there does not break this and a padding change upstream does.
  test("pulls the card back onto the rail's icon column", () => {
    const { container } = renderRow(threadRow());

    expect(container.firstElementChild?.className).toContain(THREAD_CARD_RAIL_OFFSET_CLASS);
  });

  test("shows no owner name on the viewer's own thread", () => {
    renderRow(threadRow());

    expect(screen.queryByText("Morgan Doe")).toBeNull();
  });

  test("attributes another user's thread by name", () => {
    renderRow(threadRow({ isOwn: false, userName: "Morgan Doe" }));

    expect(screen.getByText("Morgan Doe")).toBeTruthy();
  });

  // A foreign thread may not be shared; the row still opens and fails at the
  // route rather than rendering unclickable (docs/specs/task-timeline.md).
  test("links a foreign thread the same as an own one", () => {
    renderRow(threadRow({ threadId: "thread_2" as Id<"cliThreads">, isOwn: false, userName: "Morgan Doe" }));

    expect(screen.getByRole("link", { name: /Open thread/ }).getAttribute("href")).toContain("/threads/thread_2");
  });

  test("shows no avatar and no message count", () => {
    const { container } = renderRow(threadRow({ isOwn: false, userName: "Morgan Doe" }));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toMatch(/\d+\s*messages?/);
  });

  // forceStatusIndicator: a read completed thread has no glyph to show, so the
  // slot holds an aria-hidden spacer. Without it the row would lose the leading
  // grid column and its title would shift left of every streaming row.
  test("reserves the status-indicator slot on a completed row", () => {
    const { container } = renderRow(threadRow({ status: "completed" }));

    expect(container.querySelector('[aria-hidden="true"].size-4')).toBeTruthy();
  });

  test("shows a live indicator in that same slot while streaming", () => {
    const { container } = renderRow(threadRow({ status: "streaming" }));

    expect(container.querySelector('[title="Streaming response"]')).toBeTruthy();
  });

  test("words the run's status, since the glyph alone cannot carry it", () => {
    renderRow(threadRow({ status: "completed" }));

    expect(screen.getByText("Done")).toBeTruthy();
  });

  test("words a live status too", () => {
    renderRow(threadRow({ status: "streaming" }));

    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
  });

  // The same blue dot the Threads metadata field shows for the same thread.
  test("shows the unread dot in the indicator slot", () => {
    const { container } = renderRow(threadRow({ status: "completed", hasUnread: true }));

    expect(container.querySelector('[title="Unread"]')).toBeTruthy();
  });

  test("shows the done check once the thread is marked done", () => {
    const { container } = renderRow(threadRow({ status: "completed", isDone: true }));

    expect(container.querySelector('[title="Done"]')).toBeTruthy();
  });

  test("displays last activity, not the createdAt it sorts by", () => {
    const { container } = renderRow(
      threadRow({ createdAt: 1_000, lastActivityAt: Date.now() - 20 * 60_000 })
    );

    expect(container.textContent).toContain("20m");
  });

  // The stream mixes plain threads with workflow rows and nothing else tells
  // them apart (OS-1879). Plain glyph — no color, no link.
  test("marks a workflow row with the workflow glyph", () => {
    renderRow(threadRow({ isWorkflowRun: true }));

    expect(screen.getByRole("img", { name: "Workflow run" })).toBeTruthy();
  });

  test("shows no workflow glyph on a plain thread", () => {
    renderRow(threadRow());

    expect(screen.queryByRole("img", { name: "Workflow run" })).toBeNull();
  });

  test("falls back to a placeholder title on an untitled thread", () => {
    renderRow(threadRow({ title: "" }));

    expect(screen.getByText("New thread")).toBeTruthy();
  });
});
