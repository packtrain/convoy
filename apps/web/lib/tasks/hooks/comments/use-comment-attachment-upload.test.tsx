/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { useCommentAttachmentUpload } from "./use-comment-attachment-upload";

const useMutationMock = vi.fn();
const generateUploadUrlMutationMock = vi.fn();
const deletePendingAttachmentMutationMock = vi.fn();
const registerPendingAttachmentMutationMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

describe("useCommentAttachmentUpload", () => {
  const taskId = "task_1" as Id<"tasks">;

  beforeEach(() => {
    useMutationMock.mockReset();
    generateUploadUrlMutationMock.mockReset();
    deletePendingAttachmentMutationMock.mockReset();
    registerPendingAttachmentMutationMock.mockReset();
    registerPendingAttachmentMutationMock.mockResolvedValue("https://blob.test");
    fetchMock.mockReset();

    useMutationMock.mockImplementation((ref: unknown) => {
      const mutationName = getFunctionName(
        ref as Parameters<typeof getFunctionName>[0]
      );
      if (mutationName === "tasks/comments:generateTaskCommentAttachmentUploadUrl") {
        return generateUploadUrlMutationMock;
      }
      if (mutationName === "tasks/comments:deletePendingUploadedAttachment") {
        return deletePendingAttachmentMutationMock;
      }
      if (mutationName === "tasks/attachments:registerPendingUploadedAttachment") {
        return registerPendingAttachmentMutationMock;
      }
      throw new Error(`Unexpected mutation ref: ${mutationName}`);
    });

    generateUploadUrlMutationMock.mockResolvedValue("https://upload.test");
    deletePendingAttachmentMutationMock.mockResolvedValue(null);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  test("uploads and exposes uploaded pending attachment state", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    const { result } = renderHook(() => useCommentAttachmentUpload(taskId));

    await act(async () => {
      await result.current.addFiles([
        new File(["img"], "paste.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments).toHaveLength(1);
      expect(result.current.pendingAttachments[0]?.status).toBe("uploaded");
    });
    // Ownership claim (OS-1901) happens as part of the upload.
    expect(registerPendingAttachmentMutationMock).toHaveBeenCalledWith({ storageId: "storage_1" });
  });

  test("sets error state when upload fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "fail",
    });

    const { result } = renderHook(() => useCommentAttachmentUpload(taskId));

    await act(async () => {
      await result.current.addFiles([
        new File(["img"], "paste.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments).toHaveLength(1);
      expect(result.current.pendingAttachments[0]?.status).toBe("error");
    });
  });

  test("cleans up uploaded storage when pending attachment is removed", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    const { result } = renderHook(() => useCommentAttachmentUpload(taskId));

    await act(async () => {
      await result.current.addFiles([
        new File(["img"], "paste.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments[0]?.status).toBe("uploaded");
    });

    const targetId = result.current.pendingAttachments[0]?.id;
    expect(targetId).toBeDefined();

    await act(async () => {
      await result.current.removeAttachment(targetId ?? "");
    });

    expect(deletePendingAttachmentMutationMock).toHaveBeenCalledWith({
      taskId,
      storageId: "storage_1",
    });
  });

  test("cleans up uploaded storage on unmount", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    const { result, unmount } = renderHook(() => useCommentAttachmentUpload(taskId));

    await act(async () => {
      await result.current.addFiles([
        new File(["img"], "paste.png", { type: "image/png" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.pendingAttachments[0]?.status).toBe("uploaded");
    });

    unmount();

    await waitFor(() => {
      expect(deletePendingAttachmentMutationMock).toHaveBeenCalledWith({
        taskId,
        storageId: "storage_1",
      });
    });
  });
});
