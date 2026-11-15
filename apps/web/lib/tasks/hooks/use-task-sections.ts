"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type { TaskSection } from "@/convex/tasks/lib/validators";

/** Rank-ordered sections of one List; a null listRef means the project default List. */
export function useTaskSections(projectId: Id<"projects"> | undefined, listRef: string | null) {
  const sections = useQuery(
    api.tasks.sections.list,
    projectId ? { projectId, ...(listRef ? { listRef } : {}) } : "skip"
  );
  return { sections: sections ?? [], isLoading: sections === undefined };
}
