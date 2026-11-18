"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { TaskThreadComposer } from "@/components/blocks/tasks/task-thread-composer";
import { AutoStartPreferenceSelector } from "@/components/blocks/thread/auto-start-preference-selector";
import { ThreadDraftProvider, useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTitleBar } from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { attachedPullRequestUrl, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { getMutationErrorMessage } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";
import { isBaseRefSelectionValid } from "@/lib/threads/base-ref-selection";
import { resolveNewThreadDraftState } from "@/lib/threads/draft-flow";
import { buildProjectDraftStorageKey } from "@/lib/threads/draft-storage";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { useCreateThreadSubmit } from "@/lib/threads/hooks/use-create-thread-submit";
import { useRememberedNewThreadCliModels } from "@/lib/threads/hooks/use-remembered-new-thread-cli-models";
import { DEFAULT_FALLBACK_CLI_TYPE } from "@/lib/threads/types";
import { guidePrompt } from "./guide-prompt";

type Target = { projectId: Id<"projects">; organizationSlug: string; projectAlias: string; pullRequest: AttachedPullRequest };
/** The stored PR's revision; unset until Convoy has synced the PR. */
type Revision = { baseSha: string; headSha: string } | null;
type LaunchProps = Target & { viewerId: Id<"users">; revision: NonNullable<Revision>; onClose: () => void };

const draftKey = (viewerId: Id<"users">) => `pull-request-guide:${viewerId}`;
const noop = () => {};
const noAttachments = async () => [];

/**
 * Generate guide: a thread composer prefilled with the guide prompt, on the member's own profile,
 * like Run checks. Spec: docs/specs/github-integration.md → Guides → Requesting and running.
 */
export function useGenerateGuide(target: Target | null, revision: Revision) {
  // Open, for Retry the failed Guide the run writes again, and whether to skip the composer.
  const [open, setOpen] = useState<{ retryGuideId?: Id<"integrationPullRequestGuides">; auto?: boolean } | null>(null);
  const projectId = target?.projectId;
  const autoStart = useQuery(api.users.projectPreferences.get, projectId ? { projectId } : "skip")?.guideAutoStart ?? false;
  const permissions = useProjectPermissions(projectId ?? null);
  const { profiles, isLoading } = useCliProfiles(projectId);
  // The popup's draft is per member, so its key waits for the viewer.
  const viewer = useQuery(api.users.core.current);
  const reason = !target || !revision
    ? "Convoy has not synced this pull request yet"
    : !isLoading && !profiles.some((profile) => profile.isOnline)
      ? "No CLI profile is online"
      : null;
  return {
    /** Hidden without the CLI thread permission. */
    allowed: permissions.canUseThreads,
    disabled: isLoading || !viewer || reason !== null,
    reason,
    // Retry always asks: the failed run's choices are often what failed.
    start: (retryGuideId?: Id<"integrationPullRequestGuides">) => setOpen({ retryGuideId, auto: !retryGuideId && autoStart }),
    dialog:
      open && viewer && target && revision ? (
        open.auto ? (
          <AutoStart {...target} viewerId={viewer._id} revision={revision} onFallback={() => setOpen({})} onClose={() => setOpen(null)} />
        ) : (
          <LaunchDialog
            {...target}
            viewerId={viewer._id}
            revision={revision}
            retryGuideId={open.retryGuideId}
            autoStart={autoStart}
            onClose={() => setOpen(null)}
          />
        )
      ) : null,
  };
}

function LaunchDialog({
  viewerId,
  revision,
  retryGuideId,
  autoStart,
  onClose,
  ...target
}: LaunchProps & { retryGuideId?: Id<"integrationPullRequestGuides">; autoStart: boolean }) {
  const openThreadToast = useOpenThreadToast(target);
  const upsertPreferences = useMutation(api.users.projectPreferences.upsert);
  // The "next time" choice, saved only on send.
  const [choice, setChoice] = useState<boolean | null>(null);
  // Frozen at open: a push meanwhile must not send a new head with a prompt naming the old one, so the server rejects it.
  const [opened] = useState(revision);
  // Seeded on each open: the prompt names the current head, so last time's text would be stale.
  const [seed, setSeed] = useState<string | undefined>(() => guidePrompt({ pullRequest: target.pullRequest, ...opened }));
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        // Radix would focus the profile pill, which opens its card; the composer focuses itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitleBar>
          <DialogTitle className="text-sm">{retryGuideId ? "Retry the guide" : "Generate a guide"}</DialogTitle>
          <DialogDescription className="sr-only">Start a thread that writes a guide to this pull request.</DialogDescription>
        </DialogTitleBar>
        <TaskThreadComposer
          {...target}
          draftKey={draftKey(viewerId)}
          pullRequestGuide={{ headSha: opened.headSha, retryGuideId }}
          seed={seed}
          seedReplacesDraft
          onSeeded={() => setSeed(undefined)}
          autoFocus
          composerContainerClassName="p-3"
          extraSelectorTools={<AutoStartPreferenceSelector label="Generate guide" value={choice ?? autoStart} onChange={setChoice} />}
          onThreadCreated={(threadId) => {
            if (choice !== null && choice !== autoStart) {
              upsertPreferences({ projectId: target.projectId, guideAutoStart: choice }).catch((error: unknown) =>
                toast.error(getMutationErrorMessage(error, "Could not save the Generate guide choice"))
              );
            }
            openThreadToast(threadId);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function useOpenThreadToast({ organizationSlug, projectAlias, pullRequest }: Target) {
  const navigation = useNavigation();
  return (threadId: Id<"cliThreads">) =>
    toast.success(`Writing a guide for #${pullRequest.number}`, {
      action: {
        label: "Open thread",
        onClick: () => navigation.push(appRoute.projectThreadDetail(organizationSlug, projectAlias, threadId)),
      },
    });
}

/**
 * Start automatically: sends the composer's remembered choices with a fresh prompt, without showing it.
 * Falls back to the composer when the remembered profile is offline or gone.
 */
function AutoStart(props: LaunchProps & { onFallback: () => void }) {
  return (
    <ThreadDraftProvider storageKey={buildProjectDraftStorageKey(props.organizationSlug, props.projectAlias)}>
      <AutoStartRunner {...props} />
    </ThreadDraftProvider>
  );
}

function AutoStartRunner({ viewerId, revision, onFallback, onClose, ...target }: LaunchProps & { onFallback: () => void }) {
  const openThreadToast = useOpenThreadToast(target);
  const { profiles, isLoading } = useCliProfiles(target.projectId, { withModelCatalogs: true });
  const projectAgents = useQuery(api.agents.projectAgents.listByProject, { projectId: target.projectId });
  const { draft, setDraft } = useThreadDraft(draftKey(viewerId));
  const { rememberedCliModels, rememberedCliEfforts, rememberedCliType } = useRememberedNewThreadCliModels();
  // A removed worktree must not fall back to its parent checkout, where the agent would check out the PR.
  const remembered = profiles.some(
    (profile) =>
      profile._id === draft?.profileId &&
      profile.isOnline &&
      profile.paths.some((path) => path.id === draft.pathId) &&
      (!draft.baseRef || isBaseRefSelectionValid(draft.baseRef, draft.pathId ?? "", profile.paths))
  );
  const draftState = useMemo(
    () =>
      resolveNewThreadDraftState({
        profiles,
        draft,
        preselection: null,
        fallbackCliType: DEFAULT_FALLBACK_CLI_TYPE,
        fallbackProfileId: "",
        fallbackPathId: "",
        rememberedCliModels,
        rememberedCliEfforts,
        rememberedCliType,
        projectAgents,
      }),
    [draft, profiles, projectAgents, rememberedCliEfforts, rememberedCliModels, rememberedCliType]
  );
  const { handleSubmit } = useCreateThreadSubmit({
    profiles,
    draftState,
    projectAgents,
    prepareAttachmentsForSubmit: noAttachments,
    clearAfterSubmit: noop,
    setDraft,
    rememberCliModel: noop,
    pullRequestGuide: { headSha: revision.headSha },
    onCreated: (threadId) => {
      openThreadToast(threadId);
      onClose();
    },
  });

  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || isLoading || projectAgents === undefined) return;
    firedRef.current = true;
    if (!remembered) {
      onFallback();
      return;
    }
    // useCreateThreadSubmit toasts the failure; the composer lets the member try again.
    void handleSubmit({
      text: guidePrompt({ pullRequest: target.pullRequest, ...revision }),
      files: [],
      pullRequestUrl: attachedPullRequestUrl(target.pullRequest),
    }).catch(onFallback);
  }, [handleSubmit, isLoading, onFallback, projectAgents, remembered, revision, target.pullRequest]);

  return null;
}
