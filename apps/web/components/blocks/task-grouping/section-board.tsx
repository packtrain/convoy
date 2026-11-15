"use client";

import type { Id } from "@/convex/_generated/dataModel";
import type { BoardColumnData } from "@/components/blocks/board/board-column";
import {
  hasProjectPermission,
  ProjectPermission,
} from "@/lib/authz/permissions";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { useSectionAppearance } from "@/lib/preferences/use-user-preferences";
import { useTaskSections } from "@/lib/tasks/hooks/use-task-sections";
import type { TaskSection } from "@/lib/tasks/hooks/use-task-sections";
import type { BoardTaskColumn } from "./groups";
import {
  AddSectionInput,
  SectionControls,
  SectionDot,
  SectionNameField,
  sectionStyle,
  useSectionActions,
} from "./section-header";

const SECTION_COLUMN_PREFIX = "section:";

function sectionIdOfColumn(columnId: string) {
  const id = columnId.startsWith(SECTION_COLUMN_PREFIX)
    ? columnId.slice(SECTION_COLUMN_PREFIX.length)
    : "none";
  return id === "none" ? null : (id as Id<"taskSections">);
}

/** Board wiring for Section columns: data, header decoration, reorder and "Add section". */
export function useSectionBoard(
  projectId: Id<"projects">,
  listRef: string | null,
  enabled: boolean,
) {
  const { sections, isLoading } = useTaskSections(
    enabled ? projectId : undefined,
    listRef,
  );
  const actions = useSectionActions(projectId, listRef, sections);
  const { sectionColorStyle } = useSectionAppearance();
  const { myRole } = useProjectPermissions(projectId);
  const canManage = hasProjectPermission(myRole, ProjectPermission.LIST_MANAGE);

  const decorate = (
    column: BoardTaskColumn,
  ): Partial<Omit<BoardColumnData<unknown>, "items">> => {
    const section = column.section;
    if (!section) return {};
    const style = sectionStyle(section.color, sectionColorStyle);
    return {
      style: sectionColorStyle === "tint" ? style : undefined,
      headerStyle:
        sectionColorStyle === "stripe" && section.color
          ? { boxShadow: `inset 0 3px 0 ${section.color}` }
          : undefined,
      metadata:
        sectionColorStyle === "dot" ? (
          <SectionDot color={section.color} />
        ) : undefined,
      addLabel: `Add task to ${section.name}`,
      headerActions: canManage ? (
        <SectionColumnTitle
          section={section}
          sections={sections}
          count={column.cards.length}
          dot={sectionColorStyle === "dot"}
          actions={actions}
        />
      ) : undefined,
    };
  };

  /** Column drop: same boundary rules as label columns; "No section" stays first. */
  const reorder = (
    columnId: string,
    targetColumnId: string,
    side: "left" | "right",
  ) => {
    const id = sectionIdOfColumn(columnId);
    if (!id) return;
    const ids = sections.map((section) => section._id);
    const target = sectionIdOfColumn(targetColumnId);
    const boundary = target
      ? ids.indexOf(target) + (side === "right" ? 1 : 0)
      : 0;
    const from = ids.indexOf(id);
    const index = boundary > from ? boundary - 1 : boundary;
    if (from >= 0 && index !== from) void actions.moveTo(id, index);
  };

  return {
    sections,
    isLoading: enabled && isLoading,
    decorate,
    reorder: canManage ? reorder : undefined,
    isReorderable: (columnId: string) =>
      canManage && sectionIdOfColumn(columnId) !== null,
    trailing: canManage ? (
      <AddSectionInput
        create={(name) => void actions.create(name)}
        className="sticky top-0 z-10 h-10 w-60 shrink-0 self-start px-3"
      />
    ) : undefined,
  };
}

export type SectionBoard = ReturnType<typeof useSectionBoard>;

function SectionColumnTitle({
  section,
  sections,
  count,
  dot,
  actions,
}: {
  section: TaskSection;
  sections: readonly TaskSection[];
  count: number;
  dot: boolean;
  actions: ReturnType<typeof useSectionActions>;
}) {
  return (
    <div className="group/section flex min-w-0 items-center gap-1">
      {dot && <SectionDot color={section.color} />}
      <SectionNameField
        key={section._id}
        value={section.name}
        onRename={(name) => void actions.update(section._id, { name })}
        className="text-sm font-medium"
      />
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
        {count}
      </span>
      <SectionControls
        section={section}
        sections={sections}
        actions={actions}
      />
    </div>
  );
}
