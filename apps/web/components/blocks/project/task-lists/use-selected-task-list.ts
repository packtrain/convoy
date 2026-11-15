"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isSystemListRef } from "@/lib/task-lists/system-lists";

interface UseSelectedTaskListArgs {
  projectId?: Id<"projects">;
  selectedListRef: string | null;
  onInvalidListRef: () => void;
}

export function useSelectedTaskList({
  projectId,
  selectedListRef,
  onInvalidListRef,
}: UseSelectedTaskListArgs) {
  const isSystemList = isSystemListRef(selectedListRef);
  const selectedList = useQuery(
    api.tasks.lists.getByRef,
    projectId && selectedListRef && !isSystemList
      ? { projectId, ref: selectedListRef }
      : "skip"
  );

  useEffect(() => {
    if (!selectedListRef || isSystemList || selectedList !== null) {
      return;
    }
    onInvalidListRef();
  }, [isSystemList, onInvalidListRef, selectedList, selectedListRef]);

  return selectedList;
}
