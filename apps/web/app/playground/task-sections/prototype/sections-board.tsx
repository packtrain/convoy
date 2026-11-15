"use client";

import { Fragment, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { BoardColumn, type BoardColumnData } from "@/components/blocks/board/board-column";
import { BoardLayout } from "@/components/blocks/board/board-layout";
import { KanbanCard, type KanbanCardItem } from "@/components/blocks/tasks/kanban-card";
import { Button } from "@/components/ui/button";
import { STATUS_CONFIG } from "@/lib/tasks/constants";
import { Status } from "@/lib/tasks/status";
import type { TaskTreeNode, TaskUpdate } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { NO_SECTION_ID, NO_SECTION_NAME, type TaskSection } from "./sections";
import {
  SectionColorPicker,
  SectionDot,
  SectionNameField,
  startSectionDrag,
  tint,
  useSectionDropTarget,
  type SectionColorStyle,
  type SectionDrop,
} from "./section-header-row";

/** A drop carries the target column's statuses when the board's columns are statuses. */
export type BoardDrop = (sectionId: string, drop: SectionDrop, beforeTaskId?: string, statuses?: Status[]) => void;

interface SectionsBoardProps {
  groups: Map<string, TaskTreeNode[]>;
  sections: TaskSection[];
  colorStyle: SectionColorStyle;
  onDrop: BoardDrop;
  onAddSection: () => void;
  onTaskUpdate: (taskId: string, updates: TaskUpdate) => void;
}

function boardSections(groups: Map<string, TaskTreeNode[]>, sections: TaskSection[]) {
  return [
    ...(groups.get(NO_SECTION_ID)?.length ? [{ id: NO_SECTION_ID, section: null }] : []),
    ...sections.map((section) => ({ id: section.id, section })),
  ];
}

function toItems(roots: TaskTreeNode[]): KanbanCardItem[] {
  return roots.map((task) => ({
    task,
    subtaskProgress: task.childCount ? { completed: task.completedChildCount, total: task.childCount } : undefined,
  }));
}

function AddSectionButton({ onAdd, className }: { onAdd: () => void; className?: string }) {
  return (
    <div className={cn("flex items-start p-2", className)}>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onAdd}>
        <Plus />
        Add section
      </Button>
    </div>
  );
}

interface SectionColumnsProps extends SectionsBoardProps {
  autoFocusId: string | null;
  onRename: (sectionId: string, name: string | null) => void;
  onColorChange: (sectionId: string, color: string | null) => void;
  onCreateTask: (sectionId: string, title: string, position: "top" | "bottom") => void;
}

// Sections as columns: real BoardLayout, BoardColumn and KanbanCard with native drag.
export function SectionColumns({ groups, sections, colorStyle, autoFocusId, onRename, onColorChange, onCreateTask, onDrop, onAddSection, onTaskUpdate }: SectionColumnsProps) {
  return (
    <BoardLayout
      columns={boardSections(groups, sections)}
      trailing={<AddSectionButton onAdd={onAddSection} className="w-60 flex-none" />}
      renderColumn={({ id, section }) => (
        <SectionColumn
          key={id}
          sectionId={id}
          section={section}
          items={toItems(groups.get(id) ?? [])}
          colorStyle={colorStyle}
          autoFocusName={autoFocusId === id}
          onRename={(name) => onRename(id, name)}
          onColorChange={(color) => onColorChange(id, color)}
          onCreateTask={(title, position) => onCreateTask(id, title, position)}
          onDrop={(drop, beforeTaskId) => onDrop(id, drop, beforeTaskId)}
          onTaskUpdate={onTaskUpdate}
        />
      )}
    />
  );
}

interface SectionColumnProps {
  sectionId: string;
  section: TaskSection | null;
  items: KanbanCardItem[];
  colorStyle: SectionColorStyle;
  autoFocusName: boolean;
  onRename: (name: string | null) => void;
  onColorChange: (color: string | null) => void;
  onCreateTask: (title: string, position: "top" | "bottom") => void;
  onDrop: (drop: SectionDrop, beforeTaskId?: string) => void;
  onTaskUpdate: (taskId: string, updates: TaskUpdate) => void;
}

function SectionColumn({ sectionId, section, items, colorStyle, autoFocusName, onRename, onColorChange, onCreateTask, onDrop, onTaskUpdate }: SectionColumnProps) {
  const { isOver, dropProps } = useSectionDropTarget(Boolean(section), (drop) => onDrop(drop));
  const name = section?.name ?? NO_SECTION_NAME;
  const color = section?.color;
  const column: BoardColumnData<KanbanCardItem> = {
    id: sectionId,
    title: section ? (
      <span className="flex items-center gap-0.5">
        <SectionNameField
          value={section.name}
          label="Section name"
          autoFocus={autoFocusName}
          style={{ color: color && colorStyle === "stripe" ? color : undefined }}
          className="min-w-32 font-semibold"
          onDone={onRename}
        />
        <span className="flex opacity-0 group-hover/section:opacity-100 has-[[data-state=open]]:opacity-100">
          <SectionColorPicker section={section} onChange={onColorChange} />
        </span>
      </span>
    ) : (
      <span className="px-1.5">{name}</span>
    ),
    metadata: colorStyle === "dot" ? <SectionDot color={color} /> : undefined,
    items,
    addLabel: `Add task to ${name}`,
    onCreateTask,
  };
  return (
    <div
      aria-label={`Section ${name}`}
      role="group"
      style={{
        borderTopColor: color && colorStyle === "stripe" ? color : undefined,
        backgroundColor: color && colorStyle === "tint" ? tint(color, 4) : undefined,
      }}
      className={cn("group/section flex border-t-[3px] border-transparent", isOver && "bg-blue-500/5 ring-1 ring-inset ring-blue-500/60")}
      {...dropProps}
    >
      <BoardColumn
        column={column}
        getItemKey={(item) => item.task.clientId}
        headerDragHandleProps={section ? { draggable: true, onDragStart: (event) => startSectionDrag(event, section.id) } : undefined}
        renderItem={(item) => <SectionCard item={item} onDrop={(drop) => onDrop(drop, item.task.clientId)} onTaskUpdate={onTaskUpdate} />}
      />
    </div>
  );
}

function SectionCard({ item, onDrop, onTaskUpdate }: { item: KanbanCardItem; onDrop: (drop: SectionDrop) => void; onTaskUpdate: (taskId: string, updates: TaskUpdate) => void }) {
  const { isOver, dropProps } = useSectionDropTarget(false, onDrop);
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData("text/plain", item.task.clientId);
        event.dataTransfer.setData("application/x-multi-select", "false");
        event.dataTransfer.effectAllowed = "move";
      }}
      {...dropProps}
      className={cn("relative cursor-grab", isOver && "before:absolute before:inset-x-2 before:-top-1.5 before:h-0.5 before:bg-blue-500")}
    >
      <KanbanCard task={item.task} subtaskProgress={item.subtaskProgress} onTaskUpdate={(taskId, updates) => onTaskUpdate(String(taskId), updates)} />
    </div>
  );
}

// Same buckets as the real status board.
const STATUS_COLUMNS: { id: string; statuses: Status[] }[] = [
  { id: "todo", statuses: [Status.TODO, Status.TRIAGE] },
  { id: "planning", statuses: [Status.PLANNING, Status.PLAN_REVIEW] },
  { id: "in-progress", statuses: [Status.IN_PROGRESS] },
  { id: "in-review", statuses: [Status.IN_REVIEW] },
  { id: "blocked", statuses: [Status.BLOCKED] },
  { id: "done", statuses: [Status.DONE, Status.CANCELED] },
];
const GRID = { gridTemplateColumns: `repeat(${STATUS_COLUMNS.length}, minmax(0, 1fr))` };

interface SectionLanesProps extends SectionsBoardProps {
  renderLaneHeader: (sectionId: string) => ReactNode;
  spacious: boolean;
}

// Jira-style swimlanes: status columns, one collapsible row of cards per section.
export function SectionLanes({ groups, sections, colorStyle, renderLaneHeader, spacious, onDrop, onAddSection, onTaskUpdate }: SectionLanesProps) {
  const lanes = boardSections(groups, sections);
  const roots = [...groups.values()].flat();
  return (
    <div className="h-full overflow-auto">
      <div className="pb-24" style={{ minWidth: `${STATUS_COLUMNS.length * 13.5}rem` }}>
        <div className="sticky top-0 z-10 grid border-b border-border bg-muted/95 backdrop-blur" style={GRID}>
          {STATUS_COLUMNS.map(({ id, statuses }) => {
            const { icon: Icon, color } = STATUS_CONFIG[statuses[0]];
            return (
              <div key={id} className="flex h-10 items-center gap-2 border-r border-border px-3 text-sm font-medium">
                <Icon className={cn("size-4", color)} />
                {statuses[0]}
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {roots.filter((task) => statuses.includes(task.status)).length}
                </span>
              </div>
            );
          })}
        </div>
        {lanes.map(({ id, section }) => {
          const laneRoots = groups.get(id) ?? [];
          const color = section?.color;
          return (
            <Fragment key={id}>
              <div className={spacious ? "h-16" : "h-9"}>{renderLaneHeader(id)}</div>
              {!section?.collapsed && (
                <div
                  role="group"
                  aria-label={`Lane ${section?.name ?? NO_SECTION_NAME}`}
                  className="grid border-b border-border"
                  style={{
                    ...GRID,
                    boxShadow: color && colorStyle === "stripe" ? `inset 3px 0 0 ${color}` : undefined,
                    backgroundColor: color && colorStyle === "tint" ? tint(color, 4) : undefined,
                  }}
                >
                  {STATUS_COLUMNS.map(({ id: columnId, statuses }) => (
                    <LaneCell
                      key={columnId}
                      items={toItems(laneRoots.filter((task) => statuses.includes(task.status)))}
                      onDrop={(drop, beforeTaskId) => onDrop(id, drop, beforeTaskId, statuses)}
                      onTaskUpdate={onTaskUpdate}
                    />
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}
        <AddSectionButton onAdd={onAddSection} />
      </div>
    </div>
  );
}

function LaneCell({ items, onDrop, onTaskUpdate }: { items: KanbanCardItem[]; onDrop: (drop: SectionDrop, beforeTaskId?: string) => void; onTaskUpdate: (taskId: string, updates: TaskUpdate) => void }) {
  const { isOver, dropProps } = useSectionDropTarget(false, (drop) => onDrop(drop));
  return (
    <div {...dropProps} className={cn("flex min-h-20 flex-col gap-3 border-r border-border p-3", isOver && "bg-blue-500/5 ring-1 ring-inset ring-blue-500/60")}>
      {items.map((item) => (
        <SectionCard key={item.task.clientId} item={item} onDrop={(drop) => onDrop(drop, item.task.clientId)} onTaskUpdate={onTaskUpdate} />
      ))}
    </div>
  );
}
