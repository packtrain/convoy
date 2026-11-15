"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import type { FileUIPart } from "ai";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ImageDimensions } from "@/convex/lib/contracts/validators";
import { useStorageUploadQueue } from "@/hooks/uploads/use-storage-upload-queue";
import type { ThreadComposerDraftAttachment, ThreadComposerDraftAttachments } from "@/lib/threads/draft-storage";
import { getErrorMessage } from "@/lib/errors";

export interface ThreadPendingAttachment {
  id: string;
  filePartId?: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: "uploading" | "uploaded" | "error";
  error?: string;
  storageId?: Id<"_storage">;
}

export interface ThreadMessageAttachmentInput {
  storageId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  contentType: string;
  dimensions?: ImageDimensions;
}

export type ThreadComposerFilePart = FileUIPart & { id: string };

export class ThreadAttachmentSubmitError extends Error {
  code: "uploading" | "error";

  constructor(code: "uploading" | "error") {
    super(
      code === "error"
        ? "Please remove failed attachments before sending."
        : "Please wait for uploads to finish."
    );
    this.code = code;
  }
}

export function isThreadAttachmentSubmitError(
  error: unknown
): error is ThreadAttachmentSubmitError {
  return error instanceof ThreadAttachmentSubmitError;
}

function mapUploadStatus(
  status: "uploading" | "saving" | "done" | "error"
): ThreadPendingAttachment["status"] {
  if (status === "done") {
    return "uploaded";
  }
  if (status === "error") {
    return "error";
  }
  return "uploading";
}

async function filePartToFile(filePart: FileUIPart): Promise<File> {
  if (typeof filePart.url !== "string" || filePart.url.length === 0) {
    throw new Error("Attachment URL is missing");
  }

  const fileName = filePart.filename ?? "attachment";
  const response = await fetch(filePart.url);
  if (!response.ok) {
    throw new Error(`Failed to read attachment: ${fileName}`);
  }
  const blob = await response.blob();
  const contentType = filePart.mediaType || blob.type || "application/octet-stream";
  return new File([blob], fileName, { type: contentType });
}

/** Keeps finished uploads in a composer draft so they survive remounts (OS-2141). */
export interface ThreadAttachmentDraftBinding {
  /** Read once, at mount. */
  attachments: ThreadComposerDraftAttachments | undefined;
  save: (attachments: ThreadComposerDraftAttachments) => void;
}

function draftAttachmentsSignature(attachments: ThreadComposerDraftAttachments | undefined): string {
  const uploaded = (attachments?.uploaded ?? []).map((item) => `${item.filePartId}:${item.storageId}:${item.url ?? ""}`);
  return [attachments?.pending === true, ...uploaded].join("|");
}

export function useThreadMessageAttachmentUpload(
  projectId: Id<"projects"> | undefined,
  draft?: ThreadAttachmentDraftBinding
) {
  const [isDraftBound] = useState(draft !== undefined);
  const [restored] = useState(() => draft?.attachments?.uploaded ?? []);
  const [urlByStorageId, setUrlByStorageId] = useState<Record<string, string>>(() =>
    Object.fromEntries(restored.flatMap((item) => (item.url ? [[item.storageId, item.url]] : [])))
  );
  const saveDraftRef = useRef(draft?.save);
  useEffect(() => {
    saveDraftRef.current = draft?.save;
  });
  const lastSavedDraftRef = useRef(draftAttachmentsSignature(draft?.attachments));
  const persistedStorageIdsRef = useRef(new Set<string>(restored.map((item) => item.storageId)));

  const generateUploadUrlMutation = useMutation(
    api.cli.messages.generateMessageAttachmentUploadUrl
  );
  const deletePendingAttachmentMutation = useMutation(
    api.cli.messages.deletePendingUploadedAttachment
  );
  const registerPendingAttachmentMutation = useMutation(
    api.cli.messages.registerPendingUploadedAttachment
  );

  const cleanupUploadedStorage = useCallback(
    async (storageId: Id<"_storage">) => {
      if (!projectId) return;
      try {
        await deletePendingAttachmentMutation({ projectId, storageId });
      } catch (error) {
        console.error(
          "[useThreadMessageAttachmentUpload] Failed to cleanup pending upload",
          error
        );
      }
    },
    [deletePendingAttachmentMutation, projectId]
  );
  const cleanupUploadedStorageRef = useRef(cleanupUploadedStorage);
  useEffect(() => {
    cleanupUploadedStorageRef.current = cleanupUploadedStorage;
  }, [cleanupUploadedStorage]);

  const {
    uploads,
    uploadFilesWithIds,
    addUploadedItems,
    removeUpload,
    clearUploads,
    waitForInFlightUploads,
    getUploadsSnapshot,
  } = useStorageUploadQueue({
    getUploadUrl: useCallback(async () => {
      if (!projectId) {
        throw new Error("Project is required to upload attachments");
      }
      return await generateUploadUrlMutation({ projectId });
    }, [generateUploadUrlMutation, projectId]),
    registerUpload: useCallback(
      async (storageId: Id<"_storage">) => {
        if (!projectId) {
          throw new Error("Project is required to register uploaded attachments");
        }
        const url = await registerPendingAttachmentMutation({ projectId, storageId });
        if (url) {
          setUrlByStorageId((previous) => ({ ...previous, [storageId]: url }));
        }
      },
      [projectId, registerPendingAttachmentMutation]
    ),
    onAbandonedUpload: async ({ storageId }) => {
      await cleanupUploadedStorageRef.current(storageId);
    },
    autoRemoveDelay: 0,
    errorRemoveDelay: 0,
    // Restored items reuse their file-part id as the upload id.
    initialItems: restored.map((item) => ({
      id: item.filePartId,
      fileName: item.fileName,
      fileSize: item.fileSize,
      contentType: item.contentType,
      progress: 100,
      status: "done",
      storageId: item.storageId as Id<"_storage">,
      dimensions: item.dimensions,
    })),
  });
  const filePartToUploadIdRef = useRef(new Map<string, string>(restored.map((item) => [item.filePartId, item.filePartId])));
  const syncingFilePartsRef = useRef(new Map<string, Promise<void>>());
  const activeFilePartIdsRef = useRef(new Set<string>());
  const syncGenerationRef = useRef(0);
  const preparationErrorsRef = useRef(new Map<string, ThreadPendingAttachment>());
  const [preparationErrors, setPreparationErrors] = useState<ThreadPendingAttachment[]>([]);
  const [uploadIdToFilePartId, setUploadIdToFilePartId] = useState<
    Record<string, string>
  >(() => Object.fromEntries(restored.map((item) => [item.filePartId, item.filePartId])));

  const pendingAttachments = useMemo<ThreadPendingAttachment[]>(
    () =>
      uploads.map<ThreadPendingAttachment>((item) => ({
        id: item.id,
        filePartId: uploadIdToFilePartId[item.id],
        fileName: item.fileName,
        fileSize: item.fileSize,
        contentType: item.contentType,
        status: mapUploadStatus(item.status),
        error: item.error,
        storageId: item.storageId,
      })).concat(preparationErrors),
    [uploadIdToFilePartId, uploads, preparationErrors]
  );

  const draftUploads = useMemo<ThreadComposerDraftAttachment[]>(
    () =>
      uploads.flatMap((item) => {
        const filePartId = uploadIdToFilePartId[item.id];
        if (item.status !== "done" || !item.storageId || !filePartId) return [];
        const url = urlByStorageId[item.storageId];
        return [{
          filePartId,
          storageId: item.storageId,
          fileName: item.fileName,
          fileSize: item.fileSize,
          contentType: item.contentType,
          ...(url ? { url } : {}),
          ...(item.dimensions ? { dimensions: item.dimensions } : {}),
        }];
      }),
    [uploadIdToFilePartId, uploads, urlByStorageId]
  );
  /** Composer parts for the draft's uploads; pass as the composer's `initialAttachments`. */
  const draftFileParts = useMemo<ThreadComposerFilePart[]>(
    () =>
      draftUploads.map((item) => ({
        id: item.filePartId,
        type: "file",
        filename: item.fileName,
        mediaType: item.contentType,
        url: item.url ?? "",
      })),
    [draftUploads]
  );
  const hasAttachments = pendingAttachments.length > 0;

  useEffect(() => {
    if (!isDraftBound) return;
    persistedStorageIdsRef.current = new Set(draftUploads.map((item) => item.storageId));
    const next: ThreadComposerDraftAttachments = draftUploads.length > 0
      ? { pending: hasAttachments, uploaded: draftUploads }
      : { pending: hasAttachments };
    const signature = draftAttachmentsSignature(next);
    if (signature === lastSavedDraftRef.current) return;
    lastSavedDraftRef.current = signature;
    saveDraftRef.current?.(next);
  }, [draftUploads, hasAttachments, isDraftBound]);

  // Refresh restored rows so the retention sweep doesn't reclaim a live draft's files.
  useEffect(() => {
    if (!projectId) return;
    for (const item of restored) {
      void registerPendingAttachmentMutation({ projectId, storageId: item.storageId as Id<"_storage"> }).catch((error: unknown) => {
        console.error("[useThreadMessageAttachmentUpload] Failed to refresh restored upload", error);
      });
    }
  }, [projectId, registerPendingAttachmentMutation, restored]);

  const addFileParts = useCallback(
    async (fileParts: FileUIPart[]) => {
      const files = await Promise.all(
        fileParts.map((filePart) => filePartToFile(filePart))
      );
      return await uploadFilesWithIds(files);
    },
    [uploadFilesWithIds]
  );

  /**
   * Seed attachments that are already uploaded to storage (e.g. restored
   * from an edited queued message). Registers the composer file-part mapping
   * up front so `syncFileParts` treats them as existing and does not
   * re-upload; removal and abandon cleanup work like any uploaded item.
   * Call this BEFORE adding the matching file parts to the composer.
   */
  const seedUploadedAttachments = useCallback(
    (
      seeds: Array<{
        filePartId: string;
        storageId: Id<"_storage">;
        fileName: string;
        fileSize: number;
        contentType: string;
        url?: string | null;
        dimensions?: ImageDimensions;
      }>
    ) => {
      if (seeds.length === 0) {
        return;
      }
      const seededUrls = Object.fromEntries(seeds.flatMap((seed) => (seed.url ? [[seed.storageId, seed.url]] : [])));
      setUrlByStorageId((previous) => ({ ...previous, ...seededUrls }));

      const uploadIds = addUploadedItems(
        seeds.map((seed) => ({
          fileName: seed.fileName,
          fileSize: seed.fileSize,
          contentType: seed.contentType,
          storageId: seed.storageId,
          dimensions: seed.dimensions,
        }))
      );
      const nextMappings: Record<string, string> = {};
      seeds.forEach((seed, index) => {
        const uploadId = uploadIds[index];
        if (uploadId) {
          filePartToUploadIdRef.current.set(seed.filePartId, uploadId);
          nextMappings[uploadId] = seed.filePartId;
        }
      });
      if (Object.keys(nextMappings).length > 0) {
        setUploadIdToFilePartId((previous) => ({
          ...previous,
          ...nextMappings,
        }));
      }
    },
    [addUploadedItems]
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
      for (const [filePartId, uploadId] of filePartToUploadIdRef.current.entries()) {
        if (uploadId === id) {
          filePartToUploadIdRef.current.delete(filePartId);
        }
      }
      setUploadIdToFilePartId((previous) => {
        if (!(id in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[id];
        return next;
      });
    },
    [cleanupUploadedStorage, getUploadsSnapshot, removeUpload]
  );

  const syncFileParts = useCallback(
    async (fileParts: ThreadComposerFilePart[]) => {
      const generation = syncGenerationRef.current;
      activeFilePartIdsRef.current = new Set(fileParts.map(file => file.id));
      for (const id of preparationErrorsRef.current.keys()) {
        if (!activeFilePartIdsRef.current.has(id)) {
          preparationErrorsRef.current.delete(id);
          setPreparationErrors([...preparationErrorsRef.current.values()]);
        }
      }
      const removals = [...filePartToUploadIdRef.current.entries()]
        .filter(([id]) => !activeFilePartIdsRef.current.has(id))
        .map(([id, uploadId]) => {
          filePartToUploadIdRef.current.delete(id);
          return removeAttachment(uploadId);
        });

      for (const filePart of fileParts) {
        if (filePartToUploadIdRef.current.has(filePart.id) || syncingFilePartsRef.current.has(filePart.id) || preparationErrorsRef.current.has(filePart.id)) continue;
        const work = (async () => {
          try {
            const [uploadId] = await addFileParts([filePart]);
            if (!uploadId) return;
            if (syncGenerationRef.current !== generation || !activeFilePartIdsRef.current.has(filePart.id)) {
              await removeAttachment(uploadId);
              return;
            }
            filePartToUploadIdRef.current.set(filePart.id, uploadId);
            setUploadIdToFilePartId(previous => ({ ...previous, [uploadId]: filePart.id }));
          } catch (error) {
            if (syncGenerationRef.current !== generation || !activeFilePartIdsRef.current.has(filePart.id)) return;
            preparationErrorsRef.current.set(filePart.id, {
              id: filePart.id, filePartId: filePart.id, fileName: filePart.filename ?? "attachment",
              fileSize: 0, contentType: filePart.mediaType, status: "error",
              error: getErrorMessage(error, "Failed to read attachment"),
            });
            setPreparationErrors([...preparationErrorsRef.current.values()]);
            throw error;
          } finally {
            if (syncGenerationRef.current === generation) syncingFilePartsRef.current.delete(filePart.id);
          }
        })();
        syncingFilePartsRef.current.set(filePart.id, work);
      }
      await Promise.all([...removals, ...syncingFilePartsRef.current.values()]);
    },
    [addFileParts, removeAttachment]
  );

  const getPendingAttachmentsSnapshot = useCallback(
    () =>
      getUploadsSnapshot().map<ThreadPendingAttachment>((item) => ({
        id: item.id,
        filePartId: uploadIdToFilePartId[item.id],
        fileName: item.fileName,
        fileSize: item.fileSize,
        contentType: item.contentType,
        status: mapUploadStatus(item.status),
        error: item.error,
        storageId: item.storageId,
      })).concat([...preparationErrorsRef.current.values()]),
    [getUploadsSnapshot, uploadIdToFilePartId]
  );

  const getUploadedAttachmentInputs = useCallback(
    () => {
      const uploaded = getUploadsSnapshot().filter(
        (upload) => upload.status === "done" && upload.storageId !== undefined
      );

      return uploaded.map((upload) => ({
        storageId: upload.storageId as Id<"_storage">,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        contentType: upload.contentType,
        dimensions: upload.dimensions,
      }));
    },
    [getUploadsSnapshot]
  );

  const prepareAttachmentsForSubmit = useCallback(async () => {
    await Promise.allSettled(syncingFilePartsRef.current.values());
    await waitForInFlightUploads();
    const attachmentSnapshot = getPendingAttachmentsSnapshot();
    if (attachmentSnapshot.some((attachment) => attachment.status === "error")) {
      throw new ThreadAttachmentSubmitError("error");
    }
    if (attachmentSnapshot.some((attachment) => attachment.status === "uploading")) {
      throw new ThreadAttachmentSubmitError("uploading");
    }
    return getUploadedAttachmentInputs();
  }, [
    getPendingAttachmentsSnapshot,
    getUploadedAttachmentInputs,
    waitForInFlightUploads,
  ]);

  // Unmount only releases storage; state updates on an unmounting component
  // are no-ops, and a Strict Mode remount must find its uploads still queued.
  useEffect(() => {
    const syncingFileParts = syncingFilePartsRef.current;
    return () => {
      syncGenerationRef.current += 1;
      activeFilePartIdsRef.current.clear();
      syncingFileParts.clear();
      // Draft-bound uploads outlive the composer (OS-2141).
      const kept = persistedStorageIdsRef.current;
      for (const item of getUploadsSnapshot()) {
        if (item.storageId && !kept.has(item.storageId)) {
          void cleanupUploadedStorageRef.current(item.storageId);
        }
      }
    };
  }, [getUploadsSnapshot]);

  const clearAfterSubmit = useCallback(() => {
    preparationErrorsRef.current.clear();
    setPreparationErrors([]);
    syncGenerationRef.current += 1;
    activeFilePartIdsRef.current.clear();
    syncingFilePartsRef.current.clear();
    filePartToUploadIdRef.current.clear();
    setUploadIdToFilePartId({});
    clearUploads();
  }, [clearUploads]);

  return {
    pendingAttachments,
    seedUploadedAttachments,
    syncFileParts,
    removeAttachment,
    waitForInFlightUploads,
    getPendingAttachmentsSnapshot,
    getUploadedAttachmentInputs,
    prepareAttachmentsForSubmit,
    clearAfterSubmit,
    draftFileParts,
  };
}
