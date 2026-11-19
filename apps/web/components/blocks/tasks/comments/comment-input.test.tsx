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

  test("@ offers mentions; Enter inserts the login, Escape closes, and Enter then sends", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentInput
        onSubmit={onSubmit}
        mentions={[
          { login: "octocat", avatarUrl: null },
          { login: "maya", avatarUrl: null },
          { login: "mallory", avatarUrl: null },
        ]}
      />
    );
    const textarea = screen.getByPlaceholderText("Add a comment...") as HTMLTextAreaElement;
    const type = (value: string) => {
      textarea.focus();
      fireEvent.change(textarea, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
    };

    type("cc @ma");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "maya", selected: true })).toBeTruthy();
    expect(screen.getByRole("option", { name: "mallory", selected: false })).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("cc @mallory ");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();

    // An email address is no mention.
    type("me@ma");
    expect(screen.queryByRole("listbox")).toBeNull();

    type("@oc");
    expect(screen.getByRole("option", { name: "octocat" })).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("@oc");
  });

  test("Escape closes only this mention: a new @, or the next comment, offers them again", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CommentInput onSubmit={onSubmit} mentions={[{ login: "octocat", avatarUrl: null }]} />);
    const textarea = screen.getByPlaceholderText("Add a comment...") as HTMLTextAreaElement;
    const type = (value: string) => {
      textarea.focus();
      fireEvent.change(textarea, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
    };

    type("@o");
    fireEvent.keyDown(textarea, { key: "Escape" });
    type("@oc");
    expect(screen.queryByRole("listbox")).toBeNull();
    type("");
    type("@");
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(textarea, { key: "Escape" });
    type("@ hi");
    fireEvent.keyDown(textarea, { key: "Enter" });
    await vi.waitFor(() => expect(textarea.value).toBe(""));
    type("@");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  test("the textarea points at the highlighted option", () => {
    render(
      <CommentInput
        onSubmit={vi.fn()}
        mentions={[
          { login: "maya", avatarUrl: null },
          { login: "mallory", avatarUrl: null },
        ]}
      />
    );
    const textarea = screen.getByPlaceholderText("Add a comment...") as HTMLTextAreaElement;
    textarea.focus();
    fireEvent.change(textarea, { target: { value: "@m", selectionStart: 2, selectionEnd: 2 } });
    expect(textarea.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(textarea.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "maya" }).id);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(textarea.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "mallory" }).id);
  });

  test("picking inside an existing login replaces the whole login", () => {
    render(<CommentInput onSubmit={vi.fn()} mentions={[{ login: "octocat", avatarUrl: null }]} />);
    const textarea = screen.getByPlaceholderText("Add a comment...") as HTMLTextAreaElement;
    textarea.focus();
    fireEvent.change(textarea, { target: { value: "@octocat please review", selectionStart: 3, selectionEnd: 3 } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("@octocat please review");
    expect(textarea.selectionStart).toBe(9);
  });

  test("a mention nobody matches says so, and Enter still sends", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CommentInput onSubmit={onSubmit} mentions={[{ login: "octocat", avatarUrl: null }]} />);
    const textarea = screen.getByPlaceholderText("Add a comment...") as HTMLTextAreaElement;
    textarea.focus();
    fireEvent.change(textarea, { target: { value: "@ge", selectionStart: 3, selectionEnd: 3 } });
    expect(screen.getByRole("listbox", { name: "Mention" }).textContent).toBe("No matches for @ge");
    expect(screen.queryByRole("option")).toBeNull();
    expect(textarea.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("@ge");
  });

  test("an @login shows bold in the box; an email doesn't", () => {
    const { container } = render(<CommentInput onSubmit={vi.fn()} mentions={[]} />);
    const textarea = screen.getByPlaceholderText("Add a comment...");
    fireEvent.change(textarea, { target: { value: "@gecko0 hi, me@example.com", selectionStart: 0, selectionEnd: 0 } });

    expect([...container.querySelectorAll("[data-mention]")].map((mention) => mention.textContent)).toEqual(["@gecko0"]);
  });

  test("without mentions the box draws its own text", () => {
    const { container } = render(<CommentInput onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Add a comment..."), { target: { value: "@gecko0" } });

    expect(container.querySelector("[data-mention]")).toBeNull();
  });
});
