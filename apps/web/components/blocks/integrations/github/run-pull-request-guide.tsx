"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { TaskThreadComposer } from "@/components/blocks/tasks/task-thread-composer";
import { AutoStartPreferenceSelector } from "@/components/blocks/thread/auto-start-preference-selector";
import { ThreadDraftProvider, useThreadDraft } from "@/components/blocks/thread/thread-draft-provider";
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle, DialogTitleBar } from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { GuideSummary } from "@/convex/integrations/github/lib/validators";
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
import type { PullRequestOverview } from "./types";

type Target = { projectId: Id<"projects">; organizationSlug: string; projectAlias: string; pullRequest: AttachedPullRequest };
/** The stored PR's revision; unset until Convoy has synced the PR. */
type Revision = { baseSha: string; headSha: string } | null;
/** The run's prompt for a revision; with `base`, a Follow-up guide's. */
type BuildPrompt = (revision: NonNullable<Revision>, base?: GuideSummary) => string;
/** `guidePrompt` is the project's instructions the prompt is built with; unset is the default. `base` is Update guide's. */
type LaunchProps = Target & {
  viewerId: Id<"users">;
  revision: NonNullable<Revision>;
  buildPrompt: BuildPrompt;
  guidePrompt?: string;
  base?: GuideSummary;
  onClose: () => void;
};
type Open = { retryGuideId?: Id<"integrationPullRequestGuides">; auto?: boolean; duplicate?: GuideSummary; base?: GuideSummary };

const draftKey = (viewerId: Id<"users">) => `pull-request-guide:${viewerId}`;
const noop = () => {};
const noAttachments = async () => [];

/**
 * Generate guide: a thread composer prefilled with the guide prompt, on the member's own profile,
 * like Run checks. Spec: docs/specs/github-integration.md → Guides → Requesting and running.
 */
export function useGenerateGuide(
  target: Target | null,
  revision: Revision,
  guides?: GuideSummary[] | null,
  /** The PR's Stack, bottom first; null while a stacked PR's Layers load. */
  layers: { number: number; title: string }[] | null = [],
  /** Resolved and outdated review threads from the Overview; null while it loads. */
  settledThreads: PullRequestOverview["settledThreads"] | null = []
) {
  // Open, for Retry the failed Guide the run writes again, whether to skip the composer, another member's run to warn about first, and Update guide's base.
  const [open, setOpen] = useState<Open | null>(null);
  const projectId = target?.projectId;
  const autoStart = useQuery(api.users.projectPreferences.get, projectId ? { projectId } : "skip")?.guideAutoStart ?? false;
  // The project's Guide prompt; null is the built-in instructions.
  const instructions = useQuery(api.integrations.github.guides.getPrompt, projectId ? { projectId } : "skip");
  const permissions = useProjectPermissions(projectId ?? null);
  const { profiles, isLoading } = useCliProfiles(projectId);
  // The popup's draft is per member, so its key waits for the viewer.
  const viewer = useQuery(api.users.core.current);
  const buildPrompt: BuildPrompt | null =
    target && instructions !== undefined && layers && settledThreads
      ? (at, base) => guidePrompt({ pullRequest: target.pullRequest, ...at, instructions: instructions ?? undefined, layers, base, settledThreads })
      : null;
  /** A follow-up builds on the newest ready Guide, whoever wrote it; the run's agent reads its steps with `read-guide`. */
  const launch = (retryGuideId: Id<"integrationPullRequestGuides"> | undefined, followUp: boolean) =>
    setOpen({
      retryGuideId,
      auto: !retryGuideId && autoStart,
      duplicate: guides?.find((guide) => guide.status === "writing" && !guide.requester.isViewer && guide.headSha === revision?.headSha),
      base: followUp ? guides?.find((guide) => guide.status === "ready") : undefined,
    });
  const reason = !target || !revision
    ? "Convoy has not synced this pull request yet"
    : !isLoading && !profiles.some((profile) => profile.isOnline)
      ? "No CLI profile is online"
      : null;
  return {
    /** Hidden without the CLI thread permission. */
    allowed: permissions.canUseThreads,
    disabled: isLoading || !viewer || !buildPrompt || reason !== null,
    reason,
    // Retry always asks: the failed run's choices are often what failed. A retried follow-up is one again.
    start: (retryGuideId?: Id<"integrationPullRequestGuides">) => launch(retryGuideId, Boolean(guides?.find((guide) => guide._id === retryGuideId)?.base)),
    /** Update guide: a Follow-up guide of the newest ready Guide. */
    update: () => launch(undefined, true),
    dialog:
      open && viewer && target && revision && buildPrompt ? (
        open.duplicate ? (
          <ConfirmDialog
            open
            onClose={() => setOpen(null)}
            size="md"
            title={`${open.duplicate.requester.name ?? "A former member"} is already writing a guide for ${open.duplicate.headSha.slice(0, 7)}`}
            description="Their guide appears here when it finishes."
            confirm={{ label: "Start my own anyway", autoCloseOnClick: false, onClick: () => setOpen({ ...open, duplicate: undefined }) }}
          />
        ) : open.auto ? (
          <AutoStart
            {...target}
            viewerId={viewer._id}
            revision={revision}
            buildPrompt={buildPrompt}
            guidePrompt={instructions ?? undefined}
            base={open.base}
            onFallback={() => setOpen({ base: open.base })}
            onClose={() => setOpen(null)}
          />
        ) : (
          <LaunchDialog
            {...target}
            viewerId={viewer._id}
            revision={revision}
            buildPrompt={buildPrompt}
            guidePrompt={instructions ?? undefined}
            base={open.base}
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
  buildPrompt,
  guidePrompt,
  base,
  retryGuideId,
  autoStart,
  onClose,
  ...target
}: LaunchProps & { retryGuideId?: Id<"integrationPullRequestGuides">; autoStart: boolean }) {
  const openThreadToast = useOpenThreadToast(target);
  const upsertPreferences = useMutation(api.users.projectPreferences.upsert);
  // The "next time" choice, saved only on send.
  const [choice, setChoice] = useState<boolean | null>(null);
  // Frozen at open, as the seed names them: a push meanwhile makes the server reject the run, and the Guide stores these instructions.
  const [opened] = useState({ revision, guidePrompt });
  // Seeded on each open: the prompt names the current head, so last time's text would be stale.
  const [seed, setSeed] = useState<string | undefined>(() => buildPrompt(opened.revision, base));
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        // Radix would focus the profile pill, which opens its card; the composer focuses itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitleBar>
          <DialogTitle className="text-sm">{retryGuideId ? "Retry the guide" : base ? "Update the guide" : "Generate a guide"}</DialogTitle>
          <DialogDescription className="sr-only">Start a thread that writes a guide to this pull request.</DialogDescription>
        </DialogTitleBar>
        <TaskThreadComposer
          {...target}
          draftKey={draftKey(viewerId)}
          pullRequestGuide={{ headSha: opened.revision.headSha, retryGuideId, guidePrompt: opened.guidePrompt, baseGuideId: base?._id }}
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

function AutoStartRunner({ viewerId, revision, buildPrompt, guidePrompt, base, onFallback, onClose, ...target }: LaunchProps & { onFallback: () => void }) {
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
    pullRequestGuide: { headSha: revision.headSha, guidePrompt, baseGuideId: base?._id },
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
      text: buildPrompt(revision, base),
      files: [],
      pullRequestUrl: attachedPullRequestUrl(target.pullRequest),
    }).catch(onFallback);
  }, [base, buildPrompt, handleSubmit, isLoading, onFallback, projectAgents, remembered, revision, target.pullRequest]);

  return null;
}
