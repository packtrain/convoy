"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ArtifactCommentAnchor } from "@/convex/tasks/lib/artifactComments/validators";

export type ArtifactComment = FunctionReturnType<
  typeof api.tasks.artifactComments.listByArtifact
>[number];

export interface ArtifactCommentThread {
  root: ArtifactComment;
  replies: ArtifactComment[];
}

interface UseArtifactCommentsResult {
  /** Root comments with their flat replies, oldest first. */
  threads: ArtifactCommentThread[];
  isLoading: boolean;
  createComment: (content: string, anchor?: ArtifactCommentAnchor) => Promise<Id<"artifactComments">>;
  createReply: (parentId: Id<"artifactComments">, content: string) => Promise<Id<"artifactComments">>;
  updateComment: (commentId: Id<"artifactComments">, content: string) => Promise<void>;
  deleteComment: (commentId: Id<"artifactComments">) => Promise<void>;
  setStatus: (commentId: Id<"artifactComments">, status: "open" | "resolved") => Promise<void>;
}

export function useArtifactComments(
  artifactId: Id<"taskArtifacts"> | null
): UseArtifactCommentsResult {
  const comments = useQuery(
    api.tasks.artifactComments.listByArtifact,
    artifactId ? { artifactId } : "skip"
  );

  const createMutation = useMutation(api.tasks.artifactComments.create);
  const replyMutation = useMutation(api.tasks.artifactComments.reply);
  const updateMutation = useMutation(api.tasks.artifactComments.update);
  const removeMutation = useMutation(api.tasks.artifactComments.remove);
  const setStatusMutation = useMutation(api.tasks.artifactComments.setStatus);

  const threads = useMemo(() => {
    if (!comments) return [];
    const repliesByParent = new Map<Id<"artifactComments">, ArtifactComment[]>();
    for (const comment of comments) {
      if (!comment.parentId) continue;
      const list = repliesByParent.get(comment.parentId) ?? [];
      list.push(comment);
      repliesByParent.set(comment.parentId, list);
    }
    return comments
      .filter((comment) => !comment.parentId)
      .map((root) => ({ root, replies: repliesByParent.get(root._id) ?? [] }));
  }, [comments]);

  const createComment = useCallback(
    async (content: string, anchor?: ArtifactCommentAnchor) => {
      if (!artifactId) throw new Error("No artifact selected");
      return await createMutation({ artifactId, content, anchor });
    },
    [createMutation, artifactId]
  );

  const createReply = useCallback(
    async (parentId: Id<"artifactComments">, content: string) => {
      return await replyMutation({ parentId, content });
    },
    [replyMutation]
  );

  const updateComment = useCallback(
    async (commentId: Id<"artifactComments">, content: string) => {
      await updateMutation({ commentId, content });
    },
    [updateMutation]
  );

  const deleteComment = useCallback(
    async (commentId: Id<"artifactComments">) => {
      await removeMutation({ commentId });
    },
    [removeMutation]
  );

  const setStatus = useCallback(
    async (commentId: Id<"artifactComments">, status: "open" | "resolved") => {
      await setStatusMutation({ commentIds: [commentId], status });
    },
    [setStatusMutation]
  );

  return {
    threads,
    isLoading: artifactId !== null && comments === undefined,
    createComment,
    createReply,
    updateComment,
    deleteComment,
    setStatus,
  };
}
