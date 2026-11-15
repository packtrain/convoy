/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { RenameThreadDialog } from "./rename-thread-dialog";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("RenameThreadDialog", () => {
  afterEach(() => {
    cleanup();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  test("prefills the input and resets when reopened", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const threadId = "chat_1" as Id<"cliThreads">;
    const { rerender } = render(
      <RenameThreadDialog
        open
        onOpenChange={onOpenChange}
        threadId={threadId}
        currentTitle="Original title"
        onRename={onRename}
      />
    );

    const input = screen.getByLabelText("New thread title");
    expect((input as HTMLInputElement).value).toBe("Original title");
    fireEvent.change(input, { target: { value: "Temporary value" } });
    expect((input as HTMLInputElement).value).toBe("Temporary value");

    rerender(
      <RenameThreadDialog
        open={false}
        onOpenChange={onOpenChange}
        threadId={threadId}
        currentTitle="Original title"
        onRename={onRename}
      />
    );
    rerender(
      <RenameThreadDialog
        open
        onOpenChange={onOpenChange}
        threadId={threadId}
        currentTitle="Updated source title"
        onRename={onRename}
      />
    );

    expect((screen.getByLabelText("New thread title") as HTMLInputElement).value).toBe(
      "Updated source title"
    );
  });

  test("disables rename for empty or unchanged value", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const threadId = "chat_1" as Id<"cliThreads">;
    render(
      <RenameThreadDialog
        open
        onOpenChange={onOpenChange}
        threadId={threadId}
        currentTitle="Original title"
        onRename={onRename}
      />
    );

    const input = screen.getByLabelText("New thread title");
    const button = screen.getByRole("button", { name: "Rename" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "   " } });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "New title" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  test("submits trimmed title and closes with success toast", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const threadId = "chat_1" as Id<"cliThreads">;
    render(
      <RenameThreadDialog
        open
        onOpenChange={onOpenChange}
        threadId={threadId}
        currentTitle="Original title"
        onRename={onRename}
      />
    );

    fireEvent.change(screen.getByLabelText("New thread title"), {
      target: { value: "  Renamed thread  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await vi.waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(threadId, "Renamed thread")
    );
    expect(toastSuccess).toHaveBeenCalledWith("Thread renamed");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("shows error toast when rename fails", async () => {
    const onRename = vi.fn().mockRejectedValue(new Error("Rename failed"));
    const onOpenChange = vi.fn();
    const threadId = "chat_1" as Id<"cliThreads">;
    render(
      <RenameThreadDialog
        open
        onOpenChange={onOpenChange}
        threadId={threadId}
        currentTitle="Original title"
        onRename={onRename}
      />
    );

    fireEvent.change(screen.getByLabelText("New thread title"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Rename failed"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
