/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useThreadMessageAttachmentUpload,
  type ThreadComposerFilePart,
} from "./use-thread-message-attachment-upload";

const useMutationMock = vi.fn();
const generateUploadUrlMutationMock = vi.fn();
const deletePendingAttachmentMutationMock = vi.fn();
const registerPendingAttachmentMutationMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

describe("useThreadMessageAttachmentUpload", () => {
  const projectId = "project_1" as Id<"projects">;

  beforeEach(() => {
    useMutationMock.mockReset();
    generateUploadUrlMutationMock.mockReset();
    deletePendingAttachmentMutationMock.mockReset();
    registerPendingAttachmentMutationMock.mockReset();
    fetchMock.mockReset();

    useMutationMock.mockImplementation((ref: unknown) => {
      const mutationName = getFunctionName(
        ref as Parameters<typeof getFunctionName>[0]
      );
      if (mutationName === "cli/messages:generateMessageAttachmentUploadUrl") {
        return generateUploadUrlMutationMock;
      }
      if (mutationName === "cli/messages:deletePendingUploadedAttachment") {
        return deletePendingAttachmentMutationMock;
      }
      if (mutationName === "cli/messages:registerPendingUploadedAttachment") {
        return registerPendingAttachmentMutationMock;
      }
      throw new Error(`Unexpected mutation ref: ${mutationName}`);
    });

    generateUploadUrlMutationMock.mockResolvedValue("https://upload.test");
    deletePendingAttachmentMutationMock.mockResolvedValue(null);
    registerPendingAttachmentMutationMock.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  const pastePart: ThreadComposerFilePart = { id: "part_1", type: "file", filename: "paste.png", mediaType: "image/png", url: "blob:paste" };
  const serveBlobAndUpload = (upload: unknown) => (input: RequestInfo | URL) =>
    Promise.resolve(input === "https://upload.test" ? upload : { ok: true, blob: async () => new Blob(["img"], { type: "image/png" }) });

  test("uploads and exposes uploaded pending attachment state", async () => {
    fetchMock.mockImplementation(serveBlobAndUpload({ ok: true, json: async () => ({ storageId: "storage_1" }) }));

    const { result } = renderHook(() =>
      useThreadMessageAttachmentUpload(projectId)
    );

    await act(async () => {
      await result.current.syncFileParts([pastePart]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments).toHaveLength(1);
      expect(result.current.pendingAttachments[0]?.status).toBe("uploaded");
    });
    expect(registerPendingAttachmentMutationMock).toHaveBeenCalledWith({
      projectId,
      storageId: "storage_1",
    });
  });

  test("sets error state when upload fails", async () => {
    fetchMock.mockImplementation(serveBlobAndUpload({ ok: false, status: 500, text: async () => "fail" }));

    const { result } = renderHook(() =>
      useThreadMessageAttachmentUpload(projectId)
    );

    await act(async () => {
      await result.current.syncFileParts([pastePart]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments).toHaveLength(1);
      expect(result.current.pendingAttachments[0]?.status).toBe("error");
    });
  });

  test("syncFileParts uploads new file parts and cleans up removed parts", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "blob://attachment-1") {
        return {
          ok: true,
          blob: async () => new Blob(["img-1"], { type: "image/png" }),
        };
      }
      if (input === "https://upload.test") {
        return {
          ok: true,
          json: async () => ({ storageId: "storage_1" }),
        };
      }
      throw new Error(`Unexpected fetch call: ${String(input)}`);
    });

    const { result } = renderHook(() =>
      useThreadMessageAttachmentUpload(projectId)
    );

    const filePart: ThreadComposerFilePart = {
      id: "file_part_1",
      type: "file",
      filename: "paste.png",
      mediaType: "image/png",
      url: "blob://attachment-1",
    };

    await act(async () => {
      await result.current.syncFileParts([filePart]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments[0]?.status).toBe("uploaded");
      expect(result.current.pendingAttachments[0]?.filePartId).toBe("file_part_1");
    });

    await act(async () => {
      await result.current.syncFileParts([]);
    });

    expect(deletePendingAttachmentMutationMock).toHaveBeenCalledWith({
      projectId,
      storageId: "storage_1",
    });
  });

  test("overlapping syncs upload each file once and clean up removal before completion", async () => {
    let finishUpload!: (value: unknown) => void;
    const upload = new Promise(resolve => { finishUpload = resolve; });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => input === "https://upload.test" ? upload : {
      ok: true, blob: async () => new Blob(["img"], { type: "image/png" }),
    });
    const { result } = renderHook(() => useThreadMessageAttachmentUpload(projectId));
    const first: ThreadComposerFilePart = { id: "first", type: "file", filename: "image.png", mediaType: "image/png", url: "blob:first" };
    const second: ThreadComposerFilePart = { ...first, id: "second", filename: "image-2.png", url: "blob:second" };
    let firstSync!: Promise<void>;
    let secondSync!: Promise<void>;
    act(() => { firstSync = result.current.syncFileParts([first]); });
    await waitFor(() => expect(result.current.pendingAttachments).toHaveLength(1));
    act(() => { secondSync = result.current.syncFileParts([first, second]); });
    await waitFor(() => expect(result.current.pendingAttachments).toHaveLength(2));
    act(() => { void result.current.syncFileParts([second]); });
    await act(async () => {
      finishUpload({ ok: true, json: async () => ({ storageId: "storage_1" }) });
      await Promise.all([firstSync, secondSync]);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === "blob:first")).toHaveLength(1);
    expect(result.current.pendingAttachments.map(item => item.fileName)).toEqual(["image-2.png"]);
    expect(deletePendingAttachmentMutationMock).toHaveBeenCalledWith({ projectId, storageId: "storage_1" });
  });

  test("submit waits for file preparation before reading uploaded metadata", async () => {
    let resolveBlob!: (blob: Blob) => void;
    const blob = new Promise<Blob>(resolve => { resolveBlob = resolve; });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => input === "https://upload.test" ? {
      ok: true, json: async () => ({ storageId: "storage_1" }),
    } : { ok: true, blob: () => blob });
    const { result } = renderHook(() => useThreadMessageAttachmentUpload(projectId));
    let sync!: Promise<void>;
    let submit!: ReturnType<typeof result.current.prepareAttachmentsForSubmit>;
    act(() => {
      sync = result.current.syncFileParts([{ id: "file", type: "file", filename: "image-2.png", mediaType: "image/png", url: "blob:pending" }]);
      submit = result.current.prepareAttachmentsForSubmit();
    });
    await act(async () => { resolveBlob(new Blob(["image"], { type: "image/png" })); await sync; });
    expect(await submit).toEqual([{ storageId: "storage_1", fileName: "image-2.png", fileSize: 5, contentType: "image/png" }]);
  });

  test("an image's dimensions reach the submit input and the draft", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 400, close: vi.fn() }));
    fetchMock.mockImplementation(serveBlobAndUpload({ ok: true, json: async () => ({ storageId: "storage_1" }) }));
    const save = vi.fn();
    const { result } = renderHook(() => useThreadMessageAttachmentUpload(projectId, { attachments: undefined, save }));

    await act(async () => {
      await result.current.syncFileParts([pastePart]);
    });

    const dimensions = { width: 800, height: 400 };
    expect(await result.current.prepareAttachmentsForSubmit()).toEqual([expect.objectContaining({ storageId: "storage_1", dimensions })]);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ uploaded: [expect.objectContaining({ dimensions })] })));
  });

  test("restored and seeded uploads keep their dimensions", async () => {
    const dimensions = { width: 800, height: 400 };
    const uploaded = { filePartId: "part_1", storageId: "storage_1", fileName: "paste.png", fileSize: 3, contentType: "image/png", dimensions };
    const { result } = renderHook(() =>
      useThreadMessageAttachmentUpload(projectId, { attachments: { pending: true, uploaded: [uploaded] }, save: vi.fn() })
    );
    act(() => {
      result.current.seedUploadedAttachments([{ filePartId: "part_2", storageId: "storage_2" as Id<"_storage">, fileName: "seed.png", fileSize: 3, contentType: "image/png", dimensions }]);
    });

    expect(await result.current.prepareAttachmentsForSubmit()).toEqual([
      expect.objectContaining({ storageId: "storage_1", dimensions }),
      expect.objectContaining({ storageId: "storage_2", dimensions }),
    ]);
  });

  test("file preparation failures expose an error and block submit until removal", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useThreadMessageAttachmentUpload(projectId));
    await act(async () => {
      await expect(result.current.syncFileParts([{ id: "broken", type: "file", filename: "image.png", mediaType: "image/png", url: "blob:broken" }])).rejects.toThrow("Failed to read attachment");
    });
    expect(result.current.pendingAttachments).toEqual([expect.objectContaining({ filePartId: "broken", status: "error" })]);
    await expect(result.current.prepareAttachmentsForSubmit()).rejects.toMatchObject({ code: "error" });
    await act(async () => { await result.current.syncFileParts([]); });
    expect(await result.current.prepareAttachmentsForSubmit()).toEqual([]);
  });

  test("draft-bound uploads are saved to the draft and survive unmount (OS-2141)", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      input === "https://upload.test"
        ? { ok: true, json: async () => ({ storageId: "storage_1" }) }
        : { ok: true, blob: async () => new Blob(["img"], { type: "image/png" }) }
    );
    registerPendingAttachmentMutationMock.mockResolvedValue("https://files.test/storage_1");
    const save = vi.fn();

    const { result, unmount } = renderHook(() =>
      useThreadMessageAttachmentUpload(projectId, { attachments: undefined, save })
    );
    await act(async () => {
      await result.current.syncFileParts([{ id: "part_1", type: "file", filename: "paste.png", mediaType: "image/png", url: "blob:paste" }]);
    });

    await waitFor(() => {
      expect(save).toHaveBeenLastCalledWith({
        pending: true,
        uploaded: [{ filePartId: "part_1", storageId: "storage_1", fileName: "paste.png", fileSize: 3, contentType: "image/png", url: "https://files.test/storage_1" }],
      });
    });

    unmount();
    await Promise.resolve();
    expect(deletePendingAttachmentMutationMock).not.toHaveBeenCalled();
  });

  test("restores draft uploads without uploading them again (OS-2141)", async () => {
    const uploaded = { filePartId: "part_1", storageId: "storage_1", fileName: "paste.png", fileSize: 3, contentType: "image/png", url: "https://files.test/storage_1" };
    const save = vi.fn();

    const { result } = renderHook(() =>
      useThreadMessageAttachmentUpload(projectId, { attachments: { pending: true, uploaded: [uploaded] }, save })
    );

    expect(result.current.pendingAttachments).toEqual([expect.objectContaining({ filePartId: "part_1", status: "uploaded", storageId: "storage_1" })]);
    expect(result.current.draftFileParts).toEqual([{ id: "part_1", type: "file", filename: "paste.png", mediaType: "image/png", url: "https://files.test/storage_1" }]);
    await act(async () => {
      await result.current.syncFileParts(result.current.draftFileParts);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await result.current.prepareAttachmentsForSubmit()).toEqual([
      { storageId: "storage_1", fileName: "paste.png", fileSize: 3, contentType: "image/png" },
    ]);
    // Re-registering keeps the restored blob from aging into the retention sweep.
    expect(registerPendingAttachmentMutationMock).toHaveBeenCalledWith({ projectId, storageId: "storage_1" });
  });

  test("a Strict Mode remount keeps restored draft uploads queued (OS-517)", async () => {
    const uploaded = { filePartId: "part_1", storageId: "storage_1", fileName: "paste.png", fileSize: 3, contentType: "image/png" };

    const { result } = renderHook(
      () => useThreadMessageAttachmentUpload(projectId, { attachments: { pending: true, uploaded: [uploaded] }, save: vi.fn() }),
      { wrapper: StrictMode }
    );
    await act(async () => {});

    expect(result.current.pendingAttachments).toEqual([expect.objectContaining({ filePartId: "part_1", status: "uploaded", storageId: "storage_1" })]);
    expect(deletePendingAttachmentMutationMock).not.toHaveBeenCalled();
  });

  test("cleans up uploaded storage on unmount", async () => {
    fetchMock.mockImplementation(serveBlobAndUpload({ ok: true, json: async () => ({ storageId: "storage_1" }) }));

    const { result, unmount } = renderHook(() =>
      useThreadMessageAttachmentUpload(projectId)
    );

    await act(async () => {
      await result.current.syncFileParts([pastePart]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments[0]?.status).toBe("uploaded");
    });

    unmount();

    await waitFor(() => {
      expect(deletePendingAttachmentMutationMock).toHaveBeenCalledWith({
        projectId,
        storageId: "storage_1",
      });
    });
  });
});
