/**
 * @vitest-environment jsdom
 */
import { forwardRef, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { CreateTaskDialog } from "./create-task-dialog";

const pushMock = vi.fn();
const createTaskMock = vi.fn();
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/acme/OS",
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/components/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/dialog")>()),
  TitledDialog: ({
    open,
    title,
    description,
    children,
  }: {
    open: boolean;
    title?: string;
    description?: string;
    children: ReactNode;
  }) =>
    open ? (
      <div>
        {title ? <h1>{title}</h1> : null}
        {description ? <p>{description}</p> : null}
        {children}
      </div>
    ) : null,
}));

vi.mock("@/components/custom/action-button", () => ({
  ActionButton: ({
    children,
    busy,
    disabled,
  }: {
    children: ReactNode;
    busy?: boolean;
    disabled?: boolean;
  }) => (
    <button type="submit" disabled={busy || disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    type = "button",
    disabled,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    type?: "button" | "submit";
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
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
}));

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskTypeSelector: ({
    taskType,
    onTaskTypeChange,
  }: {
    taskType: { name: string };
    onTaskTypeChange: (taskType: {
      key: string;
      name: string;
      icon: "Sparkles";
      color: string;
      order: number;
      isSystem: true;
    }) => void;
  }) => (
    <div>
      <button type="button">{taskType.name}</button>
      <button
        type="button"
        onClick={() =>
          onTaskTypeChange({
            key: "feature",
            name: "Feature",
            icon: "Sparkles",
            color: "#22c55e",
            order: 2,
            isSystem: true,
          })
        }
      >
        Select Feature Type
      </button>
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-description-editor", () => ({
  TaskDescriptionEditor: ({
    value,
    onSave,
    editorContentClassName,
  }: {
    value: string | null;
    onSave: (value: string | null) => void;
    editorContentClassName?: string;
  }) => (
    <textarea
      aria-label="Description"
      data-editor-content-class-name={editorContentClassName}
      value={value ?? ""}
      onChange={(event) => onSave(event.target.value || null)}
    />
  ),
}));

vi.mock("@/components/blocks/tasks/task-table/cells/priority-cell", () => ({
  PriorityCell: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/components/blocks/tasks/task-table/cells/assignee-selector", () => ({
  AssigneeSelector: ({ onAssigneeChange }: { onAssigneeChange: (change: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onAssigneeChange({ delegatedToAgentDetails: { projectAgentId: "agent_alpha" } })}
    >
      Assignee
    </button>
  ),
  TaskAssigneeAvatar: () => null,
}));

vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({ labels: [], labelsById: new Map(), isLoading: false }),
}));

vi.mock("@/components/blocks/tasks/task-label-picker", () => ({
  TaskLabelPicker: ({ onChange }: { onChange: (labelId: string | null) => void }) => (
    <button type="button" onClick={() => onChange("label_1")}>
      Pick label
    </button>
  ),
  TaskLabelChip: () => null,
}));

vi.mock("@/components/blocks/tasks/status-dropdown-menu", () => ({
  StatusDropdownMenu: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/components/blocks/tasks/task-table/badges", () => ({
  PriorityIcon: ({ priority }: { priority: string }) => <span>{priority}</span>,
  StatusIcon: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/components/lingua-time/datetime-picker", () => ({
  DateTimePicker: () => <input aria-label="Due date" />,
}));

vi.mock("@/components/ui/command", () => {
  const MockCommandInput = forwardRef<
    HTMLInputElement,
    {
      value?: string;
      onValueChange?: (value: string) => void;
      placeholder?: string;
    }
  >(({ value, onValueChange, placeholder }, ref) => (
    <input
      ref={ref}
      aria-label={placeholder ?? "Command input"}
      value={value ?? ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    />
  ));

  MockCommandInput.displayName = "MockCommandInput";

  return {
    Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandInput: MockCommandInput,
    CommandItem: ({
      children,
      onSelect,
    }: {
      children: ReactNode;
      onSelect?: () => void;
    }) => (
      <button type="button" onClick={() => onSelect?.()}>
        {children}
      </button>
    ),
    CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

const projects = [
  {
    _id: "project_abc" as Id<"projects">,
    name: "Alpha",
    alias: "ABC",
    myRole: "member",
  },
  {
    _id: "project_xyz" as Id<"projects">,
    name: "Beta",
    alias: "XYZ",
    myRole: "member",
  },
];

const dialog = {
  isOpen: true,
  close: vi.fn(),
};

function isOrganizationProjectsArgs(
  args: unknown
): args is { organizationId: Id<"organizations"> } {
  return (
    typeof args === "object" &&
    args !== null &&
    "organizationId" in args &&
    !("projectId" in args)
  );
}

describe("CreateTaskDialog", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
    createTaskMock.mockReset();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    dialog.close.mockReset();
  });

  test("preselects the active project", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    expect(
      screen.getAllByRole("button", { name: /ABC\s*Alpha/i })[0].textContent
    ).toContain("ABC");
    expect(
      screen.getAllByRole("button", { name: /ABC\s*Alpha/i })[0].textContent
    ).toContain("Alpha");
  });

  test("the status and priority triggers are named with their values", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      isOrganizationProjectsArgs(args) ? projects : []
    );
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    expect(screen.getByRole("button", { name: /^Status: / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Priority: / })).toBeTruthy();
  });

  test("requires project selection when opened outside a project route", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias={null}
      />
    );

    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Document flow" },
    });

    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: /XYZ\s*Beta/i })[0]);

    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  test("leaves view-only projects out of the picker, even as the active project", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      isOrganizationProjectsArgs(args)
        ? [{ ...projects[0], myRole: "viewer" }, projects[1]]
        : []
    );
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Document flow" },
    });

    expect(screen.queryByRole("button", { name: /ABC\s*Alpha/i })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getAllByRole("button", { name: /XYZ\s*Beta/i })).not.toHaveLength(0);
  });

  test("drops the selected project when its create access goes away while open", () => {
    let currentProjects = projects;
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      isOrganizationProjectsArgs(args) ? currentProjects : []
    );
    useMutationMock.mockReturnValue(createTaskMock);
    const ui = () => (
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    const { rerender } = render(ui());
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Document flow" },
    });
    currentProjects = [{ ...projects[0], myRole: "viewer" }, projects[1]];
    rerender(ui());

    const createButton = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    fireEvent.submit(createButton.closest("form")!);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  test("clears the assignment when the selected project drops out of the picker", async () => {
    let currentProjects = projects;
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      isOrganizationProjectsArgs(args) ? currentProjects : []
    );
    createTaskMock.mockResolvedValue({ refId: "XYZ-1" });
    useMutationMock.mockReturnValue(createTaskMock);
    const ui = () => (
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    const { rerender } = render(ui());
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Document flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
    currentProjects = [{ ...projects[0], myRole: "viewer" }, projects[1]];
    rerender(ui());
    fireEvent.click(screen.getAllByRole("button", { name: /XYZ\s*Beta/i }).at(-1)!);
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

    await waitFor(() => expect(createTaskMock).toHaveBeenCalled());
    expect(createTaskMock.mock.calls[0][0]).toMatchObject({ projectId: "project_xyz" });
    expect(createTaskMock.mock.calls[0][0]).not.toHaveProperty("delegatedToAgentId");
  });

  test("keeps the task type trigger on the title's first line when the title wraps", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    const titleRow = screen.getByTestId("task-create-title-row");
    expect(titleRow.className).toContain("items-start");
    expect(titleRow.className).not.toContain("items-center");

    // The trigger sits in a slot as tall as the title's first line box, so a
    // one-line title still renders it centered on that line.
    const typeSlot = screen.getByTestId("task-create-type-slot");
    expect(typeSlot.className).toContain("h-10");
    expect(typeSlot.className).toContain("items-center");
  });

  test("leaves the title height to CSS so a width change re-wraps", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    const title = screen.getByLabelText("Task title");
    fireEvent.change(title, {
      target: { value: "A title long enough to wrap onto a second line" },
    });

    // A JS-measured inline height freezes at the width it was measured on, so
    // the next re-wrap gets cropped (OS-1874).
    expect((title as HTMLTextAreaElement).style.height).toBe("");
    expect(title.className).toContain("field-sizing-content");
    expect(title.className).toContain("max-h-40");
  });

  test("keeps popup description paragraphs at compact text size", () => {
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    const description = screen.getByLabelText("Description");
    const editorContentClassName = description.getAttribute(
      "data-editor-content-class-name"
    );

    expect(editorContentClassName).toContain("[&_.tiptap.ProseMirror_p]:!text-sm");
    expect(editorContentClassName).toContain("[&_.tiptap.ProseMirror_p]:!leading-6");
  });

  test("creates a task in the selected project and navigates to its deep link", async () => {
    createTaskMock.mockResolvedValue({
      taskId: "task_123" as Id<"tasks">,
      projectId: "project_xyz" as Id<"projects">,
      organizationId: "org_1" as Id<"organizations">,
      projectAlias: "XYZ",
      refNumber: 42,
      refId: "XYZ-42",
    });
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="SPRINT-1"
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /XYZ\s*Beta/i })[0]);
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Tighten add task modal #ux #QA" },
    });
    const createButton = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(createButton.disabled).toBe(false);
    });

    const form = createButton.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_xyz",
          name: "Tighten add task modal",
          taskTypeKey: "task",
          priority: "None",
          status: "To Do",
          tags: ["ux", "QA"],
        })
      );
    });

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledTimes(1);
    });

    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("listRef");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/o/org/XYZ?task=XYZ-42", {
        scroll: false,
      });
    });

    expect(dialog.close).toHaveBeenCalled();
  });

  test("creates the task with the label picked in the dialog", async () => {
    createTaskMock.mockResolvedValue({ refId: "ABC-1" });
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      isOrganizationProjectsArgs(args) ? projects : []
    );
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Labelled task" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick label" }));
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

    await waitFor(() => expect(createTaskMock).toHaveBeenCalled());
    expect(createTaskMock.mock.calls[0][0]).toMatchObject({ projectId: "project_abc", labelId: "label_1" });
  });

  test("creates a task in the active List and preserves the List in the deep link", async () => {
    createTaskMock.mockResolvedValue({
      taskId: "task_123" as Id<"tasks">,
      projectId: "project_abc" as Id<"projects">,
      organizationId: "org_1" as Id<"organizations">,
      projectAlias: "ABC",
      refNumber: 42,
      refId: "ABC-42",
    });
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="SPRINT-1"
      />
    );

    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Keep task in sprint" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_abc",
          listRef: "SPRINT-1",
        })
      );
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/o/org/ABC?task=ABC-42&list=SPRINT-1",
        { scroll: false }
      );
    });
  });

  test("infers the task type from a trailing title tag when the selector is default", async () => {
    createTaskMock.mockResolvedValue({
      taskId: "task_123" as Id<"tasks">,
      projectId: "project_abc" as Id<"projects">,
      organizationId: "org_1" as Id<"organizations">,
      projectAlias: "ABC",
      refNumber: 42,
      refId: "ABC-42",
    });
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Fix sign in #auth #bug" },
    });
    const createButton = screen.getByRole("button", { name: "Create" });
    fireEvent.submit(createButton.closest("form")!);

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Fix sign in",
          taskTypeKey: "bug",
          tags: ["auth"],
        })
      );
    });
  });

  test("keeps an explicit non-default type selection over inferred title tag", async () => {
    createTaskMock.mockResolvedValue({
      taskId: "task_123" as Id<"tasks">,
      projectId: "project_abc" as Id<"projects">,
      organizationId: "org_1" as Id<"organizations">,
      projectAlias: "ABC",
      refNumber: 42,
      refId: "ABC-42",
    });
    useQueryMock.mockImplementation((_query: unknown, args: unknown) => {
      if (isOrganizationProjectsArgs(args)) {
        return projects;
      }

      return [];
    });
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <CreateTaskDialog
        dialog={dialog}
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Feature Type" }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Fix sign in #bug" },
    });
    const createButton = screen.getByRole("button", { name: "Create" });
    fireEvent.submit(createButton.closest("form")!);

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Fix sign in",
          taskTypeKey: "feature",
          tags: [],
        })
      );
    });
  });
});
