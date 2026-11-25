/**
 * @vitest-environment jsdom
 */
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadListItem } from "./thread-list-item";

type ThreadRowChat = ComponentProps<typeof ThreadListItem>["chat"];

// Deliberately does NOT mock @/components/ui/hover-card: these cases assert the
// real Radix open/close triggers, which the stub in thread-list-item.test.tsx
// would hide.
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const BRANCH = "feat/hover-card-focus";

const chat: ThreadRowChat = {
  _id: "thread_1" as Id<"cliThreads">,
  title: "Hover card focus",
  branch: BRANCH,
  status: "completed",
  cliType: "codex",
  hasUnread: false,
  requiresAttention: false,
  pullRequestChecksRunning: false,
  lastActivityAt: 1_700_000_000_000,
};

function renderCompactRow() {
  render(
    <ThreadListItem
      chat={chat}
      isActive
      compactLayout
      organizationSlug="contoso"
      projectAlias="OS"
      showActions={false}
    />
  );

  // The row's stretched overlay link — what holds focus after the user clicks a
  // row to open its thread — and the row itself, which is the hover trigger.
  const overlayLink = screen.getByRole("link", { name: `Open thread ${chat.title}` });
  const row = overlayLink.parentElement;
  if (!row) {
    throw new Error("compact row not found");
  }

  return { overlayLink, row };
}

/** Past both Radix delays, flushing the state update the timer schedules. */
async function settleHoverCard() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
}

describe("ThreadListItem compact branch hover card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("stays closed when the row's overlay link receives focus", async () => {
    const { overlayLink, row } = renderCompactRow();

    // React's onFocus is the bubbling focusin, so focus on this descendant
    // reaches the row trigger. The browser re-dispatches focus at the stored
    // activeElement when the window regains focus (e.g. after the machine
    // unlocks), which must not open a pointer-driven card — nothing would close
    // it, since no pointerleave arrives and focus never moves.
    fireEvent.focus(overlayLink);
    await settleHoverCard();

    expect(row.dataset.state).toBe("closed");
    // The branch only renders inside the hover card on compact rows.
    expect(screen.queryByText(BRANCH)).toBeNull();
  });

  test("still opens on pointer enter", async () => {
    const { row } = renderCompactRow();

    // React derives onPointerEnter from pointerover, not the non-bubbling
    // pointerenter event.
    fireEvent.pointerOver(row, { pointerType: "mouse" });
    await settleHoverCard();

    expect(row.dataset.state).toBe("open");
    expect(screen.getByText(BRANCH)).toBeTruthy();
  });

  test("closes again on pointer leave", async () => {
    const { row } = renderCompactRow();

    fireEvent.pointerOver(row, { pointerType: "mouse" });
    await settleHoverCard();
    fireEvent.pointerOut(row, { pointerType: "mouse" });
    await settleHoverCard();

    expect(row.dataset.state).toBe("closed");
    expect(screen.queryByText(BRANCH)).toBeNull();
  });
});
