"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import {
  getEditable,
  rangeForOffsets,
  rectsForRange,
  textOf,
  type OverlayRect,
} from "./lib/dom-anchor";
import { locateAnchor, type CommentAnchor } from "./lib/locate-anchor";

export interface OverlayComment {
  id: string;
  anchor: CommentAnchor;
  resolved: boolean;
}

interface Box extends OverlayRect {
  id: string;
  resolved: boolean;
}

interface CommentOverlayProps {
  /** A `position: relative` element wrapping the MdxEditor. */
  rootRef: RefObject<HTMLElement | null>;
  comments: OverlayComment[];
  activeId: string | null;
  /**
   * Reports which comment ids currently have no home in the content, plus the
   * document start offset of every located comment (for natural sorting).
   */
  onDetachedChange: (
    detachedIds: string[],
    positions: ReadonlyMap<string, number>
  ) => void;
}

/**
 * Purely visual highlight layer. It never intercepts pointer events, so caret
 * placement and text selection inside highlighted ranges keep working —
 * click-to-activate is handled by the parent via caret-offset hit-testing.
 */
export function CommentOverlay({
  rootRef,
  comments,
  activeId,
  onDetachedChange,
}: CommentOverlayProps) {
  const [boxes, setBoxes] = useState<Box[]>([]);

  // ponytail: full relocate of every comment on each mutation — O(comments × doc);
  // debounce/incremental remap if large docs or many comments make typing lag.
  const recompute = useCallback(() => {
    const root = rootRef.current;
    const editable = getEditable(root);
    if (!root || !editable) {
      setBoxes([]);
      return;
    }

    const content = textOf(editable);
    const next: Box[] = [];
    const detached: string[] = [];
    const positions = new Map<string, number>();

    for (const comment of comments) {
      const located = locateAnchor(content, comment.anchor);
      const range = located && rangeForOffsets(editable, located.start, located.end);
      if (!range) {
        detached.push(comment.id);
        continue;
      }
      positions.set(comment.id, located.start);
      for (const rect of rectsForRange(range, root)) {
        next.push({ ...rect, id: comment.id, resolved: comment.resolved });
      }
    }

    setBoxes(next);
    onDetachedChange(detached, positions);
  }, [rootRef, comments, onDetachedChange]);

  // Recompute on content edits, layout changes, scroll, and resize. The
  // ResizeObserver fires an initial callback on observe(), which also covers the
  // first paint and every time this effect re-subscribes (i.e. comments change).
  useEffect(() => {
    const root = rootRef.current;
    const editable = getEditable(root);
    if (!root || !editable) return;

    const mutationObserver = new MutationObserver(() => recompute());
    mutationObserver.observe(editable, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const resizeObserver = new ResizeObserver(() => recompute());
    resizeObserver.observe(root);

    root.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      root.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [rootRef, recompute]);

  return (
    // z-[1]: above the editor content, below the sticky toolbar (z-10) so
    // highlights scroll under it instead of painting on top.
    <div className="pointer-events-none absolute inset-0 z-[1]">
      {boxes.map((box, index) => (
        <div
          key={`${box.id}-${index}`}
          // mix-blend-multiply keeps the text underneath legible (light theme;
          // a dark theme would want mix-blend-screen instead).
          className={cn(
            "absolute rounded-[0.2em] mix-blend-multiply transition-colors",
            box.resolved
              ? "bg-highlight/10"
              : box.id === activeId
                ? "bg-highlight/60 ring-1 ring-highlight"
                : "bg-highlight/35"
          )}
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          }}
        />
      ))}
    </div>
  );
}
