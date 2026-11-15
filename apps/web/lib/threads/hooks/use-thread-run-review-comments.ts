"use client";

import { useCallback, useMemo, useState } from "react";
import {
  anchorsEqual,
  loadRunReviewComments,
  saveRunReviewComments,
  type RunReviewComment,
  type RunReviewCommentAnchor,
} from "@/lib/threads/run-review-comments";

/**
 * Pending review comments across one thread's runs (OS-1155), write-through to
 * localStorage. Owned by the thread page: the run-diff viewer edits its run's slice
 * while the composer pill shows the total. Storage-agnostic on purpose — OS-1161 swaps
 * the backend for Convex without touching consumers.
 *
 * ponytail: postRefs come from loaded message chunks, so comments on runs outside the
 * loaded window don't pill until scrolled into view.
 */
export function useThreadRunReviewComments(postRefs: readonly string[]): {
  allComments: RunReviewComment[];
  commentsByRef: ReadonlyMap<string, RunReviewComment[]>;
  upsertComment: (
    postRef: string,
    anchor: RunReviewCommentAnchor,
    note: string,
    excerpt?: string
  ) => void;
  removeComment: (postRef: string, anchor: RunReviewCommentAnchor) => void;
  clearAllComments: () => void;
} {
  const refsKey = postRefs.join("\n");
  const loadAll = useCallback(() => {
    const byRef = new Map<string, RunReviewComment[]>();
    for (const postRef of refsKey.split("\n")) {
      if (!postRef) {
        continue;
      }
      const comments = loadRunReviewComments(postRef);
      if (comments.length > 0) {
        byRef.set(postRef, comments);
      }
    }
    return byRef;
  }, [refsKey]);

  const [commentsByRef, setCommentsByRef] = useState<ReadonlyMap<string, RunReviewComment[]>>(
    loadAll
  );

  // Reload when the thread's run set changes (render-phase prop-derived
  // state adjustment) — e.g. a new run completes or older chunks load.
  const [lastRefsKey, setLastRefsKey] = useState(refsKey);
  if (lastRefsKey !== refsKey) {
    setLastRefsKey(refsKey);
    setCommentsByRef(loadAll());
  }

  const commitRef = useCallback(
    (postRef: string, comments: RunReviewComment[]) => {
      setCommentsByRef((current) => {
        const next = new Map(current);
        if (comments.length === 0) {
          next.delete(postRef);
        } else {
          next.set(postRef, comments);
        }
        return next;
      });
      saveRunReviewComments(postRef, comments);
    },
    []
  );

  const upsertComment = useCallback(
    (postRef: string, anchor: RunReviewCommentAnchor, note: string, excerpt?: string) => {
      const existing = commentsByRef.get(postRef) ?? [];
      commitRef(postRef, [
        ...existing.filter((comment) => !anchorsEqual(comment, anchor)),
        { ...anchor, note, ...(excerpt ? { excerpt } : {}), createdAt: Date.now() },
      ]);
    },
    [commentsByRef, commitRef]
  );

  const removeComment = useCallback(
    (postRef: string, anchor: RunReviewCommentAnchor) => {
      const existing = commentsByRef.get(postRef) ?? [];
      commitRef(
        postRef,
        existing.filter((comment) => !anchorsEqual(comment, anchor))
      );
    },
    [commentsByRef, commitRef]
  );

  const clearAllComments = useCallback(() => {
    for (const postRef of commentsByRef.keys()) {
      saveRunReviewComments(postRef, []);
    }
    setCommentsByRef(new Map());
  }, [commentsByRef]);

  const allComments = useMemo(
    () => [...commentsByRef.values()].flat(),
    [commentsByRef]
  );

  return { allComments, commentsByRef, upsertComment, removeComment, clearAllComments };
}
