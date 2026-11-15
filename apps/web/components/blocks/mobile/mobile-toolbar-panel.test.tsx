/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import { MobileToolbarPanel } from "./mobile-toolbar-panel";

const listFixture: TaskListItem = {
  type: "list",
  _id: "list_1" as Id<"taskLists">,
  _creationTime: 1,
  projectId: "project_123" as Id<"projects">,
  name: "Sprint 1",
  ref: "SPRINT-1",
  isArchived: false,
  isDefault: false,
  isPinned: false,
  createdBy: "user_1" as Id<"users">,
  updatedBy: "user_1" as Id<"users">,
  createdAt: 1,
  updatedAt: 1,
};

const updateProjectMock = vi.fn();
const updateProjectMutationMock = Object.assign(updateProjectMock, {
  withOptimisticUpdate: vi.fn(() => updateProjectMock),
});
const updateListMock = vi.fn();
const toastSuccessMock = vi.fn();

let mockRole = "project-admin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/o/org/ABC",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("convex/react", () => ({
  // Keyed by function reference so a List-scoped assertion can't be satisfied
  // by a call to the project mutation (and vice versa).
  useMutation: (fn: unknown) =>
    getFunctionName(fn as Parameters<typeof getFunctionName>[0]) ===
    getFunctionName(api.tasks.lists.update)
      ? updateListMock
      : updateProjectMutationMock,
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : mockRole),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: vi.fn(),
  },
}));

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof MobileToolbarPanel>> = {}
) {
  return render(
    <MobileToolbarPanel
      projectId={"project_123" as Id<"projects">}
      organizationSlug="org"
      projectAlias="ABC"
      statusFilter="all"
      assigneeFilter={null}
      archiveFilter="active"
      onStatusFilterChange={vi.fn()}
      onAssigneeFilterChange={vi.fn()}
      onArchiveFilterChange={vi.fn()}
      viewMode="board"
      listPath="/o/org/ABC"
      boardPath="/o/org/ABC/kanban"
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe("MobileToolbarPanel", () => {
  afterEach(() => {
    cleanup();
    mockRole = "project-admin";
    updateProjectMock.mockReset();
    updateListMock.mockReset();
    updateListMock.mockResolvedValue(null);
    updateProjectMock.mockResolvedValue(null);
    toastSuccessMock.mockReset();
  });

  test("always offers the Board view link", () => {
    renderPanel();

    expect(screen.getByRole("link", { name: /Board/ }).getAttribute("href")).toBe(
      "/o/org/ABC/kanban"
    );
  });

  test("lists board groupings and reports selection", () => {
    const onBoardGroupByChange = vi.fn();
    renderPanel({ boardGroupBy: "status", onBoardGroupByChange });
    expect(screen.getByText("Columns by")).toBeDefined();

    fireEvent.click(within(screen.getByRole("group", { name: "Columns by" })).getByRole("button", { name: /Assignee/ }));

    expect(onBoardGroupByChange).toHaveBeenCalledWith("assignee");
  });

  test("lists board rows with None and reports selection", () => {
    const onBoardRowGroupByChange = vi.fn();
    renderPanel({ boardGroupBy: "status", boardRowGroupBy: "section", onBoardRowGroupByChange });
    const rows = within(screen.getByRole("group", { name: "Rows by" }));
    expect(rows.getByRole("button", { name: /Section/ }).className).toContain("bg-muted");
    fireEvent.click(rows.getByRole("button", { name: /None/ }));
    expect(onBoardRowGroupByChange).toHaveBeenLastCalledWith("none");
    fireEvent.click(rows.getByRole("button", { name: /Owner/ }));
    expect(onBoardRowGroupByChange).toHaveBeenLastCalledWith("owner");
  });

  test("disables the column dimension in rows while rows are None", () => {
    renderPanel({ boardGroupBy: "status", boardRowGroupBy: "none", onBoardRowGroupByChange: vi.fn() });
    const rows = within(screen.getByRole("group", { name: "Rows by" }));
    expect((rows.getByRole("button", { name: /Status/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((rows.getByRole("button", { name: /Owner/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("hides board groupings on the list view", () => {
    renderPanel({ viewMode: "list", onBoardGroupByChange: vi.fn() });

    expect(screen.queryByText("Group by")).toBeNull();
  });

  test("sets the current view as the project default", async () => {
    renderPanel({ boardGroupBy: "priority" });

    fireEvent.click(screen.getByRole("button", { name: /Set as default view/ }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        id: "project_123",
        defaultViewMode: "board",
        defaultBoardGroupBy: "priority",
        defaultBoardRowGroupBy: "none",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  test("disables the default-view action when the current view is the default", () => {
    renderPanel({
      boardGroupBy: "assignee",
      defaultViewMode: "board",
      defaultBoardGroupBy: "assignee",
    });

    const row = screen.getByRole("button", { name: /Default view/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
  });

  test("mirrors the List-scoped default view rows next to the project one", async () => {
    renderPanel({ boardGroupBy: "assignee", viewedList: listFixture });

    // Both scopes render as sibling rows; Reset needs an existing override.
    expect(screen.getByRole("button", { name: "Set as default view" })).toBeDefined();
    expect(
      screen.queryByRole("button", {
        name: 'Reset "Sprint 1" to project default',
      })
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Set as default view for "Sprint 1" only',
      })
    );

    await waitFor(() => {
      expect(updateListMock).toHaveBeenCalledWith({
        id: "list_1",
        defaultViewMode: "board",
        defaultBoardGroupBy: "assignee",
        defaultBoardRowGroupBy: "none",
      });
    });
  });

  test("hides the List-scoped rows without a viewed List", () => {
    renderPanel();

    expect(screen.queryByText(/only$/)).toBeNull();
    expect(screen.queryByText(/^Reset /)).toBeNull();
  });

  test("always shows the settings entry", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: /Settings/ })).toBeDefined();
  });

  test("opens AI Agents from the mobile toolbar", () => {
    const onClose = vi.fn();
    const onAiAgentsClick = vi.fn();
    renderPanel({ onClose, onAiAgentsClick });

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAiAgentsClick).toHaveBeenCalledTimes(1);
  });

  test("a viewer keeps Members but gets no AI Agents entry", () => {
    mockRole = "viewer";
    renderPanel({ onMembersClick: vi.fn(), onAiAgentsClick: vi.fn() });

    expect(screen.getByRole("button", { name: "Members" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
  });

  test("opens the settings drawer with copy link and column visibility", () => {
    renderPanel({ hiddenTaskTableColumns: ["tags"] });

    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));

    expect(screen.getByText("Copy link")).toBeTruthy();
    expect(screen.getByText("Column visibility")).toBeTruthy();
    // Stacks as a nested sheet above the already-open view-options sheet.
    expect(
      document.querySelector('[data-slot="drawer-content"]')
    ).not.toBeNull();

    // Toggling a visible column hides it via the project update mutation.
    fireEvent.click(screen.getByRole("button", { name: /Priority/ }));
    expect(updateProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project_123",
        hiddenTaskTableColumns: expect.arrayContaining(["tags", "priority"]),
      })
    );
  });
  test("the settings drawer toggles Show description on cards, off by default", () => {
    window.localStorage.clear();
    renderPanel({ viewMode: "list" });

    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    const toggle = screen.getByRole("button", { name: "Show description" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("convoy.task-card-show-description")).toBe("1");
    window.localStorage.clear();
  });

  test("offers list grouping and snapshots it as a List default", async () => {
    const onListGroupByChange = vi.fn();
    renderPanel({ viewMode: "list", listGroupBy: "owner", onListGroupByChange, viewedList: listFixture });
    fireEvent.click(screen.getByRole("button", { name: "Label" }));
    expect(onListGroupByChange).toHaveBeenCalledWith("label");
    fireEvent.click(screen.getByRole("button", { name: 'Set as default view for "Sprint 1" only' }));
    await waitFor(() => expect(updateListMock).toHaveBeenCalledWith({ id: "list_1", defaultViewMode: "list", defaultListGroupBy: "owner" }));
  });

});
