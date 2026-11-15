/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { claimNotificationDelivery } from "@/lib/notifications/delivery-storage";
import { freshToastItems, MAX_DELIVERY_AGE_MS, NotificationToasts, toastTitle } from "./notification-toasts";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
});

let feed: unknown = { items: [], watermark: 0 };
let pathname = "/o/acme/web";
const toastMock = vi.fn();
const playSoundMock = vi.fn();

vi.mock("convex/react", () => ({ useQuery: () => feed }));
vi.mock("@/convex/_generated/api", () => ({
  api: { notifications: { core: { recent: "recent" } } },
}));
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
vi.mock("@/lib/notifications/sound", () => ({
  playNotificationSound: (...args: unknown[]) => playSoundMock(...args),
}));
vi.mock("@/lib/routing/current-org-project-context", () => ({
  useCurrentOrgProject: () => ({ organizationId: "org_1" }),
}));
// Real appRoute: the "already on that thread" check compares its pathname.
vi.mock("@/lib/navigation", async () => ({
  appRoute: (await import("@/lib/navigation/routes")).appRoute,
  useNavigation: () => ({ push: vi.fn() }),
  useNavigationLocation: () => ({ pathname }),
}));

const item = (id: string, creationTime: number, read = false, readAt?: number) => ({
  id,
  _creationTime: creationTime,
  read,
  ...(readAt !== undefined ? { readAt } : {}),
});

describe("freshToastItems", () => {
  test("keeps unread rows newer than the cursor, oldest first; drops user-read rows", () => {
    const items = [item("d", 40), item("c", 30, true, 30), item("b", 20), item("a", 10)];
    expect(freshToastItems(items, 10, 40).map((row) => row.id)).toEqual(["b", "d"]);
  });

  test("keeps born-read rows (toast-only: read without readAt)", () => {
    const items = [item("b", 20, true), item("a", 10)];
    expect(freshToastItems(items, 5, 20).map((row) => row.id)).toEqual(["a", "b"]);
  });

  test("returns nothing when the cursor is at the newest row", () => {
    expect(freshToastItems([item("a", 10)], 10, 10)).toEqual([]);
  });

  // The burst a tab frozen since this morning would otherwise deliver on wake.
  test("drops rows already older than the delivery window", () => {
    const now = MAX_DELIVERY_AGE_MS + 100;
    const items = [item("fresh", now - 1_000), item("stale", 99)];
    expect(freshToastItems(items, 0, now).map((row) => row.id)).toEqual(["fresh"]);
  });

  test("keeps rows from a clock running behind the server", () => {
    expect(freshToastItems([item("a", 5_000)], 0, 1_000).map((row) => row.id)).toEqual(["a"]);
  });
});

// The real feed item is much wider; these are the only fields `toastTitle` reads.
type TitleItem = Parameters<typeof toastTitle>[0];
const threadItem = (snapshot: Record<string, unknown>) =>
  ({ type: "thread.completed", subject: { kind: "thread", id: "t1" }, snapshot }) as unknown as TitleItem;

describe("toastTitle", () => {
  test("replaces the generic runtime label with its icon", () => {
    const { container } = render(
      <>{toastTitle(threadItem({ actorName: "Claude Code", threadCliType: "claude-code" }))}</>
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Claude Code")).toBeNull();
    expect(screen.getByText("finished a run")).toBeTruthy();
  });

  test("keeps a Project agent's own name beside the icon", () => {
    const { container } = render(
      <>{toastTitle(threadItem({ actorName: "Reviewer", threadCliType: "claude-code" }))}</>
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Reviewer")).toBeTruthy();
  });

  test("falls back to plain text for a runtime with no icon", () => {
    const { container } = render(<>{toastTitle(threadItem({ actorName: "Someone", threadCliType: "other" }))}</>);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("Someone finished a run");
  });

  test("task rows stay plain text", () => {
    const taskItem = {
      type: "task.created",
      subject: { kind: "task", id: "k1" },
      snapshot: { actorName: "Ada", taskRef: "OS-12" },
    } as unknown as TitleItem;
    const { container } = render(<>{toastTitle(taskItem)}</>);
    expect(container.textContent).toBe("Ada created OS-12");
  });
});

const feedRow = (overrides: Record<string, unknown>) => ({
  _id: "n1",
  _creationTime: Date.now(),
  read: false,
  orgSlug: "acme",
  projectAlias: "web",
  type: "thread.completed",
  subject: { kind: "thread", id: "t1" },
  snapshot: { actorName: "Claude Code", threadTitle: "Fix the build" },
  ...overrides,
});

/** Mounts on an empty feed (cursor snaps to 0), then delivers `row`. */
function deliver(row: Record<string, unknown>) {
  feed = { items: [], watermark: 0 };
  const { rerender } = render(<NotificationToasts />);
  feed = { items: [row], watermark: row._creationTime as number };
  rerender(<NotificationToasts />);
}

describe("NotificationToasts sound (OS-1754)", () => {
  test("plays once for an agent-run row it toasts, passing the type and row id", () => {
    deliver(feedRow({}));
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(playSoundMock.mock.calls).toEqual([["thread.completed", "n1"]]);
  });

  // The tier mapping lives in lib/notifications/sound.ts; here it's forwarding.
  test("forwards the attention types", () => {
    deliver(feedRow({ type: "thread.waiting_input" }));
    expect(playSoundMock.mock.calls).toEqual([["thread.waiting_input", "n1"]]);
  });

  test("does not toast a row another tab already toasted, but still offers the sound", () => {
    claimNotificationDelivery("toast", "n1");
    deliver(feedRow({}));
    expect(toastMock).not.toHaveBeenCalled();
    // Decoupled on purpose: the tab that toasted may be unable to play (OS-1754).
    expect(playSoundMock.mock.calls).toEqual([["thread.completed", "n1"]]);
  });

  test("stays silent for a row that went stale while the tab slept", () => {
    deliver(feedRow({ _creationTime: Date.now() - MAX_DELIVERY_AGE_MS - 1 }));
    expect(toastMock).not.toHaveBeenCalled();
    expect(playSoundMock).not.toHaveBeenCalled();
  });

  test("toasts a row once when two tabs receive it", () => {
    deliver(feedRow({}));
    deliver(feedRow({}));
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  test("stays silent while that thread's page is open", () => {
    pathname = "/o/acme/web/threads/t1";
    deliver(feedRow({}));
    pathname = "/o/acme/web";
    expect(toastMock).not.toHaveBeenCalled();
    expect(playSoundMock).not.toHaveBeenCalled();
  });

  // Without the claim, a frozen background tab thaws on focus and replays the
  // row the user already saw on the thread page (within the delivery window).
  test("consumes a row suppressed on a visible thread page, so no other tab replays it", () => {
    pathname = "/o/acme/web/threads/t1";
    deliver(feedRow({}));
    pathname = "/o/acme/web";
    expect(claimNotificationDelivery("toast", "n1")).toBe(false);
    expect(claimNotificationDelivery("sound", "n1")).toBe(false);
  });

  test("does not consume a row suppressed on a hidden thread page — another tab must deliver it", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    pathname = "/o/acme/web/threads/t1";
    deliver(feedRow({}));
    pathname = "/o/acme/web";
    expect(toastMock).not.toHaveBeenCalled();
    expect(playSoundMock).not.toHaveBeenCalled();
    expect(claimNotificationDelivery("toast", "n1")).toBe(true);
    expect(claimNotificationDelivery("sound", "n1")).toBe(true);
  });

  test("stays silent for task rows", () => {
    deliver(
      feedRow({
        type: "task.created",
        subject: { kind: "task", id: "k1" },
        snapshot: { actorName: "Ada", taskRef: "OS-12", taskTitle: "Ship it" },
      })
    );
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(playSoundMock).not.toHaveBeenCalled();
  });

  test("stays silent for a row the recipient can no longer view", () => {
    deliver(feedRow({ orgSlug: undefined, projectAlias: undefined }));
    expect(toastMock).not.toHaveBeenCalled();
    expect(playSoundMock).not.toHaveBeenCalled();
  });
});
