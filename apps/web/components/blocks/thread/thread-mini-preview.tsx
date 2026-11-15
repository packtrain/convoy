"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Spinner } from "@/components/custom/spinner";
import { ThreadDraftProvider } from "@/components/blocks/thread/thread-draft-provider";
import { ThreadView } from "@/components/blocks/thread/thread-view/thread-view";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import { useCliMessages } from "@/lib/threads/hooks/use-cli-messages";
import { useCliThread } from "@/lib/threads/hooks/use-cli-thread";
import { threadCanWrite, threadIsReadOnly } from "@/lib/threads/sharing";

interface ThreadMiniPreviewProps {
  threadId: Id<"cliThreads">;
  organizationSlug: string;
  projectAlias: string;
}

function ThreadMiniPreviewContent({
  threadId,
  organizationSlug,
  projectAlias,
}: ThreadMiniPreviewProps) {
  const { thread, isLoading } = useCliThread(String(threadId));
  const cliMessages = useCliMessages(threadId, {
    canWrite: threadCanWrite(thread),
  });
  const project = useQuery(api.projects.core.getById, thread ? { id: thread.projectId } : "skip");

  if (isLoading || cliMessages.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center py-10">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }

  if (!thread) {
    return <div className="flex min-h-0 flex-1 items-center justify-center py-10 text-sm text-muted-foreground">Thread not found</div>;
  }

  return (
    // `min-w-0` / `minmax(0,1fr)` on both axes: the host is a fixed-width
    // `overflow-hidden` popover, so a grid track left at `auto` sizes to its
    // content's min-content width and clips the trailing edge (tab strip,
    // answered count, composer stop button) instead of shrinking (OS-1602).
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <ThreadView
        chat={thread}
        cliMessages={cliMessages}
        readOnly={threadIsReadOnly(thread)}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        organizationId={project?.organizationId}
        composerContainerClassName="p-2 max-md:pb-2"
        composerContentClassName="max-w-none"
      />
    </div>
  );
}

/** Shared embedded thread conversation for compact popover and drawer hosts. */
export function ThreadMiniPreview(props: ThreadMiniPreviewProps) {
  const draftStorageKey = buildProjectDraftStorageKey(props.organizationSlug, props.projectAlias);

  return (
    <ThreadDraftProvider key={draftStorageKey} storageKey={draftStorageKey}>
      <ThreadMiniPreviewContent {...props} />
    </ThreadDraftProvider>
  );
}
