"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { toast } from "sonner";

import type { CliThreadForkedFrom } from "@/convex/lib/contracts/validators";

import {
  showBatchDoneToast,
  showBatchProgressToast,
} from "@/lib/batch-progress-toast";
import { downloadArtifact } from "@/lib/tasks/download-artifact";
import type { UseCliMessagesResult } from "@/lib/threads/hooks/use-cli-messages";
import { readWholeForkPrefix, type WholeForkPrefix } from "@/lib/threads/hooks/use-fork-prefix";
import {
  buildThreadMarkdown,
  threadMarkdownFileName,
  type ThreadExportEnvelope,
} from "@/lib/threads/markdown-export";
import { CLI_TYPE_MAP, type CliTypeSlug } from "@/lib/threads/types";

/** One toast for the drain and its outcome; the handoff reuses it. */
export const THREAD_HISTORY_TOAST_ID = "thread-markdown-export";

/**
 * Give up waiting for older history after this long without a new chunk.
 * `hasOlderChunks` is the backend's flag and can outlive a usable cursor, in
 * which case `loadOlderChunks()` is a no-op and nothing would ever settle.
 */
export const EXPORT_STALL_MS = 15_000;

/** The transcript slice the export reads. */
export type ThreadMarkdownExportMessages = Pick<
  UseCliMessagesResult,
  | "envelopes"
  | "renderStateByMessageId"
  | "userTextById"
  | "visibleMessageIds"
  | "isLoading"
  | "hasOlderChunks"
  | "hasOlderEnvelopes"
  | "isLoadingOlderChunks"
  | "loadOlderChunks"
  | "loadedChunkCount"
>;

/**
 * Drain what pagination can reach behind a progress toast, then call
 * `onDrained` with the settled transcript. Shared by the Markdown export and
 * the thread handoff (docs/specs/cli-thread-handoff.md).
 */
export function useDrainThreadHistory(
  cliMessages: ThreadMarkdownExportMessages,
  onDrained: () => void
): { drain: () => void; isDraining: boolean } {
  const [isDraining, setIsDraining] = useState(false);
  const onDrainedRef = useRef(onDrained);
  useEffect(() => {
    onDrainedRef.current = onDrained;
  });
  const {
    envelopes,
    visibleMessageIds,
    isLoading,
    hasOlderChunks,
    isLoadingOlderChunks,
    loadOlderChunks,
    loadedChunkCount,
  } = cliMessages;

  useEffect(() => {
    if (!isDraining) {
      return;
    }

    const total = Math.max(envelopes.length, 1);
    const loaded = Math.min(visibleMessageIds.length, total);

    if (isLoading || hasOlderChunks) {
      showBatchProgressToast({
        toastId: THREAD_HISTORY_TOAST_ID,
        completed: loaded,
        total,
        label: "Loading messages",
      });
      if (hasOlderChunks && !isLoadingOlderChunks) {
        loadOlderChunks();
      }
      const stallTimer = setTimeout(finish, EXPORT_STALL_MS);
      return () => clearTimeout(stallTimer);
    }

    finish();

    function finish() {
      setIsDraining(false);
      onDrainedRef.current();
    }
  }, [
    envelopes,
    hasOlderChunks,
    isDraining,
    isLoading,
    isLoadingOlderChunks,
    loadOlderChunks,
    // Progress: re-arms the stall timer whenever history actually arrives.
    loadedChunkCount,
    visibleMessageIds,
  ]);

  const drain = useCallback(() => {
    setIsDraining(true);
  }, []);

  return { drain, isDraining };
}

/**
 * Export the whole conversation as Markdown (OS-1749), then hand the file to
 * the browser. Spec: docs/specs/cli-thread-markdown-export.md
 */
export function useThreadMarkdownExport({
  title,
  taskRef,
  cliType,
  forkedFrom,
  cliMessages,
}: {
  title: string;
  taskRef?: string;
  cliType?: CliTypeSlug;
  forkedFrom?: CliThreadForkedFrom;
  cliMessages: ThreadMarkdownExportMessages;
}): { exportMarkdown: (() => void) | undefined; isExporting: boolean } {
  const convex = useConvex();
  const { drain, isDraining } = useDrainThreadHistory(cliMessages, () => {
    const { envelopes, renderStateByMessageId, userTextById, hasOlderEnvelopes } = cliMessages;
    const save = (prefix: WholeForkPrefix | null) => {
      const exportedAt = Date.now();
      const markdown = buildThreadMarkdown({
        title,
        taskRef,
        cliLabel: cliType ? CLI_TYPE_MAP[cliType] : undefined,
        exportedAt,
        hasUnreachableHistory: hasOlderEnvelopes || prefix?.complete === false,
        envelopes: [...(prefix?.envelopes ?? []), ...envelopes] as ThreadExportEnvelope[],
        partsByMessageId: prefix ? new Map([...prefix.partsByMessageId, ...renderStateByMessageId]) : renderStateByMessageId,
        userTextById: prefix ? new Map([...prefix.userTextById, ...userTextById]) : userTextById,
      });

      if (!downloadArtifact(markdown, threadMarkdownFileName(title, exportedAt), "markdown")) {
        toast.error("Could not save the Markdown file", { id: THREAD_HISTORY_TOAST_ID });
        return;
      }

      showBatchDoneToast({
        toastId: THREAD_HISTORY_TOAST_ID,
        total: (prefix?.envelopes.length ?? 0) + envelopes.length,
        label: "Exported",
        itemLabel: "message",
      });
    };

    if (!forkedFrom) {
      save(null);
      return;
    }
    // A fork's own rows start at the copied run; the ancestors hold the rest.
    readWholeForkPrefix(convex, forkedFrom).then(save, () => {
      toast.error("Could not read the earlier messages", { id: THREAD_HISTORY_TOAST_ID });
    });
  });

  // The copied run lands in batches, as for Branch and Handoff.
  const isForkCopying = (forkedFrom?.copiesInFlight ?? 0) > 0;
  return { exportMarkdown: isForkCopying ? undefined : drain, isExporting: isDraining };
}
