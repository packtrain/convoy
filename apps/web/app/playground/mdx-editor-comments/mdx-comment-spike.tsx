"use client";

import dynamic from "next/dynamic";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CommentOverlay, type OverlayComment } from "@/components/blocks/tasks/artifact-comments/comment-overlay";
import { captureSelection, caretOffset, getEditable, textOf } from "@/components/blocks/tasks/artifact-comments/lib/dom-anchor";
import { locateAnchor, type CommentAnchor } from "@/components/blocks/tasks/artifact-comments/lib/locate-anchor";

const MdxEditor = dynamic(() => import("@/components/mdx-editor").then((mod) => mod.MdxEditor), {
  ssr: false,
});

interface SpikeComment extends OverlayComment {
  body: string;
}

interface PendingSelection {
  anchor: CommentAnchor;
  top: number;
  left: number;
}

const SAMPLE = `# Release plan

The rollout happens in three phases. The first phase ships to internal users
only, so we can watch the dashboards before a wider launch.

## Phase 1

Ship the feature flag off by default. We enable it for the team and confirm the
dashboards look healthy before moving on.

## Phase 2

Turn the flag on for beta customers. Watch the dashboards again — if anything
regresses we roll back immediately.

## Phase 3

General availability. Announce it and update the docs.
`;

export function MdxCommentSpike() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(SAMPLE);
  const [comments, setComments] = useState<SpikeComment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detachedIds, setDetachedIds] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(true);
  const [pending, setPending] = useState<PendingSelection | null>(null);

  const onDetachedChange = useCallback((ids: string[]) => {
    setDetachedIds((prev) => {
      if (prev.size === ids.length && ids.every((id) => prev.has(id))) return prev;
      return new Set(ids);
    });
  }, []);

  const visible = useMemo(
    () => comments.filter((c) => showResolved || !c.resolved),
    [comments, showResolved]
  );

  const handleMouseUp = () => {
    const editable = getEditable(rootRef.current);
    if (!editable) return;

    const anchor = captureSelection(editable);
    if (anchor) {
      const selection = window.getSelection();
      const rects = selection?.getRangeAt(0).getClientRects();
      const last = rects && rects.length > 0 ? rects[rects.length - 1] : null;
      const base = rootRef.current?.getBoundingClientRect();
      if (!last || !base) return;
      setPending({
        anchor,
        top: last.bottom - base.top + 6,
        left: last.right - base.left,
      });
      return;
    }

    setPending(null);

    // Collapsed click: activate the comment under the caret. The overlay is
    // pointer-transparent so the caret lands in the text naturally.
    const offset = caretOffset(editable);
    if (offset === null) return;
    const content = textOf(editable);
    const hit = visible.find((c) => {
      const range = locateAnchor(content, c.anchor);
      return range !== null && offset >= range.start && offset <= range.end;
    });
    if (hit) setActiveId(hit.id);
  };

  const addComment = () => {
    if (!pending) return;
    const id = crypto.randomUUID();
    setComments((prev) => [...prev, { id, anchor: pending.anchor, resolved: false, body: "" }]);
    setActiveId(id);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const toggleResolved = (id: string) =>
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c))
    );

  const removeComment = (id: string) =>
    setComments((prev) => prev.filter((c) => c.id !== id));

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">MDX comment overlay spike</h1>
          <p className="text-xs text-muted-foreground">
            Select text → Comment. Edit the doc and watch highlights track / detach. (OS-1019)
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-4">
          <div ref={rootRef} className="relative" onMouseUp={handleMouseUp}>
            <MdxEditor value={value} onChange={setValue} toolbar theme="light" />
            <CommentOverlay
              rootRef={rootRef}
              comments={visible}
              activeId={activeId}
              onDetachedChange={onDetachedChange}
            />
            {pending && (
              <div
                className="absolute z-20"
                style={{ top: pending.top, left: pending.left }}
              >
                <Button size="sm" className="h-7 cursor-pointer gap-1 shadow-md" onClick={addComment}>
                  <MessageSquarePlus className="size-3.5" />
                  Comment
                </Button>
              </div>
            )}
          </div>
        </div>

        <aside className="flex w-80 shrink-0 flex-col border-l border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            Comments ({visible.length})
          </div>
          <div className="flex-1 space-y-2 overflow-auto p-3">
            {visible.length === 0 && (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            )}
            {visible.map((c) => {
              const isDetached = detachedIds.has(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    "cursor-pointer rounded-md border p-2 text-sm transition-colors",
                    c.id === activeId ? "border-primary bg-accent" : "border-border",
                    c.resolved && "opacity-50"
                  )}
                >
                  <blockquote className="mb-1 border-l-2 border-highlight pl-2 text-xs italic text-muted-foreground">
                    “{c.anchor.text}”
                  </blockquote>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs">
                      {isDetached ? (
                        <span className="text-destructive">detached</span>
                      ) : (
                        <span className="text-muted-foreground">anchored</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleResolved(c.id);
                        }}
                      >
                        {c.resolved ? "Unresolve" : "Resolve"}
                      </button>
                      <button
                        type="button"
                        aria-label="Delete comment"
                        className="cursor-pointer text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeComment(c.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
