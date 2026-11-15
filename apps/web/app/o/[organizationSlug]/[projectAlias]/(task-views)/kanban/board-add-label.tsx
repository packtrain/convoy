"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { CreateTaskLabelDialog } from "@/components/blocks/tasks/create-task-label-dialog";
import { Button } from "@/components/ui/button";

/**
 * Trailing "+" after the last label column: creates a new label (= a new
 * board column) without leaving the board.
 */
export function BoardAddLabel({
  projectId,
  labelCount,
  disabledReason,
}: {
  projectId: Id<"projects">;
  labelCount: number;
  /** Set when creating is not possible right now (e.g. label cap reached). */
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    // px-3/py-2 + h-6 mirror the column headers so the "+" lines up with the
    // per-column add buttons; sticky like them so it stays put when the board
    // scrolls vertically (self-start keeps the flex item from stretching,
    // which would break sticky).
    <div className="sticky top-0 z-10 flex self-start px-3 py-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Add label"
        title={disabledReason}
        disabled={Boolean(disabledReason)}
        className="h-6 w-6 cursor-pointer text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
      </Button>
      <CreateTaskLabelDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        labelCount={labelCount}
      />
    </div>
  );
}
