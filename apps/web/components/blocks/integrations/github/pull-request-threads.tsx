"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AttachedPullRequest } from "@/convex/lib/contracts/github";
import { EmptyValue } from "@/components/blocks/tasks/task-table/badges";
import { ThreadListItem } from "@/components/blocks/thread/thread-list-item";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimelineThreadRow } from "@/lib/tasks/timeline/rows";
import { getThreadDisplayStatus } from "@/lib/threads/display-status";

export type PullRequestThread = FunctionReturnType<typeof api.cli.threads.lists.listByAttachedPullRequest>[number];

/** The viewer's own and shared threads whose Attached pull request is this PR; undefined while loading. */
export function usePullRequestThreads(projectId: Id<"projects">, pullRequest: AttachedPullRequest | null) {
  return useQuery(
    api.cli.threads.lists.listByAttachedPullRequest,
    pullRequest ? { projectId, owner: pullRequest.owner, name: pullRequest.name, number: pullRequest.number } : "skip"
  );
}

/** Activity's thread card row; a teammate's thread carries their name. */
export function toTimelineThreadRow(thread: PullRequestThread): TimelineThreadRow {
  return {
    threadId: thread._id,
    title: thread.title,
    status: getThreadDisplayStatus(thread),
    cliType: thread.cliType,
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    userName: thread.ownerName,
    hasUnread: thread.hasUnread,
    isDone: thread.isDone,
    isOwn: thread.ownerName === undefined,
    isWorkflowRun: thread.workflowRunId !== undefined && thread.parentThreadId === undefined,
  };
}

/** The Threads label's "+": opens Activity's thread composer. */
export function PullRequestThreadsComposeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label="Start a thread" title="Start a thread" className="-my-1.5 size-7">
      <Plus className="size-3.5" />
    </Button>
  );
}

/** The Overview's Threads property, as on the task sidebar. */
export function PullRequestThreadsProperty({
  threads,
  organizationSlug,
  projectAlias,
}: {
  threads: PullRequestThread[] | undefined;
  organizationSlug: string;
  projectAlias: string;
}) {
  if (!threads?.length) {
    return <span className="flex h-7 items-center">{threads ? <EmptyValue /> : <Skeleton className="h-4 w-32" aria-label="Loading" />}</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {threads.map((thread) => (
        <ThreadListItem
          key={thread._id}
          chat={thread}
          isActive={false}
          compactLayout
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          showAssociatedTask={false}
          showActions={false}
          showStatusIndicator={false}
          rowClassName="border-b-0 bg-transparent rounded-sm hover:bg-muted dark:hover:bg-muted/50 -ml-1.5"
          innerClassName="px-1.5 py-1"
        />
      ))}
    </div>
  );
}
