"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_ATTACHMENT_SIZE } from "@/convex/lib/constants";
import type { ImageDimensions } from "@/convex/lib/contracts/validators";
import { getContentType, readImageDimensions } from "@/lib/tasks/files";
import { isRecord } from "@/lib/type-guards";
import { getErrorMessage } from "@/lib/errors";

export interface StorageUploadItem {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  progress: number;
  status: "uploading" | "saving" | "done" | "error";
  error?: string;
  storageId?: Id<"_storage">;
  /** Images only; measured alongside the upload. */
  dimensions?: ImageDimensions;
}

interface ValidationErrorContext {
  item: StorageUploadItem;
  message: string;
}

interface UploadErrorContext {
  item: StorageUploadItem;
  error: Error;
}

interface UploadCompleteContext {
  item: StorageUploadItem & { storageId: Id<"_storage"> };
}

interface AbandonedUploadContext {
  item: StorageUploadItem;
  storageId: Id<"_storage">;
}

export interface UseStorageUploadQueueOptions {
  getUploadUrl: (file: File) => Promise<string>;
  /** Claims the blob right after the POST, before any abandon branch (OS-1901). */
  registerUpload?: (storageId: Id<"_storage">, file: File) => Promise<unknown>;
  onUploadComplete?: (context: UploadCompleteContext) => Promise<void>;
  onUploadError?: (context: UploadErrorContext) => void;
  onValidationError?: (context: ValidationErrorContext) => void;
  onAbandonedUpload?: (context: AbandonedUploadContext) => Promise<void> | void;
  maxSize?: number;
  autoRemoveDelay?: number;
  errorRemoveDelay?: number;
  /** Already-uploaded items the queue starts with (read once, e.g. a restored draft). */
  initialItems?: StorageUploadItem[];
}

function getStorageIdFromUploadResponse(payload: unknown): Id<"_storage"> {
  if (!isRecord(payload)) {
    throw new Error("Upload response is invalid");
  }

  const storageId = payload.storageId;
  if (typeof storageId !== "string") {
    throw new Error("Upload response missing storageId");
  }

  return storageId as Id<"_storage">;
}

/** POSTs one blob to a Convex upload URL and returns its storage id. */
export async function uploadToStorage(uploadUrl: string, body: Blob, contentType: string): Promise<Id<"_storage">> {
  const result = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

  if (!result.ok) {
    const errorText = await result.text();
    throw new Error(`Upload failed: ${result.status} ${errorText}`.trim());
  }

  return getStorageIdFromUploadResponse(await result.json());
}

export function useStorageUploadQueue(options: UseStorageUploadQueueOptions) {
  const {
    getUploadUrl,
    registerUpload,
    onUploadComplete,
    onUploadError,
    onValidationError,
    onAbandonedUpload,
    maxSize = MAX_ATTACHMENT_SIZE,
    autoRemoveDelay = 1000,
    errorRemoveDelay = 5000,
    initialItems = [],
  } = options;

  const [uploads, setUploads] = useState<StorageUploadItem[]>(initialItems);
  const uploadsRef = useRef<StorageUploadItem[]>(uploads);
  const inFlightUploadsRef = useRef(new Map<string, Promise<void>>());
  const removedUploadIdsRef = useRef(new Set<string>());
  const removeTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const isMountedRef = useRef(true);
  const getUploadUrlRef = useRef(getUploadUrl);
  const registerUploadRef = useRef(registerUpload);
  const onUploadCompleteRef = useRef(onUploadComplete);
  const onUploadErrorRef = useRef(onUploadError);
  const onValidationErrorRef = useRef(onValidationError);
  const onAbandonedUploadRef = useRef(onAbandonedUpload);

  useEffect(() => {
    getUploadUrlRef.current = getUploadUrl;
  }, [getUploadUrl]);

  useEffect(() => {
    registerUploadRef.current = registerUpload;
  }, [registerUpload]);

  useEffect(() => {
    onUploadCompleteRef.current = onUploadComplete;
  }, [onUploadComplete]);

  useEffect(() => {
    onUploadErrorRef.current = onUploadError;
  }, [onUploadError]);

  useEffect(() => {
    onValidationErrorRef.current = onValidationError;
  }, [onValidationError]);

  useEffect(() => {
    onAbandonedUploadRef.current = onAbandonedUpload;
  }, [onAbandonedUpload]);

  useEffect(() => {
    isMountedRef.current = true;
    const timers = removeTimersRef.current;
    return () => {
      isMountedRef.current = false;
      timers.forEach((timerId) => {
        clearTimeout(timerId);
      });
      timers.clear();
    };
  }, []);

  const setUploadsState = useCallback(
    (
      updater:
        | StorageUploadItem[]
        | ((previous: StorageUploadItem[]) => StorageUploadItem[])
    ) => {
      const next =
        typeof updater === "function" ? updater(uploadsRef.current) : updater;
      uploadsRef.current = next;
      setUploads(next);
    },
    []
  );

  const removeUpload = useCallback(
    (id: string) => {
      removedUploadIdsRef.current.add(id);
      setUploadsState((previous) => previous.filter((item) => item.id !== id));

      if (!inFlightUploadsRef.current.has(id)) {
        removedUploadIdsRef.current.delete(id);
      }
    },
    [setUploadsState]
  );

  const updateUpload = useCallback(
    (id: string, updates: Partial<StorageUploadItem>) => {
      setUploadsState((previous) =>
        previous.map((item) => (item.id === id ? { ...item, ...updates } : item))
      );
    },
    [setUploadsState]
  );

  const getUploadsSnapshot = useCallback(() => uploadsRef.current, []);

  const waitForInFlightUploads = useCallback(async () => {
    // Allow callers that enqueue uploads and submit in quick succession
    // to observe in-flight promises registered in the same tick.
    await Promise.resolve();
    while (inFlightUploadsRef.current.size > 0) {
      await Promise.all([...inFlightUploadsRef.current.values()]);
    }
  }, []);

  const clearUploads = useCallback(() => {
    const snapshot = uploadsRef.current;
    snapshot.forEach((item) => {
      removedUploadIdsRef.current.add(item.id);
    });
    setUploadsState([]);
    snapshot.forEach((item) => {
      if (!inFlightUploadsRef.current.has(item.id)) {
        removedUploadIdsRef.current.delete(item.id);
      }
    });
  }, [setUploadsState]);

  const scheduleRemove = useCallback(
    (id: string, delayMs: number) => {
      if (delayMs <= 0) {
        return;
      }

      const timeoutId = setTimeout(() => {
        removeTimersRef.current.delete(timeoutId);
        if (!isMountedRef.current) {
          return;
        }
        removeUpload(id);
      }, delayMs);
      removeTimersRef.current.add(timeoutId);
    },
    [removeUpload]
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const uploadId = crypto.randomUUID();
      const contentType = getContentType(file);

      if (file.size > maxSize) {
        const message = "File exceeds size limit";
        const item: StorageUploadItem = {
          id: uploadId,
          fileName: file.name,
          fileSize: file.size,
          contentType,
          progress: 0,
          status: "error",
          error: message,
        };
        setUploadsState((previous) => [...previous, item]);
        onValidationErrorRef.current?.({ item, message });
        scheduleRemove(uploadId, errorRemoveDelay);
        return uploadId;
      }

      const initialItem: StorageUploadItem = {
        id: uploadId,
        fileName: file.name,
        fileSize: file.size,
        contentType,
        progress: 0,
        status: "uploading",
      };

      setUploadsState((previous) => [...previous, initialItem]);

      const uploadPromise = (async () => {
        const dimensions = readImageDimensions(file);
        try {
          const storageId = await uploadToStorage(await getUploadUrlRef.current(file), file, contentType);
          // Before the abandon check: an unregistered blob has no owner to clean it up.
          await registerUploadRef.current?.(storageId, file);

          const currentItem =
            uploadsRef.current.find((item) => item.id === uploadId) ?? initialItem;

          if (
            removedUploadIdsRef.current.has(uploadId) ||
            !isMountedRef.current
          ) {
            await onAbandonedUploadRef.current?.({ item: currentItem, storageId });
            return;
          }

          updateUpload(uploadId, { status: "saving", progress: 90, storageId, dimensions: await dimensions });

          if (onUploadCompleteRef.current) {
            const completeItem: StorageUploadItem & { storageId: Id<"_storage"> } = {
              ...(uploadsRef.current.find((item) => item.id === uploadId) ?? currentItem),
              status: "saving",
              progress: 90,
              storageId,
            };
            await onUploadCompleteRef.current({ item: completeItem });
          }

          if (
            removedUploadIdsRef.current.has(uploadId) ||
            !isMountedRef.current
          ) {
            const abandonedItem =
              uploadsRef.current.find((item) => item.id === uploadId) ?? {
                ...currentItem,
                storageId,
              };
            await onAbandonedUploadRef.current?.({ item: abandonedItem, storageId });
            return;
          }

          updateUpload(uploadId, { status: "done", progress: 100, storageId });
          scheduleRemove(uploadId, autoRemoveDelay);
        } catch (error) {
          if (
            removedUploadIdsRef.current.has(uploadId) ||
            !isMountedRef.current
          ) {
            return;
          }

          const uploadError =
            error instanceof Error ? error : new Error(String(error));
          const currentItem =
            uploadsRef.current.find((item) => item.id === uploadId) ?? initialItem;
          updateUpload(uploadId, {
            status: "error",
            error: getErrorMessage(uploadError, String(error)),
          });
          onUploadErrorRef.current?.({ item: currentItem, error: uploadError });
          scheduleRemove(uploadId, errorRemoveDelay);
        } finally {
          inFlightUploadsRef.current.delete(uploadId);
          removedUploadIdsRef.current.delete(uploadId);
        }
      })();

      inFlightUploadsRef.current.set(uploadId, uploadPromise);
      await uploadPromise;
      return uploadId;
    },
    [
      autoRemoveDelay,
      errorRemoveDelay,
      maxSize,
      scheduleRemove,
      setUploadsState,
      updateUpload,
    ]
  );

  const uploadFilesWithIds = useCallback(
    async (files: File[]) => {
      return await Promise.all(files.map((file) => uploadFile(file)));
    },
    [uploadFile]
  );

  /**
   * Seed items that are already uploaded to storage (e.g. attachments
   * restored from an edited queued message). They enter the queue in `done`
   * state and behave like any finished upload: included in submit snapshots,
   * removable, and cleaned up on abandon.
   */
  const addUploadedItems = useCallback(
    (
      items: Array<{
        fileName: string;
        fileSize: number;
        contentType: string;
        storageId: Id<"_storage">;
        dimensions?: ImageDimensions;
      }>
    ): string[] => {
      if (items.length === 0) {
        return [];
      }

      const seeded: StorageUploadItem[] = items.map((item) => ({
        id: crypto.randomUUID(),
        fileName: item.fileName,
        fileSize: item.fileSize,
        contentType: item.contentType,
        progress: 100,
        status: "done",
        storageId: item.storageId,
        dimensions: item.dimensions,
      }));
      setUploadsState((previous) => [...previous, ...seeded]);
      return seeded.map((item) => item.id);
    },
    [setUploadsState]
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      await uploadFilesWithIds(files);
    },
    [uploadFilesWithIds]
  );

  const activeUploads = useMemo(
    () => uploads.filter((item) => item.status !== "done"),
    [uploads]
  );

  return {
    uploads,
    activeUploads,
    uploadFiles,
    uploadFilesWithIds,
    addUploadedItems,
    removeUpload,
    clearUploads,
    waitForInFlightUploads,
    getUploadsSnapshot,
  };
}
