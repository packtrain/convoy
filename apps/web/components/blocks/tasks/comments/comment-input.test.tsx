/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, test, expect, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CommentInput } from "./comment-input";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: {
      firstName: "Test",
      lastName: "User",
      imageUrl: "",
    },
  }),
}));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("CommentInput", () => {
  afterEach(() => {
    cleanup();
  });

  test("the attach button is named", () => {
    render(
      <CommentInput
        onSubmit={vi.fn()}
        pendingAttachments={[]}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Attach file" })).toBeTruthy();
  });

  test("submits on Enter and keeps Shift+Enter for newline", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentInput
        onSubmit={onSubmit}
        pendingAttachments={[]}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText("Add a comment...");
    fireEvent.change(textarea, { target: { value: "Hello world" } });

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Hello world");

    fireEvent.change(textarea, { target: { value: "Line 1" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("pastes clipboard images into pending attachments", () => {
    const onAddFiles = vi.fn();
    const image = new File(["image-data"], "paste.png", { type: "image/png" });

    render(
      <CommentInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        pendingAttachments={[]}
        onAddFiles={onAddFiles}
        onRemoveAttachment={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText("Add a comment...");
    const pasteEvent = createEvent.paste(textarea, {
      clipboardData: {
        getData: () => "",
        items: [
          {
            kind: "file",
            getAsFile: () => image,
          },
        ],
        files: [],
      },
    });
    fireEvent(textarea, pasteEvent);

    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onAddFiles).toHaveBeenCalledWith([image]);
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  test("ignores non-image clipboard files", () => {
    const onAddFiles = vi.fn();
    const textFile = new File(["notes"], "notes.txt", { type: "text/plain" });

    render(
      <CommentInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        pendingAttachments={[]}
        onAddFiles={onAddFiles}
        onRemoveAttachment={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText("Add a comment...");
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: "file",
            getAsFile: () => textFile,
          },
        ],
        files: [],
      },
    });

    expect(onAddFiles).not.toHaveBeenCalled();
  });

  test("keeps default text paste when clipboard has both text and images", () => {
    const onAddFiles = vi.fn();
    const image = new File(["image-data"], "paste.png", { type: "image/png" });

    render(
      <CommentInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        pendingAttachments={[]}
        onAddFiles={onAddFiles}
        onRemoveAttachment={vi.fn()}
      />
    );

    const textarea = screen.getByPlaceholderText("Add a comment...");
    const pasteEvent = createEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? "Hello world" : ""),
        items: [
          {
            kind: "file",
            getAsFile: () => image,
          },
        ],
        files: [],
      },
    });

    fireEvent(textarea, pasteEvent);

    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onAddFiles).toHaveBeenCalledWith([image]);
    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  test("disables submit while there are uploading attachments", () => {
    render(
      <CommentInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        pendingAttachments={[
          {
            id: "att_1",
            fileName: "image.png",
            fileSize: 100,
            contentType: "image/png",
            status: "uploading",
          },
        ]}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
      />
    );

    const sendButton = screen.getByRole("button", { name: "Send comment" });
    expect(sendButton).toHaveProperty("disabled", true);
  });

  test("disables submit while there are failed attachments", () => {
    render(
      <CommentInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        pendingAttachments={[
          {
            id: "att_1",
            fileName: "image.png",
            fileSize: 100,
            contentType: "image/png",
            status: "error",
            error: "Upload failed",
          },
        ]}
        onAddFiles={vi.fn()}
        onRemoveAttachment={vi.fn()}
      />
    );

    const sendButton = screen.getByRole("button", { name: "Send comment" });
    expect(sendButton).toHaveProperty("disabled", true);
  });

  test("renders pending attachment pills and removes them", () => {
    const onRemoveAttachment = vi.fn();

    render(
      <CommentInput
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        pendingAttachments={[
          {
            id: "att_1",
            fileName: "notes.pdf",
            fileSize: 128,
            contentType: "application/pdf",
            status: "uploaded",
          },
        ]}
        onAddFiles={vi.fn()}
        onRemoveAttachment={onRemoveAttachment}
      />
    );

    expect(screen.getByText("notes.pdf")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove notes.pdf" }));

    expect(onRemoveAttachment).toHaveBeenCalledWith("att_1");
  });
});
