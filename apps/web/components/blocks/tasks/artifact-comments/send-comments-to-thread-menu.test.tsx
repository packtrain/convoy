/**
 * @vitest-environment jsdom
 */
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { href, type RouteTarget } from "@/lib/navigation";
import {
  ThreadDraftProvider,
  useThreadDraft,
} from "@/components/blocks/thread/thread-draft-provider";
import { loadProjectDrafts, saveProjectDrafts } from "@/lib/threads/draft-storage";
import { SendCommentsToThreadMenu } from "./send-comments-to-thread-menu";

const useQueryMock = vi.fn();
const pushMock = vi.fn();
const pickerPropsMock = vi.fn();
let location = { pathname: "/o/acme/OS", search: "", hash: "" };

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/lib/navigation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/navigation")>(
    "@/lib/navigation"
  );
  return {
    ...actual,
    useNavigation: () => ({ push: pushMock, replace: vi.fn(), location }),
  };
});

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <div />,
}));

vi.mock("@/components/blocks/thread/thread-picker-dialog", () => ({
  ThreadPickerDialog: (props: {
    open: boolean;
    onSelect: (threadId: string) => void;
  }) => {
    pickerPropsMock(props);
    return props.open ? (
      <button type="button" onClick={() => props.onSelect("thread_picked")}>
        Pick thread_picked
      </button>
    ) : null;
  },
}));

const STORAGE_KEY = "convoy.thread-composer-drafts:acme:OS";
const MESSAGE = "Address the open comments...";

function pushedHref(): string {
  expect(pushMock).toHaveBeenCalledTimes(1);
  return href(pushMock.mock.calls[0][0] as RouteTarget);
}

function taskThread(id: string, lastActivityAt: number, overrides?: { title?: string }) {
  return {
    _id: id as Id<"cliThreads">,
    title: overrides?.title ?? `Thread ${id}`,
    status: "completed",
    cliType: "codex",
    hasUnread: false,
    requiresAttention: false,
    agent: {
      name: "Reviewer",
      color: "blue",
      isDeleted: false,
    },
    associatedTask: {
      _id: "task_1" as Id<"tasks">,
      refId: "OS-12",
      name: "Task name",
      taskType: {
        key: "task",
        name: "Task",
        icon: "SquareCheckBig",
        color: "#64748b",
        isSystem: true,
      },
      isArchived: false,
    },
    lastActivityAt,
  };
}

function renderMenu(props?: { onNavigateToThread?: (threadId: string) => void }) {
  return render(
    <SendCommentsToThreadMenu
      projectId={"project_1" as Id<"projects">}
      taskId={"task_1" as Id<"tasks">}
      taskRefId="OS-12"
      organizationSlug="acme"
      projectAlias="OS"
      artifactId="artifact_1"
      message={MESSAGE}
      onNavigateToThread={props?.onNavigateToThread}
    />
  );
}

describe("SendCommentsToThreadMenu", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useQueryMock.mockReturnValue([]);
    location = { pathname: "/o/acme/OS", search: "", hash: "" };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test("uses the compact panel-header button treatment", () => {
    renderMenu();

    expect(
      screen
        .getByRole("button", { name: "Send open comments to a thread" })
        .getAttribute("data-size")
    ).toBe("icon-sm");
  });

  test("lists task threads newest-first, capped at five", () => {
    useQueryMock.mockReturnValue([
      taskThread("thread_old", 100),
      taskThread("thread_new", 500),
      ...[1, 2, 3, 4].map((n) => taskThread(`thread_mid_${n}`, 200 + n)),
    ]);

    renderMenu();

    const items = screen
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent);
    expect(items).toEqual([
      "Thread thread_new",
      "Thread thread_mid_4",
      "Thread thread_mid_3",
      "Thread thread_mid_2",
      "Thread thread_mid_1",
    ]);
  });

  test("renders task thread destinations with the shared compact row metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T18:00:00Z"));
    useQueryMock.mockReturnValue([
      taskThread("thread_1", new Date("2026-07-23T17:55:00Z").getTime()),
    ]);

    renderMenu();

    expect(screen.getByText("OS-12")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.getByText("5m")).toBeTruthy();
  });

  test("sending to an existing task thread seeds its draft and navigates to the thread", () => {
    useQueryMock.mockReturnValue([taskThread("thread_1", 100)]);

    renderMenu();
    const destination = screen
      .getByRole("heading", { name: "Thread thread_1" })
      .closest("button");
    expect(destination).toBeTruthy();
    if (!destination) {
      throw new Error("Expected the compact thread row to be a menu button");
    }
    fireEvent.click(destination);

    expect(loadProjectDrafts(STORAGE_KEY)["thread:thread_1"]?.text).toBe(MESSAGE);
    expect(pushedHref()).toBe("/o/acme/OS/threads/thread_1");
  });

  test("new thread seeds the new-thread draft and navigates with the task preselected", () => {
    saveProjectDrafts(STORAGE_KEY, {
      new: { text: "My intro", updatedAt: Date.now() },
    });

    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(loadProjectDrafts(STORAGE_KEY)["new"]?.text).toBe(
      `My intro\n\n${MESSAGE}`
    );
    expect(pushedHref()).toBe("/o/acme/OS/threads?attachedTask=OS-12");
  });

  // OS-1716: an artifact open in a right sidebar is URL state (`?artifact=` for
  // the task sidebar, `?threadArtifact=` for the workspace's own tab). Pushing
  // a bare thread route would drop it and read as "the send just closed my
  // artifact", so the current query is carried over.
  test("keeps the current query string so an open artifact survives the send", () => {
    location = {
      pathname: "/o/acme/OS/threads/thread_0",
      search: "?task=OS-12&artifact=artifact_1",
      hash: "",
    };
    useQueryMock.mockReturnValue([taskThread("thread_1", 100)]);

    renderMenu();
    const destination = screen
      .getByRole("heading", { name: "Thread thread_1" })
      .closest("button");
    if (!destination) {
      throw new Error("Expected the compact thread row to be a menu button");
    }
    fireEvent.click(destination);

    expect(pushedHref()).toBe(
      "/o/acme/OS/threads/thread_1?task=OS-12&artifact=artifact_1"
    );
  });

  // Off the threads route the query belongs to that page (task detail, board),
  // so carrying it into the thread URL would be nonsense.
  test("drops an unrelated page's query string when leaving that page", () => {
    location = {
      pathname: "/o/acme/OS",
      search: "?task=OS-12&artifact=artifact_1",
      hash: "",
    };
    useQueryMock.mockReturnValue([taskThread("thread_1", 100)]);

    renderMenu();
    const destination = screen
      .getByRole("heading", { name: "Thread thread_1" })
      .closest("button");
    if (!destination) {
      throw new Error("Expected the compact thread row to be a menu button");
    }
    fireEvent.click(destination);

    expect(pushedHref()).toBe("/o/acme/OS/threads/thread_1");
  });

  // OS-1716: inside the thread workspace the host owns the switch — it keeps
  // the current query string (so `?threadArtifact` survives, leaving the
  // artifact open) and switches the group tab when the destination is a
  // sibling. A plain push would strip both.
  test("delegates existing-thread navigation to the host when it owns the switch", () => {
    const onNavigateToThread = vi.fn();
    useQueryMock.mockReturnValue([taskThread("thread_1", 100)]);

    renderMenu({ onNavigateToThread });
    const destination = screen
      .getByRole("heading", { name: "Thread thread_1" })
      .closest("button");
    if (!destination) {
      throw new Error("Expected the compact thread row to be a menu button");
    }
    fireEvent.click(destination);

    expect(loadProjectDrafts(STORAGE_KEY)["thread:thread_1"]?.text).toBe(MESSAGE);
    expect(onNavigateToThread).toHaveBeenCalledWith("thread_1");
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("picked search threads also route through the host switch", () => {
    const onNavigateToThread = vi.fn();

    renderMenu({ onNavigateToThread });
    fireEvent.click(screen.getByRole("button", { name: "Search threads..." }));
    fireEvent.click(screen.getByRole("button", { name: "Pick thread_picked" }));

    expect(loadProjectDrafts(STORAGE_KEY)["thread:thread_picked"]?.text).toBe(
      MESSAGE
    );
    expect(onNavigateToThread).toHaveBeenCalledWith("thread_picked");
    expect(pushMock).not.toHaveBeenCalled();
  });

  // The new-thread destination is a different route, so the host switch never
  // applies to it.
  test("new thread still navigates even when the host owns thread switching", () => {
    renderMenu({ onNavigateToThread: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(pushedHref()).toBe("/o/acme/OS/threads?attachedTask=OS-12");
  });

  // OS-1716: the new-thread view hosts the task sidebar too, so `?task=`/
  // `?artifact=` carry over and the artifact stays open. `?threadArtifact=` is
  // dropped — that tab belongs to a thread, and there is no thread yet.
  test("new thread keeps the open artifact when already on the threads route", () => {
    location = {
      pathname: "/o/acme/OS/threads/thread_0",
      search: "?task=OS-12&artifact=artifact_1&threadArtifact=artifact_9",
      hash: "",
    };

    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(pushedHref()).toBe(
      "/o/acme/OS/threads?task=OS-12&artifact=artifact_1&attachedTask=OS-12"
    );
  });

  // OS-1716: with a provider mounted the seed goes through it, so text the user
  // typed a moment ago — still inside the 200ms persist debounce, not in
  // storage — is merged instead of overwritten.
  test("seeds through a mounted draft provider, keeping unpersisted text", async () => {
    useQueryMock.mockReturnValue([taskThread("thread_1", 100)]);
    const seenText = vi.fn();

    function DraftProbe() {
      const { draft, setDraft } = useThreadDraft("thread:thread_1");

      useEffect(() => {
        seenText(draft?.text);
      }, [draft?.text]);

      return (
        <button type="button" onClick={() => setDraft({ text: "typed" })}>
          Type
        </button>
      );
    }

    render(
      <ThreadDraftProvider storageKey={STORAGE_KEY}>
        <DraftProbe />
        <SendCommentsToThreadMenu
          projectId={"project_1" as Id<"projects">}
          taskId={"task_1" as Id<"tasks">}
          taskRefId="OS-12"
          organizationSlug="acme"
          projectAlias="OS"
          artifactId="artifact_1"
          message={MESSAGE}
        />
      </ThreadDraftProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    const destination = screen
      .getByRole("heading", { name: "Thread thread_1" })
      .closest("button");
    if (!destination) {
      throw new Error("Expected the compact thread row to be a menu button");
    }
    fireEvent.click(destination);

    await waitFor(() => {
      expect(seenText).toHaveBeenLastCalledWith(`typed\n\n${MESSAGE}`);
    });
  });

  test("picking a thread from search seeds that thread's draft and navigates", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Search threads..." }));
    fireEvent.click(screen.getByRole("button", { name: "Pick thread_picked" }));

    expect(loadProjectDrafts(STORAGE_KEY)["thread:thread_picked"]?.text).toBe(
      MESSAGE
    );
    expect(pushedHref()).toBe("/o/acme/OS/threads/thread_picked");
  });
});
