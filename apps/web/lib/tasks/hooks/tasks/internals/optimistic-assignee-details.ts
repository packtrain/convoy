import { useCallback, useMemo, useRef } from "react";
import { consumePendingAssigneeDetails, type PendingAssigneeSplitDetails } from "@/lib/tasks/optimistic-assignees";

export type OptimisticAssigneeDetailsStore = {
  queue: (key: string, details: PendingAssigneeSplitDetails) => void;
  queueForIds: (ids: readonly string[], details: PendingAssigneeSplitDetails) => void;
  consume: (key: string) => PendingAssigneeSplitDetails | undefined;
};

export function useOptimisticAssigneeDetails(): OptimisticAssigneeDetailsStore {
  const pendingDetailsRef = useRef<Map<string, PendingAssigneeSplitDetails>>(new Map());

  const queue = useCallback((key: string, details: PendingAssigneeSplitDetails) => {
    pendingDetailsRef.current.set(key, details);
  }, []);

  const queueForIds = useCallback((ids: readonly string[], details: PendingAssigneeSplitDetails) => {
    for (const id of ids) {
      pendingDetailsRef.current.set(id, details);
    }
  }, []);

  const consume = useCallback((key: string) => {
    return consumePendingAssigneeDetails(pendingDetailsRef.current, key);
  }, []);

  return useMemo(
    () => ({
      queue,
      queueForIds,
      consume,
    }),
    [consume, queue, queueForIds]
  );
}
