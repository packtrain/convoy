import { useMemo } from "react";
import type { FlattenedRow, TaskSectionRow } from "@/lib/tasks/types";

type PresentRows = (rows: FlattenedRow[]) => (FlattenedRow | TaskSectionRow)[];

export function useTaskTableRows(rows: FlattenedRow[], presentRows?: PresentRows) {
  return useMemo(() => presentRows ? presentRows(rows) : rows, [rows, presentRows]);
}
