/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { StrictMode, type ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { CommentComposer } from "./comment-composer";

const useMutationMock = vi.fn();
const useTaskCommentsMock = vi.fn();
const toastErrorMock = vi.fn();

const generateUploadUrlMutationMock = vi.fn();
const deletePendingAttachmentMutationMock = vi.fn();
const registerPendingAttachmentMutationMock = vi.fn();
const createCommentMock = vi.fn();
const createCommentWithAttachmentsMock = vi.fn();
const updateCommentMock = vi.fn();
const deleteCommentMock = vi.fn();
const loadMoreMock = vi.fn();

const fetchMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/lib/tasks/hooks/comments/use-task-comments", () => ({
  useTaskComments: (...args: unknown[]) => useTaskCommentsMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/components/blocks/attachment-drop-zone", () => ({
  AttachmentDropZone: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./comment-input", () => ({
  CommentInput: (props: {
    onSubmit: (content: string) => Promise<void>;
    onAddFiles: (files: File[]) => void;
    onRemoveAttachment: (id: string) => void;
    pendingAttachments: Array<{ id: string; status: string; error?: string }>;
  }) => {
    return (
      <div>
        <button type="button" onClick={() => props.onAddFiles([new File(["image-data"], "paste.png", { type: "image/png" })])}>
          Add file
        </button>
        <button
          type="button"
          onClick={() => {
            void Promise.resolve(props.onSubmit("Hello world")).catch(() => {});
          }}
        >
          Submit comment
        </button>
        <button
          type="button"
          onClick={() => {
            const first = props.pendingAttachments[0];
            if (first) props.onRemoveAttachment(first.id);
          }}
        >
          Remove first
        </button>
        <span data-testid="pending-statuses">{props.pendingAttachments.map((attachment) => attachment.status).join(",")}</span>
        <span data-testid="pending-errors">
          {props.pendingAttachments
            .map((attachment) => attachment.error ?? "")
            .filter(Boolean)
            .join(",")}
        </span>
      </div>
    );
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CommentComposer", () => {
  const taskId = "task_1" as Id<"tasks">;

  beforeEach(() => {
    useMutationMock.mockReset();
    useTaskCommentsMock.mockReset();
    generateUploadUrlMutationMock.mockReset();
    deletePendingAttachmentMutationMock.mockReset();
    registerPendingAttachmentMutationMock.mockReset();
    registerPendingAttachmentMutationMock.mockResolvedValue("https://blob.test");
    createCommentMock.mockReset();
    createCommentWithAttachmentsMock.mockReset();
    updateCommentMock.mockReset();
    deleteCommentMock.mockReset();
    loadMoreMock.mockReset();
    fetchMock.mockReset();
    toastErrorMock.mockReset();

    useMutationMock.mockImplementation((ref: unknown) => {
      const mutationName = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
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

    useTaskCommentsMock.mockReturnValue({
      comments: [],
      isLoading: false,
      isLoadingMore: false,
      hasMore: false,
      loadMore: loadMoreMock,
      createComment: createCommentMock,
      createCommentWithAttachments: createCommentWithAttachmentsMock,
      updateComment: updateCommentMock,
      deleteComment: deleteCommentMock,
    });

    generateUploadUrlMutationMock.mockResolvedValue("https://upload.test");
    createCommentMock.mockResolvedValue("comment_1");
    createCommentWithAttachmentsMock.mockResolvedValue("comment_1");
    deletePendingAttachmentMutationMock.mockResolvedValue(null);

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  test("starts attachment upload immediately when files are added", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    render(<CommentComposer taskId={taskId} />);
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));

    await waitFor(() => {
      expect(generateUploadUrlMutationMock).toHaveBeenCalledWith({ taskId });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("waits for uploads and submits atomically with attachments", async () => {
    const uploadDeferred = createDeferred<{ ok: boolean; json: () => Promise<{ storageId: string }> }>();
    fetchMock.mockReturnValue(uploadDeferred.promise);

    render(<CommentComposer taskId={taskId} />);

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit comment" }));

    expect(createCommentWithAttachmentsMock).not.toHaveBeenCalled();

    uploadDeferred.resolve({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    await waitFor(() => {
      expect(createCommentWithAttachmentsMock).toHaveBeenCalledWith({
        content: "Hello world",
        attachments: [
          {
            storageId: "storage_1",
            fileName: "paste.png",
            fileSize: 10,
            contentType: "image/png",
          },
        ],
      });
      expect(createCommentMock).not.toHaveBeenCalled();
    });
  });

  test("submits text-only comment via createComment when no attachments", async () => {
    render(<CommentComposer taskId={taskId} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit comment" }));

    await waitFor(() => {
      expect(createCommentMock).toHaveBeenCalledWith("Hello world");
      expect(createCommentWithAttachmentsMock).not.toHaveBeenCalled();
    });
  });

  test("completes upload in StrictMode without getting stuck in uploading", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    render(
      <StrictMode>
        <CommentComposer taskId={taskId} />
      </StrictMode>
    );
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));

    await waitFor(() => expect(screen.getByTestId("pending-statuses").textContent).toContain("uploaded"));
  });

  test("blocks submit when an attachment upload fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Failed",
    });

    render(<CommentComposer taskId={taskId} />);

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    await waitFor(() => expect(screen.getByTestId("pending-statuses").textContent).toContain("error"));

    fireEvent.click(screen.getByRole("button", { name: "Submit comment" }));

    await waitFor(() => {
      expect(createCommentWithAttachmentsMock).not.toHaveBeenCalled();
      expect(createCommentMock).not.toHaveBeenCalled();
    });
  });

  test("removing uploaded attachment triggers best-effort cleanup", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    render(<CommentComposer taskId={taskId} />);
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    await waitFor(() => expect(screen.getByTestId("pending-statuses").textContent).toContain("uploaded"));

    fireEvent.click(screen.getByRole("button", { name: "Remove first" }));

    await waitFor(() => {
      expect(deletePendingAttachmentMutationMock).toHaveBeenCalledWith({
        taskId,
        storageId: "storage_1",
      });
    });
  });

  test("unmount triggers cleanup for unsent uploaded attachments", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage_1" }),
    });

    const { unmount } = render(<CommentComposer taskId={taskId} />);
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    await waitFor(() => expect(screen.getByTestId("pending-statuses").textContent).toContain("uploaded"));

    unmount();

    await waitFor(() => {
      expect(deletePendingAttachmentMutationMock).toHaveBeenCalledWith({
        taskId,
        storageId: "storage_1",
      });
    });
  });

  test("shows an error toast when comment creation fails", async () => {
    createCommentMock.mockRejectedValueOnce(new Error("nope"));

    render(<CommentComposer taskId={taskId} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit comment" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to post comment");
    });
  });
});
