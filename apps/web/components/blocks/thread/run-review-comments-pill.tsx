"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Pill, PillAction, PillContent, PillIcon, PillText } from "@/components/ui/pill";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  reviewCommentsPillLabel,
  type RunReviewComment,
} from "@/lib/threads/run-review-comments";

/**
 * Composer pill for pending run-review comments (OS-1155). The comments ride
 * the next sent message; removing the pill deletes them after confirmation.
 */
export function RunReviewCommentsPill({
  comments,
  onClear,
}: {
  comments: readonly RunReviewComment[];
  onClear: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (comments.length === 0) {
    return null;
  }

  return (
    <>
      <TooltipExt content="Review comments — sent with your next message">
        <Pill className="max-w-[280px] border-info/40">
          <PillContent>
            <PillIcon>
              <MessageSquare className="size-4 text-info" />
            </PillIcon>
            <PillText>{reviewCommentsPillLabel(comments)}</PillText>
          </PillContent>
          <PillAction
            onClick={() => setConfirmOpen(true)}
            aria-label="Remove review comments"
          />
        </Pill>
      </TooltipExt>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove review comments?</AlertDialogTitle>
            <AlertDialogDescription>
              {comments.length === 1
                ? "Your pending review comment will be deleted"
                : `All ${comments.length} pending review comments will be deleted`}{" "}
              without being sent to the agent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onClear();
              }}
            >
              Remove comments
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
