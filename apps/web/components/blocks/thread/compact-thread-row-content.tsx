"use client";

import type { ReactNode } from "react";
import { isCliType, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { SlashCommandDisplayText, slashCommandDisplayText } from "@/lib/slash-commands/display";
import { THREAD_STATUS_META } from "@/lib/threads/status-meta";
import type { ThreadStatus } from "@/lib/threads/types";
import { cn } from "@/lib/utils";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import { ThreadAgentChip, type ThreadAgentChipAgent } from "./thread-agent-chip";
import { ThreadStatusIndicator } from "./thread-status-indicator";

export function CompactThreadRowContent({
  title,
  status,
  cliType,
  lastActivityAt,
  isUnread = false,
  isDone = false,
  forceStatusIndicator = false,
  showStatusLabel = false,
  userName,
  agent,
  leadingControl,
  titlePrefix,
  actions,
  className,
}: {
  title: string;
  status: ThreadStatus;
  cliType: string;
  lastActivityAt: number;
  isUnread?: boolean;
  isDone?: boolean;
  forceStatusIndicator?: boolean;
  /**
   * Word the status next to the glyph. Off by default: in a dense thread list
   * the glyph is enough and the column is needed for other metadata. On where a
   * row stands alone in a mixed stream (the task timeline), because there a
   * completed run's glyph is a blank spacer — nothing at all says "Done".
   */
  showStatusLabel?: boolean;
  userName?: string;
  agent?: ThreadAgentChipAgent;
  leadingControl?: ReactNode;
  titlePrefix?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const threadLabel = slashCommandDisplayText(title || "New thread");
  const renderIndicator = forceStatusIndicator || status !== "completed" || isUnread || isDone;

  return (
    <div
      className={cn(
        // `pl-2` positions the status indicator, which the task timeline's
        // thread card offsets itself against to sit on the activity rail's
        // column — see `task-timeline/rail-geometry.ts` before changing it.
        "pointer-events-none relative z-10 grid min-w-0 items-center gap-2 px-3 py-2 pl-2",
        leadingControl && renderIndicator
          ? "grid-cols-[auto_auto_minmax(0,1fr)_auto]"
          : leadingControl || renderIndicator
            ? "grid-cols-[auto_minmax(0,1fr)_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]",
        className
      )}
    >
      {leadingControl ? <span className="flex size-4 shrink-0 items-center justify-center">{leadingControl}</span> : null}
      {renderIndicator ? (
        <ThreadStatusIndicator
          status={status}
          isUnread={isUnread}
          isDone={isDone}
          showDoneCheck
          resting="blank"
          className="flex size-4 items-center justify-center"
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        {titlePrefix}
        <h4 className="min-w-0 truncate text-sm font-medium leading-5 text-foreground" title={threadLabel}>
          <SlashCommandDisplayText text={title || "New thread"} highlightCommands={false} />
        </h4>
      </div>
      {/*
        Hover actions replace the whole metadata cluster inline instead of
        floating over it: nothing is painted on top of the title, and the title
        keeps its full width at rest because the swapped-out layer is removed
        from layout rather than just hidden.

        The `data-state=open` variants keep the swap latched while an action
        menu is open (OS-1596). Radix anchors the portalled menu to the trigger
        and re-measures it on scroll/resize, so a trigger that hits
        `display: none` the moment the pointer leaves the row toward the menu
        measures as a zero-size rect and teleports the menu to viewport 0,0.
      */}
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <span
          className={cn(
            "flex items-center gap-1.5",
            actions && "group-hover:hidden group-has-[[data-state=open]]:hidden"
          )}
        >
          {userName ? <span className="text-xs text-muted-foreground/70">{userName}</span> : null}
          {showStatusLabel ? (
            <span className={cn("text-xs font-medium", THREAD_STATUS_META[status].className)}>
              {THREAD_STATUS_META[status].label}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground/70">{formatCompactRelativeTime(lastActivityAt)}</span>
          {agent ? <ThreadAgentChip agent={agent} compact /> : null}
          {isCliType(cliType) ? renderCliIcon(cliType, "size-3.5 shrink-0 text-muted-foreground") : null}
        </span>
        {actions ? (
          <span className="hidden items-center justify-end gap-1.5 group-hover:flex group-has-[[data-state=open]]:flex [&_*]:transition-none">
            {actions}
          </span>
        ) : null}
      </div>
    </div>
  );
}
