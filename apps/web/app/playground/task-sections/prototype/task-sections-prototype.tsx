"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { SortingState } from "@tanstack/react-table";
import type { Id } from "@/convex/_generated/dataModel";
import { ProjectHeader } from "@/components/blocks/project/project-header";
import { TaskTable } from "@/components/blocks/tasks/task-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useKeyboardNavigation } from "@/components/blocks/tasks/task-table/hooks/use-keyboard-navigation";
import { useLocalTasks } from "@/app/playground/tasks/hooks/use-local-tasks";
import { useNavigationLocation } from "@/lib/navigation";
import { createDefaultTask, createLocalTask } from "@/lib/tasks/defaults";
import { useTaskSelection } from "@/lib/tasks/hooks/use-task-selection";
import type { Status } from "@/lib/tasks/status";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { buildTaskTree } from "@/lib/tasks/tree";
import type { AssigneeFilter, LocalTask, ReorderMultipleFn, ReorderPosition, StatusFilterKey, Task, TaskSectionRow, TaskUpdate } from "@/lib/tasks/types";
import { SEED_PLACEMENT, SEED_SECTIONS, SEED_TASKS, TASK_TYPE_BY_ID } from "./fixtures";
import { AddSectionRow, SectionHeaderRow, tint, type SectionColorStyle, type SectionDrop } from "./section-header-row";
import { SectionColumns, SectionLanes } from "./sections-board";
import {
  ADD_SECTION_ROW,
  NO_SECTION_ID,
  buildSectionRows,
  moveSection,
  placeTasks,
  removeSection,
  rootsBySection,
  sectionIdOfRow,
  sectionOf,
  taskIdsWithSubtasks,
  type SectionPlacement,
  type TaskSection,
} from "./sections";

const PATH = "/playground/task-sections";

type BoardLayoutMode = "columns" | "lanes";

function PrototypeToggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Tabs value={value} onValueChange={(next) => onChange(next as T)}>
        <TabsList aria-label={label}>
          {options.map(([option, text]) => (
            <TabsTrigger key={option} value={option} className="px-2 text-xs">
              {text}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

function toTask(local: LocalTask, index: number): Task {
  return {
    _id: local.id as Id<"tasks">,
    clientId: local.id,
    ...createDefaultTask({
      refNumber: index + 1,
      refId: local.id,
      name: local.name,
      taskType: resolveTaskTypeSummary(TASK_TYPE_BY_ID[local.id] ?? "task"),
      priority: local.priority,
      status: local.status,
      assignee: local.assignee,
      tags: local.tags,
      rank: local.rank,
      parentId: local.parentId as Id<"tasks"> | null,
    }),
  };
}

export function TaskSectionsPrototype() {
  const viewMode = new URLSearchParams(useNavigationLocation().search).get("view") === "board" ? "board" : "list";
  const local = useLocalTasks(SEED_TASKS);
  const [sections, setSections] = useState<TaskSection[]>(SEED_SECTIONS);
  const [placement, setPlacement] = useState<SectionPlacement>(SEED_PLACEMENT);
  // A new section's name field takes focus once.
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);
  const [colorStyle, setColorStyle] = useState<SectionColorStyle>("dot");
  const [headerStyle, setHeaderStyle] = useState<"compact" | "spacious">("spacious");
  const spacious = headerStyle === "spacious";
  const [boardLayout, setBoardLayout] = useState<BoardLayoutMode>("lanes");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(["NS-139"]));
  const nextRef = useRef(200);

  const taskList = useMemo(() => local.tasks.map(toTask), [local.tasks]);
  const taskTree = useMemo(() => buildTaskTree(taskList), [taskList]);
  const groups = useMemo(() => rootsBySection(taskTree, sections, placement), [taskTree, sections, placement]);
  const rows = useMemo(() => buildSectionRows(taskTree, sections, placement, expandedIds, spacious ? 68 : undefined), [taskTree, sections, placement, expandedIds, spacious]);
  const taskIds = useMemo(() => rows.filter((row) => !("rowType" in row)).map((row) => row.clientId), [rows]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // The real table DnD reorders by rank; a root drop also adopts the target's section.
  const reorderTasks = (sourceId: string, targetId: string | null, parentId?: string | null, position?: ReorderPosition) => {
    local.reorderTasks(sourceId, targetId, parentId, position);
    if (!parentId && targetId && !targetId.startsWith("add-")) setPlacement((p) => placeTasks(p, [sourceId], sectionOf(p, targetId)));
  };
  const reorderMultiple: ReorderMultipleFn = (ids, targetId, parentId, position) => {
    local.reorderMultiple(ids, targetId, parentId, position);
    if (!parentId && !targetId.startsWith("add-")) setPlacement((p) => placeTasks(p, ids, sectionOf(p, targetId)));
  };
  const setParent = (id: string, parentId: string | null, rank?: string) => {
    local.setParent(id, parentId, rank);
    if (parentId) setExpandedIds((prev) => new Set(prev).add(parentId));
  };
  const setParentMultiple = (ids: string[], parentId: string | null) => {
    local.setParentMultiple(ids, parentId);
    if (parentId) setExpandedIds((prev) => new Set(prev).add(parentId));
  };

  const updateTask = (id: string, updates: TaskUpdate) => {
    const { assigneeId: _a, delegatedToAgentId: _d, assigneeDetails: _ad, delegatedToAgentDetails: _dd, ...taskUpdates } = updates;
    void [_a, _d, _ad, _dd];
    local.updateTask(id, { ...taskUpdates, dueDate: updates.dueDate ? new Date(updates.dueDate).toLocaleDateString() : undefined });
  };
  const addTask = (task: Omit<Task, "_id" | "clientId">, position?: { afterId?: string; beforeId?: string; parentId?: string }) => {
    const created = createLocalTask({ id: `NS-${nextRef.current++}`, name: task.name, priority: task.priority, status: task.status, parentId: position?.parentId ?? task.parentId ?? null });
    void local.addTask(created, position);
    const anchor = position?.afterId ?? position?.beforeId;
    if (!created.parentId && anchor) setPlacement((p) => placeTasks(p, [created.id], sectionOf(p, anchor)));
    return created.id;
  };

  const createInSection = (sectionId: string, name: string, at: "top" | "bottom") => {
    const roots = groups.get(sectionId) ?? [];
    const created = createLocalTask({ id: `NS-${nextRef.current++}`, name });
    void local.addTask(created, at === "top" && roots[0] ? { beforeId: roots[0]._id } : roots.length ? { afterId: roots[roots.length - 1]._id } : undefined);
    setPlacement((p) => placeTasks(p, [created.id], sectionId));
    return created.id;
  };
  const updateSection = (id: string, patch: Partial<TaskSection>) => setSections((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addSection = () => {
    const id = `section-${nextRef.current++}`;
    setSections((current) => [...current, { id, name: "New section", color: null, collapsed: false }]);
    setAutoFocusId(id);
  };
  const deleteSection = (id: string) => {
    const next = removeSection(sections, placement, id);
    setSections(next.sections);
    setPlacement(next.placement);
  };

  // Table/board state reused from the tasks playground.
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>(null);
  // No details sidebar: it queries Convex, which rejects the prototype's local task ids.
  const selection = useTaskSelection({ taskIds, onOpenDetails: () => {} });
  const containerRef = useRef<HTMLDivElement>(null);
  useKeyboardNavigation({
    taskIds,
    selectedIds: selection.selectedIds,
    setSelectedIds: selection.setSelectedIds,
    lastSelectedId: selection.lastSelectedId,
    setLastSelectedId: selection.setLastSelectedId,
    focusInput: local.focusInput,
    reorderTasks,
    inputRefs: local.inputRefs,
    rowRefs: local.rowRefs,
    containerRef,
    enabled: viewMode === "list",
  });

  const renameSection = (id: string, name: string | null) => {
    if (name) updateSection(id, { name });
    setAutoFocusId(null);
  };

  // Board drops into a status column also take that column's first status.
  const dropOnSection = (sectionId: string, drop: SectionDrop, beforeTaskId?: string, statuses?: Status[]) => {
    if (drop.kind === "section") {
      if (sectionId !== NO_SECTION_ID) setSections((current) => moveSection(current, drop.sectionId, current.findIndex((s) => s.id === sectionId)));
      return;
    }
    const ids = drop.isMultiSelect ? Array.from(selection.selectedIds) : [drop.clientId];
    const target = beforeTaskId ?? groups.get(sectionId)?.find((root) => !ids.includes(root._id))?._id;
    if (target && !ids.includes(target)) local.reorderMultiple(ids, target, null, "before");
    else if (!target) local.setParentMultiple(ids, null);
    setPlacement((p) => placeTasks(p, ids, sectionId));
    for (const id of statuses ? ids : []) {
      const task = local.tasks.find((t) => t.id === id);
      if (task && !statuses!.includes(task.status)) local.updateTask(id, { status: statuses![0] });
    }
  };

  const renderSectionHeader = (id: string, withAddTask: boolean): ReactNode => {
    const section = sections.find((s) => s.id === id) ?? null;
    const index = section ? sections.indexOf(section) : -1;
    return (
      <SectionHeaderRow
        section={section}
        isFirst={index === 0}
        isLast={index === sections.length - 1}
        colorStyle={colorStyle}
        spacious={spacious}
        autoFocusName={autoFocusId === id}
        onToggle={() => section && updateSection(id, { collapsed: !section.collapsed })}
        onRename={(name) => renameSection(id, name)}
        onColorChange={(color) => updateSection(id, { color })}
        onAddTask={
          withAddTask
            ? () => {
                if (section?.collapsed) updateSection(id, { collapsed: false });
                local.focusInput(createInSection(id, "", "bottom"), "start");
              }
            : undefined
        }
        onMove={(offset) => setSections((current) => moveSection(current, id, index + offset))}
        onDelete={() => deleteSection(id)}
        onDrop={(drop) => dropOnSection(id, drop)}
      />
    );
  };
  const renderSectionRow = (row: TaskSectionRow) =>
    row.clientId === ADD_SECTION_ROW.clientId ? <AddSectionRow onAdd={addSection} /> : renderSectionHeader(sectionIdOfRow(row) ?? NO_SECTION_ID, true);

  // Stripe and Tint reach every row of a colored section through the rows' data attributes.
  // Tint skips hovered and selected (bg-accent) rows so their own backgrounds still show.
  const rowColorCss =
    colorStyle === "dot"
      ? ""
      : sections
          .filter((s) => s.color)
          .flatMap((s) =>
            taskIdsWithSubtasks(groups.get(s.id) ?? []).map((id) =>
              colorStyle === "stripe"
                ? `[data-task-row-id="${id}"],[data-task-add-row-id="add-${id}"]{box-shadow:inset 3px 0 0 ${s.color}}`
                : `[data-task-row-id="${id}"]:not(:hover):not(.bg-accent),[data-task-add-row-id="add-${id}"]{background-color:${tint(s.color!, 4)}}`
            )
          )
          .join("");

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-6 border-b border-border px-4 py-1.5">
        <PrototypeToggle label="Section header" value={headerStyle} options={[["compact", "Compact"], ["spacious", "Spacious"]]} onChange={setHeaderStyle} />
        <PrototypeToggle label="Section color" value={colorStyle} options={[["dot", "Dot"], ["stripe", "Stripe"], ["tint", "Tint"]]} onChange={setColorStyle} />
        {viewMode === "board" && (
          <PrototypeToggle label="Board sections as" value={boardLayout} options={[["lanes", "Rows"], ["columns", "Columns"]]} onChange={setBoardLayout} />
        )}
      </div>
      <style>{rowColorCss}</style>
      <ProjectHeader
        projectName="Northstar"
        statusFilter={statusFilter}
        assigneeFilter={assigneeFilter}
        archiveFilter="active"
        viewMode={viewMode}
        listPath={PATH}
        boardPath={`${PATH}?view=board`}
        onStatusFilterChange={setStatusFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        onArchiveFilterChange={() => {}}
        onSearchTaskSelect={() => {}}
        getSearchTaskHref={(ref) => `${PATH}?task=${ref}`}
        onAddTask={() => local.focusInput(createInSection(sections[0]?.id ?? NO_SECTION_ID, "", "top"), "start")}
      />
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {viewMode === "board" && boardLayout === "lanes" ? (
          <SectionLanes
            groups={groups}
            sections={sections}
            colorStyle={colorStyle}
            renderLaneHeader={(id) => renderSectionHeader(id, false)}
            spacious={spacious}
            onDrop={dropOnSection}
            onAddSection={addSection}
            onTaskUpdate={updateTask}
          />
        ) : viewMode === "board" ? (
          <SectionColumns
            groups={groups}
            sections={sections}
            colorStyle={colorStyle}
            autoFocusId={autoFocusId}
            onRename={renameSection}
            onColorChange={(id, color) => updateSection(id, { color })}
            onCreateTask={(id, title, at) => createInSection(id, title, at)}
            onDrop={dropOnSection}
            onAddSection={addSection}
            onTaskUpdate={updateTask}
          />
        ) : (
          <TaskTable
            tasks={rows}
            taskTree={taskTree}
            renderSectionRow={renderSectionRow}
            inputRefs={local.inputRefs}
            registerRow={local.registerRow}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            sorting={sorting}
            onSortingChange={setSorting}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            selectedIds={selection.selectedIds}
            onRowClick={selection.handleRowClick}
            onSelectRow={selection.handleSelectRow}
            onContextMenuSelectRow={selection.handleContextMenuSelection}
            expandedIds={expandedIds}
            toggleExpanded={toggleExpanded}
            isDndEnabled={sorting.length === 0}
            reorderTasks={reorderTasks}
            reorderMultiple={reorderMultiple}
            setParent={setParent}
            setParentMultiple={setParentMultiple}
            allowAddTask={false}
            addTaskValue=""
            onAddTaskChange={() => {}}
            onAddTaskKeyDown={() => {}}
            onAddTaskBlur={() => {}}
            onInlineDraftChange={() => {}}
            onInlineDraftCommit={() => {}}
            onInlineDraftCancel={() => {}}
            updateTask={updateTask}
            deleteTask={local.deleteTask}
            addTask={addTask}
            beginInlineTaskDraft={() => {}}
            focusInput={local.focusInput}
            getAdjacentId={local.getAdjacentId}
            getPreviousTaskId={() => taskIds.at(-1) ?? null}
            onDuplicate={() => {}}
            onUpdateStatus={() => {}}
            onOpenDetails={() => {}}
            archiveTask={() => {}}
            unarchiveTask={() => {}}
          />
        )}
      </div>
    </div>
  );
}
