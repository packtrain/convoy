"use client";

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import type { ProjectAgentListItem } from "@/components/blocks/agents/agent-list-utils";
import type { ThreadComposerAttachedTask } from "@/components/blocks/thread/thread-composer";
import { ThreadDraftProvider, getNewThreadDraftKey, useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import type { Id } from "@/convex/_generated/dataModel";
import { appRoute, useNavigation } from "@/lib/navigation";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import { buildAutomationDraftSeed, resolveNewThreadDraftState } from "@/lib/threads/draft-flow";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreateThreadSubmit } from "@/lib/threads/hooks/use-create-thread-submit";
import { useRememberedNewThreadCliModels } from "@/lib/threads/hooks/use-remembered-new-thread-cli-models";
import { DEFAULT_FALLBACK_CLI_TYPE } from "@/lib/threads/types";
import type { Task } from "@/lib/tasks/types";

const noop = () => {};
const noAttachments = async () => [];

interface AgentAutomationAutoSubmitProps {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
  task: Task;
  agent: ProjectAgentListItem;
  /** Auto-submit can't proceed (no profiles, no resolvable selection, create failed): open the composer dialog instead. */
  onFallback: () => void;
  onDone: () => void;
}

/**
 * Headless auto-submit for assignment automation (OS-1131): with the per-project
 * "auto-start" preference on, create the thread through the exact pipeline the composer
 * dialog would use — same automation seed, same profile/path resolution, same
 * `useCreateThreadSubmit` — without rendering the dialog. Fires once when profiles
 * resolve.
 */
export function AgentAutomationAutoSubmit(props: AgentAutomationAutoSubmitProps) {
  const draftStorageKey = buildProjectDraftStorageKey(props.organizationSlug, props.projectAlias);

  return (
    <ThreadDraftProvider key={draftStorageKey} storageKey={draftStorageKey}>
      <AutoSubmitRunner {...props} />
    </ThreadDraftProvider>
  );
}

function AutoSubmitRunner({ projectId, organizationSlug, projectAlias, task, agent, onFallback, onDone }: AgentAutomationAutoSubmitProps) {
  const navigation = useNavigation();
  const { profiles, hasProfiles, isLoading: isProfilesLoading } = useCliProfiles(projectId, { withModelCatalogs: true });
  const { draft: newThreadDraft } = useThreadDraft(getNewThreadDraftKey());
  const { rememberedCliModels, rememberedCliEfforts, rememberedCliType } = useRememberedNewThreadCliModels();

  const automation = agent.automation;

  // The assigned agent is the only bindable option (OS-1138): the resolver
  // keeps the seeded projectAgentId only while it resolves in this list, and
  // the submit pipeline narrows the id against it before sending.
  const projectAgents = useMemo(() => [agent], [agent]);

  // The same seed the composer dialog writes into its draft slot, resolved
  // through the same function — the assigned agent is bound, automation config
  // wins, profile/path follows the persisted new-thread draft, then the
  // online-profile fallback.
  const resolved = useMemo(() => {
    const defaultProfile = profiles.find((profile) => profile.isOnline) ?? profiles[0];
    return resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "",
        updatedAt: 0,
        projectAgentId: agent._id,
        ...buildAutomationDraftSeed(automation),
        ...(newThreadDraft?.profileId ? { profileId: newThreadDraft.profileId } : {}),
        ...(newThreadDraft?.pathId ? { pathId: newThreadDraft.pathId } : {}),
      },
      preselection: null,
      fallbackCliType: DEFAULT_FALLBACK_CLI_TYPE,
      fallbackProfileId: defaultProfile?._id ?? "",
      fallbackPathId: defaultProfile?.paths[0]?.id ?? "",
      rememberedCliModels,
      rememberedCliEfforts,
      rememberedCliType,
      projectAgents,
    });
  }, [agent._id, automation, newThreadDraft, profiles, projectAgents, rememberedCliEfforts, rememberedCliModels, rememberedCliType]);

  const attachedTask: ThreadComposerAttachedTask = useMemo(
    () => ({ _id: task._id, refId: task.refId, name: task.name, taskType: task.taskType }),
    [task._id, task.name, task.refId, task.taskType]
  );

  const { handleSubmit } = useCreateThreadSubmit({
    profiles,
    draftState: resolved,
    // Without this list the resolved projectAgentId is silently dropped — the
    // submit pipeline only sends ids it can narrow against these options.
    projectAgents,
    prepareAttachmentsForSubmit: noAttachments,
    clearAfterSubmit: noop,
    setDraft: noop,
    rememberCliModel: noop,
    attachedTask,
    agentWorkSource: "assignment_automation",
    onCreated: (threadId) => {
      toast.success(`Thread started for ${task.refId}`, {
        action: {
          label: "Open",
          onClick: () => navigation.push(appRoute.projectThreadDetail(organizationSlug, projectAlias, String(threadId))),
        },
      });
      onDone();
    },
  });

  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || isProfilesLoading) {
      return;
    }
    firedRef.current = true;

    if (!hasProfiles || !resolved.profileId || !resolved.pathId) {
      onFallback();
      return;
    }

    void handleSubmit({
      text: automation?.prompt?.displayContent ?? "",
      composerDocument: automation?.prompt?.composerDocument,
      files: [],
      taskId: task._id,
      attachedTask,
    }).catch(() => {
      // useCreateThreadSubmit already toasts the failure; let the user retry
      // with the composer visible.
      onFallback();
    });
  }, [
    attachedTask,
    automation?.prompt?.composerDocument,
    automation?.prompt?.displayContent,
    handleSubmit,
    hasProfiles,
    isProfilesLoading,
    onFallback,
    resolved.pathId,
    resolved.profileId,
    task._id,
  ]);

  return null;
}
