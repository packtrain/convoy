/**
 * Client-local persistence for the thread workspace's view preferences (diff
 * style, word wrap, split vs full-width layout). Browser UI preferences only —
 * deliberately not stored on the server. Fail-soft: storage errors fall back
 * to the defaults.
 */

import { useSyncExternalStore } from "react";
import { readLocalJson, readLocalString, writeLocalJson, writeLocalString } from "@/lib/browser/local-storage";

const DIFF_STYLE_KEY = "convoy.thread-changes-diff-style";
const WORD_WRAP_KEY = "convoy.thread-changes-word-wrap";
const LAYOUT_MODE_KEY = "convoy.thread-layout-mode";

export type ChangesDiffStyle = "unified" | "split";

/**
 * `split` — thread on the left, panels in the right sidebar (default).
 * `full` — the thread is one tab among the panels, each filling the width.
 */
export type ThreadLayoutMode = "split" | "full";

/** Every pref here is two-valued, so reading one is "is it the non-default?". */
function storedIs(key: string, value: string): boolean {
  return readLocalString(key) === value;
}

export function readChangesDiffStyle(): ChangesDiffStyle {
  return storedIs(DIFF_STYLE_KEY, "split") ? "split" : "unified";
}

export function writeChangesDiffStyle(style: ChangesDiffStyle): void {
  writeLocalString(DIFF_STYLE_KEY, style);
}

export function readChangesWordWrap(): boolean {
  return storedIs(WORD_WRAP_KEY, "1");
}

export function writeChangesWordWrap(wrap: boolean): void {
  writeLocalString(WORD_WRAP_KEY, wrap ? "1" : "0");
}

export function readThreadLayoutMode(): ThreadLayoutMode {
  return storedIs(LAYOUT_MODE_KEY, "full") ? "full" : "split";
}

export function writeThreadLayoutMode(mode: ThreadLayoutMode): void {
  writeLocalString(LAYOUT_MODE_KEY, mode);
}

const FILE_TREE_KEY = "convoy.thread-changes-file-tree";

export function readChangesFileTree(): boolean {
  return storedIs(FILE_TREE_KEY, "1");
}

export function writeChangesFileTree(open: boolean): void {
  writeLocalString(FILE_TREE_KEY, open ? "1" : "0");
}

const FILE_TREE_SIDE_KEY = "convoy.changes-file-tree-side";
const FILE_TREE_SIDE_EVENT = "convoy:changes-file-tree-side-change";

/** Which side of a diff its changed-files tree sits on; set in Settings → Appearance. */
export type FileTreeSide = "right" | "left";

export function readFileTreeSide(): FileTreeSide {
  return storedIs(FILE_TREE_SIDE_KEY, "left") ? "left" : "right";
}

export function writeFileTreeSide(side: FileTreeSide): void {
  if (writeLocalString(FILE_TREE_SIDE_KEY, side)) {
    window.dispatchEvent(new CustomEvent(FILE_TREE_SIDE_EVENT));
  }
}

function subscribeToFileTreeSide(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === FILE_TREE_SIDE_KEY) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(FILE_TREE_SIDE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(FILE_TREE_SIDE_EVENT, onChange);
  };
}

/** Live across mounted diffs: a settings change moves open trees at once. */
export function useFileTreeSide(): FileTreeSide {
  return useSyncExternalStore(subscribeToFileTreeSide, readFileTreeSide, () => "right");
}

const HISTORY_LAYOUT_KEY = "convoy.history-layout";

/** History's List | Graph toggle (OS-2536), shared by the worktree page and the thread Changes tab. */
export type HistoryLayout = "list" | "graph";

export function readHistoryLayout(): HistoryLayout {
  return storedIs(HISTORY_LAYOUT_KEY, "graph") ? "graph" : "list";
}

export function writeHistoryLayout(layout: HistoryLayout): void {
  writeLocalString(HISTORY_LAYOUT_KEY, layout);
}

// Multi-repo threads: the repo the Changes tab last showed, per thread (newest 100).
const CHANGES_REPO_KEY = "convoy.thread-changes-repo";
const MAX_REMEMBERED_REPOS = 100;

function readChangesRepos(): [string, string][] {
  const parsed = readLocalJson(CHANGES_REPO_KEY);
  return Array.isArray(parsed)
    ? parsed.filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string")
    : [];
}

export function readChangesRepo(threadId: string): string | null {
  return readChangesRepos().find(([id]) => id === threadId)?.[1] ?? null;
}

export function writeChangesRepo(threadId: string, repoId: string): void {
  const rest = readChangesRepos().filter(([id]) => id !== threadId);
  writeLocalJson(CHANGES_REPO_KEY, [[threadId, repoId], ...rest].slice(0, MAX_REMEMBERED_REPOS));
}
