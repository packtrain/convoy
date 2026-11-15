/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CommentAttachments } from "./comment-attachments";
import { downloadFile } from "@/lib/tasks/files";
import type { TaskCommentAttachment } from "@/lib/tasks/types";

vi.mock("@/components/blocks/tasks/attachment-lightbox", () => ({
  AttachmentLightbox: ({
    open,
    slides,
    initialIndex,
    onClose,
    onDownload,
  }: {
    open: boolean;
    slides: Array<{ fileName: string; type?: string }>;
    initialIndex: number;
    onClose: () => void;
    onDownload: (index: number) => void;
  }) =>
    open ? (
      <div>
        <h2>Attachment preview</h2>
        <div data-testid="slide-count">{slides.length}</div>
        <div data-testid="initial-index">{initialIndex}</div>
        <div data-testid="selected-slide">{slides[initialIndex]?.fileName}</div>
        <div data-testid="selected-slide-type">
          {slides[initialIndex]?.type ?? "image"}
        </div>
        <button type="button" onClick={() => onDownload(initialIndex)}>
          Download slide
        </button>
        <button type="button" onClick={onClose}>
          Close preview
        </button>
      </div>
    ) : null,
}));

vi.mock("@/lib/tasks/files", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tasks/files")>(
    "@/lib/tasks/files"
  );
  return {
    ...actual,
    downloadFile: vi.fn().mockResolvedValue(true),
  };
});

const imageAttachment: TaskCommentAttachment = {
  _id: "comment_attachment_image_1" as TaskCommentAttachment["_id"],
  fileName: "comment-preview.png",
  fileSize: 1024,
  contentType: "image/png",
  url: "https://example.com/comment-preview.png",
};

const secondImageAttachment: TaskCommentAttachment = {
  _id: "comment_attachment_image_2" as TaskCommentAttachment["_id"],
  fileName: "comment-second-preview.png",
  fileSize: 1536,
  contentType: "image/png",
  url: "https://example.com/comment-second-preview.png",
};

const videoAttachment: TaskCommentAttachment = {
  _id: "comment_attachment_video_1" as TaskCommentAttachment["_id"],
  fileName: "comment-clip.mp4",
  fileSize: 4096,
  contentType: "video/mp4",
  url: "https://example.com/comment-clip.mp4",
};

const fileAttachment: TaskCommentAttachment = {
  _id: "comment_attachment_file_1" as TaskCommentAttachment["_id"],
  fileName: "notes.pdf",
  fileSize: 2048,
  contentType: "application/pdf",
  url: "https://example.com/notes.pdf",
};

describe("CommentAttachments", () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  test("clicking image attachment opens a gallery on the clicked image", () => {
    render(
      <CommentAttachments
        attachments={[imageAttachment, fileAttachment, secondImageAttachment]}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /comment-second-preview\.png/i })
    );

    expect(
      screen.getByRole("heading", { name: /attachment preview/i })
    ).toBeDefined();
    expect(screen.getByTestId("slide-count").textContent).toBe("2");
    expect(screen.getByTestId("initial-index").textContent).toBe("1");
    expect(screen.getByTestId("selected-slide").textContent).toBe(
      "comment-second-preview.png"
    );
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test("clicking video attachment opens the preview as a video slide", () => {
    render(
      <CommentAttachments
        attachments={[imageAttachment, fileAttachment, videoAttachment]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /comment-clip\.mp4/i }));

    expect(
      screen.getByRole("heading", { name: /attachment preview/i })
    ).toBeDefined();
    expect(screen.getByTestId("slide-count").textContent).toBe("2");
    expect(screen.getByTestId("initial-index").textContent).toBe("1");
    expect(screen.getByTestId("selected-slide").textContent).toBe(
      "comment-clip.mp4"
    );
    expect(screen.getByTestId("selected-slide-type").textContent).toBe("video");
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test("downloads image attachment from the preview lightbox", () => {
    render(
      <CommentAttachments attachments={[imageAttachment, secondImageAttachment]} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /comment-second-preview\.png/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /download slide/i }));

    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.com/comment-second-preview.png",
      "comment-second-preview.png"
    );
  });

  test("downloads video attachment from the preview lightbox", () => {
    render(
      <CommentAttachments attachments={[imageAttachment, videoAttachment]} />
    );

    fireEvent.click(screen.getByRole("button", { name: /comment-clip\.mp4/i }));
    fireEvent.click(screen.getByRole("button", { name: /download slide/i }));

    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.com/comment-clip.mp4",
      "comment-clip.mp4"
    );
  });

  test("clicking non-previewable attachment downloads it directly", () => {
    render(<CommentAttachments attachments={[fileAttachment]} />);

    fireEvent.click(screen.getByRole("button", { name: /notes\.pdf/i }));

    expect(downloadFile).toHaveBeenCalledWith(
      "https://example.com/notes.pdf",
      "notes.pdf"
    );
    expect(
      screen.queryByRole("heading", { name: /attachment preview/i })
    ).toBeNull();
  });

  test("closes the preview lightbox", () => {
    render(<CommentAttachments attachments={[imageAttachment]} />);

    fireEvent.click(screen.getByRole("button", { name: /comment-preview\.png/i }));
    fireEvent.click(screen.getByRole("button", { name: /close preview/i }));

    expect(
      screen.queryByRole("heading", { name: /attachment preview/i })
    ).toBeNull();
  });
});
