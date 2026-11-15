"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { useThreadReadState } from "./thread-read-state-context";

interface ThreadMarkReadButtonProps {
  threadId: Id<"cliThreads">;
  hasUnread: boolean;
  requiresAttention: boolean;
}

/**
 * Explicit "Mark as read" thread-header action (OS-1305). Rendered only when
 * marking the thread read would have an effect. Acknowledges the current
 * failed/waiting-input attention state per the read-state spec.
 */
export function ThreadMarkReadButton({
  threadId,
  hasUnread,
  requiresAttention,
}: ThreadMarkReadButtonProps) {
  const threadReadState = useThreadReadState();
  const markReadMutation = useMutation(api.cli.threads.core.markRead);

  const handleMarkRead = useCallback(async () => {
    // Spec: explicit mark-read on the active thread clears local auto-read
    // suppression first, then persists read state.
    threadReadState?.clearSuppressionIfMatches(threadId);
    try {
      await markReadMutation({
        threadId,
        acknowledgeAttention: requiresAttention,
      });
    } catch {
      toast.error("Failed to mark thread as read");
    }
  }, [markReadMutation, requiresAttention, threadId, threadReadState]);

  if (!hasUnread && !requiresAttention) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void handleMarkRead()}
      className="cursor-pointer"
    >
      Mark as read
    </Button>
  );
}
