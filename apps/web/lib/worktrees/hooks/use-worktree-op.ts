"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliHistoryScope, CliWorktreeOpKind } from "@/convex/lib/contracts/validators";
import { getErrorMessage } from "@/lib/errors";

export interface WorktreeOpState {
  /** `resultJson` of the last completed op for this key; kept across a failed refresh. */
  resultJson: string | undefined;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

interface Pending {
  key: string;
  generation: number;
  opId: Id<"cliWorktreeOps">;
}

interface Settled {
  key: string;
  generation: number;
  resultJson?: string;
  error: string | null;
}

const EXPIRED_MESSAGE = "The CLI did not answer before the request expired. Refresh to try again.";

/**
 * Enqueue a worktree op on mount and on every `refresh()`, and watch it to
 * completion. Deliberately uncached: working-tree results are mutable, unlike
 * the checkpoint-keyed file ops in the thread panel (OS-2036). Each request
 * is tied to a generation so a stale op can never overwrite a newer outcome.
 */
export function useWorktreeOp(args: {
  profileId: Id<"cliProfiles">;
  pathId: string;
  kind: CliWorktreeOpKind;
  /** For file ops; part of the key, so a different file is a different request. */
  filePath?: string;
  /** commitPatch: the commit. Part of the key, like `filePath`. */
  postRef?: string;
  /** gitLog: the page to fetch. Part of the key, like `filePath`. */
  cursor?: string;
  /** gitLog: the walk (OS-2595). Part of the key, like `filePath`. */
  scope?: CliHistoryScope;
  enabled: boolean;
}): WorktreeOpState {
  const { profileId, pathId, kind, filePath, postRef, cursor, scope, enabled } = args;
  const key = `${profileId}:${pathId}:${kind}:${filePath ?? ""}:${postRef ?? ""}:${cursor ?? ""}:${scope ?? ""}`;
  const [generation, setGeneration] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  // StrictMode runs the effect twice; the mutation must go out once per request.
  const requestedRef = useRef<string | null>(null);
  const enqueueOp = useMutation(api.cli.worktreeOps.enqueue);
  const op = useQuery(api.cli.worktreeOps.get, pending ? { opId: pending.opId } : "skip");

  useEffect(() => {
    const request = `${key}:${generation}`;
    if (!enabled || requestedRef.current === request) {
      return;
    }
    requestedRef.current = request;
    enqueueOp({
      profileId,
      kind,
      pathId,
      ...(filePath ? { filePath } : {}),
      ...(postRef ? { postRef } : {}),
      ...(cursor ? { cursor } : {}),
      ...(scope ? { scope } : {}),
    })
      .then((opId) => setPending({ key, generation, opId }))
      .catch((requestError) => {
        setPending(null);
        setSettled((previous) => ({
          key,
          generation,
          resultJson: previous?.key === key ? previous.resultJson : undefined,
          error: getErrorMessage(requestError, "Failed to reach the CLI"),
        }));
      });
  }, [enabled, generation, key, profileId, pathId, kind, filePath, postRef, cursor, scope, enqueueOp]);

  // Settle during render (state adjusted from a changed input). A null row
  // means the op was pruned before the CLI answered.
  if (pending && op !== undefined && (op === null || op.status !== "pending")) {
    const previous = settled?.key === pending.key ? settled.resultJson : undefined;
    setSettled({
      key: pending.key,
      generation: pending.generation,
      resultJson: op?.status === "done" ? op.resultJson : previous,
      error:
        op === null
          ? EXPIRED_MESSAGE
          : op.status === "failed"
            ? (op.error ?? "The CLI could not complete the request")
            : null,
    });
    setPending(null);
  }

  // Another key's outcome is stale by the time its key comes back: forget it (OS-2596 review).
  if (settled && settled.key !== key) {
    setSettled(null);
  }
  const current = settled?.key === key ? settled : null;
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  return {
    resultJson: current?.resultJson,
    error: current?.error ?? null,
    loading: enabled && current?.generation !== generation,
    refresh,
  };
}
