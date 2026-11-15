/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";
import { NotificationsSubpage } from "./notifications-subpage";

const unreadOnlyMock = vi.hoisted(() => ({ current: true }));

vi.mock("convex/react", () => ({
  useQuery: () => 0,
  useMutation: () => vi.fn(),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: { notifications: { core: { unreadCount: "unreadCount", markAllAsRead: "markAllAsRead", list: "list" } } },
}));
vi.mock("@/lib/notifications/filter-storage", () => ({
  readNotificationsUnreadOnly: () => unreadOnlyMock.current,
  writeNotificationsUnreadOnly: vi.fn(),
}));
vi.mock("@/lib/notifications/hooks/use-notification-preferences", () => ({
  useNotificationPreferences: () => undefined,
}));

function renderSubpage() {
  return render(<NotificationsSubpage organizationId={"org_1" as Id<"organizations">} onBack={vi.fn()} />);
}

describe("NotificationsSubpage", () => {
  afterEach(() => {
    cleanup();
    unreadOnlyMock.current = true;
  });

  test("an empty unread inbox is the shared empty state, centered in the panel", () => {
    const { container } = renderSubpage();

    const content = container.querySelector<HTMLElement>("[data-slot=sidebar-content]")!;
    const empty = expectEmptyState("You're all caught up", { boundary: content });
    expectVerticallyCentered(empty, content);
  });

  test("an empty inbox with read items shown says there are no notifications yet", () => {
    unreadOnlyMock.current = false;
    renderSubpage();

    expect(expectEmptyState("No notifications yet")).toBeDefined();
  });
});
