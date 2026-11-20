"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";

interface Pending {
  pathId: string;
  opId: Id<"cliWorktreeOps"> | null;
}

interface Outcome {
  pathId: string;
  error: string | null;
}

/**
 * Enqueue a `remove` worktree op and toast its outcome once (OS-2459). The
 * caller decides what success and a refused removal lead to.
 */
export function useWorktreeRemoval(
  profileId: Id<"cliProfiles">,
  options: { onRemoved?: (pathId: string) => void; onViewChanges?: (pathId: string) => void } = {}
) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const enqueueOp = useMutation(api.cli.worktreeOps.enqueue);
  const op = useQuery(api.cli.worktreeOps.get, pending?.opId ? { opId: pending.opId } : "skip");

  // Settle during render; a null row means the op was pruned before the CLI answered.
  if (pending?.opId && op !== undefined && (op === null || op.status !== "pending")) {
    setPending(null);
    setOutcome({
      pathId: pending.pathId,
      error: op?.status === "done" ? null : (op?.error ?? "The CLI did not answer before the request expired."),
    });
  }

  const report = useEffectEvent(({ pathId, error }: Outcome) => {
    if (error === null) {
      toast.success("Worktree removed");
      options.onRemoved?.(pathId);
      return;
    }
    const onViewChanges = options.onViewChanges;
    toast.error(error, onViewChanges ? { action: { label: "View changes", onClick: () => onViewChanges(pathId) } } : undefined);
  });
  useEffect(() => {
    if (outcome) {
      report(outcome);
    }
  }, [outcome]);

  const remove = useCallback(
    async (pathId: string): Promise<boolean> => {
      setPending({ pathId, opId: null });
      try {
        const opId = await enqueueOp({ profileId, kind: "remove", pathId });
        setPending({ pathId, opId });
        return true;
      } catch (error) {
        setPending(null);
        toast.error(getErrorMessage(error, "Failed to remove worktree"));
        return false;
      }
    },
    [enqueueOp, profileId]
  );

  return { removingPathId: pending?.pathId ?? null, remove };
}
