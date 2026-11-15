/**
 * @vitest-environment jsdom
 */
import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TaskSectionRow } from "@/lib/tasks/types";
import { TaskTable } from "./index";

afterEach(cleanup);

vi.mock("./hooks/use-task-table-virtualizer", () => ({
  getRowHeight: () => 44,
  useTaskTableVirtualizer: (rows: unknown[]) => ({
    getVirtualItems: () => rows.map((_, index) => ({ index, key: index, start: index * 44, size: 44 })),
    getTotalSize: () => rows.length * 44,
    isScrolling: false,
    scrollToIndex: vi.fn(),
    measure: vi.fn(),
  }),
}));
vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({ labels: [], labelsById: new Map() }),
}));
vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: () => ({ canUseThreads: true }),
}));
vi.mock("@/components/blocks/tasks/use-resource-task-drop", () => ({
  useResourceTaskDrop: () => ({ hasResourceDrag: () => false, dropResource: vi.fn() }),
}));

function taskDrag() {
  const data: Record<string, string> = { "text/plain": "task-1", "application/x-multi-select": "false" };
  return { types: Object.keys(data), getData: (type: string) => data[type] ?? "", dropEffect: "none" };
}

test("a section's Add task footer accepts task drops and hands them to the group", () => {
  const onGroupDrop = vi.fn(() => true);
  const rows: TaskSectionRow[] = [
    { rowType: "section", kind: "group-header", clientId: "group:section:s1", height: 44 },
    { rowType: "section", kind: "group-add", clientId: "group-add:section:s1", height: 44 },
  ];
  const props = new Proxy(
    {
      tasks: rows,
      taskTree: [],
      inputRefs: { current: new Map() },
      rowSelection: {},
      sorting: [],
      statusFilter: "all",
      assigneeFilter: null,
      selectedIds: new Set<string>(),
      isDndEnabled: true,
      addTaskValue: "",
      onGroupDrop,
      renderSectionRow: (row: TaskSectionRow) => <div>{row.clientId}</div>,
    } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : vi.fn()) },
  ) as unknown as ComponentProps<typeof TaskTable>;
  render(<TaskTable {...props} />);

  const footer = screen.getByText("group-add:section:s1");
  const dataTransfer = taskDrag();
  expect(fireEvent.dragOver(footer, { dataTransfer })).toBe(false);
  fireEvent.drop(footer, { dataTransfer });
  expect(onGroupDrop).toHaveBeenCalledWith(["task-1"], "group-add:section:s1", expect.any(String));
});
