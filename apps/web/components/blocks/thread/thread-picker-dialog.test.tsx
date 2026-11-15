/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadPickerDialog } from "./thread-picker-dialog";

const onSelectMock = vi.fn();
const onOpenChangeMock = vi.fn();
const loadMoreMock = vi.fn();

const THREAD_RESULT = {
  _id: "thread_1" as Id<"cliThreads">,
  title: "Add a new task field to track task commits",
  status: "completed",
  hasPendingInteraction: false,
  cliType: "codex",
  hasUnread: false,
  requiresAttention: false,
  lastActivityAt: new Date("2026-07-23T17:55:00Z").getTime(),
  agent: {
    name: "Reviewer",
    color: "blue",
    isDeleted: false,
  },
  associatedTask: {
    _id: "task_1" as Id<"tasks">,
    refId: "OS-637",
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
};

let threadResults: unknown[] = [THREAD_RESULT];
let hasMoreResults = false;
let isLoadingResults = false;
let isLoadingMoreResults = false;

vi.mock("@/lib/threads/hooks/use-cli-threads", () => ({
  useCliThreads: () => ({
    threads: threadResults,
    isLoading: isLoadingResults,
    hasMore: hasMoreResults,
    isLoadingMore: isLoadingMoreResults,
    loadMore: loadMoreMock,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ),
  CommandItem: ({
    children,
    onSelect,
    showCheckIcon = true,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    showCheckIcon?: boolean;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
      {showCheckIcon ? (
        <span data-testid="command-item-check-indicator" />
      ) : null}
    </button>
  ),
  CommandList: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div data-testid="thread-command-list" className={className}>
      {children}
    </div>
  ),
}));

function renderPicker() {
  return render(
    <ThreadPickerDialog
      projectId={"project_1" as Id<"projects">}
      open
      onOpenChange={onOpenChangeMock}
      onSelect={onSelectMock}
    />
  );
}

describe("ThreadPickerDialog", () => {
  beforeEach(() => {
    threadResults = [THREAD_RESULT];
    hasMoreResults = false;
    isLoadingResults = false;
    isLoadingMoreResults = false;
  });

  test("shows skeleton rows instead of loading text while threads load", () => {
    isLoadingResults = true;
    threadResults = [];
    renderPicker();

    expect(screen.queryByText(/Loading/)).toBeNull();
    expect(
      screen.getByTestId("thread-command-list").querySelectorAll("[data-slot='skeleton']").length
    ).toBeGreaterThan(0);
  });

  test("labels a pending load-more with an ellipsis character", () => {
    hasMoreResults = true;
    isLoadingMoreResults = true;
    renderPicker();

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test("renders search results with the shared compact thread metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T18:00:00Z"));

    renderPicker();

    expect(screen.getByText("OS-637")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.getByText("5m")).toBeTruthy();
  });

  test("removes the shared command-list height cap so results fill the dialog", () => {
    renderPicker();

    expect(screen.getByTestId("thread-command-list").className).toContain(
      "max-h-[none]"
    );
  });

  test("does not reserve selection-indicator space for redirect-only results", () => {
    renderPicker();

    expect(screen.queryByTestId("command-item-check-indicator")).toBeNull();
  });

  // `listByProject` pages the roots, and a group container is a root — but a
  // container has no composer of its own, so picking one seeded a draft key
  // nothing reads and the message vanished (OS-1716).
  test("omits group containers, which are not a thread destination", () => {
    threadResults = [
      { ...THREAD_RESULT, _id: "group_1", title: "A group", kind: "group" },
      { ...THREAD_RESULT, _id: "run_1", title: "A run", kind: "group", workflowRunId: "wfrun_1" },
      THREAD_RESULT,
    ];

    renderPicker();

    expect(screen.queryByText("A group")).toBeNull();
    expect(screen.queryByText("A run")).toBeNull();
    expect(
      screen.getByText("Add a new task field to track task commits")
    ).toBeTruthy();
  });

  test("says so when every result was a container", () => {
    threadResults = [{ ...THREAD_RESULT, _id: "group_1", kind: "group" }];

    renderPicker();

    expect(screen.getByText("No threads found")).toBeTruthy();
  });

  // Filtering happens per loaded page, so a page of only containers must still
  // offer "Load more" — otherwise the picker dead-ends on "No threads found".
  test("keeps Load more when a whole page filtered out but more remain", () => {
    threadResults = [{ ...THREAD_RESULT, _id: "group_1", kind: "group" }];
    hasMoreResults = true;

    renderPicker();

    expect(screen.queryByText("No threads found")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMoreMock).toHaveBeenCalled();
  });

  test("selects the thread and closes the picker", () => {
    renderPicker();

    const title = screen.getByText("Add a new task field to track task commits");
    const result = title.closest("button");
    expect(result).toBeTruthy();
    if (!result) {
      throw new Error("Expected the thread result to be a command item");
    }
    fireEvent.click(result);

    expect(onSelectMock).toHaveBeenCalledWith("thread_1");
    expect(onOpenChangeMock).toHaveBeenCalledWith(false);
  });
});
