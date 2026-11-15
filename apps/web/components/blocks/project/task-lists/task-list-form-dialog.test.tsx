/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskListFormDialog } from "./task-list-form-dialog";
import type { TaskListItem } from "./task-list-types";

const createListMock = vi.fn();
const updateListMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : "project-admin"),
  useMutation: (fn: unknown) =>
    getFunctionName(fn as Parameters<typeof getFunctionName>[0]) ===
    getFunctionName(api.tasks.lists.create)
      ? createListMock
      : updateListMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix Select is not pointer-drivable in jsdom; a native <select> keeps the
// value contract (and the trigger's accessible name) testable.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="Default view"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectLabel: () => null,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const projectId = "project_123" as Id<"projects">;

const listFixture: TaskListItem = {
  type: "list",
  _id: "list_1" as Id<"taskLists">,
  _creationTime: 1,
  projectId,
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

function renderDialog(list?: TaskListItem) {
  return render(
    <TaskListFormDialog
      projectId={projectId}
      list={list}
      open
      onOpenChange={vi.fn()}
    />
  );
}

describe("TaskListFormDialog default view selector", () => {
  afterEach(() => {
    cleanup();
    createListMock.mockReset();
    updateListMock.mockReset();
    createListMock.mockResolvedValue("list_new");
    updateListMock.mockResolvedValue(null);
  });

  test("keeps Name and Key editable alongside the new selector", () => {
    renderDialog(listFixture);

    expect(screen.getByLabelText("Name")).toBeDefined();
    expect(screen.getByLabelText("Key")).toBeDefined();
    expect(screen.getByLabelText("Default view")).toBeDefined();
  });

  test("shows Project default for a List with no override", () => {
    renderDialog(listFixture);

    expect(
      (screen.getByLabelText("Default view") as HTMLSelectElement).value
    ).toBe("inherit");
  });

  test("shows the stored override for an overridden List", () => {
    renderDialog({
      ...listFixture,
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
    });

    expect(
      (screen.getByLabelText("Default view") as HTMLSelectElement).value
    ).toBe("board:label");
  });

  test("omits the default view field when it did not change", async () => {
    renderDialog({ ...listFixture, defaultViewMode: "board" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Omitted rather than resent, so a rename can't rewrite the override.
    await waitFor(() => {
      expect(updateListMock).toHaveBeenCalled();
    });
    expect(updateListMock.mock.calls[0][0]).not.toHaveProperty(
      "defaultViewMode"
    );
  });

  test("creating with a Board option passes both fields in one call", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Sprint 20" },
    });
    fireEvent.change(screen.getByLabelText("Default view"), {
      target: { value: "board:priority" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createListMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          name: "Sprint 20",
          defaultViewMode: "board",
          defaultBoardGroupBy: "priority",
        })
      );
    });
  });

  test("choosing Project default on an overridden List clears the override", async () => {
    renderDialog({
      ...listFixture,
      defaultViewMode: "board",
      defaultBoardGroupBy: "label",
    });

    fireEvent.change(screen.getByLabelText("Default view"), {
      target: { value: "inherit" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateListMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: listFixture._id,
          defaultViewMode: null,
        })
      );
    });
  });
});
