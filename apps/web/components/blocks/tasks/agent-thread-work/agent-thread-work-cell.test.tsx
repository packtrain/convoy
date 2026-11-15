/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { Priority, Status, type Task } from "@/lib/tasks/types";
import { AgentThreadWorkCell } from "./agent-thread-work-cell";

const { useIsMobileMock, useQueryMock } = vi.hoisted(() => ({
  useIsMobileMock: vi.fn(() => false),
  useQueryMock: vi.fn((): unknown => []),
}));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: useIsMobileMock,
}));

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/lib/navigation", () => ({
  useRouteParams: () => ({
    organizationSlug: "contoso",
    projectAlias: "OS",
  }),
  AppLink: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: unknown } & Record<string, unknown>) => {
    void href;
    return (
      <a href="#" {...props}>
        {children}
      </a>
    );
  },
  appRoute: {
    projectThreadDetail: (
      organizationSlug: string,
      projectAlias: string,
      threadId: string
    ) => `/o/${organizationSlug}/${projectAlias}/threads/${threadId}`,
    projectThreadsWithPreselection: (
      organizationSlug: string,
      projectAlias: string
    ) => `/o/${organizationSlug}/${projectAlias}/threads`,
  },
}));

vi.mock("@/components/blocks/thread/thread-list-item", () => ({
  ThreadListItem: ({ chat }: { chat: { _id: string; title: string } }) => (
    <a href="#" data-testid={`thread-row-${chat._id}`}>
      {chat.title}
    </a>
  ),
}));

vi.mock("@/components/blocks/thread/thread-mini-preview", () => ({
  ThreadMiniPreview: ({ threadId }: { threadId: string }) => (
    <div data-testid="thread-preview" data-thread-id={threadId} />
  ),
}));

vi.mock("@/components/ui/drawer", () =>
  import("@/test-utils/mocks/drawer")
);

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => (
    <div data-testid="agent-thread-popover-root">{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="agent-thread-popover-content">{children}</div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-thread-composer", () => ({
  TaskThreadComposer: ({
    composerTextareaClassName,
    onThreadCreated,
  }: {
    composerTextareaClassName?: string;
    onThreadCreated?: (id: string) => void;
  }) => (
    <button
      type="button"
      data-textarea-class={composerTextareaClassName}
      onClick={() => onThreadCreated?.("thread-9")}
    >
      Thread composer
    </button>
  ),
}));

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task-1" as Task["_id"],
    clientId: "client-1",
    refNumber: 1213,
    refId: "OS-1213",
    name: "Responsive agent threads",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: Priority.NONE,
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: "0|a:",
    parentId: null,
    createdAt: 1,
    isArchived: false,
    assignee: null,
    ...overrides,
  };
}

function renderCell({ canUseThreads = true }: { canUseThreads?: boolean } = {}) {
  return render(
    <AgentThreadWorkCell
      task={createTask()}
      projectId={"project-1" as Id<"projects">}
      canUseThreads={canUseThreads}
    />
  );
}

describe("AgentThreadWorkCell", () => {
  beforeEach(() => {
    useIsMobileMock.mockReturnValue(false);
    useQueryMock.mockReturnValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("a task without agent threads shows an em dash", () => {
    renderCell({ canUseThreads: false });
    expect(screen.getByText("—")).toBeTruthy();
  });

  test("keeps the thread list and composer in a popover on desktop", () => {
    renderCell();

    expect(screen.getByTestId("agent-thread-popover-root")).toBeTruthy();
    expect(screen.queryByTestId("drawer-root")).toBeNull();
    expect(screen.getByText("Thread composer")).toBeTruthy();
    // Without threads, the composer still gets the unified header — with a
    // disabled back button since there is no list to go back to.
    expect(screen.getByText("New thread")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Back to thread list" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getByLabelText("Open full page")).toBeTruthy();
  });

  test("opens the thread list and composer in a bottom drawer on mobile", () => {
    useIsMobileMock.mockReturnValue(true);
    renderCell();

    expect(screen.queryByTestId("agent-thread-popover-root")).toBeNull();
    expect(screen.getByTestId("drawer-root").getAttribute("data-direction")).toBe(
      "bottom"
    );

    fireEvent.click(screen.getByRole("button", { name: "Task agent threads" }));

    expect(screen.getByTestId("agent-thread-work-drawer")).toBeTruthy();
    expect(screen.getByText("Task agent threads")).toBeTruthy();
    expect(screen.getByText("Thread composer")).toBeTruthy();
  });

  test.each([false, true])("without threads access shows only the badges (mobile: %s)", (isMobile) => {
    useIsMobileMock.mockReturnValue(isMobile);
    renderCell({ canUseThreads: false });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("agent-thread-popover-root")).toBeNull();
    expect(screen.queryByTestId("drawer-root")).toBeNull();
    expect(screen.queryByText("Thread composer")).toBeNull();
    expect(useQueryMock).not.toHaveBeenCalled();
  });

  test("uses a shorter input in the Run-column new-thread composer", () => {
    renderCell();

    expect(
      screen.getByText("Thread composer").getAttribute("data-textarea-class")
    ).toBe("min-h-12 p-2.5");
  });

  test("opens the latest own thread in a mini preview and switches via rows", () => {
    useQueryMock.mockReturnValue([
      { _id: "thread-1", title: "Older thread", lastActivityAt: 1 },
      { _id: "thread-2", title: "Newest thread", lastActivityAt: 2 },
    ]);
    renderCell();

    // Latest thread is previewed under the one-line header only — no thread
    // list above it.
    const preview = screen.getByTestId("thread-preview");
    expect(preview.getAttribute("data-thread-id")).toBe("thread-2");
    expect(screen.getByText("Newest thread")).toBeTruthy();
    expect(screen.getByText("Start new")).toBeTruthy();
    expect(screen.getByLabelText("Open full thread")).toBeTruthy();
    expect(screen.queryByText("Thread composer")).toBeNull();
    expect(screen.queryByTestId("thread-row-thread-1")).toBeNull();

    // Back returns to the plain list — no composer, just rows to pick from.
    fireEvent.click(screen.getByRole("button", { name: "Back to thread list" }));
    expect(screen.queryByTestId("thread-preview")).toBeNull();
    expect(screen.queryByText("Thread composer")).toBeNull();

    // Selecting a row from the list re-opens the mini preview.
    fireEvent.click(screen.getByTestId("thread-row-thread-1"));
    expect(
      screen.getByTestId("thread-preview").getAttribute("data-thread-id")
    ).toBe("thread-1");

    // "Start new" opens the composer view with the same header layout.
    fireEvent.click(screen.getByText("Start new"));
    expect(screen.queryByTestId("thread-preview")).toBeNull();
    expect(screen.getByText("New thread")).toBeTruthy();
    expect(screen.getByLabelText("Open full page")).toBeTruthy();
    expect(screen.getByText("Thread composer")).toBeTruthy();

    // Back again, then the list's "+ Start new" row opens the same view.
    fireEvent.click(screen.getByRole("button", { name: "Back to thread list" }));
    expect(screen.queryByText("Thread composer")).toBeNull();
    fireEvent.click(screen.getByText("Start new"));
    expect(screen.getByText("Thread composer")).toBeTruthy();

    // Creating a thread from the composer opens it in the mini preview right
    // away — even before the thread list query includes it.
    fireEvent.click(screen.getByText("Thread composer"));
    expect(
      screen.getByTestId("thread-preview").getAttribute("data-thread-id")
    ).toBe("thread-9");
    expect(screen.getByText("New thread")).toBeTruthy();
  });
});
