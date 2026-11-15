"use client";

import { Button } from "@/components/ui/button";

interface ThreadMarkDoneButtonProps {
  isDone: boolean;
  /**
   * Runs the toggle. The caller owns the mutation because the write carries an
   * optimistic update (the group strip re-sorts on done, OS-1478).
   */
  onToggle: () => void;
}

/**
 * Explicit done/not-done toggle in the thread-detail header (OS-1382).
 * Visible in both directions, including mid-run: the mark is sticky (OS-2176).
 */
export function ThreadMarkDoneButton({ isDone, onToggle }: ThreadMarkDoneButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onToggle}
      className="cursor-pointer"
    >
      {isDone ? "Mark as not done" : "Mark as done"}
    </Button>
  );
}
