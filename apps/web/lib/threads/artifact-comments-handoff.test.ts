/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  composeArtifactCommentsMessage,
  filterOpenCommentThreads,
  upsertArtifactCommentsDraft,
  type HandoffCommentThread,
} from "./artifact-comments-handoff";
import { loadProjectDrafts, saveProjectDrafts } from "./draft-storage";

const STORAGE_KEY = "convoy.thread-composer-drafts:acme:OS";

function thread(overrides: {
  id: string;
  content: string;
  status?: "open" | "resolved";
  anchorText?: string;
  anchorLines?: { start: number; end: number };
  replies?: string[];
}): HandoffCommentThread {
  return {
    root: {
      _id: overrides.id,
      content: overrides.content,
      status: overrides.status,
      anchor:
        overrides.anchorText === undefined
          ? undefined
          : { text: overrides.anchorText, lines: overrides.anchorLines },
    },
    replies: (overrides.replies ?? []).map((content) => ({ content })),
  };
}

describe("filterOpenCommentThreads", () => {
  test("keeps open and status-less roots, drops resolved ones", () => {
    const threads = [
      thread({ id: "a", content: "open", status: "open" }),
      thread({ id: "b", content: "legacy no status" }),
      thread({ id: "c", content: "done", status: "resolved" }),
    ];

    expect(filterOpenCommentThreads(threads).map((t) => t.root._id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("composeArtifactCommentsMessage", () => {
  test("renders quoted id/lines/quote metadata, then body and replies", () => {
    const message = composeArtifactCommentsMessage({
      artifactName: "Launch plan",
      artifactId: "artifact_1",
      threads: [
        thread({
          id: "comment_1",
          content: "Why before launch?",
          anchorText: "ship before launch",
          anchorLines: { start: 3, end: 3 },
          replies: ["Because of the freeze.", "Agreed."],
        }),
      ],
    });

    expect(message).toBe(
      [
        'Address the open comments on the artifact "Launch plan" (artifactId artifact_1):',
        "",
        "# comment id: comment_1",
        "# lines: 3",
        "> ship before launch",
        "Why before launch?",
        "Reply: Because of the freeze.",
        "Reply: Agreed.",
        "",
        "When a comment is addressed, mark it resolved using the `set_artifact_comment_status` MCP tool or `convoy tasks artifacts comments resolve <commentId>`.",
      ].join("\n")
    );
  });

  test("renders a line range, quotes every anchor line, and omits lines/quote for detached comments", () => {
    const message = composeArtifactCommentsMessage({
      artifactName: "Doc",
      artifactId: "artifact_1",
      threads: [
        thread({
          id: "comment_1",
          content: "Tighten this.",
          anchorText: "first line\nsecond line",
          anchorLines: { start: 4, end: 5 },
        }),
        thread({ id: "comment_2", content: "Detached note." }),
      ],
    });

    expect(message).toContain(
      "# comment id: comment_1\n# lines: 4-5\n> first line\n> second line\nTighten this."
    );
    expect(message).toContain("\n\n# comment id: comment_2\nDetached note.\n\n");
  });

  test("omits the lines row when the anchor has no located lines", () => {
    const message = composeArtifactCommentsMessage({
      artifactName: "Doc",
      artifactId: "artifact_1",
      threads: [
        thread({ id: "comment_1", content: "Hmm.", anchorText: "watch" }),
      ],
    });

    expect(message).toContain(
      "# comment id: comment_1\n> watch\nHmm."
    );
  });
});

describe("upsertArtifactCommentsDraft", () => {
  const messageFor = (artifactId: string, body: string) =>
    composeArtifactCommentsMessage({
      artifactName: "Doc",
      artifactId,
      threads: [thread({ id: `${artifactId}-c1`, content: body })],
    });

  beforeEach(() => {
    window.localStorage.clear();
  });

  test("creates a draft when none exists", () => {
    upsertArtifactCommentsDraft(STORAGE_KEY, "thread:thread_1", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "Fix this."),
    });

    expect(loadProjectDrafts(STORAGE_KEY)["thread:thread_1"]?.text).toBe(
      messageFor("artifact_1", "Fix this.")
    );
  });

  test("appends to existing draft text and preserves other draft fields", () => {
    saveProjectDrafts(STORAGE_KEY, {
      new: {
        text: "My own intro",
        profileId: "profile_1",
        pathId: "path_1",
        updatedAt: Date.now(),
      },
    });

    upsertArtifactCommentsDraft(STORAGE_KEY, "new", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "Fix this."),
    });

    const draft = loadProjectDrafts(STORAGE_KEY)["new"];
    expect(draft?.text).toBe(
      `My own intro\n\n${messageFor("artifact_1", "Fix this.")}`
    );
    expect(draft?.profileId).toBe("profile_1");
    expect(draft?.pathId).toBe("path_1");
  });

  test("replaces whitespace-only draft text instead of appending", () => {
    saveProjectDrafts(STORAGE_KEY, {
      "thread:thread_1": { text: "   ", updatedAt: Date.now() },
    });

    upsertArtifactCommentsDraft(STORAGE_KEY, "thread:thread_1", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "Fix this."),
    });

    expect(loadProjectDrafts(STORAGE_KEY)["thread:thread_1"]?.text).toBe(
      messageFor("artifact_1", "Fix this.")
    );
  });

  test("re-sending the same artifact replaces its previous block instead of stacking", () => {
    upsertArtifactCommentsDraft(STORAGE_KEY, "new", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "First pass."),
    });
    upsertArtifactCommentsDraft(STORAGE_KEY, "new", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "Second pass."),
    });

    expect(loadProjectDrafts(STORAGE_KEY)["new"]?.text).toBe(
      messageFor("artifact_1", "Second pass.")
    );
  });

  test("re-sending keeps the user's own text around the replaced block", () => {
    saveProjectDrafts(STORAGE_KEY, {
      new: {
        text: `Intro\n\n${messageFor("artifact_1", "First pass.")}\n\nOutro`,
        updatedAt: Date.now(),
      },
    });

    upsertArtifactCommentsDraft(STORAGE_KEY, "new", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "Second pass."),
    });

    expect(loadProjectDrafts(STORAGE_KEY)["new"]?.text).toBe(
      `Intro\n\nOutro\n\n${messageFor("artifact_1", "Second pass.")}`
    );
  });

  test("blocks for a different artifact are kept", () => {
    upsertArtifactCommentsDraft(STORAGE_KEY, "new", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "Doc one."),
    });
    upsertArtifactCommentsDraft(STORAGE_KEY, "new", {
      artifactId: "artifact_2",
      message: messageFor("artifact_2", "Doc two."),
    });

    expect(loadProjectDrafts(STORAGE_KEY)["new"]?.text).toBe(
      `${messageFor("artifact_1", "Doc one.")}\n\n${messageFor("artifact_2", "Doc two.")}`
    );
  });

  test("clears stale composerContent so the seeded text wins in the composer", () => {
    saveProjectDrafts(STORAGE_KEY, {
      new: {
        text: "Old text",
        composerContent: { type: "doc", content: [] },
        updatedAt: Date.now(),
      },
    });

    upsertArtifactCommentsDraft(STORAGE_KEY, "new", {
      artifactId: "artifact_1",
      message: messageFor("artifact_1", "Fix this."),
    });

    expect(loadProjectDrafts(STORAGE_KEY)["new"]?.composerContent).toBeUndefined();
  });
});
