"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_ATTACHMENT_SIZE, MAX_ATTACHMENT_SIZE_MB } from "@/convex/lib/constants";
import { useStorageUploadQueue, type StorageUploadItem } from "./use-storage-upload-queue";

export type UploadItem = StorageUploadItem;

export interface UseFileUploadOptions {
  /** Called after successful upload to storage, before marking as done */
  onUploadComplete?: (item: UploadItem) => Promise<void>;
  /** Called when an upload fails */
  onUploadError?: (item: UploadItem, error: Error) => void;
  /** Max file size in bytes (defaults to MAX_ATTACHMENT_SIZE) */
  maxSize?: number;
  /** Auto-remove completed uploads after this delay (ms). Set to 0 to disable. */
  autoRemoveDelay?: number;
  /** Auto-remove errors after this delay (ms). Set to 0 to disable. */
  errorRemoveDelay?: number;
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const {
    onUploadComplete,
    onUploadError,
    maxSize = MAX_ATTACHMENT_SIZE,
    autoRemoveDelay = 1000,
    errorRemoveDelay = 5000,
  } = options;

  const generateUploadUrl = useMutation(api.tasks.attachments.generateTaskAttachmentUploadUrl);
  const registerPendingUpload = useMutation(api.tasks.attachments.registerPendingUploadedAttachment);
  const { uploads, activeUploads, uploadFiles, removeUpload } = useStorageUploadQueue({
    getUploadUrl: useCallback(async () => generateUploadUrl({}), [generateUploadUrl]),
    registerUpload: useCallback(
      async (storageId: Id<"_storage">) => registerPendingUpload({ storageId }),
      [registerPendingUpload]
    ),
    onUploadComplete: onUploadComplete
      ? async ({ item }) => {
          await onUploadComplete(item);
        }
      : undefined,
    onUploadError: ({ item, error }) => {
      toast.error(`Upload failed: ${item.fileName}`, { description: error.message });
      onUploadError?.(item, error);
    },
    onValidationError: ({ item }) => {
      toast.error(`Upload failed: ${item.fileName}`, {
        description: `File exceeds ${MAX_ATTACHMENT_SIZE_MB} MB limit`,
      });
    },
    maxSize,
    autoRemoveDelay,
    errorRemoveDelay,
  });

  return {
    uploads,
    activeUploads,
    uploadFiles,
    removeUpload,
  };
}
