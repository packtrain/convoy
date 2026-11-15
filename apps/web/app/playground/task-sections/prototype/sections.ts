import { flattenTree } from "@/lib/tasks/tree";
import type { FlattenedRow, TaskSectionRow, TaskTreeNode } from "@/lib/tasks/types";

export interface TaskSection {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
}

/** Root task id → section id. Roots without an entry are in No section. */
export type SectionPlacement = Readonly<Record<string, string>>;

export const NO_SECTION_ID = "none";
export const NO_SECTION_NAME = "No section";
export const ADD_SECTION_ROW: TaskSectionRow = { rowType: "section", clientId: "section-add" };
const ROW_PREFIX = "section:";

export function sectionRowId(sectionId: string): string {
  return `${ROW_PREFIX}${sectionId}`;
}

export function sectionIdOfRow(row: TaskSectionRow): string | null {
  return row.clientId.startsWith(ROW_PREFIX) ? row.clientId.slice(ROW_PREFIX.length) : null;
}

export function sectionOf(placement: SectionPlacement, taskId: string): string {
  return placement[taskId] ?? NO_SECTION_ID;
}

/** Roots grouped in display order: No section first, then each section. */
export function rootsBySection(tree: TaskTreeNode[], sections: TaskSection[], placement: SectionPlacement) {
  const groups = new Map<string, TaskTreeNode[]>([[NO_SECTION_ID, []], ...sections.map((s) => [s.id, []] as [string, TaskTreeNode[]])]);
  for (const root of tree) {
    (groups.get(sectionOf(placement, root._id)) ?? groups.get(NO_SECTION_ID)!).push(root);
  }
  return groups;
}

export function buildSectionRows(
  tree: TaskTreeNode[],
  sections: TaskSection[],
  placement: SectionPlacement,
  expandedIds: Set<string>,
  headerHeight?: number
): (FlattenedRow | TaskSectionRow)[] {
  const groups = rootsBySection(tree, sections, placement);
  const rows: (FlattenedRow | TaskSectionRow)[] = [];
  const header = (id: string): TaskSectionRow => ({ rowType: "section", clientId: sectionRowId(id), ...(headerHeight && { height: headerHeight }) });
  // One extra depth level indents a section's tasks under its header.
  const indented = (roots: TaskTreeNode[]) => flattenTree(roots, expandedIds).map((row) => ({ ...row, depth: row.depth + 1 }));
  const noSection = groups.get(NO_SECTION_ID)!;
  if (noSection.length > 0) {
    rows.push(header(NO_SECTION_ID), ...indented(noSection));
  }
  for (const section of sections) {
    rows.push(header(section.id));
    if (!section.collapsed) rows.push(...indented(groups.get(section.id)!));
  }
  rows.push(ADD_SECTION_ROW);
  return rows;
}

/** Ids of the given roots and all their subtasks. */
export function taskIdsWithSubtasks(roots: TaskTreeNode[]): string[] {
  return roots.flatMap((root) => [root._id, ...taskIdsWithSubtasks(root.children ?? [])]);
}

export function placeTasks(placement: SectionPlacement, taskIds: string[], sectionId: string): SectionPlacement {
  const next = { ...placement };
  for (const id of taskIds) {
    if (sectionId === NO_SECTION_ID) delete next[id];
    else next[id] = sectionId;
  }
  return next;
}

export function moveSection(sections: TaskSection[], id: string, toIndex: number): TaskSection[] {
  const section = sections.find((s) => s.id === id);
  if (!section) return sections;
  const rest = sections.filter((s) => s.id !== id);
  rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, section);
  return rest;
}

export function removeSection(sections: TaskSection[], placement: SectionPlacement, id: string) {
  return {
    sections: sections.filter((s) => s.id !== id),
    placement: Object.fromEntries(Object.entries(placement).filter(([, sectionId]) => sectionId !== id)),
  };
}
