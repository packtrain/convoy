/**
 * @vitest-environment jsdom
 */
import { forwardRef, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { MobileCreateTaskPanel } from "./mobile-create-task-panel";

const pushMock = vi.fn();
const createTaskMock = vi.fn();
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/org/ABC",
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => {
  const CommandInput = forwardRef<HTMLInputElement>((_props, ref) => (
    <input ref={ref} />
  ));
  CommandInput.displayName = "CommandInput";

  return {
    Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CommandInput,
    CommandItem: ({
      children,
      onSelect,
    }: {
      children: ReactNode;
      onSelect?: () => void;
    }) => (
      <button type="button" onClick={onSelect}>
        {children}
      </button>
    ),
    CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/components/custom/dropdown-search-input", () => ({
  DropdownSearchInput: forwardRef<HTMLInputElement, { placeholder?: string; mode?: string }>(
    function DropdownSearchInputMock({ placeholder, mode }, ref) {
      return <input ref={ref} placeholder={placeholder} data-search-mode={mode} />;
    }
  ),
}));

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskTypeSelector: () => <button type="button">Task</button>,
}));

vi.mock("@/components/blocks/tasks/task-description-editor", () => ({
  TaskDescriptionEditor: () => <textarea aria-label="Description" />,
}));

vi.mock("@/components/blocks/tasks/task-table/cells/priority-cell", () => ({
  PriorityCell: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/components/blocks/tasks/task-table/cells/assignee-selector", () => ({
  AssigneeSelector: ({
    trigger,
    onAssigneeChange,
  }: {
    trigger: ReactNode;
    onAssigneeChange: (change: unknown) => void;
  }) => (
    <>
      {trigger}
      <button
        type="button"
        onClick={() => onAssigneeChange({ delegatedToAgentDetails: { projectAgentId: "agent_alpha" } })}
      >
        Pick agent
      </button>
    </>
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
}));

vi.mock("@/components/blocks/tasks/status-dropdown-menu", () => ({
  StatusDropdownMenu: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/components/blocks/tasks/task-table/badges", () => ({
  PriorityIcon: () => null,
  StatusIcon: () => null,
}));

const projects = [
  {
    _id: "project_abc" as Id<"projects">,
    name: "Alpha",
    alias: "ABC",
    myRole: "member",
  },
];

describe("MobileCreateTaskPanel", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
    createTaskMock.mockReset();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
  });

  test("the status and priority triggers are named with their values", () => {
    useQueryMock.mockReturnValue(projects);
    useMutationMock.mockReturnValue(createTaskMock);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /^Status: / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Priority: / })).toBeTruthy();
  });

  test("keeps the task type trigger on the title's first line when the title wraps", () => {
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="BACKLOG"
        onClose={vi.fn()}
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

  test("pads the title band evenly so the row sits centered in it", () => {
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="BACKLOG"
        onClose={vi.fn()}
      />
    );

    // One `py-*` class, not a `pt-*` paired with a divider margin that has to
    // be kept in sync by hand (OS-1913).
    const titleRow = screen.getByTestId("task-create-title-row");
    expect(titleRow.className).toContain("py-3");
    expect(titleRow.className).not.toMatch(/\bpt-\d/);
  });

  test("keeps the title's line height in the font-size class so cn() can't drop it", () => {
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="BACKLOG"
        onClose={vi.fn()}
      />
    );

    // tailwind-merge reads `text-sm` as a font-size that carries a line height,
    // so a separate `leading-6` next to it is dropped and the slot's h-10 then
    // centers the trigger on a line box the text never had (OS-1913).
    const title = screen.getByLabelText("Task title");
    expect(title.className).toContain("text-sm/6");
    expect(title.className).not.toMatch(/\bleading-6\b/);
  });

  test("leaves the title height to CSS so a width change re-wraps", () => {
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="BACKLOG"
        onClose={vi.fn()}
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
    expect(title.className).toContain("max-h-30");
  });

  test("creates a task in the active List and preserves the List in the deep link", async () => {
    createTaskMock.mockResolvedValue({ refId: "ABC-42" });
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="BACKLOG"
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Create from mobile" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_abc",
          listRef: "BACKLOG",
        })
      );
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/o/org/ABC?task=ABC-42&list=BACKLOG",
        { scroll: false }
      );
    });
  });

  test("creates in an archived current project and hides other archived ones", async () => {
    createTaskMock.mockResolvedValue({ refId: "OLD-1" });
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue([
      ...projects,
      { _id: "project_old" as Id<"projects">, name: "Old", alias: "OLD", myRole: "member", isArchived: true },
      { _id: "project_gone" as Id<"projects">, name: "Gone", alias: "GONE", myRole: "member", isArchived: true },
    ]);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="OLD"
        activeListRef={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText("Gone")).toBeNull();
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Still works" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project_old" }));
    });
  });

  test("creates the task with the label picked in the panel", async () => {
    createTaskMock.mockResolvedValue({ refId: "ABC-43" });
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="BACKLOG"
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Labelled" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick label" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createTaskMock).toHaveBeenCalled());
    expect(createTaskMock.mock.calls[0][0]).toMatchObject({ labelId: "label_1" });
  });

  test("the project picker uses the shared dropdown search row", () => {
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias={projects[0].alias}
        activeListRef={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText("Search projects…").getAttribute("data-search-mode")).toBe("command");
  });

  test("leaves view-only projects out of the picker, even as the active project", () => {
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue([
      ...projects,
      { _id: "project_vo" as Id<"projects">, name: "View only", alias: "VO", myRole: "viewer" },
    ]);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="VO"
        activeListRef={null}
        onClose={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Create from mobile" },
    });

    expect(screen.queryByText("View only")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test("drops the selected project when its create access goes away while open", () => {
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);
    const ui = () => (
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef={null}
        onClose={vi.fn()}
      />
    );

    const { rerender } = render(ui());
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Create from mobile" },
    });
    useQueryMock.mockReturnValue([{ ...projects[0], myRole: "viewer" }]);
    rerender(ui());

    const createButton = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    fireEvent.submit(createButton.closest("form")!);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  test("clears the assignment when the selected project drops out of the picker", async () => {
    const beta = { _id: "project_xyz" as Id<"projects">, name: "Beta", alias: "XYZ", myRole: "member" };
    createTaskMock.mockResolvedValue({ refId: "XYZ-1" });
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue([...projects, beta]);
    const ui = () => (
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef={null}
        onClose={vi.fn()}
      />
    );

    const { rerender } = render(ui());
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Create from mobile" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pick agent" }));
    useQueryMock.mockReturnValue([{ ...projects[0], myRole: "viewer" }, beta]);
    rerender(ui());
    fireEvent.click(screen.getByRole("button", { name: /XYZ\s*Beta/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createTaskMock).toHaveBeenCalled());
    expect(createTaskMock.mock.calls[0][0]).toMatchObject({ projectId: "project_xyz" });
    expect(createTaskMock.mock.calls[0][0]).not.toHaveProperty("delegatedToAgentId");
  });

  test("swaps the arrow for a spinner while the task is being created", async () => {
    // Never resolves, so the submitting state stays observable.
    createTaskMock.mockReturnValue(new Promise(() => {}));
    useMutationMock.mockReturnValue(createTaskMock);
    useQueryMock.mockReturnValue(projects);

    render(
      <MobileCreateTaskPanel
        open
        organizationId={"org_1" as Id<"organizations">}
        organizationSlug="org"
        activeProjectAlias="ABC"
        activeListRef="BACKLOG"
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Create from mobile" },
    });

    const submit = screen.getByRole("button", { name: "Create" });
    expect(submit.querySelector(".lucide-arrow-up")).not.toBeNull();

    fireEvent.click(submit);

    // The busy spinner replaces the arrow rather than crowding in beside it
    // (OS-1914).
    await waitFor(() => {
      expect(within(submit).getByRole("status")).toBeTruthy();
    });
    expect(submit.querySelector(".lucide-arrow-up")).toBeNull();
  });
});
