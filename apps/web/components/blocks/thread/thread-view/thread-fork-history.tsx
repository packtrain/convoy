"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { useConvex } from "convex/react";
import { GitBranch } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliThreadForkedFrom } from "@/convex/lib/contracts/validators";
import { AppLink, appRoute } from "@/lib/navigation";
import { useForkPrefix, type ForkPrefixSegment } from "@/lib/threads/hooks/use-fork-prefix";
import { forkDividerAnchor } from "@/lib/threads/message-rows";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { ThreadMessageList, type ThreadDetailTaskLink } from "./thread-message-list";

type ListProps = ComponentProps<typeof ThreadMessageList>;

interface ForkProps extends Pick<ListProps, "onOpenArtifact" | "onOpenTaskRef" | "onOpenTaskInSidebar" | "onOpenDiffFile"> {
  forkedFrom: CliThreadForkedFrom;
  organizationSlug: string;
  projectAlias: string;
  taskLinkHref: (task: ThreadDetailTaskLink) => string;
  /** Forks the ancestor at that run; absent for read-only viewers. */
  onBranchFromHere?: (messageId: Id<"cliMessages">) => void;
  onBranchIntoTab?: (messageId: Id<"cliMessages">) => void;
}

type ParentSummary = { title: string; forkedFrom?: CliThreadForkedFrom };

/** One-shot read of the parent: `undefined` while loading, `null` when gone or not viewable. Skipped when the title is known. */
function useParentThread(threadId: Id<"cliThreads">, knownTitle?: string): ParentSummary | null | undefined {
  const convex = useConvex();
  const [parent, setParent] = useState<ParentSummary | null | undefined>(undefined);
  useEffect(() => {
    if (knownTitle !== undefined) {
      return;
    }
    let cancelled = false;
    convex
      .query(api.cli.threads.core.get, { threadId })
      .then((row) => {
        if (!cancelled) setParent(row ? { title: row.title, forkedFrom: row.forkedFrom } : null);
      })
      .catch(() => {
        if (!cancelled) setParent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [convex, knownTitle, threadId]);
  return knownTitle !== undefined ? { title: knownTitle } : parent;
}

/**
 * "Forked from <parent>" on the same separator line a context-compaction
 * notice uses (OS-1397). The host list places it below the copied run via
 * `forkDividerAnchor`. Spec: cli-thread-fork.md → Thread view.
 */
export function ThreadForkDivider({
  forkedFrom,
  organizationSlug,
  projectAlias,
  parentTitle,
}: Pick<ForkProps, "forkedFrom" | "organizationSlug" | "projectAlias"> & { parentTitle?: string }) {
  const parent = useParentThread(forkedFrom.threadId, parentTitle);
  return (
    <Marker variant="separator" className="my-2 text-xs">
      <MarkerIcon>
        <GitBranch />
      </MarkerIcon>
      <MarkerContent>
        {parent === null ? (
          "Forked from a deleted thread"
        ) : (
          <>
            Forked from{" "}
            <AppLink href={appRoute.projectThreadDetail(organizationSlug, projectAlias, String(forkedFrom.threadId))}>
              {parent?.title ?? "…"}
            </AppLink>
          </>
        )}
      </MarkerContent>
    </Marker>
  );
}

/**
 * The ancestors' messages before the copied run, read once and rendered above
 * the fork's transcript, read-only. One list per ancestor, oldest first; only
 * the oldest carries the "Show more" cut, which pages that ancestor and then
 * walks to the next one. Spec: cli-thread-fork.md → Earlier parent messages.
 */
export function ThreadForkHistory({ forkedFrom, organizationSlug, projectAlias, taskLinkHref, onBranchFromHere, onBranchIntoTab, ...openHandlers }: ForkProps) {
  const prefix = useForkPrefix({ forkedFrom });

  if (prefix.status === "unavailable") {
    return <p className="py-3 text-center text-sm text-muted-foreground">The original thread is no longer available.</p>;
  }
  if (prefix.status === "loaded" && !prefix.hasOlder && prefix.segments.every((segment) => segment.messages.length === 0)) {
    return null;
  }
  // While loading, one empty list shows the placeholder.
  const segments: ForkPrefixSegment[] = prefix.segments.length > 0 ? prefix.segments : [{ forkedFrom, title: "", messages: [] }];
  return (
    <>
      {segments.map((segment, index) => (
        <ThreadMessageList
          key={segment.forkedFrom.threadId}
          embedded
          isThreadProcessing={false}
          isQueueHeld={false}
          isSubmitting={false}
          showOlderMessagesCut={index === 0 && prefix.hasOlder}
          showOlderMessagesPlaceholder={index === 0 && prefix.isLoadingOlder}
          showOlderMessagesLabel="Show more"
          isLoadingMessages={prefix.status === "loading"}
          visibleMessages={segment.messages}
          userTextById={prefix.userTextById}
          userMessageResponseMap={prefix.userMessageResponseMap}
          askUserQuestionResponses={prefix.askUserQuestionResponses}
          getUserMessageAttachments={prefix.getUserMessageAttachments}
          renderStateByMessageId={prefix.renderStateByMessageId}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          onShowOlderMessages={prefix.loadOlder}
          onBranchFromHere={onBranchFromHere}
          onBranchIntoTab={onBranchIntoTab}
          taskLinkHref={taskLinkHref}
          {...openHandlers}
          transcriptDivider={
            segment.parentForkedFrom
              ? {
                  afterMessageId: forkDividerAnchor(segment.messages, segment.parentForkedFrom.runId),
                  node: (
                    <ThreadForkDivider
                      forkedFrom={segment.parentForkedFrom}
                      organizationSlug={organizationSlug}
                      projectAlias={projectAlias}
                      parentTitle={segments[index - 1]?.title}
                    />
                  ),
                }
              : undefined
          }
        />
      ))}
    </>
  );
}
