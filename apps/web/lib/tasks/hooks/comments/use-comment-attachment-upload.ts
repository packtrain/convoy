"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useStorageUploadQueue } from "@/hooks/uploads/use-storage-upload-queue";

type InternalCommentAttachment = {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: "uploading" | "uploaded" | "error";
  error?: string;
  storageId?: Id<"_storage">;
};

export function useCommentAttachmentUpload(taskId: Id<"tasks">) {
  const generateUploadUrlMutation = useMutation(
    api.tasks.comments.generateTaskCommentAttachmentUploadUrl
  );
  const deletePendingAttachmentMutation = useMutation(
    api.tasks.comments.deletePendingUploadedAttachment
  );
  const registerPendingAttachmentMutation = useMutation(
    api.tasks.attachments.registerPendingUploadedAttachment
  );

  const cleanupUploadedStorage = useCallback(
    async (storageId: Id<"_storage">) => {
      try {
        await deletePendingAttachmentMutation({ taskId, storageId });
      } catch (error) {
        console.error("[useCommentAttachmentUpload] Failed to cleanup pending upload", error);
      }
    },
    [deletePendingAttachmentMutation, taskId]
  );
  const cleanupUploadedStorageRef = useRef(cleanupUploadedStorage);
  useEffect(() => {
    cleanupUploadedStorageRef.current = cleanupUploadedStorage;
  }, [cleanupUploadedStorage]);

  const {
    uploads,
    uploadFiles,
    removeUpload,
    clearUploads,
    waitForInFlightUploads,
    getUploadsSnapshot,
  } = useStorageUploadQueue({
    getUploadUrl: useCallback(
      async () => generateUploadUrlMutation({ taskId }),
      [generateUploadUrlMutation, taskId]
    ),
    registerUpload: useCallback(
      async (storageId: Id<"_storage">) => registerPendingAttachmentMutation({ storageId }),
      [registerPendingAttachmentMutation]
    ),
    onAbandonedUpload: async ({ storageId }) => {
      await cleanupUploadedStorageRef.current(storageId);
    },
    autoRemoveDelay: 0,
    errorRemoveDelay: 0,
  });

  const pendingAttachments = useMemo<InternalCommentAttachment[]>(
    () =>
      uploads.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        contentType: item.contentType,
        status: item.status === "done" ? "uploaded" : item.status === "error" ? "error" : "uploading",
        error: item.error,
        storageId: item.storageId,
      })),
    [uploads]
  );

  const removeAttachment = useCallback(
    async (id: string) => {
      const target = getUploadsSnapshot().find((item) => item.id === id);
      if (!target) {
        return;
      }

      if (target.storageId) {
        await cleanupUploadedStorage(target.storageId);
      }

      removeUpload(id);
    },
    [cleanupUploadedStorage, getUploadsSnapshot, removeUpload]
  );

  const getPendingAttachmentsSnapshot = useCallback(
    () =>
      getUploadsSnapshot().map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        contentType: item.contentType,
        status:
          item.status === "done"
            ? ("uploaded" as const)
            : item.status === "error"
            ? ("error" as const)
              : ("uploading" as const),
        error: item.error,
        storageId: item.storageId,
      })),
    [getUploadsSnapshot]
  );

  useEffect(() => {
    return () => {
      const snapshot = getUploadsSnapshot();
      snapshot.forEach((item) => {
        if (item.storageId) {
          void cleanupUploadedStorageRef.current(item.storageId);
        }
      });
      clearUploads();
    };
  }, [clearUploads, getUploadsSnapshot]);

  return {
    pendingAttachments,
    addFiles: uploadFiles,
    removeAttachment,
    waitForInFlightUploads,
    getPendingAttachmentsSnapshot,
    clearAfterSubmit: clearUploads,
  };
}
