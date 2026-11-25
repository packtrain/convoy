/**
 * Client-local persistence for the thread workspace's view preferences (diff
 * style, word wrap, split vs full-width layout). Browser UI preferences only —
 * deliberately not stored on the server. Fail-soft: storage errors fall back
 * to the defaults.
 */

import { useSyncExternalStore } from "react";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

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
