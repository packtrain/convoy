// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { createDefaultTask } from "@/lib/tasks/defaults";
import { buildTaskTree, flattenTree } from "@/lib/tasks/tree";
import type { Task, TaskSectionRow } from "@/lib/tasks/types";
import { buildBoardTaskColumns, NO_SECTION_COLUMN_ID } from "./groups";
import { ProjectRole } from "@/lib/authz/roles";
import { useTaskGrouping } from "./use-task-grouping";
import { useSectionBoard } from "./section-board";

const mocks = vi.hoisted(() => ({
  role: "project-admin" as string,
  headerStyle: "compact",
  mutate: vi.fn(() => Promise.resolve()),
  optimistic: undefined as undefined | ((store: unknown, args: unknown) => void),
}));
vi.mock("convex/react", () => ({
  useMutation: () =>
    Object.assign(mocks.mutate, {
      withOptimisticUpdate: (update: typeof mocks.optimistic) => {
        mocks.optimistic = update;
        return mocks.mutate;
      },
    }),
}));
afterEach(() => {
  mocks.mutate.mockClear();
  mocks.optimistic = undefined;
  mocks.headerStyle = "compact";
  mocks.role = ProjectRole.PROJECT_ADMIN;
});
const design = { _id: "design" as Id<"taskSections">, name: "Design", color: "#ef4444", rank: "0|100000:" };
const build = { _id: "build" as Id<"taskSections">, name: "Build", color: null, rank: "0|200000:" };
vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: () => ({ myRole: mocks.role }),
}));
vi.mock("@/lib/tasks/hooks/use-assignable-task-assignees", () => ({
  useAssignableTaskAssignees: () => ({ users: [], projectAgents: [] }),
}));
vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({ labels: [] }),
}));
vi.mock("@/lib/tasks/hooks/use-task-sections", () => ({
  useTaskSections: () => ({ sections: [design, build] }),
}));
vi.mock("@/lib/preferences/use-user-preferences", () => ({
  useSectionAppearance: () => ({
    sectionHeaderStyle: mocks.headerStyle,
    sectionColorStyle: "tint",
  }),
}));

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { ...createDefaultTask(), _id: id as Id<"tasks">, clientId: id, rank: id, ...overrides };
}

const tasks = [
  task("a", { sectionId: design._id }),
  task("a1", { parentId: "a" }),
  task("b"),
  task("stale", { sectionId: "deleted" as Id<"taskSections"> }),
];

function setup() {
  return renderHook(() =>
    useTaskGrouping({
      projectId: "project" as Id<"projects">,
      listRef: null,
      groupBy: "section",
      tasks,
      statusFilter: "all",
      assigneeFilter: null,
      archived: false,
      addTask: vi.fn(() => "new"),
      updateTask: vi.fn(),
      moveTask: vi.fn(),
      reorderMultiple: vi.fn(),
      setParent: vi.fn(),
    }),
  ).result.current;
}

test("section columns lead with No section and send unknown sections there", () => {
  const columns = buildBoardTaskColumns({ boardGroupBy: "section", tasks, sections: [design, build] });
  expect(columns.map((column) => [column.id, column.cards.map((card) => card.task._id)])).toEqual([
    [NO_SECTION_COLUMN_ID, ["b", "stale"]],
    ["section:design", ["a"]],
    ["section:build", []],
  ]);
  expect(columns[0].dropTarget).toEqual({ sectionId: null });
  expect(columns[1].createDefaults).toEqual({ sectionId: "design" });
});

test("tint colors every row of a colored section, subtask and add rows included", () => {
  const grouping = setup();
  const rows = flattenTree(buildTaskTree(tasks), new Set(["a"]));
  const tinted = rows.filter((row) => grouping.getRowStyle(row)).map((row) => row.clientId);
  expect(tinted).toEqual(["a", "a1", "add-a"]);
  expect(grouping.getRowStyle(rows[0])?.backgroundColor).toContain("#ef4444 4%");
});

test("members can create a section from outside the grouping; viewers cannot", () => {
  setup().createSection?.("Design");
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ name: "Design" }));
  mocks.role = ProjectRole.VIEWER;
  expect(setup().createSection).toBeUndefined();
});

test("members get an Add section row; viewers do not", () => {
  expect(setup().presentRows([]).at(-1)).toMatchObject({ kind: "section-add" });
  mocks.role = ProjectRole.VIEWER;
  expect(setup().presentRows([]).some((row) => "kind" in row && row.kind === "section-add")).toBe(false);
});

test.each([
  ["compact", 44],
  ["spacious", 68],
])("%s headers are %ipx in the row model and on the header itself", (style, height) => {
  mocks.headerStyle = style;
  const grouping = setup();
  const header = grouping.presentRows([])[0] as TaskSectionRow;
  expect(header).toMatchObject({ kind: "group-header", height });
  // Mobile wrappers do not size their headers.
  render(grouping.renderHeader(header, { mobile: true }) as ReactElement);
  expect(screen.getByLabelText("Section No section").style.height).toBe(`${height}px`);
});

function typeAndPress(key: string) {
  const input = screen.getByPlaceholderText(/Add section/);
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "Ship" } });
  fireEvent.keyDown(input, { key });
}

const addRows: [string, () => ReactElement | undefined][] = [
  ["list", () => setup().renderHeader({ rowType: "section", kind: "section-add", clientId: "section-add", height: 44 }) as ReactElement],
  ["board", () => renderHook(() => useSectionBoard("project" as Id<"projects">, null, true)).result.current.trailing],
];

test.each(addRows)("%s Add section: Escape discards, Enter creates once", (_, element) => {
  const { unmount } = render(element());
  typeAndPress("Escape");
  expect(mocks.mutate).not.toHaveBeenCalled();
  typeAndPress("Enter");
  act(() => screen.getByPlaceholderText(/Add section/).blur());
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ name: "Ship" }));
  unmount();
});

test.each(addRows)("%s Add section drops a leading \"# \"", (_, element) => {
  render(element());
  const input = screen.getByPlaceholderText(/Add section/);
  fireEvent.change(input, { target: { value: "# Ship it" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ name: "Ship it" }));
});

test("Add section lines up with the section chevron", () => {
  render(setup().renderHeader({ rowType: "section", kind: "section-add", clientId: "section-add", height: 44 }) as ReactElement);
  expect(screen.getByPlaceholderText(/Add section/).parentElement?.style.paddingLeft).toBe("24px");
});

test("the section name input has no focus ring, like the task name input", () => {
  const grouping = setup();
  render(grouping.renderHeader({ rowType: "section", clientId: "group:section:design" }) as ReactElement);
  expect(screen.getByLabelText("Section name").className).not.toMatch(/ring|focus:bg/);
});

test("the section menu has no Rename item; the name is edited in place", async () => {
  const grouping = setup();
  render(grouping.renderHeader({ rowType: "section", clientId: "group:section:design" }) as ReactElement);
  const trigger = screen.getByRole("button", { name: "Design actions" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  expect(await screen.findByText("Move up")).toBeDefined();
  expect(screen.queryByText("Rename section")).toBeNull();
});

test("a new section shows at the end of the list before the server answers", () => {
  setup().createSection?.("Ship");
  const setQuery = vi.fn();
  mocks.optimistic?.({ getQuery: () => [design, build], setQuery }, { name: "Ship" });
  const next = setQuery.mock.calls[0][2] as { name: string; color: string | null; rank: string }[];
  expect(next.map((section) => section.name)).toEqual(["Design", "Build", "Ship"]);
  expect(next[2].color).toBeNull();
  expect(next[2].rank > build.rank).toBe(true);
});

const SECTION_DRAG = "application/x-task-section";

test("dragging a section header's grip carries the section id", () => {
  const grouping = setup();
  render(grouping.renderHeader({ rowType: "section", clientId: "group:section:design" }) as ReactElement);
  const setData = vi.fn();
  fireEvent.dragStart(screen.getByLabelText("Drag Design"), {
    dataTransfer: { setData, setDragImage: vi.fn() },
  });
  expect(setData).toHaveBeenCalledWith(SECTION_DRAG, "design");
});

function renderSectionRows() {
  const grouping = setup();
  render(
    <>
      {grouping.renderHeader({ rowType: "section", clientId: "group:section:none" })}
      {grouping.renderHeader({ rowType: "section", clientId: "group:section:design" })}
      {grouping.renderHeader({ rowType: "section", clientId: "group:section:build" })}
      {grouping.renderHeader({ rowType: "section", kind: "section-add", clientId: "section-add", height: 44 })}
    </>,
  );
}

const dragData = () => ({ types: [SECTION_DRAG], setData: vi.fn(), setDragImage: vi.fn(), dropEffect: "" });
const addRow = () => screen.getByPlaceholderText(/Add section/).parentElement!;
const hasLine = (element: HTMLElement) => element.dataset.dropLine === "before";

function dragOverAll(name: string) {
  fireEvent.dragStart(screen.getByLabelText(`Drag ${name}`), { dataTransfer: dragData() });
  for (const label of ["Section No section", "Section Design", "Section Build"])
    fireEvent.dragOver(screen.getByLabelText(label), { dataTransfer: dragData() });
  fireEvent.dragOver(addRow(), { dataTransfer: dragData() });
}

test("a section drag shows a line only where the drop changes the order", () => {
  renderSectionRows();
  dragOverAll("Design");
  expect(hasLine(screen.getByLabelText("Section No section"))).toBe(false);
  expect(hasLine(screen.getByLabelText("Section Design"))).toBe(false);
  expect(hasLine(screen.getByLabelText("Section Build"))).toBe(false);
  expect(hasLine(addRow())).toBe(true);
});

test("dropping a section above a header moves it before that section", () => {
  renderSectionRows();
  dragOverAll("Build");
  expect(hasLine(screen.getByLabelText("Section Design"))).toBe(true);
  fireEvent.drop(screen.getByLabelText("Section Design"), { dataTransfer: dragData() });
  const { sectionId, rank } = (mocks.mutate.mock.calls[0] as unknown as [{ sectionId: string; rank: string }])[0];
  expect(sectionId).toBe("build");
  expect(rank < design.rank).toBe(true);
  expect(hasLine(screen.getByLabelText("Section Design"))).toBe(false);
});

test("dropping a section on Add section moves it last", () => {
  renderSectionRows();
  dragOverAll("Design");
  fireEvent.drop(addRow(), { dataTransfer: dragData() });
  const { sectionId, rank } = (mocks.mutate.mock.calls[0] as unknown as [{ sectionId: string; rank: string }])[0];
  expect(sectionId).toBe("design");
  expect(rank > build.rank).toBe(true);
});

test("viewers get no section grip", () => {
  mocks.role = ProjectRole.VIEWER;
  const grouping = setup();
  render(grouping.renderHeader({ rowType: "section", clientId: "group:section:design" }) as ReactElement);
  expect(screen.queryByLabelText("Drag Design")).toBeNull();
});
