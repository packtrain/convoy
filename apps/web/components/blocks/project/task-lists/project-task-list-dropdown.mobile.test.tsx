/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { LexoRank } from "lexorank";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ProjectTaskListDropdown } from "./project-task-list-dropdown";

const usePaginatedQueryMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const isMobileMock = vi.fn(() => true);

vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: () => isMobileMock(),
  isDesktopViewport: () => !isMobileMock(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/acme/OS",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

type TaskListItem =
  FunctionReturnType<typeof api.tasks.lists.list>["page"][number];

const projectId = "project_123" as Id<"projects">;
const defaultRank = LexoRank.middle().toString();
const activeRank = LexoRank.parse(defaultRank).genNext().toString();
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
const defaultList: TaskListItem = {
  ...activeList,
  _id: "list_default" as Id<"taskLists">,
  name: "Inbox",
  ref: "INBOX",
  rank: defaultRank,
  isDefault: true,
};

function renderSelector(
  overrides: Partial<React.ComponentProps<typeof ProjectTaskListDropdown>> = {}
) {
  return render(
    <ProjectTaskListDropdown
      projectId={projectId}
      defaultListId={defaultList._id}
      archiveFilter="active"
      selectedListRef={null}
      onStatusFilterChange={vi.fn()}
      onArchiveFilterChange={vi.fn()}
      onSelectedListChange={vi.fn()}
      {...overrides}
    />
  );
}

function openSelector() {
  fireEvent.click(screen.getByRole("button", { name: "Open lists" }));
}

beforeEach(() => {
  usePaginatedQueryMock.mockReset();
  useQueryMock.mockReset();
  useMutationMock.mockReset();
  isMobileMock.mockReset();
  isMobileMock.mockReturnValue(true);

  usePaginatedQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
    if (args === "skip") {
      return { results: undefined, status: "LoadingFirstPage", loadMore: vi.fn() };
    }

    return {
      results: [defaultList, activeList],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
  });
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
    return undefined;
  });
  useMutationMock.mockImplementation(() => vi.fn());
});

afterEach(() => {
  cleanup();
  // The sheet's aria-hider marks the rest of the document while it is open, and
  // jsdom unmounts without the exit lifecycle that restores those nodes. Left
  // in place, the next test's trigger would be hidden from the a11y tree.
  document.querySelectorAll("[data-aria-hidden]").forEach((node) => {
    node.removeAttribute("aria-hidden");
    node.removeAttribute("data-aria-hidden");
  });
});

describe("ProjectTaskListDropdown on mobile", () => {
  test("labels the trigger with the selected List and keeps the sheet closed", () => {
    renderSelector();

    expect(
      screen.getByRole("button", { name: "Open lists" }).getAttribute("aria-haspopup")
    ).toBe("dialog");
    expect(
      screen.getByRole("button", { name: "Open lists" }).textContent
    ).toContain("Inbox");
    expect(screen.queryByPlaceholderText("Search lists...")).toBeNull();
  });

  test("renders the same trigger pill as the desktop header", () => {
    isMobileMock.mockReturnValue(false);
    const { unmount } = renderSelector();
    const desktopTrigger = screen.getByRole("button", { name: "Open lists" });
    const desktopMarkup = desktopTrigger.outerHTML;
    unmount();

    isMobileMock.mockReturnValue(true);
    renderSelector();

    expect(
      screen.getByRole("button", { name: "Open lists" }).outerHTML
    ).toBe(desktopMarkup.replace('aria-haspopup="menu"', 'aria-haspopup="dialog"'));
  });

  test("opens the picker in a drag-handled bottom sheet", () => {
    renderSelector();

    openSelector();

    const sheet = document.querySelector('[data-slot="drawer-content"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute("data-vaul-drawer-direction")).toBe("bottom");
    expect(screen.getByPlaceholderText("Search lists...")).toBeDefined();
    expect(document.activeElement).not.toBe(
      screen.getByPlaceholderText("Search lists...")
    );
  });

  test("fills the sheet height instead of clipping List rows to the menu viewport", () => {
    renderSelector();

    openSelector();

    const listViewport = screen.getByRole("listbox");
    expect(listViewport.className).toContain("flex-1");
    expect(listViewport.className).toContain("overflow-y-auto");
    expect(listViewport.className).not.toContain("max-h-[17rem]");
  });

  test("clears the mobile nav bar so the last List row can scroll into view", () => {
    renderSelector();

    openSelector();

    // Trailing scroll space inside the List viewport, not sheet padding: the
    // sheet reaches the bottom of the screen and the nav bar floats over it.
    expect(screen.getByRole("listbox").className).toContain(
      "pb-[var(--mobile-nav-clearance)]"
    );
  });

  test("lets vertical drags scroll the List instead of dragging the sheet", () => {
    renderSelector();

    openSelector();

    expect(screen.getByRole("listbox").closest("[data-vaul-no-drag]")).not.toBeNull();
  });

  test("selects a persisted List from the sheet and closes it", () => {
    const onSelectedListChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onArchiveFilterChange = vi.fn();
    renderSelector({
      onSelectedListChange,
      onStatusFilterChange,
      onArchiveFilterChange,
    });

    openSelector();
    fireEvent.click(screen.getByRole("option", { name: "Sprint 1" }));

    expect(onSelectedListChange).toHaveBeenCalledWith("SPRINT-1");
    expect(onStatusFilterChange).not.toHaveBeenCalled();
    expect(onArchiveFilterChange).not.toHaveBeenCalled();
  });

  test("selects Backlog once from the sheet", () => {
    const onSelectedListChange = vi.fn();
    const onArchiveFilterChange = vi.fn();
    renderSelector({ onSelectedListChange, onArchiveFilterChange });

    openSelector();
    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));

    expect(onSelectedListChange).toHaveBeenCalledWith("BACKLOG");
    expect(onSelectedListChange).toHaveBeenCalledTimes(1);
    expect(onArchiveFilterChange).not.toHaveBeenCalled();
  });

  test("switches to the archive view from the sheet", () => {
    const onSelectedListChange = vi.fn();
    const onArchiveFilterChange = vi.fn();
    renderSelector({ onSelectedListChange, onArchiveFilterChange });

    openSelector();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(onArchiveFilterChange).toHaveBeenCalledWith("archived");
    expect(onSelectedListChange).toHaveBeenCalledWith(null);
  });

  test("keeps the sheet a selection surface without List row actions", () => {
    renderSelector();

    openSelector();

    expect(screen.getByRole("option", { name: "Sprint 1" })).toBeDefined();
    expect(screen.queryByLabelText("Actions for Sprint 1")).toBeNull();
    expect(screen.queryByLabelText("Pin Backlog to sidebar")).toBeNull();
  });

  test("still allows creating a List from the sheet", () => {
    renderSelector();

    openSelector();

    expect(screen.getByRole("button", { name: "Create list" })).toBeDefined();
  });

  test("resets the List search query when the sheet closes", () => {
    renderSelector();

    openSelector();
    fireEvent.change(screen.getByPlaceholderText("Search lists..."), {
      target: { value: "Sprint" },
    });

    expect(
      (screen.getByPlaceholderText("Search lists...") as HTMLInputElement).value
    ).toBe("Sprint");

    // Selecting closes the sheet; the query resets so the next open starts
    // clean. (The sheet content is still mounted here: jsdom never fires the
    // exit transition that unmounts it.)
    fireEvent.click(screen.getByRole("option", { name: "Sprint 1" }));

    expect(
      (screen.getByPlaceholderText("Search lists...") as HTMLInputElement).value
    ).toBe("");
  });

  test("keeps the desktop popover menu above the mobile breakpoint", () => {
    isMobileMock.mockReturnValue(false);
    renderSelector();

    expect(
      screen.getByRole("button", { name: "Open lists" }).getAttribute("aria-haspopup")
    ).toBe("menu");

    openSelector();

    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
    expect(screen.getByRole("menu")).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByPlaceholderText("Search lists...")
    );
  });
});
