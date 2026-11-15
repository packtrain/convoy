/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskListItem } from "./task-lists/task-list-types";
import { SettingsDropdown } from "./settings-dropdown";
import {
  DEV_SETTINGS,
  DEV_SETTING_ENABLED_VALUE,
} from "@/lib/dev-mode/constants";

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

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const updateProjectMock = vi.fn();
const projectMcpDialogMock = vi.fn();
const updateProjectMutationMock = Object.assign(updateProjectMock, {
  withOptimisticUpdate: vi.fn(() => updateProjectMock),
});
const updateListMock = vi.fn();

let mockRole = "project-admin";

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
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

vi.mock("./project-mcp-configuration-dialog", () => ({
  ProjectMcpConfigurationDialog: (props: {
    open: boolean;
    organizationSlug: string;
    projectAlias: string;
  }) => {
    projectMcpDialogMock(props);
    return props.open ? <div data-testid="project-mcp-dialog" /> : null;
  },
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Radio = React.createContext({ value: "", onValueChange: (_value: string) => { void _value; } });
  return ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    className,
    disabled,
    onClick,
    onSelect,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    disabled?: boolean;
    onClick?: () => void;
    onSelect?: (event: React.MouseEvent) => void;
    role?: string;
    "aria-label"?: string;
    "aria-checked"?: boolean;
  }) => (
    <button type="button" className={className} disabled={disabled} onClick={onSelect ?? onClick} {...props}>
      {children}
    </button>
  ),
  DropdownMenuRadioGroup: ({ children, value, onValueChange, "aria-label": label }: { children: ReactNode; value: string; onValueChange: (value: string) => void; "aria-label"?: string }) => <Radio.Provider value={{ value, onValueChange }}><div role="group" aria-label={label}>{children}</div></Radio.Provider>,
  DropdownMenuRadioItem: ({ children, value, onSelect, ...props }: { children: ReactNode; value: string; onSelect?: (event: React.MouseEvent) => void }) => {
    const group = React.useContext(Radio);
    return <button role="menuitemradio" aria-checked={group.value === value} {...props} onClick={event => { onSelect?.(event); group.onValueChange(value); }}>{children}</button>;
  },
  DropdownMenuCheckboxItem: ({ children, checked, onCheckedChange }: { children: ReactNode; checked?: boolean; onCheckedChange?: (checked: boolean) => void }) => (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
});
});

const UNFINISHED_LABELS = [
  "Filters",
  "Auto hide done items",
  "Import",
  "Export",
  "Notify me",
];

describe("SettingsDropdown", () => {
  afterEach(() => {
    cleanup();
    mockRole = "project-admin";
    window.localStorage.clear();
    vi.restoreAllMocks();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    updateProjectMock.mockReset();
    updateListMock.mockReset();
    updateListMock.mockResolvedValue(null);
    updateProjectMutationMock.withOptimisticUpdate.mockClear();
    updateProjectMock.mockResolvedValue(null);
    projectMcpDialogMock.mockReset();
  });

  test("shows Add members instead of Share and calls the members action", () => {
    const onAddMembers = vi.fn();
    const onOpenAiAgents = vi.fn();

    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        onAddMembers={onAddMembers}
        onOpenAiAgents={onOpenAiAgents}
      />
    );

    expect(screen.queryByText("Share")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add members" }));
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    expect(onAddMembers).toHaveBeenCalledTimes(1);
    expect(onOpenAiAgents).toHaveBeenCalledTimes(1);
  });

  test("a viewer gets neither Add members nor AI Agents", () => {
    mockRole = "viewer";
    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        onAddMembers={vi.fn()}
        onOpenAiAgents={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Add members" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
  });

  test("removes the Lists menu item", () => {
    render(<SettingsDropdown />);

    expect(screen.queryByRole("button", { name: "Lists" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Configuration" })).toBeNull();
  });

  test("hides settings features that are not implemented", () => {
    render(<SettingsDropdown />);

    for (const label of UNFINISHED_LABELS) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  test("shows unfinished settings features disabled when the developer toggle is on", () => {
    window.localStorage.setItem(
      DEV_SETTINGS.showUnfinishedItems.storageKey,
      DEV_SETTING_ENABLED_VALUE
    );
    render(<SettingsDropdown />);

    for (const label of [
      "Filters",
      "Auto hide done items",
      "Import",
      "Export",
      "Notify me",
    ]) {
      const menuItem = screen.getByRole("button", {
        name: label,
      }) as HTMLButtonElement;

      expect(menuItem.disabled).toBe(true);
    }
  });

  test("board icons change only column grouping without layout or ungroup controls", () => {
    const onBoardGroupByChange = vi.fn();
    const onListGroupByChange = vi.fn();
    render(<SettingsDropdown showBoardGroupBy boardGroupBy="priority"
      onBoardGroupByChange={onBoardGroupByChange} onListGroupByChange={onListGroupByChange} />);
    expect(screen.getByText("Columns by")).toBeDefined();
    expect(screen.queryByText("Layout")).toBeNull();
    expect(screen.queryByRole("button", { name: "List layout" })).toBeNull();
    expect(screen.queryByRole("menuitemradio", { name: "No grouping" })).toBeNull();
    const priority = screen.getByRole("menuitemradio", { name: "Columns by: Priority" });
    expect(priority.getAttribute("aria-checked")).toBe("true");
    expect(priority.className).toContain("bg-primary");
    for (const label of ["Status", "Assignee", "Owner", "Priority", "Type", "Label"]) {
      fireEvent.click(screen.getByRole("menuitemradio", { name: `Columns by: ${label}` }));
      expect(onBoardGroupByChange).toHaveBeenLastCalledWith(label.toLowerCase());
    }
    expect(onListGroupByChange).not.toHaveBeenCalled();
  });

  test("board view toggles Show description, off by default and kept in this browser", () => {
    render(<SettingsDropdown showBoardGroupBy />);

    const toggle = screen.getByRole("menuitemcheckbox", { name: "Show description" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem("convoy.task-card-show-description")).toBe("1");
  });

  test("list view has no Show description toggle", () => {
    render(<SettingsDropdown />);

    expect(screen.queryByRole("menuitemcheckbox", { name: "Show description" })).toBeNull();
  });

  test("list icons group and ungroup without invoking board navigation", () => {
    const onListGroupByChange = vi.fn();
    const onBoardGroupByChange = vi.fn();
    const props = { onListGroupByChange, onBoardGroupByChange, boardGroupBy: "priority" as const };
    const { rerender } = render(<SettingsDropdown {...props} listGroupBy="none" />);
    expect(screen.getByText("Group by")).toBeDefined();
    expect(screen.queryByText("Group list by")).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "No grouping" }).getAttribute("aria-checked")).toBe("true");
    for (const label of ["Status", "Assignee", "Owner", "Priority", "Type", "Label"]) {
      fireEvent.click(screen.getByRole("menuitemradio", { name: `Group by: ${label}` }));
      expect(onListGroupByChange).toHaveBeenLastCalledWith(label.toLowerCase());
    }
    rerender(<SettingsDropdown {...props} listGroupBy="owner" />);
    expect(screen.getByRole("menuitemradio", { name: "Group by: Owner" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No grouping" }));
    expect(onListGroupByChange).toHaveBeenLastCalledWith("none");
    expect(onBoardGroupByChange).not.toHaveBeenCalled();
    rerender(<SettingsDropdown {...props} listGroupBy="owner" showBoardGroupBy />);
    expect(screen.getByRole("menuitemradio", { name: "Columns by: Priority" }).getAttribute("aria-checked")).toBe("true");
    rerender(<SettingsDropdown {...props} listGroupBy="owner" />);
    expect(screen.getByRole("menuitemradio", { name: "Group by: Owner" }).getAttribute("aria-checked")).toBe("true");
  });

  test("defaults the active board column grouping to Status", () => {
    render(<SettingsDropdown showBoardGroupBy />);
    expect(screen.getByRole("menuitemradio", { name: "Columns by: Status" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Columns by: Type" }).getAttribute("aria-checked")).toBe("false");
  });

  test("sets the current board view as the project default view", async () => {
    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        showBoardGroupBy
        boardGroupBy="assignee"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Set as default view" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        id: "project_123",
        defaultViewMode: "board",
        defaultBoardGroupBy: "assignee",
        defaultBoardRowGroupBy: "none",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  test("sets the list view as the project default without a board grouping", async () => {
    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        defaultViewMode="board"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Set as default view" }));

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        id: "project_123",
        defaultViewMode: "list",
        defaultListGroupBy: "none",
      });
    });
  });

  test("disables the default-view action when the current view is the default", () => {
    // List is the implicit default when nothing is stored.
    const { unmount } = render(
      <SettingsDropdown projectId={"project_123" as Id<"projects">} />
    );
    const listDefaultButton = screen.getByRole("button", { name: "Default view" });
    expect((listDefaultButton as HTMLButtonElement).disabled).toBe(true);
    unmount();

    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        showBoardGroupBy
        boardGroupBy="assignee"
        defaultViewMode="board"
        defaultBoardGroupBy="assignee"
      />
    );
    const boardDefaultButton = screen.getByRole("button", { name: "Default view" });
    expect((boardDefaultButton as HTMLButtonElement).disabled).toBe(true);
  });

  test("hides the List-scoped default view actions without a viewed List", () => {
    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        showBoardGroupBy
      />
    );

    expect(screen.getByRole("button", { name: "Set as default view" })).toBeDefined();
    expect(screen.queryByText(/only$/)).toBeNull();
    expect(screen.queryByText(/^Reset /)).toBeNull();
  });

  test("sets the current view as the viewed List's default view", async () => {
    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        showBoardGroupBy
        boardGroupBy="assignee"
        viewedList={listFixture}
      />
    );

    // Both scopes render as flat siblings, with the List name interpolated.
    expect(screen.getByRole("button", { name: "Set as default view" })).toBeDefined();
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
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Default view updated for "Sprint 1"'
    );
  });

  test("disables the List-scoped action when the override already matches", () => {
    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        showBoardGroupBy
        boardGroupBy="assignee"
        viewedList={{
          ...listFixture,
          defaultViewMode: "board",
          defaultBoardGroupBy: "assignee",
        }}
      />
    );

    const listItem = screen.getByRole("button", {
      name: 'Set as default view for "Sprint 1" only',
    }) as HTMLButtonElement;
    expect(listItem.disabled).toBe(true);
  });

  test("offers Reset only for a List that carries an override", async () => {
    const { unmount } = render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        viewedList={listFixture}
      />
    );
    expect(
      screen.queryByRole("button", {
        name: 'Reset "Sprint 1" to project default',
      })
    ).toBeNull();
    unmount();

    render(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        viewedList={{ ...listFixture, defaultViewMode: "board" }}
      />
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: 'Reset "Sprint 1" to project default',
      })
    );

    await waitFor(() => {
      expect(updateListMock).toHaveBeenCalledWith({
        id: "list_1",
        defaultViewMode: null,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '"Sprint 1" now uses the project default view'
    );
  });

  test("hides removed layout and group submenus", () => {
    render(<SettingsDropdown showBoardGroupBy />);

    expect(screen.queryByRole("button", { name: "Group by" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
  });

  test("renders supported column visibility options without order controls", async () => {
    updateProjectMock.mockResolvedValue(null);

    const { rerender } = render(
      <SettingsDropdown projectId={"project_123" as Id<"projects">} />
    );

    expect(screen.getByRole("button", { name: "Column visibility" })).toBeDefined();
    expect(screen.queryByText("Column order & visibility")).toBeNull();
    expect(screen.queryByText("Task")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.getByText("Priority")).toBeDefined();
    expect(screen.getByText("Due date")).toBeDefined();
    expect(screen.getByText("Tags")).toBeDefined();
    expect(screen.getByText("Assignee")).toBeDefined();
    // No saved setting: Tags starts hidden (docs/specs/task-table-column-visibility.md).
    expect(screen.getByRole("button", { name: "Show Tags column" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Hide Priority column" }));

    rerender(
      <SettingsDropdown
        projectId={"project_123" as Id<"projects">}
        hiddenTaskTableColumns={["priority", "tags"]}
      />
    );
    expect(screen.getByRole("button", { name: "Show Priority column" })).toBeDefined();
    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith({
        id: "project_123",
        hiddenTaskTableColumns: ["priority", "tags"],
      });
    });
  });

  test("copies the full project link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SettingsDropdown projectPath="/o/acme/ABC" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("http://localhost:3000/o/acme/ABC");
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Project link copied to clipboard"
    );
  });

  test("opens project MCP configuration when route params are available", () => {
    render(
      <SettingsDropdown
        organizationSlug="acme"
        projectAlias="WEB"
      />
    );

    expect(projectMcpDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: false,
        organizationSlug: "acme",
        projectAlias: "WEB",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure MCP" }));

    expect(screen.getByTestId("project-mcp-dialog")).toBeDefined();
    expect(projectMcpDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        organizationSlug: "acme",
        projectAlias: "WEB",
      })
    );
  });

  test("hides project MCP configuration without route params", () => {
    render(<SettingsDropdown />);

    expect(screen.queryByRole("button", { name: "Configure MCP" })).toBeNull();
    expect(projectMcpDialogMock).not.toHaveBeenCalled();
  });
  test("board Rows by submenu changes rows and the default view snapshots both axes", async () => {
    const onBoardRowGroupByChange = vi.fn();
    const { rerender } = render(<SettingsDropdown projectId={"project_123" as Id<"projects">} showBoardGroupBy
      boardGroupBy="status" boardRowGroupBy="section" onBoardGroupByChange={vi.fn()}
      onBoardRowGroupByChange={onBoardRowGroupByChange} defaultViewMode="board" defaultBoardGroupBy="status" />);
    expect(screen.getByRole("button", { name: /^Rows by\s*Section$/ })).toBeDefined();
    const rows = within(screen.getByRole("group", { name: "Rows by" }));
    expect(rows.getByRole("menuitemradio", { name: "Section" }).getAttribute("aria-checked")).toBe("true");
    expect(rows.getByRole("menuitemradio", { name: /^Status\s*Swaps axes$/ })).toBeDefined();
    fireEvent.click(rows.getByRole("menuitemradio", { name: "No rows" }));
    expect(onBoardRowGroupByChange).toHaveBeenLastCalledWith("none");
    fireEvent.click(rows.getByRole("menuitemradio", { name: "Label" }));
    expect(onBoardRowGroupByChange).toHaveBeenLastCalledWith("label");
    fireEvent.click(screen.getByRole("button", { name: "Set as default view" }));
    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledWith({
      id: "project_123", defaultViewMode: "board", defaultBoardGroupBy: "status", defaultBoardRowGroupBy: "section",
    }));
    rerender(<SettingsDropdown projectId={"project_123" as Id<"projects">} showBoardGroupBy boardGroupBy="status"
      boardRowGroupBy="section" defaultViewMode="board" defaultBoardGroupBy="status" defaultBoardRowGroupBy="section" />);
    expect((screen.getByRole("button", { name: "Default view" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SettingsDropdown listGroupBy="owner" boardRowGroupBy="section" />);
    expect(screen.queryByText("Rows by")).toBeNull();
  });

  test("Rows by disables the column dimension while rows are None", () => {
    render(<SettingsDropdown showBoardGroupBy boardGroupBy="status" onBoardRowGroupByChange={vi.fn()} />);
    const rows = within(screen.getByRole("group", { name: "Rows by" }));
    // Nothing to swap with, so picking it would do nothing.
    expect((rows.getByRole("menuitemradio", { name: "Status" }) as HTMLButtonElement).disabled).toBe(true);
    expect((rows.getByRole("menuitemradio", { name: "Owner" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("changes list grouping and saves Owner as the project default", async () => {
    const onListGroupByChange = vi.fn();
    render(<SettingsDropdown projectId={"project_123" as Id<"projects">} listGroupBy="owner" onListGroupByChange={onListGroupByChange} />);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Group by: Label" }));
    expect(onListGroupByChange).toHaveBeenCalledWith("label");
    fireEvent.click(screen.getByRole("button", { name: "Set as default view" }));
    await waitFor(() => expect(updateProjectMock).toHaveBeenCalledWith({ id: "project_123", defaultViewMode: "list", defaultListGroupBy: "owner" }));
  });

});
