"use client";

import { useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useFileUpload, type UploadItem } from "@/hooks/uploads/use-file-upload";
import type { UploadProgress } from "@/lib/tasks/types";

export function useTaskAttachments(taskId: Id<"tasks"> | undefined) {
  const attachments = useQuery(
    api.tasks.attachments.listTaskAttachmentsByTask,
    taskId ? { taskId } : "skip"
  );

  const saveAttachmentMutation = useMutation(api.tasks.attachments.saveTaskAttachment);
  const deleteAttachmentMutation = useMutation(
    api.tasks.attachments.deleteTaskAttachment
  );

  // Handle saving attachment metadata after upload
  const handleUploadComplete = useCallback(
    async (item: UploadItem) => {
      if (!taskId || !item.storageId) return;

      await saveAttachmentMutation({
        taskId,
        storageId: item.storageId,
        fileName: item.fileName,
        fileSize: item.fileSize,
        contentType: item.contentType,
      });
    },
    [taskId, saveAttachmentMutation]
  );

  const { activeUploads, uploadFiles: baseUploadFiles } = useFileUpload({
    onUploadComplete: handleUploadComplete,
  });

  // Wrap uploadFiles to check taskId
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!taskId) {
        console.error("[Attachments] No taskId provided");
        return;
      }
      await baseUploadFiles(files);
    },
    [taskId, baseUploadFiles]
  );

  const deleteAttachment = useCallback(
    async (attachmentId: Id<"taskAttachments">) => {
      await deleteAttachmentMutation({ attachmentId });
    },
    [deleteAttachmentMutation]
  );

  // Convert UploadItem to UploadProgress for backwards compatibility
  const uploading: UploadProgress[] = activeUploads.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    progress: item.progress,
    status: item.status,
    error: item.error,
  }));

  return { attachments, uploadFiles, deleteAttachment, uploading };
}
