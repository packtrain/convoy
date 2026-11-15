/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorageUploadQueue } from "./use-storage-upload-queue";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useStorageUploadQueue", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("uploads successfully and runs post-upload completion callback", async () => {
    const getUploadUrl = vi.fn().mockResolvedValue("https://upload.test");
    const onUploadComplete = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl,
        onUploadComplete,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    await act(async () => {
      await result.current.uploadFiles([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(1);
      expect(result.current.uploads[0]?.status).toBe("done");
    });

    expect(getUploadUrl).toHaveBeenCalledTimes(1);
    expect(onUploadComplete).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("measures an image's pixel size before it finishes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ storageId: "storage_1" }) }));
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 400, close: vi.fn() }));
    const { result } = renderHook(() =>
      useStorageUploadQueue({ getUploadUrl: vi.fn().mockResolvedValue("https://upload.test"), autoRemoveDelay: 0, errorRemoveDelay: 0 })
    );

    await act(async () => {
      await result.current.uploadFiles([
        new File(["image"], "image.png", { type: "image/png" }),
        new File(["text"], "notes.txt", { type: "text/plain" }),
      ]);
    });

    expect(result.current.uploads.map((item) => item.dimensions)).toEqual([{ width: 800, height: 400 }, undefined]);
  });

  test("sets error status and calls onUploadError when upload fails", async () => {
    const getUploadUrl = vi.fn().mockResolvedValue("https://upload.test");
    const onUploadError = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      })
    );

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl,
        onUploadError,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    await act(async () => {
      await result.current.uploadFiles([
        new File(["doc"], "doc.txt", { type: "text/plain" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(1);
      expect(result.current.uploads[0]?.status).toBe("error");
    });

    expect(onUploadError).toHaveBeenCalledTimes(1);
  });

  test("handles file-size validation before upload", async () => {
    const getUploadUrl = vi.fn();
    const onValidationError = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl,
        onValidationError,
        maxSize: 1,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    await act(async () => {
      await result.current.uploadFiles([
        new File(["too-big"], "big.bin", { type: "application/octet-stream" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(1);
      expect(result.current.uploads[0]?.status).toBe("error");
    });

    expect(getUploadUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledTimes(1);
  });

  test("invokes onAbandonedUpload when an in-flight upload is removed", async () => {
    const deferred = createDeferred<{
      ok: boolean;
      json: () => Promise<{ storageId: string }>;
    }>();
    const getUploadUrl = vi.fn().mockResolvedValue("https://upload.test");
    const onAbandonedUpload = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(deferred.promise));

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl,
        onAbandonedUpload,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    let uploadPromise: Promise<void> | undefined;
    await act(async () => {
      uploadPromise = result.current.uploadFiles([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(1);
      expect(result.current.uploads[0]?.status).toBe("uploading");
    });

    const uploadId = result.current.uploads[0]?.id;
    expect(uploadId).toBeDefined();

    act(() => {
      result.current.removeUpload(uploadId ?? "");
    });

    await act(async () => {
      deferred.resolve({
        ok: true,
        json: async () => ({ storageId: "storage_1" }),
      });
      await uploadPromise;
    });

    expect(onAbandonedUpload).toHaveBeenCalledTimes(1);
    expect(result.current.uploads).toHaveLength(0);
  });

  test("registers the upload before abandoning an in-flight removal (OS-1901)", async () => {
    const deferred = createDeferred<{
      ok: boolean;
      json: () => Promise<{ storageId: string }>;
    }>();
    const getUploadUrl = vi.fn().mockResolvedValue("https://upload.test");
    const registerUpload = vi.fn().mockResolvedValue(undefined);
    const onAbandonedUpload = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(deferred.promise));

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl,
        registerUpload,
        onAbandonedUpload,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    let uploadPromise: Promise<void> | undefined;
    await act(async () => {
      uploadPromise = result.current.uploadFiles([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });
    await waitFor(() => {
      expect(result.current.uploads[0]?.status).toBe("uploading");
    });

    act(() => {
      result.current.removeUpload(result.current.uploads[0]?.id ?? "");
    });
    await act(async () => {
      deferred.resolve({
        ok: true,
        json: async () => ({ storageId: "storage_1" }),
      });
      await uploadPromise;
    });

    expect(registerUpload).toHaveBeenCalledWith("storage_1");
    expect(onAbandonedUpload).toHaveBeenCalledTimes(1);
    expect(registerUpload.mock.invocationCallOrder[0]).toBeLessThan(
      onAbandonedUpload.mock.invocationCallOrder[0]
    );
  });

  test("waitForInFlightUploads resolves after pending uploads complete", async () => {
    const deferred = createDeferred<{
      ok: boolean;
      json: () => Promise<{ storageId: string }>;
    }>();
    const getUploadUrl = vi.fn().mockResolvedValue("https://upload.test");
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(deferred.promise));

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    await act(async () => {
      void result.current.uploadFiles([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });

    let waitSettled = false;
    const waitPromise = result.current.waitForInFlightUploads().then(() => {
      waitSettled = true;
    });

    await Promise.resolve();
    expect(waitSettled).toBe(false);

    await act(async () => {
      deferred.resolve({
        ok: true,
        json: async () => ({ storageId: "storage_1" }),
      });
      await waitPromise;
    });

    expect(waitSettled).toBe(true);
    expect(result.current.uploads[0]?.status).toBe("done");
  });

  test("clearUploads marks all pending uploads as removed and cleans state", async () => {
    const deferred = createDeferred<{
      ok: boolean;
      json: () => Promise<{ storageId: string }>;
    }>();
    const onAbandonedUpload = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(deferred.promise));

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl: async () => "https://upload.test",
        onAbandonedUpload,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    await act(async () => {
      void result.current.uploadFiles([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(1);
      expect(result.current.uploads[0]?.status).toBe("uploading");
    });

    act(() => {
      result.current.clearUploads();
    });

    await act(async () => {
      deferred.resolve({
        ok: true,
        json: async () => ({ storageId: "storage_1" }),
      });
      await result.current.waitForInFlightUploads();
    });

    expect(onAbandonedUpload).toHaveBeenCalledTimes(1);
    expect(result.current.uploads).toHaveLength(0);
  });

  test("supports multiple concurrent uploads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: crypto.randomUUID() }),
      })
    );
    const getUploadUrl = vi.fn().mockResolvedValue("https://upload.test");

    const { result } = renderHook(() =>
      useStorageUploadQueue({
        getUploadUrl,
        autoRemoveDelay: 0,
        errorRemoveDelay: 0,
      })
    );

    await act(async () => {
      await result.current.uploadFiles([
        new File(["1"], "one.txt", { type: "text/plain" }),
        new File(["2"], "two.txt", { type: "text/plain" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(2);
      expect(result.current.uploads.every((item) => item.status === "done")).toBe(true);
    });

    expect(getUploadUrl).toHaveBeenCalledTimes(2);
  });

  test("uses latest onAbandonedUpload callback for in-flight uploads after rerender", async () => {
    const deferred = createDeferred<{
      ok: boolean;
      json: () => Promise<{ storageId: string }>;
    }>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(deferred.promise));
    const firstOnAbandoned = vi.fn().mockResolvedValue(undefined);
    const secondOnAbandoned = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ onAbandonedUpload }) =>
        useStorageUploadQueue({
          getUploadUrl: async () => "https://upload.test",
          onAbandonedUpload,
          autoRemoveDelay: 0,
          errorRemoveDelay: 0,
        }),
      { initialProps: { onAbandonedUpload: firstOnAbandoned } }
    );

    await act(async () => {
      void result.current.uploadFiles([
        new File(["image"], "image.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(1);
      expect(result.current.uploads[0]?.status).toBe("uploading");
    });

    const uploadId = result.current.uploads[0]?.id;
    expect(uploadId).toBeDefined();

    rerender({ onAbandonedUpload: secondOnAbandoned });

    act(() => {
      result.current.removeUpload(uploadId ?? "");
    });

    await act(async () => {
      deferred.resolve({
        ok: true,
        json: async () => ({ storageId: "storage_1" }),
      });
      await result.current.waitForInFlightUploads();
    });

    expect(firstOnAbandoned).not.toHaveBeenCalled();
    expect(secondOnAbandoned).toHaveBeenCalledTimes(1);
  });
});
