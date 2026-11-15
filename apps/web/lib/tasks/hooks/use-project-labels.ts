"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type ProjectLabel = FunctionReturnType<typeof api.tasks.labels.list>[number];

/**
 * Rank-ordered labels for a project (rank order = board column order).
 * Shared by the board label grouping, the sidebar picker, and the table
 * column — one subscription per surface, never per-row queries.
 */
export function useProjectLabels(projectId: Id<"projects"> | undefined) {
  const labels = useQuery(api.tasks.labels.list, projectId ? { projectId } : "skip");

  const labelsById = useMemo(
    () => new Map<string, ProjectLabel>((labels ?? []).map((label) => [String(label._id), label])),
    [labels]
  );

  return {
    labels: labels ?? [],
    labelsById,
    isLoading: labels === undefined,
  };
}
