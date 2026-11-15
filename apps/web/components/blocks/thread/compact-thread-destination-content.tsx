"use client";

import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { getThreadDisplayStatus } from "@/lib/threads/display-status";
import type { ThreadListItemData } from "./thread-list-item";
import { CompactThreadRowContent } from "./compact-thread-row-content";

type CompactThreadDestination = Pick<
  ThreadListItemData,
  | "title"
  | "status"
  | "hasPendingInteraction"
  | "requiresAttention"
  | "cliType"
  | "lastActivityAt"
  | "hasUnread"
  | "agent"
  | "associatedTask"
>;

export function CompactThreadDestinationContent({
  thread,
  className,
}: {
  thread: CompactThreadDestination;
  className?: string;
}) {
  return (
    <CompactThreadRowContent
      title={thread.title}
      status={getThreadDisplayStatus(thread)}
      cliType={thread.cliType}
      lastActivityAt={thread.lastActivityAt}
      isUnread={thread.hasUnread}
      forceStatusIndicator
      agent={thread.agent}
      titlePrefix={
        thread.associatedTask ? (
          <TaskRefWithType
            refId={thread.associatedTask.refId}
            taskType={thread.associatedTask.taskType}
            refInteractive={false}
            className="shrink-0 gap-1.5"
            refClassName="text-xs font-medium text-muted-foreground"
            typeClassName="shrink-0"
          />
        ) : undefined
      }
      className={className}
    />
  );
}
