import { isRecord } from "@/lib/type-guards";
import { readLocalJson, writeLocalJson } from "@/lib/browser/local-storage";

/**
 * Inline review comments on run diffs (OS-1155). Unsent comments live in
 * localStorage keyed by the run's post checkpoint ref, so a page refresh
 * keeps them; they surface as a pill on the thread composer and ride the
 * next sent message, which becomes the durable record.
 * ponytail: localStorage is single-browser — OS-1161 moves storage to Convex.
 */

export type RunReviewSide = "additions" | "deletions";

export interface RunReviewCommentAnchor {
  path: string;
  side: RunReviewSide;
  lineNumber: number;
}

export interface RunReviewComment extends RunReviewCommentAnchor {
  note: string;
  /** Diff excerpt captured at comment time, so composing never needs the live patch. */
  excerpt?: string;
  createdAt: number;
}

export function anchorsEqual(a: RunReviewCommentAnchor, b: RunReviewCommentAnchor): boolean {
  return a.path === b.path && a.side === b.side && a.lineNumber === b.lineNumber;
}

const STORAGE_KEY = "convoy.run-review-comments";
/** Runs kept in storage; checkpoint refs are pruned server-side around 20 runs too. */
const MAX_STORED_RUNS = 20;

interface StoredRun {
  updatedAt: number;
  comments: RunReviewComment[];
}

function parseComment(value: unknown): RunReviewComment | null {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    (value.side !== "additions" && value.side !== "deletions") ||
    typeof value.lineNumber !== "number" ||
    typeof value.note !== "string" ||
    typeof value.createdAt !== "number"
  ) {
    return null;
  }
  return {
    path: value.path,
    side: value.side,
    lineNumber: value.lineNumber,
    note: value.note,
    ...(typeof value.excerpt === "string" ? { excerpt: value.excerpt } : {}),
    createdAt: value.createdAt,
  };
}

function readStore(): Record<string, StoredRun> {
  const parsed = readLocalJson(STORAGE_KEY);
  if (!isRecord(parsed)) {
    return {};
  }
  const store: Record<string, StoredRun> = {};
  for (const [postRef, entry] of Object.entries(parsed)) {
    if (!isRecord(entry) || typeof entry.updatedAt !== "number" || !Array.isArray(entry.comments)) {
      continue;
    }
    const comments = entry.comments
      .map(parseComment)
      .filter((comment): comment is RunReviewComment => comment !== null);
    if (comments.length > 0) {
      store[postRef] = { updatedAt: entry.updatedAt, comments };
    }
  }
  return store;
}

export function loadRunReviewComments(postRef: string): RunReviewComment[] {
  return readStore()[postRef]?.comments ?? [];
}

export function saveRunReviewComments(postRef: string, comments: RunReviewComment[]): void {
  const store = readStore();
  if (comments.length === 0) {
    delete store[postRef];
  } else {
    store[postRef] = { updatedAt: Date.now(), comments };
  }
  const keptRefs = Object.entries(store)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_RUNS)
    .map(([ref]) => ref);
  const pruned = Object.fromEntries(keptRefs.map((ref) => [ref, store[ref]]));
  // Quota/permission failures degrade to in-memory-only comments.
  writeLocalJson(STORAGE_KEY, pruned);
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface PatchRow {
  text: string;
  hunkIndex: number;
  oldLine?: number;
  newLine?: number;
}

function parsePatchRows(filePatch: string): PatchRow[] {
  const rows: PatchRow[] = [];
  let hunkIndex = -1;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of filePatch.split("\n")) {
    const header = line.match(HUNK_HEADER_RE);
    if (header) {
      hunkIndex += 1;
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) {
      continue;
    }
    const marker = line[0];
    if (marker === "+") {
      rows.push({ text: line, hunkIndex, newLine });
      newLine += 1;
    } else if (marker === "-") {
      rows.push({ text: line, hunkIndex, oldLine });
      oldLine += 1;
    } else if (marker === " ") {
      rows.push({ text: line, hunkIndex, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else {
      // Anything else (new `diff --git`, empty trailing line) ends the hunk.
      inHunk = false;
    }
  }
  return rows;
}

/**
 * Cut a small unified-diff excerpt around one line of a per-file patch.
 * `side`/`lineNumber` use post-run numbering for additions and pre-run
 * numbering for deletions — the same coordinates the diff renderer reports
 * on line click. Returns null when the line is not part of the patch.
 */
export function extractPatchExcerpt(
  filePatch: string,
  side: RunReviewSide,
  lineNumber: number,
  contextLines = 2
): string | null {
  const rows = parsePatchRows(filePatch);
  const targetIndex = rows.findIndex((row) =>
    side === "additions" ? row.newLine === lineNumber : row.oldLine === lineNumber
  );
  if (targetIndex === -1) {
    return null;
  }
  const hunkIndex = rows[targetIndex].hunkIndex;
  const excerpt = rows
    .slice(Math.max(0, targetIndex - contextLines), targetIndex + contextLines + 1)
    .filter((row) => row.hunkIndex === hunkIndex)
    .map((row) => row.text);
  return excerpt.join("\n");
}

/**
 * Serialize pending comments into one plain-text feedback block, appended to
 * the user's message on send. Uses `@path` references (runtimes resolve them
 * natively) with the diff excerpt captured at comment time.
 */
export function composeReviewFeedbackMessage(comments: readonly RunReviewComment[]): string {
  const sorted = [...comments].sort(
    (a, b) => a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber
  );
  const blocks = sorted.map((comment) => {
    const lineLabel =
      comment.side === "deletions"
        ? `removed line ${comment.lineNumber}`
        : `line ${comment.lineNumber}`;
    const header = `@${comment.path} (${lineLabel}):`;
    return comment.excerpt
      ? `${header}\n\`\`\`diff\n${comment.excerpt}\n\`\`\`\n${comment.note}`
      : `${header}\n${comment.note}`;
  });
  return `Review feedback on the run's changes:\n\n${blocks.join("\n\n")}`;
}

const PILL_NOTE_MAX_CHARS = 40;

/** Composer pill label: the trimmed note for one comment, a count otherwise. */
export function reviewCommentsPillLabel(comments: readonly RunReviewComment[]): string {
  if (comments.length === 1) {
    const note = comments[0].note.trim().replace(/\s+/g, " ");
    return note.length > PILL_NOTE_MAX_CHARS ? `${note.slice(0, PILL_NOTE_MAX_CHARS)}…` : note;
  }
  return `${comments.length} review comments`;
}
