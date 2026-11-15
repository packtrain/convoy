"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface UseTaskCommentsResult {
  createComment: (content: string) => Promise<Id<"taskComments">>;
  createCommentWithAttachments: (args: {
    content: string;
    attachments: Array<{
      storageId: Id<"_storage">;
      fileName: string;
      fileSize: number;
      contentType: string;
    }>;
  }) => Promise<Id<"taskComments">>;
  updateComment: (commentId: Id<"taskComments">, content: string) => Promise<void>;
  deleteComment: (commentId: Id<"taskComments">) => Promise<void>;
}

/**
 * Comment mutations for a task — create, update, delete.
 *
 * **Deliberately holds no list subscription.** Comments are rows in the merged timeline,
 * which paginates through its own cursor; a `usePaginatedQuery` here would be a second
 * live read of rows nothing renders — once per caller, and there are two. Both want
 * only the mutations.
 */
export function useTaskComments(taskId: Id<"tasks">): UseTaskCommentsResult {
  const createMutation = useMutation(api.tasks.comments.create);
  const createWithAttachmentsMutation = useMutation(api.tasks.comments.createWithAttachments);
  const updateMutation = useMutation(api.tasks.comments.update);
  const removeMutation = useMutation(api.tasks.comments.remove);

  const createComment = useCallback(
    async (content: string) => {
      return await createMutation({ taskId, content });
    },
    [createMutation, taskId]
  );

  const updateComment = useCallback(
    async (commentId: Id<"taskComments">, content: string) => {
      await updateMutation({ commentId, content });
    },
    [updateMutation]
  );

  const deleteComment = useCallback(
    async (commentId: Id<"taskComments">) => {
      await removeMutation({ commentId });
    },
    [removeMutation]
  );

  const createCommentWithAttachments = useCallback(
    async ({
      content,
      attachments,
    }: {
      content: string;
      attachments: Array<{
        storageId: Id<"_storage">;
        fileName: string;
        fileSize: number;
        contentType: string;
      }>;
    }) => {
      return await createWithAttachmentsMutation({
        taskId,
        content,
        attachments,
      });
    },
    [createWithAttachmentsMutation, taskId]
  );

  return {
    createComment,
    createCommentWithAttachments,
    updateComment,
    deleteComment,
  };
}
