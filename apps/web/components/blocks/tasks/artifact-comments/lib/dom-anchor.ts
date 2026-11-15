// DOM bridge between rendered-text offsets and the MDXEditor contentEditable (OS-1019). Lexical
// reconciles the DOM and can replace text nodes on every keystroke, so we never hold a live
// Range: we work in rendered-text offset space (against `editable.textContent`) and rebuild one
// on demand. Capture slices the same textContent so re-finding stays consistent.

import type { CommentAnchor } from "./locate-anchor";

const CONTEXT_LEN = 40;

/** The MDXEditor contenteditable inside the kit root. */
export function getEditable(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[contenteditable="true"]') ?? null;
}

/** Full rendered text of the editable, the space all offsets live in. */
export function textOf(editable: HTMLElement): string {
  return editable.textContent ?? "";
}

/**
 * Rendered-text offset of a (node, offset) DOM point within `editable`.
 * Range.toString() concatenates the text content up to the point, which also
 * handles element-node boundaries (triple-click / select-all selections).
 */
function pointToOffset(editable: HTMLElement, node: Node, nodeOffset: number): number {
  const range = document.createRange();
  range.setStart(editable, 0);
  range.setEnd(node, nodeOffset);
  return range.toString().length;
}

/** Build a DOM Range spanning [start, end) in rendered-text space. */
export function rangeForOffsets(
  editable: HTMLElement,
  start: number,
  end: number
): Range | null {
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  let total = 0;
  let startNode: Node | null = null;
  let startLocal = 0;
  let endNode: Node | null = null;
  let endLocal = 0;

  let node = walker.nextNode();
  while (node) {
    const len = (node.textContent ?? "").length;
    if (startNode === null && start <= total + len) {
      startNode = node;
      startLocal = start - total;
    }
    if (end <= total + len) {
      endNode = node;
      endLocal = end - total;
      break;
    }
    total += len;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startLocal);
  range.setEnd(endNode, endLocal);
  return range;
}

/** Capture an anchor from the current window selection, if it sits inside `editable`. */
export function captureSelection(editable: HTMLElement): CommentAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return null;

  // Range boundaries are always document-ordered, so start <= end.
  const start = pointToOffset(editable, range.startContainer, range.startOffset);
  const end = pointToOffset(editable, range.endContainer, range.endOffset);

  const content = textOf(editable);
  const text = content.slice(start, end);
  if (!text.trim()) return null;

  return {
    text,
    prefix: content.slice(Math.max(0, start - CONTEXT_LEN), start),
    suffix: content.slice(end, end + CONTEXT_LEN),
    startOffset: start,
  };
}

/** Rendered-text offset of the collapsed caret, if it sits inside `editable`. */
export function caretOffset(editable: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return null;

  return pointToOffset(editable, range.startContainer, range.startOffset);
}

export interface OverlayRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Client rects of a range, made relative to `container` (its offset box). */
export function rectsForRange(range: Range, container: HTMLElement): OverlayRect[] {
  const base = container.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((r) => ({
    top: r.top - base.top + container.scrollTop,
    left: r.left - base.left + container.scrollLeft,
    width: r.width,
    height: r.height,
  }));
}
