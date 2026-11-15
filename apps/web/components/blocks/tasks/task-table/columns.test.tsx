/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createColumns } from "./columns";
import {
  Priority,
  Status,
  type Task,
} from "@/lib/tasks/types";
import type { TaskExternalLink } from "@/lib/tasks/external-links";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task-1" as Task["_id"],
    clientId: "client-1",
    refNumber: 1,
    refId: "OS-1",
    name: "Buy milk",
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
    ...overrides,
    assignee: overrides.assignee ?? null,
  };
}

type PullRequestLink = Extract<TaskExternalLink, { kind: "pull_request" }>;

function createPullRequestLink(
  overrides: Partial<PullRequestLink> = {}
): PullRequestLink {
  return {
    kind: "pull_request",
    id: "pr-1",
    url: "https://github.com/contoso/contoso/pull/1",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createUrlLink(): Extract<TaskExternalLink, { kind: "url" }> {
  return {
    kind: "url",
    id: "url-1",
    url: "https://example.com",
    createdAt: 1,
    updatedAt: 1,
  };
}

function createBranchLink(): Extract<TaskExternalLink, { kind: "branch" }> {
  return {
    kind: "branch",
    id: "branch-1",
    name: "main",
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderNameCell(
  {
    showTaskRank = false,
    showResourceCount = true,
    taskOverrides,
    onNameCellClick,
  }: {
    showTaskRank?: boolean;
    showResourceCount?: boolean;
    taskOverrides?: Partial<Task>;
    onNameCellClick?: () => void;
  } = {}
) {
  const task = createTask(taskOverrides);
  const inputRefs = { current: new Map<string, HTMLInputElement>() };
  const beginInlineTaskDraft = vi.fn();
  const updateTask = vi.fn();
  const deleteTask = vi.fn();
  const focusInput = vi.fn();
  const getAdjacentId = vi.fn();

  const columns = createColumns(inputRefs, showTaskRank, [], showResourceCount);
  const nameColumn = columns.find((column) => {
    const accessorKey = "accessorKey" in column ? column.accessorKey : undefined;
    return accessorKey === "name";
  });

  if (!nameColumn || typeof nameColumn.cell !== "function") {
    throw new Error("Name column not found");
  }

  render(
    <div onClick={onNameCellClick}>
      {nameColumn.cell({
        row: { original: task } as never,
        getValue: () => task.name as never,
        table: {
          options: {
            meta: {
              updateTask,
              deleteTask,
              beginInlineTaskDraft,
              focusInput,
              getAdjacentId,
              statusFilter: "all",
              assigneeFilter: null,
              currentUserId: undefined,
              toggleExpanded: vi.fn(),
              defaultParentId: undefined,
            },
          },
        } as never,
      } as never)}
    </div>
  );

  return {
    task,
    beginInlineTaskDraft,
    updateTask,
    deleteTask,
    focusInput,
    getAdjacentId,
    input: screen.getByDisplayValue("Buy milk") as HTMLInputElement,
  };
}

function renderNameHeader({
  archiveFilter = "active",
  doneTaskCount = 2,
  onArchiveAllDone = vi.fn(),
  onCollapseAll = vi.fn(),
  canMoveClosedToBottom = true,
  onMoveClosedToBottom = vi.fn(),
  isNameColumnAutoWidth = false,
  onSetNameColumnAutoWidth = vi.fn(),
  canUpdateTask,
}: {
  archiveFilter?: "active" | "archived";
  doneTaskCount?: number;
  onArchiveAllDone?: () => void;
  onCollapseAll?: () => void;
  canMoveClosedToBottom?: boolean;
  onMoveClosedToBottom?: () => void;
  isNameColumnAutoWidth?: boolean;
  onSetNameColumnAutoWidth?: () => void;
  canUpdateTask?: boolean;
} = {}) {
  const inputRefs = { current: new Map<string, HTMLInputElement>() };
  const columns = createColumns(inputRefs);
  const nameColumn = columns.find((column) => {
    const accessorKey = "accessorKey" in column ? column.accessorKey : undefined;
    return accessorKey === "name";
  });

  if (!nameColumn || typeof nameColumn.header !== "function") {
    throw new Error("Name column header not found");
  }

  render(
    nameColumn.header({
      table: {
        options: {
          meta: {
            archiveFilter,
            doneTaskCount,
            onArchiveAllDone,
            onCollapseAll,
            canMoveClosedToBottom,
            onMoveClosedToBottom,
            isNameColumnAutoWidth,
            onSetNameColumnAutoWidth,
            canUpdateTask,
          },
        },
      },
    } as never)
  );

  return { onArchiveAllDone, onMoveClosedToBottom, onSetNameColumnAutoWidth };
}

describe("createColumns", () => {
  afterEach(() => {
    cleanup();
  });

  test("hides the task rank by default", () => {
    renderNameCell();

    expect(screen.queryByText("0|a:")).toBeNull();
  });

  test("shows the raw task rank before the title input when enabled", () => {
    const { input } = renderNameCell({ showTaskRank: true });
    const rankLabel = screen.getByText("0|a:");

    expect(rankLabel).toBeDefined();
    expect(
      rankLabel.compareDocumentPosition(input.parentElement as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("pressing Enter on an existing task starts a local draft instead of creating a backend task", () => {
    const { task, beginInlineTaskDraft, input } = renderNameCell();

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(beginInlineTaskDraft).toHaveBeenCalledWith({
      afterClientId: task.clientId,
      parentId: null,
    });
  });

  test("pressing Backspace on an empty task still deletes it and focuses the previous row", () => {
    const { task, deleteTask, focusInput, getAdjacentId, input } = renderNameCell({
      showTaskRank: true,
    });

    getAdjacentId.mockReturnValue("task-0");

    fireEvent.change(input, { target: { value: "" } });
    input.focus();
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(deleteTask).toHaveBeenCalledWith(task._id);
    expect(focusInput).toHaveBeenCalledWith("task-0", "end");
  });

  test("renders canceled task titles with the closed-task styling", () => {
    const { input } = renderNameCell({
      taskOverrides: { status: Status.CANCELED },
    });

    expect(input.className).toContain("text-muted-foreground");
    expect(input.className).toContain("line-through");
  });

  test("renders the task checkbox as checked for canceled tasks", () => {
    renderNameCell({
      taskOverrides: { status: Status.CANCELED },
    });

    expect(screen.getByRole("checkbox").getAttribute("data-state")).toBe("checked");
  });

  test.each([
    [false, "false"],
    [true, "true"],
  ])("the subtask toggle is a named disclosure button (expanded: %s)", (isExpanded, ariaExpanded) => {
    renderNameCell({ taskOverrides: { hasChildren: true, isExpanded } as Partial<Task> });

    expect(screen.getByRole("button", { name: "Subtasks" }).getAttribute("aria-expanded")).toBe(ariaExpanded);
  });

  test("the resource count is an image named with the count", () => {
    renderNameCell({ taskOverrides: { attachmentCount: 2, artifactCount: 1 } });

    expect(screen.getByRole("img", { name: "3 resources" })).toBeTruthy();
  });

  test("a single resource is named in the singular", () => {
    renderNameCell({ taskOverrides: { attachmentCount: 1 } });

    expect(screen.getByRole("img", { name: "1 resource" })).toBeTruthy();
  });

  test("shows the resource count when the task has attachments or artifacts", () => {
    renderNameCell({ taskOverrides: { attachmentCount: 2, artifactCount: 1 } });

    expect(screen.getByRole("img", { name: /resources?$/ }).textContent).toBe("3");
  });

  test("spaces the resource count away from trailing task metadata", () => {
    renderNameCell({
      taskOverrides: {
        attachmentCount: 1,
        childCount: 1,
        completedChildCount: 0,
      } as Partial<Task>,
    });

    expect(
      screen.getByRole("img", { name: /resources?$/ }).parentElement?.className
    ).toContain("mr-3");
  });

  test("shows the resource count for artifacts alone", () => {
    renderNameCell({ taskOverrides: { artifactCount: 2 } });

    expect(screen.getByRole("img", { name: /resources?$/ }).textContent).toBe("2");
  });

  test("hides the resource count when the task has no resources", () => {
    renderNameCell();

    expect(screen.queryByRole("img", { name: /resources?$/ })).toBeNull();
  });

  test("hides the resource count when disabled by the project setting", () => {
    renderNameCell({
      showResourceCount: false,
      taskOverrides: { attachmentCount: 2, artifactCount: 1 },
    });

    expect(screen.queryByRole("img", { name: /resources?$/ })).toBeNull();
  });

  test("renders PR links after the resource count without triggering the task row", () => {
    const pullRequest = createPullRequestLink({
      title: "Render task PR icon",
    });
    const onTaskRowClick = vi.fn();
    renderNameCell({
      taskOverrides: {
        attachmentCount: 1,
        externalLinks: [pullRequest],
      },
      onNameCellClick: onTaskRowClick,
    });
    const resourceCount = screen.getByRole("img", { name: /resources?$/ });
    const link = screen.getByRole("link", {
      name: "Open pull request: Render task PR icon",
    });
    expect(
      resourceCount.compareDocumentPosition(link) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(link.getAttribute("href")).toBe(pullRequest.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.firstElementChild?.getAttribute("class")).toContain(
      "text-success"
    );

    fireEvent.click(link);
    expect(onTaskRowClick).not.toHaveBeenCalled();
  });

  test("renders multiple PR links in stored order and ignores other link kinds", () => {
    const firstPullRequest = createPullRequestLink({
      id: "pr-1",
      identifier: "#1",
    });
    const secondPullRequest = createPullRequestLink({
      id: "pr-2",
      url: "https://github.com/contoso/contoso/pull/2",
      identifier: "#2",
    });

    renderNameCell({
      taskOverrides: {
        externalLinks: [
          firstPullRequest,
          createBranchLink(),
          secondPullRequest,
        ],
      },
    });

    const links = screen.getAllByRole("link", {
      name: /Open pull request:/,
    });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      firstPullRequest.url,
      secondPullRequest.url,
    ]);
    expect(screen.queryByRole("link", { name: /main/ })).toBeNull();
  });

  test("renders no PR link when the task has no pull-request external link", () => {
    renderNameCell({
      taskOverrides: {
        externalLinks: [createUrlLink()],
      },
    });

    expect(
      screen.queryByRole("link", { name: /Open pull request:/ })
    ).toBeNull();
  });

  test("visually hides compact metadata headers until the wide table breakpoint", () => {
    const inputRefs = { current: new Map<string, HTMLInputElement>() };
    const columns = createColumns(inputRefs);

    const metadataHeaders = [
      ["status", "Status"],
      ["priority", "Priority"],
      ["assignee", "Assignee"],
      ["dueDate", "Due date"],
    ] as const;

    const renderedHeaders = metadataHeaders.map(([accessorKey, label]) => {
      const column = columns.find((candidate) => {
        const candidateAccessorKey =
          "accessorKey" in candidate ? candidate.accessorKey : undefined;
        return candidateAccessorKey === accessorKey;
      });

      if (!column || typeof column.header !== "function") {
        throw new Error(`${label} header not found`);
      }

      return {
        label,
        node: column.header({} as never),
      };
    });

    render(
      <>
        {renderedHeaders.map((header) => (
          <div key={header.label}>{header.node}</div>
        ))}
      </>
    );

    for (const [accessorKey, label] of metadataHeaders) {
      const header = screen.getByText(label);
      expect(header.className).toContain("sr-only");
      // Icon-only columns keep their label hidden at every width.
      const isIconOnly = accessorKey === "priority" || accessorKey === "assignee";
      expect(header.className.includes("@4xl:not-sr-only")).toBe(!isIconOnly);
    }
  });

  test.each([
    ["priority", "lucide-signal"],
    ["assignee", "lucide-user-round"],
  ] as const)("shows an icon in the %s header", (accessorKey, iconClass) => {
    const inputRefs = { current: new Map<string, HTMLInputElement>() };
    const column = createColumns(inputRefs).find(
      (candidate) => "accessorKey" in candidate && candidate.accessorKey === accessorKey
    );
    if (!column || typeof column.header !== "function") {
      throw new Error(`${accessorKey} header not found`);
    }

    const { container } = render(<>{column.header({} as never)}</>);

    const icon = container.querySelector(`svg.${iconClass}`);
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  test("omits hidden configurable columns", () => {
    const inputRefs = { current: new Map<string, HTMLInputElement>() };
    const columns = createColumns(inputRefs, false, ["priority", "assignee"]);

    const accessorKeys = columns.map((column) =>
      "accessorKey" in column ? column.accessorKey : column.id
    );

    expect(accessorKeys).toContain("name");
    expect(accessorKeys).toContain("status");
    expect(accessorKeys).toContain("dueDate");
    expect(accessorKeys).toContain("tags");
    expect(accessorKeys).not.toContain("priority");
    expect(accessorKeys).not.toContain("assignee");
  });

  test("renders task header actions behind a hover-revealed chevron menu", async () => {
    const { onArchiveAllDone, onMoveClosedToBottom } = renderNameHeader();

    const trigger = screen.getByRole("button", {
      name: "Task name column actions",
    });
    expect(trigger.className).toContain("opacity-0");
    expect(trigger.className).toContain("focus-visible:opacity-100");
    expect(trigger.className).toContain("ml-auto");
    expect(trigger.className).toContain("group-hover/task-name-header:opacity-100");

    fireEvent.pointerDown(trigger);

    await screen.findByText("Archive done");
    const moveClosedItem = screen.getByText("Closed to bottom");
    expect(screen.getAllByText("Shift")).toHaveLength(2);
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("B")).toBeDefined();

    fireEvent.click(moveClosedItem.closest("[role='menuitem']") ?? moveClosedItem);
    expect(onMoveClosedToBottom).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(trigger);
    const reopenedArchiveItem = await screen.findByText("Archive done");
    fireEvent.click(reopenedArchiveItem);
    expect(onArchiveAllDone).toHaveBeenCalledTimes(1);
  });

  test("read-only viewers get only the view items in the header menu", async () => {
    renderNameHeader({ canUpdateTask: false });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Task name column actions" })
    );

    await screen.findByText("Collapse all");
    expect(screen.getByText("Auto width")).toBeTruthy();
    for (const label of ["Archive done", "Closed to bottom", "Move active to"]) {
      expect(screen.queryByText(label), label).toBeNull();
    }
  });

  test("triggers auto-width from the header menu when in fixed mode", async () => {
    const { onSetNameColumnAutoWidth } = renderNameHeader({
      isNameColumnAutoWidth: false,
    });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Task name column actions" })
    );

    const autoWidthItem = await screen.findByText("Auto width");
    fireEvent.click(autoWidthItem.closest("[role='menuitem']") ?? autoWidthItem);
    expect(onSetNameColumnAutoWidth).toHaveBeenCalledTimes(1);
  });

  test("disables the auto-width menu item when already in auto mode", async () => {
    renderNameHeader({ isNameColumnAutoWidth: true });

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Task name column actions" })
    );

    const autoWidthItem = (await screen.findByText("Auto width")).closest(
      "[role='menuitem']"
    );
    // Radix marks disabled items with data-disabled (and pointer-events-none in
    // the browser); we assert the disabled state rather than the click being
    // swallowed, since jsdom dispatches clicks regardless of pointer-events.
    expect(autoWidthItem?.getAttribute("data-disabled")).not.toBeNull();
  });
});

test("root names have no group offset", () => {
 renderNameCell();
 const name = document.querySelector(".flex.items-center.w-full") as HTMLElement;
 expect(name.style.paddingLeft).toBe("0px");
});

test("task completion uses a native checkbox without mount-time control updates", () => {
 renderNameCell();
 expect(screen.getByRole("checkbox").tagName).toBe("INPUT");
});

test("native task completion updates status without opening details", () => {
 const onNameCellClick = vi.fn();
 const {task,updateTask} = renderNameCell({onNameCellClick});
 fireEvent.click(screen.getByRole("checkbox"));
 expect(updateTask).toHaveBeenCalledExactlyOnceWith(task._id, {status: Status.DONE});
 expect(onNameCellClick).not.toHaveBeenCalled();
});

test("task header Collapse all invokes the view action even in archived lists", async () => {
  const onCollapseAll = vi.fn();
  renderNameHeader({ archiveFilter: "archived", onCollapseAll });
  fireEvent.pointerDown(screen.getByRole("button", { name: "Task name column actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Collapse all" }));
  expect(onCollapseAll).toHaveBeenCalledTimes(1);
});

test.each([Status.DONE, Status.CANCELED])("%s completion keeps its solid fill in dark mode", (status) => {
  renderNameCell({ taskOverrides: { status } });
  const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  expect(checkbox.classList.contains("checked:bg-primary")).toBe(true);
  expect(checkbox.classList.contains("dark:checked:bg-primary")).toBe(true);
});

describe("read-only viewer cells", () => {
  afterEach(cleanup);

  function renderReadOnlyCell(columnId: string, taskOverrides: Partial<Task> = {}) {
    const task = createTask(taskOverrides);
    const updateTask = vi.fn();
    const deleteTask = vi.fn();
    const columns = createColumns({ current: new Map<string, HTMLInputElement>() });
    const column = columns.find((candidate) =>
      ("accessorKey" in candidate ? candidate.accessorKey : candidate.id) === columnId
    );
    if (!column || typeof column.cell !== "function") {
      throw new Error(`${columnId} column not found`);
    }
    render(
      <>
        {column.cell({
          row: { original: task } as never,
          getValue: () => task[columnId as keyof Task] as never,
          table: {
            options: {
              meta: {
                updateTask,
                deleteTask,
                beginInlineTaskDraft: vi.fn(),
                focusInput: vi.fn(),
                getAdjacentId: vi.fn(),
                statusFilter: "all",
                assigneeFilter: null,
                allowedStatuses: [Status.TODO, Status.DONE],
                projectLabels: [],
                projectLabelsById: new Map(),
                canUpdateTask: false,
              },
            },
          } as never,
        } as never)}
      </>
    );
    return { task, updateTask, deleteTask };
  }

  test("name renders as text with a read-only completion checkbox and type", () => {
    const { updateTask } = renderReadOnlyCell("name");

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Buy milk")).toBeTruthy();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    fireEvent.click(checkbox);
    expect(updateTask).not.toHaveBeenCalled();
    // The task ref stays a copy button; the type selector menu is gone.
    expect(screen.queryAllByRole("button").filter((button) => button.hasAttribute("aria-haspopup"))).toEqual([]);
  });

  test.each(["status", "priority", "label"])("%s renders its value without a menu trigger", (columnId) => {
    renderReadOnlyCell(columnId, { priority: Priority.HIGH });
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("due date picker is disabled", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    renderReadOnlyCell("dueDate", { dueDate: Date.UTC(2026, 9, 27) });
    for (const control of [...screen.getAllByRole("textbox"), ...screen.getAllByRole("button")]) {
      expect((control as HTMLInputElement | HTMLButtonElement).disabled).toBe(true);
    }
    vi.unstubAllGlobals();
  });

  test("assignee trigger is disabled", () => {
    renderReadOnlyCell("assignee");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("metadata cell layout (OS-2256)", () => {
  afterEach(cleanup);

  function renderCell(columnId: string, taskOverrides: Partial<Task> = {}, hidden: Parameters<typeof createColumns>[2] = []) {
    const task = createTask(taskOverrides);
    const updateTask = vi.fn();
    const columns = createColumns({ current: new Map<string, HTMLInputElement>() }, false, hidden);
    const column = columns.find((candidate) =>
      ("accessorKey" in candidate ? candidate.accessorKey : candidate.id) === columnId
    );
    if (!column || typeof column.cell !== "function") {
      throw new Error(`${columnId} column not found`);
    }
    const { container } = render(
      <>
        {column.cell({
          row: { original: task } as never,
          getValue: () => task[columnId as keyof Task] as never,
          table: {
            options: {
              meta: {
                updateTask,
                deleteTask: vi.fn(),
                beginInlineTaskDraft: vi.fn(),
                focusInput: vi.fn(),
                getAdjacentId: vi.fn(),
                statusFilter: "all",
                assigneeFilter: null,
                allowedStatuses: [Status.TODO, Status.DONE],
                projectLabels: [],
                projectLabelsById: new Map(),
                canUpdateTask: true,
              },
            },
          } as never,
        } as never)}
      </>
    );
    return { container, updateTask, task };
  }

  function getHeaderText(columnId: string) {
    const columns = createColumns({ current: new Map<string, HTMLInputElement>() });
    const column = columns.find((candidate) =>
      ("accessorKey" in candidate ? candidate.accessorKey : candidate.id) === columnId
    );
    const header = column?.header;
    const { container } = render(<>{typeof header === "function" ? header({} as never) : header}</>);
    return container.textContent;
  }

  test("the due date header uses sentence case", () => {
    expect(getHeaderText("dueDate")).toBe("Due date");
  });

  test("status shows an icon and a plain label, not a bordered chip", () => {
    renderCell("status", { status: Status.IN_PROGRESS });
    const label = screen.getByText(Status.IN_PROGRESS);
    expect(label.closest(".border")).toBeNull();
  });

  test("priority is icon-only and an empty priority shows an em dash", () => {
    renderCell("priority", { priority: Priority.HIGH });
    expect(screen.getByRole("button").textContent).toBe("Priority: High");
    cleanup();
    renderCell("priority", { priority: Priority.NONE });
    expect(screen.getByText("—")).toBeTruthy();
  });

  test("assignee is avatar-only and an unassigned task shows an em dash", () => {
    renderCell("assignee");
    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toBe("—Assignee: No assignee");
  });

  test.each<[string, Partial<Task>]>([
    ["label", {}],
    ["tags", { tags: [] }],
  ])("an empty %s cell shows an em dash", (columnId, overrides) => {
    renderCell(columnId, overrides);
    expect(screen.getByText("—")).toBeTruthy();
  });

  test("tags cell opens a tag editor that saves through updateTask", async () => {
    const { updateTask, task } = renderCell("tags", { tags: ["ui"] });
    fireEvent.click(screen.getByRole("button", { name: "Tags: ui" }));
    const input = await screen.findByLabelText("Task tags");
    fireEvent.change(input, { target: { value: "docs" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(updateTask).toHaveBeenCalledWith(task._id, { tags: ["ui", "docs"] });
  });
});
