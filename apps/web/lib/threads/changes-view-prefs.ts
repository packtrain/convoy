/**
 * Client-local persistence for the thread workspace's view preferences (diff
 * style, word wrap, split vs full-width layout). Browser UI preferences only —
 * deliberately not stored on the server. Fail-soft: storage errors fall back
 * to the defaults.
 */

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
