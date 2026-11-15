"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UseCliMessagesResult } from "@/lib/threads/hooks/use-cli-messages";

const INITIAL_PART_LIMIT = 100;
const LOAD_MORE_PART_STEP = 100;
const LOAD_MORE_MESSAGE_STEP = 5;
/** Budget a thread starts at, before any "show more" click widens it. */
const INITIAL_BUDGET = { partLimit: INITIAL_PART_LIMIT, minMessages: 0 };

interface ThreadDetailMessageLike {
  _id: string;
  role: "user" | "assistant";
}

type RevealFloor = {
  /** Messages revealed so far — a count, so ids leaving the list can't lose it. */
  count: number;
  /** Per-message part cost high-water mark. */
  partCostByMessageId: Map<string, number>;
};

/**
 * Reveal floors per thread: a revealed message is never re-hidden while the
 * thread stays open (OS-1707). Module-scoped because React state needs a render
 * to commit and a ref may not be touched during render.
 * Spec: docs/specs/cli-thread-message-pagination.md.
 * ponytail: revealed messages stay mounted until unmount — virtualize the list
 * if that ever costs anything.
 */
const revealFloorByThreadId = new Map<string, RevealFloor>();

function getRevealFloor(threadId: string): RevealFloor {
  const existing = revealFloorByThreadId.get(threadId);
  if (existing) {
    return existing;
  }

  const floor: RevealFloor = { count: 0, partCostByMessageId: new Map() };
  revealFloorByThreadId.set(threadId, floor);
  return floor;
}

/**
 * How many of the newest messages the part budget admits. Part costs are a
 * per-message high-water mark, never the live count, so a streaming message
 * collapsing cannot widen the budget on its own (OS-1707).
 */
function computeBudgetCount<T extends ThreadDetailMessageLike>(
  messages: T[],
  partCostByMessageId: Map<string, number>,
  renderStateByMessageId: UseCliMessagesResult["renderStateByMessageId"],
  minMessages: number,
  partLimit: number
): number {
  let partCount = 0;
  let visibleCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const parts =
      message.role === "assistant"
        ? Math.max(
            renderStateByMessageId.get(message._id)?.parts.length ?? 1,
            partCostByMessageId.get(message._id) ?? 0
          )
        : 1;
    partCostByMessageId.set(message._id, parts);

    if (
      visibleCount + 1 > minMessages &&
      partCount + parts > partLimit &&
      partCount > 0
    ) {
      break;
    }

    partCount += parts;
    visibleCount += 1;
  }

  return visibleCount;
}

interface UseThreadDetailMessageVisibilityArgs<T extends ThreadDetailMessageLike> {
  threadId: string;
  messages: T[];
  renderStateByMessageId: UseCliMessagesResult["renderStateByMessageId"];
  loadedChunkCount: number;
  hasOlderChunks: boolean;
  /**
   * History exists above the capped envelope window (OS-1600). Chunk
   * pagination cannot reach it, so the cut stays visible as a truthful "there
   * is more above" marker rather than disappearing at the window edge.
   */
  hasOlderEnvelopes?: boolean;
  isLoadingOlderChunks: boolean;
  olderHistoryPaused?: boolean;
  loadOlderChunks: () => void;
}

export function useThreadDetailMessageVisibility<
  T extends ThreadDetailMessageLike,
>({
  threadId,
  messages,
  renderStateByMessageId,
  loadedChunkCount,
  hasOlderChunks,
  hasOlderEnvelopes = false,
  isLoadingOlderChunks,
  olderHistoryPaused = false,
  loadOlderChunks,
}: UseThreadDetailMessageVisibilityArgs<T>) {
  const [visibilityState, setVisibilityState] = useState(() => ({
    threadId,
    ...INITIAL_BUDGET,
    olderMessagesRequestStartCount: null as number | null,
  }));
  const isCurrentThreadState = visibilityState.threadId === threadId;
  const partLimit = isCurrentThreadState
    ? visibilityState.partLimit
    : INITIAL_BUDGET.partLimit;
  const minMessages = isCurrentThreadState
    ? visibilityState.minMessages
    : INITIAL_BUDGET.minMessages;
  const olderMessagesRequestStartCountBase = isCurrentThreadState
    ? visibilityState.olderMessagesRequestStartCount
    : null;
  const olderMessagesRequestStartCount =
    olderMessagesRequestStartCountBase !== null &&
    (loadedChunkCount > olderMessagesRequestStartCountBase || !hasOlderChunks)
      ? null
      : olderMessagesRequestStartCountBase;

  // Drop the floor on unmount so a thread reopened later starts from the part
  // budget instead of inheriting a stale floor.
  useEffect(
    () => () => {
      revealFloorByThreadId.delete(threadId);
    },
    [threadId]
  );

  const { visibleMessages, hiddenCount } = useMemo(() => {
    const revealed = getRevealFloor(threadId);
    const budgetCount = computeBudgetCount(
      messages,
      revealed.partCostByMessageId,
      renderStateByMessageId,
      minMessages,
      partLimit
    );
    const visibleCount = Math.min(
      messages.length,
      Math.max(budgetCount, revealed.count)
    );
    revealed.count = visibleCount;
    const startIdx = messages.length - visibleCount;

    return {
      visibleMessages: messages.slice(startIdx),
      hiddenCount: startIdx,
    };
  }, [messages, minMessages, partLimit, renderStateByMessageId, threadId]);

  const handleShowOlderMessages = useCallback(() => {
    if (hasOlderChunks) {
      loadOlderChunks();
    }

    setVisibilityState((previous) => ({
      threadId,
      partLimit:
        (previous.threadId === threadId
          ? previous.partLimit
          : INITIAL_BUDGET.partLimit) + LOAD_MORE_PART_STEP,
      minMessages:
        Math.max(
          visibleMessages.length,
          previous.threadId === threadId
            ? previous.minMessages
            : INITIAL_BUDGET.minMessages
        ) + LOAD_MORE_MESSAGE_STEP,
      olderMessagesRequestStartCount: hasOlderChunks ? loadedChunkCount : null,
    }));
  }, [hasOlderChunks, loadOlderChunks, loadedChunkCount, threadId, visibleMessages.length]);

  const showOlderMessagesPlaceholder =
    olderMessagesRequestStartCount !== null || isLoadingOlderChunks;
  /**
   * Label and clickability are one decision, derived once: a cut is actionable
   * exactly when clicking it can reveal or fetch something. Splitting them into
   * two expressions over the same conditions let a new label become an inert
   * button (or a clickable static marker) by omission (OS-1600).
   */
  const olderMessagesCut =
    hiddenCount > 0
      ? { label: "Show more messages", actionable: true }
      : hasOlderChunks
        ? {
            label: olderHistoryPaused
              ? "More history remains. Continue loading"
              : "Show more",
            actionable: true,
          }
        : // Nothing left to fetch, but the thread is longer than the envelope
          // window — say so instead of implying the history starts here.
          hasOlderEnvelopes
          ? { label: "Beginning of loaded history", actionable: false }
          : null;

  return {
    visibleMessages,
    showOlderMessagesCut: showOlderMessagesPlaceholder || olderMessagesCut !== null,
    showOlderMessagesLabel: olderMessagesCut?.label,
    showOlderMessagesPlaceholder,
    isOlderMessagesCutActionable: olderMessagesCut?.actionable ?? false,
    handleShowOlderMessages,
  };
}
