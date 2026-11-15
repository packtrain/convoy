"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { AttachmentDropZone } from "@/components/blocks/attachment-drop-zone";
import { CommentInput } from "./comment-input";
import { useTaskComments } from "@/lib/tasks/hooks/comments/use-task-comments";
import { useCommentAttachmentUpload } from "@/lib/tasks/hooks/use-comment-attachment-upload";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

interface CommentComposerProps {
  taskId: Id<"tasks">;
  disabled?: boolean;
  className?: string;
}

export function CommentComposer({
  taskId,
  disabled,
  className,
}: CommentComposerProps) {
  const { createComment, createCommentWithAttachments } = useTaskComments(taskId);
  const {
    pendingAttachments,
    addFiles,
    removeAttachment,
    waitForInFlightUploads,
    getPendingAttachmentsSnapshot,
    clearAfterSubmit,
  } = useCommentAttachmentUpload(taskId);

  const handleAddFiles = useCallback(
    (files: File[]) => {
      void addFiles(files);
    },
    [addFiles]
  );

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      void removeAttachment(id);
    },
    [removeAttachment]
  );

  const handleSubmit = useCallback(
    async (content: string) => {
      try {
        await waitForInFlightUploads();

        const latestAttachments = getPendingAttachmentsSnapshot();
        const hasFailed = latestAttachments.some(
          (attachment) => attachment.status === "error"
        );
        if (hasFailed) {
          toast.error("Please remove failed attachments before sending.");
          return;
        }

        const hasUploading = latestAttachments.some(
          (attachment) => attachment.status === "uploading"
        );
        if (hasUploading) {
          toast.error("Please wait for uploads to finish.");
          return;
        }

        const uploadedAttachments = latestAttachments
          .filter(
            (
              attachment
            ): attachment is typeof attachment & { storageId: Id<"_storage"> } =>
              attachment.status === "uploaded" && !!attachment.storageId
          )
          .map((attachment) => ({
            storageId: attachment.storageId,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            contentType: attachment.contentType,
          }));

        if (uploadedAttachments.length > 0) {
          await createCommentWithAttachments({
            content,
            attachments: uploadedAttachments,
          });
        } else {
          await createComment(content);
        }

        clearAfterSubmit();
      } catch (error) {
        toast.error("Failed to post comment");
        throw error;
      }
    },
    [
      clearAfterSubmit,
      createComment,
      createCommentWithAttachments,
      getPendingAttachmentsSnapshot,
      waitForInFlightUploads,
    ]
  );

  return (
    <AttachmentDropZone onDrop={handleAddFiles} disabled={disabled}>
      <div className={cn("border-t border-border p-4", className)}>
        <CommentInput
          onSubmit={handleSubmit}
          pendingAttachments={pendingAttachments}
          onAddFiles={handleAddFiles}
          onRemoveAttachment={handleRemoveAttachment}
          disabled={disabled}
        />
      </div>
    </AttachmentDropZone>
  );
}
