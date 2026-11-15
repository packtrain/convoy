/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { LexoRank } from "lexorank";
import { api } from "@/convex/_generated/api";
import { withProjectRole } from "@/test-utils/project-role";
import type { Id } from "@/convex/_generated/dataModel";
import {
  TaskListPicker,
  TaskListSettingsManagement,
} from "./task-list-management";
import { MoveToListMenuContent } from "./move-to-list-menu-content";
import { ProjectTaskListDropdown } from "./project-task-list-dropdown";

const usePaginatedQueryMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/acme/OS",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

type TaskListItem =
  FunctionReturnType<typeof api.tasks.lists.list>["page"][number];

const projectId = "project_123" as Id<"projects">;
const defaultRank = LexoRank.middle().toString();
const activeRank = LexoRank.parse(defaultRank).genNext().toString();
const archivedRank = LexoRank.parse(activeRank).genNext().toString();
const activeList: TaskListItem = {
  type: "list",
  _id: "list_active" as Id<"taskLists">,
  _creationTime: 1,
  projectId,
  name: "Sprint 1",
  ref: "SPRINT-1",
  rank: activeRank,
  color: "#ef4444",
  isArchived: false,
  isDefault: false,
  isPinned: false,
  createdBy: "user_123" as Id<"users">,
  updatedBy: "user_123" as Id<"users">,
  createdAt: 1,
  updatedAt: 1,
};
const archivedList: TaskListItem = {
  ...activeList,
  _id: "list_archived" as Id<"taskLists">,
  name: "Archived Sprint",
  ref: "ARCHIVED-SPRINT",
  rank: archivedRank,
  isArchived: true,
  archivedAt: 2,
  archivedBy: "user_123" as Id<"users">,
};
const defaultList: TaskListItem = {
  ...activeList,
  _id: "list_default" as Id<"taskLists">,
  name: "Inbox",
  ref: "INBOX",
  rank: defaultRank,
  isDefault: true,
};

const createMock = vi.fn();
const updateMock = vi.fn();
const setDefaultMock = vi.fn();
const archiveMock = vi.fn();
const unarchiveMock = vi.fn();
const removeMock = vi.fn();
const pinMock = vi.fn();
const unpinMock = vi.fn();
const reorderMock = vi.fn();
const loadMoreMock = vi.fn();

function setupPaginatedQuery() {
  usePaginatedQueryMock.mockImplementation((fn: unknown, args: unknown) => {
    const functionName = getFunctionName(
      fn as Parameters<typeof getFunctionName>[0]
    );
    if (args === "skip") {
      return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
    }

    if (functionName === getFunctionName(api.tasks.lists.list) && (args as { archived?: boolean }).archived) {
      return {
        results: [archivedList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    }

    const status = functionName === getFunctionName(api.tasks.lists.list)
      ? "CanLoadMore"
      : "Exhausted";

    return {
      results: [activeList],
      status,
      loadMore: loadMoreMock,
    };
  });
}

beforeEach(() => {
  usePaginatedQueryMock.mockReset();
  useQueryMock.mockReset();
  useMutationMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  setDefaultMock.mockReset();
  archiveMock.mockReset();
  unarchiveMock.mockReset();
  removeMock.mockReset();
  pinMock.mockReset();
  unpinMock.mockReset();
  reorderMock.mockReset();
  loadMoreMock.mockReset();

  createMock.mockResolvedValue("list_new");
  updateMock.mockResolvedValue(null);
  setDefaultMock.mockResolvedValue(null);
  archiveMock.mockResolvedValue(null);
  unarchiveMock.mockResolvedValue(null);
  removeMock.mockResolvedValue(null);
  pinMock.mockResolvedValue(null);
  unpinMock.mockResolvedValue(null);
  reorderMock.mockResolvedValue(null);

  setupPaginatedQuery();
  useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
    if (args === "skip") {
      return undefined;
    }
    const functionName = getFunctionName(
      fn as Parameters<typeof getFunctionName>[0]
    );
    if (functionName === getFunctionName(api.projects.members.getMyRole)) {
      return "project-admin";
    }
    if (functionName === getFunctionName(api.tasks.sections.listByProject)) {
      return [];
    }
    return undefined;
  });
  useMutationMock.mockImplementation((fn: unknown) => {
    const functionName = getFunctionName(
      fn as Parameters<typeof getFunctionName>[0]
    );
    if (functionName === getFunctionName(api.tasks.lists.create)) return createMock;
    if (functionName === getFunctionName(api.tasks.lists.update)) return updateMock;
    if (functionName === getFunctionName(api.tasks.lists.setDefault)) {
      return setDefaultMock;
    }
    if (functionName === getFunctionName(api.tasks.lists.archive)) return archiveMock;
    if (functionName === getFunctionName(api.tasks.lists.unarchive)) return unarchiveMock;
    if (functionName === getFunctionName(api.tasks.lists.remove)) return removeMock;
    if (functionName === getFunctionName(api.tasks.lists.pin)) return pinMock;
    if (functionName === getFunctionName(api.tasks.lists.unpin)) return unpinMock;
    if (functionName === getFunctionName(api.tasks.lists.reorder)) return reorderMock;
    return vi.fn();
  });
});

afterEach(() => {
  cleanup();
});

function openActions(label: string) {
  const trigger = screen.getByLabelText(label);
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe("task List management", () => {
  test("clips the next compact List row to reveal that the picker scrolls", () => {
    render(<TaskListPicker projectId={projectId} />);

    expect(screen.getByRole("listbox").className).toContain("max-h-[17rem]");
    expect(screen.getByRole("listbox").className).toContain("overflow-y-auto");
  });

  test("renders header Lists with search, load more, create, and row actions", async () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [defaultList, activeList],
        status: "CanLoadMore",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListPicker projectId={projectId} defaultListId={defaultList._id} />);

    expect(screen.getByPlaceholderText("Search lists...")).toBeDefined();
    expect(screen.getByRole("option", { name: "Inbox" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Backlog" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Archived" })).toBeDefined();
    expect(screen.getByText("Sprint 1")).toBeDefined();
    expect(screen.getAllByText("Inbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Pin Inbox to sidebar" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Pin Sprint 1 to sidebar" })).toBeDefined();
    expect(screen.getByLabelText("Actions for Inbox")).toBeDefined();
    // Load more scrolls with the rows as the last entry, after the create row —
    // pinned below the viewport a floating mobile nav bar would cover it.
    const loadMore = screen.getByRole("button", { name: "Load more" });
    const viewport = screen.getByRole("listbox");
    expect(viewport.contains(loadMore)).toBe(true);
    const entries = Array.from(loadMore.parentElement?.children ?? []);
    expect(entries.at(-1)).toBe(loadMore);
    expect(entries.at(-2)?.textContent).toContain("Create list");

    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Sprint 2" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: 'Create list "Sprint 2"' })
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Sprint 2"
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId,
        name: "Sprint 2",
        ref: "SPRINT-2",
        color: null,
        isPinned: true,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Create list" })).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear list search" }));

    openActions("Actions for Inbox");
    fireEvent.click(await screen.findByText("Edit"));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Inbox");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Set as default"));
    expect(screen.getByText(/"Sprint 1" will become the default list/)).toBeDefined();
    expect(screen.getByText(/Existing tasks will not move/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));

    await waitFor(() => {
      expect(setDefaultMock).toHaveBeenCalledWith({ id: activeList._id });
    });

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Archive"));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(archiveMock).toHaveBeenCalledWith({ id: activeList._id });
    });
  });

  test("a viewer browses header Lists with no create row and no row actions", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) =>
      args === "skip"
        ? { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() }
        : { results: [defaultList, activeList], status: "Exhausted", loadMore: vi.fn() }
    );
    useQueryMock.mockImplementation(withProjectRole("viewer"));

    render(<TaskListPicker projectId={projectId} defaultListId={defaultList._id} />);

    expect(screen.getByText("Sprint 1")).toBeDefined();
    expect(screen.queryByLabelText("Actions for Sprint 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pin Sprint 1 to sidebar" })).toBeNull();
    expect(screen.queryByText("Create list")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Sprint 2" },
    });
    expect(screen.queryByRole("button", { name: 'Create list "Sprint 2"' })).toBeNull();
  });

  test("filters system Lists while searching Lists", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListPicker projectId={projectId} />);

    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "arc" },
    });

    expect(screen.queryByRole("button", { name: "Inbox" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Backlog" })).toBeNull();
    expect(screen.getByRole("button", { name: "Archived" })).toBeDefined();
    expect(screen.queryByText("No lists found")).toBeNull();
    expect(screen.queryByText("Sprint 1")).toBeNull();
  });

  test("hides the system separator when no system List matches search", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListPicker projectId={projectId} />);

    expect(screen.getByRole("separator")).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Sprint" },
    });

    expect(screen.queryByRole("button", { name: "Inbox" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Backlog" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archived" })).toBeNull();
    expect(screen.getByText("Sprint 1")).toBeDefined();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  test("renders a compact not-found row when create is disabled and nothing matches", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(
      <TaskListPicker
        projectId={projectId}
        disabledRows={{ create: true }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "ABC" },
    });

    expect(screen.getByText('"ABC" not found')).toBeDefined();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByRole("button", { name: 'Create list "ABC"' })).toBeNull();
  });

  test("selects system Lists from the header picker", () => {
    const onSelectInbox = vi.fn();
    const onSelectBacklog = vi.fn();
    const onSelectArchived = vi.fn();
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [defaultList, activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(
      <TaskListPicker
        projectId={projectId}
        defaultListId={defaultList._id}
        onSelectInbox={onSelectInbox}
        onSelectBacklog={onSelectBacklog}
        onSelectArchived={onSelectArchived}
      />
    );

    fireEvent.click(screen.getByRole("option", { name: "Inbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(onSelectInbox).toHaveBeenCalledTimes(1);
    expect(onSelectBacklog).toHaveBeenCalledTimes(1);
    expect(onSelectArchived).toHaveBeenCalledTimes(1);
  });

  test("moves focus from search to the matching persisted List with ArrowDown", () => {
    const onSelectList = vi.fn();
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListPicker projectId={projectId} onSelectList={onSelectList} />);

    const search = screen.getByPlaceholderText("Search lists...");
    fireEvent.change(search, { target: { value: "Sprint 1" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    const row = screen.getByText("Sprint 1").closest('[role="option"]');
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row as HTMLElement, { key: "Enter" });
    expect(onSelectList).toHaveBeenCalledWith(activeList);
  });

  test("selects the focused persisted List with Space", () => {
    const onSelectList = vi.fn();
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListPicker projectId={projectId} onSelectList={onSelectList} />);

    const search = screen.getByPlaceholderText("Search lists...");
    fireEvent.change(search, { target: { value: "Sprint 1" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    const row = screen.getByText("Sprint 1").closest('[role="option"]');
    fireEvent.keyDown(row as HTMLElement, { key: " " });

    expect(onSelectList).toHaveBeenCalledWith(activeList);
  });

  test("moves focus from search to the create row with ArrowDown", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListPicker projectId={projectId} />);

    const search = screen.getByPlaceholderText("Search lists...");
    fireEvent.change(search, { target: { value: "Sprint 2" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: 'Create list "Sprint 2"' })
    );
  });

  test("highlights the selected persisted List in the header picker", () => {
    render(
      <TaskListPicker
        projectId={projectId}
        selectedListRef={activeList.ref}
        onSelectList={vi.fn()}
      />
    );

    const selectedRow = screen.getByText("Sprint 1").closest('[role="option"]');

    expect(selectedRow?.getAttribute("aria-selected")).toBe("true");
    expect(selectedRow?.className).toContain("bg-muted");
  });

  test("focuses the List search input when the header dropdown opens", () => {
    render(
      <ProjectTaskListDropdown
        projectId={projectId}
        defaultListId={activeList._id}
        archiveFilter="active"
        selectedListRef={null}
        onStatusFilterChange={vi.fn()}
        onArchiveFilterChange={vi.fn()}
        onSelectedListChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Open lists" }).textContent
    ).toContain("Sprint 1");

    fireEvent.click(screen.getByRole("button", { name: "Open lists" }));

    expect(document.activeElement).toBe(screen.getByPlaceholderText("Search lists..."));
  });

  test("renders a skeleton in the header trigger while the default List is unresolved", () => {
    const { container } = render(
      <ProjectTaskListDropdown
        projectId={projectId}
        defaultListId={defaultList._id}
        archiveFilter="active"
        selectedListRef={null}
        onStatusFilterChange={vi.fn()}
        onArchiveFilterChange={vi.fn()}
        onSelectedListChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Open lists" })).toBeDefined();
    expect(screen.queryByText("Default list")).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')?.className).toContain("w-14");
  });

  test("labels an archived selected List in the header trigger", () => {
    render(
      <ProjectTaskListDropdown
        projectId={projectId}
        defaultListId={defaultList._id}
        archiveFilter="active"
        selectedListRef={archivedList.ref}
        selectedList={archivedList}
        onStatusFilterChange={vi.fn()}
        onArchiveFilterChange={vi.fn()}
        onSelectedListChange={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "Open lists" });

    expect(trigger.textContent).toContain("Archived Sprint");
  });

  test("selects a newly created List from the header dropdown", async () => {
    const onSelectedListChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onArchiveFilterChange = vi.fn();

    render(
      <ProjectTaskListDropdown
        projectId={projectId}
        archiveFilter="active"
        selectedListRef={null}
        onStatusFilterChange={onStatusFilterChange}
        onArchiveFilterChange={onArchiveFilterChange}
        onSelectedListChange={onSelectedListChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open lists" }));
    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Sprint 2" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: 'Create list "Sprint 2"' })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId,
        name: "Sprint 2",
        ref: "SPRINT-2",
        color: null,
        isPinned: true,
      });
      expect(onSelectedListChange).toHaveBeenCalledWith("SPRINT-2");
    });
    expect(onStatusFilterChange).not.toHaveBeenCalled();
    expect(onArchiveFilterChange).not.toHaveBeenCalled();
  });

  test("keeps the header create dialog open when choosing a List color", async () => {
    render(
      <ProjectTaskListDropdown
        projectId={projectId}
        archiveFilter="active"
        selectedListRef={null}
        onStatusFilterChange={vi.fn()}
        onArchiveFilterChange={vi.fn()}
        onSelectedListChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open lists" }));
    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Colored Header List" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: 'Create list "Colored Header List"',
      })
    );
    fireEvent.click(screen.getByLabelText("Select color"));

    const colorButton = await screen.findByLabelText("#3b82f6");
    fireEvent.pointerDown(colorButton);
    fireEvent.click(colorButton);

    expect(screen.getByRole("dialog", { name: "Create list" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId,
        name: "Colored Header List",
        ref: "COLORED-HEADER-LIST",
        color: "#3b82f6",
        isPinned: true,
      });
    });
  });

  test("selecting a persisted List from Backlog uses one selected-List change", () => {
    const onSelectedListChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onArchiveFilterChange = vi.fn();

    render(
      <ProjectTaskListDropdown
        projectId={projectId}
        archiveFilter="active"
        selectedListRef="BACKLOG"
        onStatusFilterChange={onStatusFilterChange}
        onArchiveFilterChange={onArchiveFilterChange}
        onSelectedListChange={onSelectedListChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open lists" }));
    fireEvent.click(screen.getByRole("option", { name: "Sprint 1" }));

    expect(onSelectedListChange).toHaveBeenCalledWith("SPRINT-1");
    expect(onStatusFilterChange).not.toHaveBeenCalled();
    expect(onArchiveFilterChange).not.toHaveBeenCalled();
  });

  test("selecting Backlog from the header dropdown targets the system List once", () => {
    const onSelectedListChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onArchiveFilterChange = vi.fn();

    render(
      <ProjectTaskListDropdown
        projectId={projectId}
        archiveFilter="active"
        selectedListRef={null}
        onStatusFilterChange={onStatusFilterChange}
        onArchiveFilterChange={onArchiveFilterChange}
        onSelectedListChange={onSelectedListChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open lists" }));
    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));

    expect(onSelectedListChange).toHaveBeenCalledWith("BACKLOG");
    expect(onStatusFilterChange).not.toHaveBeenCalled();
    expect(onArchiveFilterChange).not.toHaveBeenCalled();
  });

  test("header picker rows expose link hrefs and keep plain-click selection", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [defaultList, activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });
    const onSelectedListChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onArchiveFilterChange = vi.fn();

    render(
      <ProjectTaskListDropdown
        projectId={projectId}
        defaultListId={defaultList._id}
        archiveFilter="active"
        selectedListRef={null}
        getListHref={(listRef) =>
          listRef ? `/o/acme/OS?list=${listRef}` : "/o/acme/OS"
        }
        backlogHref="/o/acme/OS?list=BACKLOG"
        archivedHref="/o/acme/OS?archived=true"
        onStatusFilterChange={onStatusFilterChange}
        onArchiveFilterChange={onArchiveFilterChange}
        onSelectedListChange={onSelectedListChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open lists" }));

    expect(screen.getByRole("link", { name: "Inbox" }).getAttribute("href"))
      .toBe("/o/acme/OS?list=INBOX");
    expect(screen.getByRole("link", { name: "Sprint 1" }).getAttribute("href"))
      .toBe("/o/acme/OS?list=SPRINT-1");
    expect(screen.getByRole("link", { name: "Backlog" }).getAttribute("href"))
      .toBe("/o/acme/OS?list=BACKLOG");
    expect(screen.getByRole("link", { name: "Archived" }).getAttribute("href"))
      .toBe("/o/acme/OS?archived=true");

    fireEvent.click(screen.getByRole("link", { name: "Sprint 1" }));

    expect(onSelectedListChange).toHaveBeenCalledWith("SPRINT-1");
    expect(onStatusFilterChange).not.toHaveBeenCalled();
    expect(onArchiveFilterChange).not.toHaveBeenCalled();
  });

  test("does not select a newly created List from settings management", async () => {
    const onSelectedListChange = vi.fn();

    render(<TaskListSettingsManagement projectId={projectId} />);

    fireEvent.click(screen.getByRole("button", { name: "New list" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Settings List" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId,
        name: "Settings List",
        ref: "SETTINGS-LIST",
        color: null,
        isPinned: true,
      });
    });
    expect(onSelectedListChange).not.toHaveBeenCalled();
  });

  test("settings rows link to task views for active and archived Lists", () => {
    const getOpenTasksHref = (list: TaskListItem) => `/o/acme/OS?list=${list.ref}`;

    const { rerender } = render(
      <TaskListSettingsManagement
        projectId={projectId}
        getOpenTasksHref={getOpenTasksHref}
      />
    );

    expect(screen.getByRole("link", { name: "Sprint 1" }).getAttribute("href"))
      .toBe("/o/acme/OS?list=SPRINT-1");

    rerender(
      <TaskListSettingsManagement
        projectId={projectId}
        archived
        getOpenTasksHref={getOpenTasksHref}
      />
    );

    expect(
      screen.getByRole("link", { name: "Archived Sprint" })
      .getAttribute("href")
    ).toBe("/o/acme/OS?list=ARCHIVED-SPRINT");
  });

  test("shows settings drag handles only for active unfiltered manageable Lists", () => {
    const { unmount } = render(<TaskListSettingsManagement projectId={projectId} />);

    expect(screen.getByRole("button", { name: "Drag to reorder list" })).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Sprint" },
    });
    expect(screen.queryByRole("button", { name: "Drag to reorder list" })).toBeNull();

    unmount();
    render(<TaskListSettingsManagement projectId={projectId} archived />);
    expect(screen.queryByRole("button", { name: "Drag to reorder list" })).toBeNull();

    cleanup();
    useQueryMock.mockImplementation((fn: unknown, args: unknown) => {
      if (args === "skip") {
        return undefined;
      }
      const functionName = getFunctionName(
        fn as Parameters<typeof getFunctionName>[0]
      );
      if (functionName === getFunctionName(api.projects.members.getMyRole)) {
        return "viewer";
      }
      return undefined;
    });
    render(<TaskListSettingsManagement projectId={projectId} />);
    expect(screen.queryByRole("button", { name: "Drag to reorder list" })).toBeNull();
  });

  test("edits names without changing keys unless the key field changes", async () => {
    render(<TaskListSettingsManagement projectId={projectId} />);

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Edit"));
    expect(screen.getByLabelText("Key")).toBeDefined();
    expect(
      screen.getByText(/Changing the list key will affect existing task references/)
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Sprint One" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        id: activeList._id,
        name: "Sprint One",
        ref: activeList.ref,
        color: activeList.color,
      });
    });
  });

  test("creates a List pinned to the sidebar by default", async () => {
    render(<TaskListSettingsManagement projectId={projectId} />);

    fireEvent.click(screen.getByRole("button", { name: "New list" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Pinned List" },
    });
    expect(
      screen.getByRole("checkbox", { name: /pin to sidebar/i }).getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId,
        name: "Pinned List",
        ref: "PINNED-LIST",
        color: null,
        isPinned: true,
      });
    });
  });

  test("unpins a pinned List from the edit form checkbox", async () => {
    const pinnedList: TaskListItem = { ...activeList, isPinned: true };
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [pinnedList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListSettingsManagement projectId={projectId} />);

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Edit"));
    const checkbox = screen.getByRole("checkbox", { name: /pin to sidebar/i });
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        id: pinnedList._id,
        name: pinnedList.name,
        ref: pinnedList.ref,
        color: pinnedList.color,
        isPinned: false,
      });
    });
  });

  test("sets an active List as the default from settings", async () => {
    render(<TaskListSettingsManagement projectId={projectId} />);

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Set as default"));
    expect(screen.getByText(/"Sprint 1" will become the default list/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));

    await waitFor(() => {
      expect(setDefaultMock).toHaveBeenCalledWith({ id: activeList._id });
    });
  });

  test("pins a List to the sidebar from row actions", async () => {
    render(<TaskListSettingsManagement projectId={projectId} />);

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Pin to sidebar"));

    await waitFor(() => {
      expect(pinMock).toHaveBeenCalledWith({ id: activeList._id });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '"Sprint 1" pinned to sidebar'
    );
  });

  test("pins a List to the sidebar from the direct row button", async () => {
    render(<TaskListSettingsManagement projectId={projectId} />);

    fireEvent.click(screen.getByRole("button", { name: "Pin Sprint 1 to sidebar" }));

    await waitFor(() => {
      expect(pinMock).toHaveBeenCalledWith({ id: activeList._id });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '"Sprint 1" pinned to sidebar'
    );
  });

  test("unpins a pinned List from row actions", async () => {
    const pinnedList: TaskListItem = { ...activeList, isPinned: true };
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [pinnedList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListSettingsManagement projectId={projectId} />);

    expect(
      screen.getByRole("button", { name: "Unpin Sprint 1 from sidebar" })
    ).toBeDefined();

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Unpin from sidebar"));

    await waitFor(() => {
      expect(unpinMock).toHaveBeenCalledWith({ id: pinnedList._id });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '"Sprint 1" unpinned from sidebar'
    );
  });

  test("hides pin actions for non-admin roles", async () => {
    useQueryMock.mockReturnValue("member");

    render(<TaskListSettingsManagement projectId={projectId} />);

    openActions("Actions for Sprint 1");
    expect(await screen.findByText("Archive")).toBeDefined();
    expect(screen.queryByText("Pin to sidebar")).toBeNull();
    expect(screen.queryByText("Unpin from sidebar")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pin Sprint 1 to sidebar" })
    ).toBeNull();
  });

  test("hides the create form pin checkbox for non-admin roles", () => {
    useQueryMock.mockReturnValue("member");

    render(<TaskListSettingsManagement projectId={projectId} />);

    fireEvent.click(screen.getByRole("button", { name: "New list" }));
    expect(
      screen.queryByRole("checkbox", { name: /pin to sidebar/i })
    ).toBeNull();
  });

  test("hides pin actions for archived Lists", async () => {
    render(<TaskListSettingsManagement projectId={projectId} archived />);

    openActions("Actions for Archived Sprint");
    expect(await screen.findByText("Unarchive")).toBeDefined();
    expect(screen.queryByText("Pin to sidebar")).toBeNull();
    expect(screen.queryByText("Unpin from sidebar")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pin Archived Sprint to sidebar" })
    ).toBeNull();
  });

  test("disables active List creation at the project limit", () => {
    const limitedLists = Array.from({ length: 20 }, (_, index) => ({
      ...activeList,
      _id: `list_limit_${index}` as Id<"taskLists">,
      name: `List ${index + 1}`,
      ref: `LIST-${index + 1}`,
      isDefault: index === 0,
    }));
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: limitedLists,
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListSettingsManagement projectId={projectId} />);

    expect(screen.getByRole("button", { name: "New list" })).toHaveProperty(
      "disabled",
      true
    );
  });

  test("creates a List with a selected color", async () => {
    render(<TaskListSettingsManagement projectId={projectId} />);

    fireEvent.click(screen.getByRole("button", { name: "New list" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Colored List" },
    });
    fireEvent.click(screen.getByLabelText("Select color"));
    fireEvent.click(await screen.findByLabelText("#fca5a5"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId,
        name: "Colored List",
        ref: "COLORED-LIST",
        color: "#fca5a5",
        isPinned: true,
      });
    });
  });

  test("renders colored Lists in the move-to-List menu", () => {
    render(
      <MoveToListMenuContent
        projectId={projectId}
        onMoveToList={vi.fn()}
      />
    );

    const row = screen.getByText("Sprint 1").closest("button");
    const icon = row?.querySelector("svg");

    expect(icon?.style.color).toBe("rgb(239, 68, 68)");
  });

  test("navigates and selects move-to-List results from the search input", () => {
    const onMoveToList = vi.fn();
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(
      <MoveToListMenuContent
        projectId={projectId}
        autoFocusSearch
        onMoveToList={onMoveToList}
      />
    );

    const search = screen.getByPlaceholderText("Search lists...");
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: "Sprint 1" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    const row = screen.getByText("Sprint 1").closest("button");
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row as HTMLElement, { key: " " });
    expect(onMoveToList).toHaveBeenCalledWith(activeList.ref);
  });

  test("move-to-List menu includes and disables the current default List", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [defaultList, activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(
      <MoveToListMenuContent
        projectId={projectId}
        selectedListRef={defaultList.ref}
        onMoveToList={vi.fn()}
      />
    );

    expect(screen.getByText("Inbox")).toBeDefined();
    expect(screen.getByText("Backlog").closest("button")?.disabled).toBe(false);
    expect(screen.getByText("Archived").closest("button")?.disabled).toBe(true);
    expect(screen.getByText("Sprint 1")).toBeDefined();
    expect(screen.getAllByText("Inbox")).toHaveLength(1);
    expect(screen.getByText("Inbox").closest("button")?.disabled).toBe(true);
  });

  test("settings archived view shows archived Lists and unarchives them", async () => {
    render(<TaskListSettingsManagement projectId={projectId} archived />);

    expect(screen.getByText("Archived Sprint")).toBeDefined();
    expect(screen.queryByRole("button", { name: "New list" })).toBeNull();

    openActions("Actions for Archived Sprint");
    fireEvent.click(await screen.findByText("Unarchive"));

    await waitFor(() => {
      expect(unarchiveMock).toHaveBeenCalledWith({ id: archivedList._id });
    });
  });

  test("filters locally when all Lists are already loaded", () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [activeList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListSettingsManagement projectId={projectId} />);

    expect(screen.getByText("Sprint 1")).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Missing" },
    });

    expect(screen.queryByText("Sprint 1")).toBeNull();
    expect(screen.getByText("No lists found")).toBeDefined();
  });

  test("confirms hard delete", async () => {
    render(<TaskListSettingsManagement projectId={projectId} />);

    openActions("Actions for Sprint 1");
    fireEvent.click(await screen.findByText("Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(removeMock).toHaveBeenCalledWith({ id: activeList._id });
    });
  });

  test("disables archive and delete actions for the default List", async () => {
    usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") {
        return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
      }

      return {
        results: [defaultList],
        status: "Exhausted",
        loadMore: loadMoreMock,
      };
    });

    render(<TaskListSettingsManagement projectId={projectId} />);

    openActions("Actions for Inbox");

    const archiveItem = await screen.findByText("Archive");
    const deleteItem = screen.getByText("Delete");
    const archiveMenuItem = archiveItem.closest('[role="menuitem"]');
    const deleteMenuItem = deleteItem.closest('[role="menuitem"]');

    expect(archiveMenuItem?.getAttribute("aria-disabled")).toBe("true");
    expect(archiveMenuItem?.getAttribute("title")).toBe(
      "The default list can't be archived."
    );
    expect(deleteMenuItem?.getAttribute("aria-disabled")).toBe("true");
    expect(deleteMenuItem?.getAttribute("title")).toBe(
      "The default list can't be deleted."
    );

    fireEvent.click(archiveItem);
    fireEvent.click(deleteItem);

    expect(screen.queryByText("Archive list")).toBeNull();
    expect(screen.queryByText("Delete list")).toBeNull();
    expect(archiveMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe("task List dialogs when List access goes away", () => {
  test("an open create form closes and never submits", async () => {
    const view = render(<TaskListPicker projectId={projectId} />);
    fireEvent.click(screen.getByRole("button", { name: "Create list" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Revoked List" } });
    useQueryMock.mockImplementation(withProjectRole("viewer"));
    view.rerender(<TaskListPicker projectId={projectId} />);

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("an open archive confirmation closes and never submits", () => {
    const view = render(<TaskListPicker projectId={projectId} />);
    openActions("Actions for Sprint 1");
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(screen.getByRole("button", { name: "Archive" })).toBeDefined();
    useQueryMock.mockImplementation(withProjectRole("viewer"));
    view.rerender(<TaskListPicker projectId={projectId} />);

    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(archiveMock).not.toHaveBeenCalled();
  });
});
