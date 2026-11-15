"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Plus, Search, Send } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { CompactThreadDestinationContent } from "@/components/blocks/thread/compact-thread-destination-content";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThreadPickerDialog } from "@/components/blocks/thread/thread-picker-dialog";
import {
  buildThreadDraftKey,
  getNewThreadDraftKey,
  useOptionalThreadDraftProvider,
} from "@/components/blocks/thread/thread-draft-provider";
import {
  buildArtifactCommentsDraftText,
  upsertArtifactCommentsDraft,
} from "@/lib/threads/artifact-comments-handoff";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import { appRoute, useNavigation } from "@/lib/navigation";

const MAX_TASK_THREADS = 5;

interface SendCommentsToThreadMenuProps {
  projectId: Id<"projects">;
  taskId: Id<"tasks">;
  /** Task ref like "OS-12"; auto-attaches the task on the new-thread path. */
  taskRefId: string;
  organizationSlug: string;
  projectAlias: string;
  /** Artifact the message was composed for; re-sends replace its block. */
  artifactId: string;
  /** Composed handoff message for the artifact's open comments. */
  message: string;
  /**
   * Host-owned switch to an existing thread (the thread workspace, OS-1716):
   * keeps the query and selects a group sibling's tab. Omitted elsewhere,
   * where a plain push is right.
   */
  onNavigateToThread?: (threadId: Id<"cliThreads">) => void;
}

/**
 * Rail-header action that seeds a thread composer draft with the open
 * comments and navigates there: a recent task thread, a new thread, or any
 * thread found via the picker.
 */
export function SendCommentsToThreadMenu({
  projectId,
  taskId,
  taskRefId,
  organizationSlug,
  projectAlias,
  artifactId,
  message,
  onNavigateToThread,
}: SendCommentsToThreadMenuProps) {
  const navigation = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const taskThreads = useQuery(
    api.cli.threads.lists.listByAssociatedTask,
    menuOpen ? { projectId, taskId } : "skip"
  );
  const recentTaskThreads = useMemo(
    () =>
      // Copy first: `useQuery` hands back the shared cached array, and sorting
      // it in place would reorder it for every other subscriber.
      [...(taskThreads ?? [])].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, MAX_TASK_THREADS),
    [taskThreads]
  );

  const storageKey = buildProjectDraftStorageKey(organizationSlug, projectAlias);
  const draftProvider = useOptionalThreadDraftProvider();

  /**
   * Through a mounted provider — it owns the live draft, so a storage write
   * would drop text still inside its persist debounce (OS-1716). Outside one
   * (task and artifact routes) storage is the only channel.
   */
  const seedDraft = (threadKey: string) => {
    if (draftProvider) {
      draftProvider.seedDraft(threadKey, (previousText) =>
        buildArtifactCommentsDraftText(previousText, { artifactId, message })
      );
      return;
    }
    upsertArtifactCommentsDraft(storageKey, threadKey, { artifactId, message });
  };

  /**
   * The current query, when the send starts inside the threads route: an open
   * artifact is URL state, and a bare push would close it (OS-1716). Another
   * page's query describes that page, so it is left behind.
   */
  const sameRouteQuery = (): URLSearchParams | null => {
    const isSameRoute = navigation.location.pathname.startsWith(
      appRoute.projectThreads(organizationSlug, projectAlias).pathname
    );
    return isSameRoute && navigation.location.search
      ? new URLSearchParams(navigation.location.search)
      : null;
  };

  const sendToThread = (threadId: Id<"cliThreads">) => {
    seedDraft(buildThreadDraftKey(threadId));
    if (onNavigateToThread) {
      onNavigateToThread(threadId);
      return;
    }
    const target = appRoute.projectThreadDetail(
      organizationSlug,
      projectAlias,
      threadId
    );
    const query = sameRouteQuery();
    navigation.push(query ? { ...target, query } : target);
  };

  const sendToNewThread = () => {
    seedDraft(getNewThreadDraftKey());
    const query = sameRouteQuery();
    if (!query) {
      navigation.push(
        appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, {
          attachedTask: taskRefId,
        })
      );
      return;
    }
    // `?threadArtifact=` names a thread's artifact tab and there is no thread
    // yet; the task sidebar's `?artifact=` does render here, so it stays.
    query.delete("threadArtifact");
    query.set("attachedTask", taskRefId);
    navigation.push({
      ...appRoute.projectThreads(organizationSlug, projectAlias),
      query,
    });
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            aria-label="Send open comments to a thread"
            title="Send open comments to a thread"
          >
            <Send />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[28rem] max-w-[calc(100vw-2rem)]"
        >
          {recentTaskThreads.length > 0 && (
            <>
              <DropdownMenuLabel>Task threads</DropdownMenuLabel>
              {recentTaskThreads.map((thread) => (
                <DropdownMenuItem
                  key={thread._id}
                  className="group cursor-pointer p-0"
                  onClick={() => sendToThread(thread._id)}
                >
                  <CompactThreadDestinationContent
                    thread={thread}
                    className="w-full px-2 py-1.5"
                  />
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem className="cursor-pointer" onClick={sendToNewThread}>
            <Plus className="size-4" />
            New thread
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setPickerOpen(true)}
          >
            <Search className="size-4" />
            Search threads...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ThreadPickerDialog
        projectId={projectId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={sendToThread}
      />
    </>
  );
}
