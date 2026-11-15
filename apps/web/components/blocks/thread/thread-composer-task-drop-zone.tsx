"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  dragHasTasksForProject,
  readTaskDragPayload,
} from "@/lib/tasks/task-drag";

interface ThreadComposerTaskDropZoneProps {
  projectId: string | null;
  /** First root task of the drag; the composer holds at most one attached task. */
  onDropTask: (task: { id: string; refId: string }) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Drop target that attaches a task dragged from a task table (e.g. the thread
 * sidebar's Tasks panel) to the thread composer — the drag counterpart of the
 * "+" menu's "Attach task". Gates on the cross-surface task-drag MIME, so file
 * drags fall through to the composer's own file handling untouched.
 */
export function ThreadComposerTaskDropZone({
  projectId,
  onDropTask,
  disabled = false,
  children,
  className,
}: ThreadComposerTaskDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (
      disabled ||
      !projectId ||
      !dragHasTasksForProject(event.dataTransfer, projectId)
    ) {
      return;
    }
    event.preventDefault();
    // Task drags must not reach the Tiptap editor below: its ProseMirror
    // dragover/drop handling would show a text drop cursor and insert the
    // drag's text/plain id as editor content.
    event.stopPropagation();
    // Must stay within the drag's effectAllowed ("move", set by the task
    // table) — a disallowed effect makes the browser cancel the drop.
    event.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    setIsDragOver(false);
    if (disabled || !projectId) {
      return;
    }
    const payload = readTaskDragPayload(event.dataTransfer);
    if (!payload || payload.projectId !== projectId) {
      return;
    }
    // stopPropagation in the capture phase keeps the drop away from both the
    // Tiptap editor (whose native drop handler would insert the drag's
    // text/plain id as text) and the table's document-level ambient-drop
    // listener (which would treat it as a row reorder).
    event.preventDefault();
    event.stopPropagation();
    const refId = payload.taskRefIds?.[0];
    if (!refId) {
      return;
    }
    onDropTask({ id: payload.taskIds[0], refId });
  };

  return (
    <div
      className={cn("relative", className)}
      onDragOverCapture={handleDragOver}
      onDragLeave={handleDragLeave}
      onDropCapture={handleDrop}
    >
      {children}
      {isDragOver && (
        <div
          data-testid="thread-composer-task-drop-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/5"
        >
          <span className="rounded-lg bg-background/90 px-4 py-2 text-sm font-medium text-foreground">
            Drop to attach task
          </span>
        </div>
      )}
    </div>
  );
}
