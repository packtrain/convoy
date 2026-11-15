/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { format } from "date-fns";
import { afterEach, expect, test, vi } from "vitest";
import { ArtifactCommentThread } from "./artifact-comment-thread";

vi.mock("@/lib/auth/hooks", () => ({ useAppUser: () => ({ user: null }) }));
vi.mock("./artifact-comment-composer", () => ({ ArtifactCommentComposer: () => null }));

afterEach(cleanup);

test("shows the absolute date on hover over the relative time", () => {
  const createdAt = Date.UTC(2026, 2, 5, 14, 30);
  const root = {
    _id: "comment_1",
    authorName: "Ada Lovelace",
    authorAvatarUrl: null,
    content: "Looks good",
    createdAt,
    isEdited: false,
    status: "open",
    canEdit: false,
    canDelete: false,
  };
  render(
    <ArtifactCommentThread
      thread={{ root, replies: [] } as never}
      isActive={false}
      onActivate={vi.fn()}
      readOnly
      onReply={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      onSetStatus={vi.fn()}
    />
  );

  const time = screen.getByText(/ago$/);
  expect(time.getAttribute("title")).toBe(format(new Date(createdAt), "PPpp"));
});

test("hover-only comment actions are named and show on keyboard focus", () => {
  const root = {
    _id: "comment_1",
    authorName: "Ada Lovelace",
    authorAvatarUrl: null,
    content: "Looks good",
    createdAt: Date.now(),
    isEdited: false,
    status: "open",
    canEdit: true,
    canDelete: true,
  };
  render(
    <ArtifactCommentThread
      thread={{ root, replies: [] } as never}
      isActive={false}
      onActivate={vi.fn()}
      readOnly={false}
      onReply={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      onSetStatus={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: "Comment actions" }).className).toContain(
    "group-focus-within/comment:opacity-100"
  );
  expect(screen.getByRole("button", { name: "Resolve comment" }).className).toContain(
    "group-focus-within/thread:opacity-100"
  );
});
