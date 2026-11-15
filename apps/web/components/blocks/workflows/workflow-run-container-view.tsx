"use client";

import { Plus, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { AddThreadToGroupDraftView } from "@/components/blocks/thread/add-thread-to-group-draft-view";
import { ThreadMobileBackButton } from "@/components/blocks/thread/thread-mobile-back-button";
import { useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import type { ThreadViewChat } from "@/components/blocks/thread/thread-view/thread-view";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreatedThreadHold } from "@/lib/threads/hooks/use-created-thread-hold";
import { buildAddToGroupDraftSeed } from "@/lib/threads/draft-flow";
import { WorkflowRunPanel } from "./workflow-run-panel";

/** Empty run view and manual composer. Spec: docs/specs/workflows.md, Threads. */
export function WorkflowRunContainerView({
  chat,
  workflowRunId,
  organizationId,
  params,
  draftOpen,
  onDraftOpenChange,
  onCreated,
}: {
  chat: ThreadViewChat;
  workflowRunId: Id<"workflowRuns">;
  organizationId?: Id<"organizations">;
  params: { organizationSlug: string; projectAlias: string };
  draftOpen: boolean;
  onDraftOpenChange: (open: boolean) => void;
  onCreated: (threadId: Id<"cliThreads">) => void;
}) {
  const { profiles } = useCliProfiles(chat.projectId, { withModelCatalogs: true });
  const draftKey = `sibling:${chat._id}`;
  const { draft, setDraft } = useThreadDraft(draftKey);
  const { awaitCreatedThread } = useCreatedThreadHold();

  const openDraft = () => {
    if (!draft?.text.trim() && (!draft?.profileId || draft.seededFrom !== chat._id)) {
      setDraft(buildAddToGroupDraftSeed(chat, profiles));
    }
    onDraftOpenChange(true);
  };
  const handleCreated = async (threadId: Id<"cliThreads">) => {
    await awaitCreatedThread({ threadId, containerId: chat._id });
    onCreated(threadId);
    onDraftOpenChange(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <ThreadMobileBackButton
          organizationSlug={params.organizationSlug}
          projectAlias={params.projectAlias}
        />
        <h1 className="truncate text-sm font-medium">{chat.title}</h1>
        {draftOpen ? (
          <Button variant="ghost" size="icon-sm" aria-label="Close new thread" onClick={() => onDraftOpenChange(false)}>
            <X />
          </Button>
        ) : chat.isOwner !== false ? (
          <Button variant="ghost" size="icon-sm" aria-label="New thread in group" onClick={openDraft}>
            <Plus />
          </Button>
        ) : null}
      </div>
      {draftOpen ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]" data-slot="add-to-group-draft">
          <AddThreadToGroupDraftView
            chat={chat}
            params={params}
            organizationId={organizationId}
            draftKey={draftKey}
            onCreated={handleCreated}
          />
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
          <WorkflowRunPanel runId={workflowRunId} params={params} />
        </div>
      )}
    </div>
  );
}
