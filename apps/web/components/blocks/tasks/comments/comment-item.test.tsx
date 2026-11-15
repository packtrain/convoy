/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, test, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { Comment } from "@/lib/tasks/types";
import { format } from "date-fns";
import { CommentItem } from "./comment-item";

function commentId(value: string): Id<"taskComments"> {
  return value as Id<"taskComments">;
}

function taskId(value: string): Id<"tasks"> {
  return value as Id<"tasks">;
}

function userId(value: string): Id<"users"> {
  return value as Id<"users">;
}

const baseComment: Comment = {
  _id: commentId("comment_1"),
  _creationTime: 1700000000000,
  taskId: taskId("task_1"),
  authorId: userId("user_1"),
  authorName: "Test User",
  authorAvatarUrl: null,
  content: "[Contoso](https://example.com)",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isEdited: false,
  attachments: [],
  canEdit: true,
  canDelete: true,
};

describe("CommentItem", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function mockCommentBodyHeight(scrollHeight: number) {
    vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(scrollHeight);
  }

  test("the actions button is named and shows on keyboard focus", () => {
    render(
      <CommentItem
        comment={baseComment}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const actions = screen.getByRole("button", { name: "Comment actions" });
    expect(actions.className).toContain("group-focus-within:opacity-100");
  });

  test("shows the absolute date on hover over the relative time", () => {
    const createdAt = Date.UTC(2026, 2, 5, 14, 30);
    render(
      <CommentItem
        comment={{ ...baseComment, createdAt }}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const time = screen.getByText(/ago$/);
    expect(time.getAttribute("title")).toBe(format(new Date(createdAt), "PPpp"));
  });

  test("renders markdown links in comment content", () => {
    render(
      <CommentItem
        comment={baseComment}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByRole("button", { name: "Contoso" })).toBeDefined();
    expect(screen.queryByText("[Contoso](https://example.com)")).toBeNull();
  });

  test("renders markdown headings with the expected levels", () => {
    render(
      <CommentItem
        comment={{ ...baseComment, content: "# Level 1\n\n## Level 2" }}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByRole("heading", { level: 1, name: "Level 1" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Level 2" })).toBeDefined();
  });

  test("does not show expand affordance for non-overflowing comments", async () => {
    mockCommentBodyHeight(112);
    render(
      <CommentItem
        comment={baseComment}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId("comment-expandable-area")).toBeNull();
      expect(screen.queryByTestId("comment-expand-hint")).toBeNull();
      expect(screen.queryByTestId("comment-fade-overlay")).toBeNull();
    });
  });

  test("shows expand affordance and fade overlay for overflowing comments", async () => {
    mockCommentBodyHeight(260);
    render(
      <CommentItem
        comment={baseComment}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      const expandableArea = screen.getByRole("button", {
        name: "Expand comment",
      });
      expect(expandableArea).toBeDefined();
      expect(expandableArea.getAttribute("tabindex")).toBe("0");
      expect(screen.getByTestId("comment-expand-hint").className).toContain(
        "group-focus-visible/comment-expand:opacity-100"
      );
      expect(screen.getByTestId("comment-fade-overlay")).toBeDefined();
    });
  });

  test("expands overflowing comment and hides truncation affordances", async () => {
    mockCommentBodyHeight(260);
    render(
      <CommentItem
        comment={baseComment}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const expandableArea = await screen.findByTestId("comment-expandable-area");
    fireEvent.click(expandableArea);

    await waitFor(() => {
      expect(screen.queryByTestId("comment-expandable-area")).toBeNull();
      expect(screen.queryByTestId("comment-expand-hint")).toBeNull();
      expect(screen.queryByTestId("comment-fade-overlay")).toBeNull();
    });
  });

  test("expands overflowing comment with keyboard Enter", async () => {
    mockCommentBodyHeight(260);
    render(
      <CommentItem
        comment={baseComment}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const expandableArea = await screen.findByRole("button", {
      name: "Expand comment",
    });
    fireEvent.keyDown(expandableArea, { key: "Enter" });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Expand comment" })).toBeNull();
      expect(screen.queryByTestId("comment-fade-overlay")).toBeNull();
    });
  });
});
