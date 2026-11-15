import type { CommentSort } from "../artifact-comments-rail";
import { readLocalJson, writeLocalJson } from "@/lib/browser/local-storage";
import { isRecord } from "@/lib/type-guards";

const STORAGE_KEY = "task-artifact-comment-prefs";

export interface CommentPrefs {
  showResolved: boolean;
  sort: CommentSort;
  /** Whether the comments rail is open; persists across artifacts/sessions. */
  isOpen: boolean;
}

export const DEFAULT_COMMENT_PREFS: CommentPrefs = {
  showResolved: true,
  sort: "natural",
  isOpen: false,
};

const SORTS: readonly CommentSort[] = ["natural", "newest", "oldest"];

function isCommentSort(value: unknown): value is CommentSort {
  return SORTS.some((sort) => sort === value);
}

export function readCommentPrefs(): CommentPrefs {
  const record = readLocalJson(STORAGE_KEY);
  if (!isRecord(record)) {
    return DEFAULT_COMMENT_PREFS;
  }

  return {
    showResolved: typeof record.showResolved === "boolean" ? record.showResolved : DEFAULT_COMMENT_PREFS.showResolved,
    sort: isCommentSort(record.sort) ? record.sort : DEFAULT_COMMENT_PREFS.sort,
    isOpen: typeof record.isOpen === "boolean" ? record.isOpen : DEFAULT_COMMENT_PREFS.isOpen,
  };
}

export function writeCommentPrefs(prefs: Partial<CommentPrefs>): void {
  writeLocalJson(STORAGE_KEY, { ...readCommentPrefs(), ...prefs });
}
