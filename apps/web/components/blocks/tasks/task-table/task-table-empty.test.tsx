/**
 * @vitest-environment jsdom
 */
import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

function renderTable(overrides: Record<string, unknown> = {}) {
  const props = new Proxy(
    {
      tasks: [],
      taskTree: [],
      inputRefs: { current: new Map() },
      rowSelection: {},
      sorting: [],
      statusFilter: "all",
      assigneeFilter: null,
      selectedIds: new Set<string>(),
      isDndEnabled: false,
      addTaskValue: "",
      allowAddTask: true,
      defaultParentId: undefined,
      ...overrides,
    } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : vi.fn()) },
  ) as unknown as ComponentProps<typeof TaskTable>;
  return render(<TaskTable {...props} />);
}

test("an empty list shows only the add row, no empty state", () => {
  renderTable();
  expect(screen.queryByRole("heading", { name: "No tasks" })).toBeNull();
});

test("loading the next page shows an ellipsis", () => {
  renderTable({ isLoadingMore: true });
  expect(screen.getByText("Loading more…")).toBeTruthy();
});
