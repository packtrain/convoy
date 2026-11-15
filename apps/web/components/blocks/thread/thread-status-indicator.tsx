"use client";

import { Check, Circle } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import type { ThreadStatus } from "@/lib/threads/types";
import { cn } from "@/lib/utils";

/**
* The status glyph for a thread, shared by every surface that renders one from a
* `ThreadStatus`. New surfaces belong here rather than in a local switch. Companion to
* `THREAD_STATUS_META`, which owns the *words* — that catalog was extracted when three
* surfaces' labels had drifted, and the glyphs were drifting the same way.
*
* Two dots are deliberately not this component: `AgentThreadWorkStatusDot` has its own palette
* (while sharing the wording catalog), and `threads-demo` keeps a private copy. Surfaces differ
* in only two ways, so both are props: whether a finished thread shows a checkmark, and what
* the resting state occupies.
*/
export function ThreadStatusIndicator({
  status,
  isUnread = false,
  isDone = false,
  resting = "placeholder",
  showDoneCheck = false,
  className,
}: {
  status: ThreadStatus;
  isUnread?: boolean;
  /** Explicitly marked done (OS-1382); only rendered with `showDoneCheck`. */
  isDone?: boolean;
  /**
   * What a read, finished thread leaves behind. `placeholder` keeps a
   * transparent dot so a column of rows doesn't reflow as threads settle;
   * `blank` renders an empty box, for surfaces that size their own slot.
   */
  resting?: "placeholder" | "blank";
  /**
   * Render `isDone` as a checkmark. Off for the full row (its done treatment is
   * elsewhere in the row) and for tabs, where a tab is already tight on width
   * with the task-ref chip beside it (OS-1594).
   */
  showDoneCheck?: boolean;
  /** The wrapper's classes — each surface sizes its own slot. */
  className?: string;
}) {
  if (status === "streaming" || status === "pending") {
    return (
      <span title={status === "pending" ? "Pending" : "Streaming response"} className={className}>
        <Spinner className="size-3" />
      </span>
    );
  }

  if (status === "waiting_input") {
    return <Dot title="Awaiting input" color="text-warning fill-warning" animate className={className} />;
  }

  if (status === "failed") {
    return <Dot title="Error" color="text-destructive fill-destructive" className={className} />;
  }

  // Done outranks unread: a thread the user finished with is finished even if
  // its last activity was never opened.
  if (showDoneCheck && isDone) {
    return (
      <span title="Done" className={cn("text-muted-foreground", className)}>
        <Check className="size-3.5" />
      </span>
    );
  }

  if (isUnread) {
    return <ThreadUnreadIndicator isUnread className={className} />;
  }

  if (resting === "blank") {
    return <span className={cn("shrink-0", className)} aria-hidden="true" />;
  }

  return <Dot title="Read" color="text-transparent fill-transparent" className={className} />;
}

/** Unread activity independent of the thread's running or attention status. */
export function ThreadUnreadIndicator({ isUnread, className }: {
  isUnread: boolean;
  className?: string;
}) {
  return isUnread ? <Dot title="Unread" color="text-info fill-info" className={className} /> : null;
}

function Dot({
  title,
  color,
  animate = false,
  className,
}: {
  title: string;
  color: string;
  animate?: boolean;
  className?: string;
}) {
  return (
    <span title={title} className={className}>
      <Circle className={cn("size-2", color, animate && "animate-pulse")} />
    </span>
  );
}
