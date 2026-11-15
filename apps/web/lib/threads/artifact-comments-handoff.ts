import {
  loadProjectDrafts,
  mergeThreadDraft,
  saveProjectDrafts,
} from "./draft-storage";

/**
 * Structural view of an artifact comment thread — kept minimal so this
 * threads-domain helper does not depend on the tasks domain's hook types.
 */
export interface HandoffCommentThread {
  root: {
    _id: string;
    content: string;
    status?: "open" | "resolved";
    anchor?: {
      text: string;
      /** 1-based line range in the artifact source, when it could be located. */
      lines?: { start: number; end: number };
    };
  };
  replies: { content: string }[];
}

/** Roots that still need attention; absent status means "open". */
export function filterOpenCommentThreads<T extends HandoffCommentThread>(
  threads: T[]
): T[] {
  return threads.filter((t) => (t.root.status ?? "open") !== "resolved");
}

/**
 * Serialize open comment threads into an editable composer message. Each
 * block leads with quoted metadata — the comment id an agent needs to resolve
 * it via MCP/CLI, the anchor's line range when located, and the quoted anchor
 * text — followed by the comment body and replies.
 */
export function composeArtifactCommentsMessage({
  artifactName,
  artifactId,
  threads,
}: {
  artifactName: string;
  artifactId: string;
  threads: HandoffCommentThread[];
}): string {
  const blocks = threads.map(({ root, replies }) => {
    // "#" marks technical metadata, "> " quotes the anchored snippet.
    const lines: string[] = [`# comment id: ${root._id}`];
    if (root.anchor) {
      const range = root.anchor.lines;
      if (range) {
        lines.push(
          `# lines: ${range.start === range.end ? range.start : `${range.start}-${range.end}`}`
        );
      }
      lines.push(...root.anchor.text.split("\n").map((line) => `> ${line}`));
    }
    lines.push(root.content);
    lines.push(...replies.map((reply) => `Reply: ${reply.content}`));
    return lines.join("\n");
  });

  return [
    buildMessageHeader(artifactName, artifactId),
    ...blocks,
    MESSAGE_FOOTER,
  ].join("\n\n");
}

const MESSAGE_FOOTER =
  "When a comment is addressed, mark it resolved using the `set_artifact_comment_status` MCP tool or `convoy tasks artifacts comments resolve <commentId>`.";

function buildMessageHeader(artifactName: string, artifactId: string): string {
  return `Address the open comments on the artifact "${artifactName}" (artifactId ${artifactId}):`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip previously seeded blocks for this artifact (header through footer,
 * built from the same constants as compose so they stay in sync). The
 * artifact name is wildcarded — it may have been renamed since the last send.
 */
function removeArtifactCommentsBlock(text: string, artifactId: string): string {
  // Split the header template around the name slot so the name (which may
  // have changed since the last send) is wildcarded while everything else
  // is matched literally.
  const placeholder = "\u0000";
  const [headerPrefix, headerSuffix] = buildMessageHeader(
    placeholder,
    artifactId
  ).split(placeholder);
  const pattern = new RegExp(
    `${escapeRegExp(headerPrefix)}[^"]*${escapeRegExp(headerSuffix)}[\\s\\S]*?${escapeRegExp(MESSAGE_FOOTER)}`,
    "g"
  );
  return text.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Appends the comments message to a draft's existing text. Re-sending the same
 * artifact replaces its previous block instead of stacking duplicates.
 */
export function buildArtifactCommentsDraftText(
  previousText: string,
  { artifactId, message }: { artifactId: string; message: string }
): string {
  const remainder = previousText
    ? removeArtifactCommentsBlock(previousText, artifactId)
    : "";
  return remainder ? `${remainder}\n\n${message}` : message;
}

/**
 * Seed a persisted composer draft with the comments message, for hosts with no
 * mounted `ThreadDraftProvider` (the task and artifact routes) — the provider
 * loads storage on mount, so the thread page picks this up after navigation.
 * A mounted provider seeds itself instead (`seedDraft`), which is what keeps
 * unpersisted text (OS-1716).
 */
export function upsertArtifactCommentsDraft(
  storageKey: string,
  threadKey: string,
  { artifactId, message }: { artifactId: string; message: string }
): void {
  const drafts = loadProjectDrafts(storageKey);
  const existing = drafts[threadKey];
  saveProjectDrafts(storageKey, {
    ...drafts,
    [threadKey]: mergeThreadDraft(existing, {
      text: buildArtifactCommentsDraftText(existing?.text ?? "", {
        artifactId,
        message,
      }),
      // Stale composerContent would win over text in the composer — drop it.
      composerContent: undefined,
      // Bumped so an already-mounted composer adopts the seed (OS-1716); the
      // count, not a timestamp, so re-seeding identical text still counts.
      seedCount: (existing?.seedCount ?? 0) + 1,
    }),
  });
}
