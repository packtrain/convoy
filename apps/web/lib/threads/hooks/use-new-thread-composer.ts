"use client";

import type { CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildProjectAgentDraftPatch,
  resolveNewThreadDraftState,
  type ThreadProjectAgentOption,
} from "@/lib/threads/draft-flow";
import { getDefaultCliEffort, getDefaultCliModel, getDefaultMode, type CliModel, type CliTypeSlug } from "@/lib/cli-runtime-ui/registry";
import type { ResolvedAgentContext } from "@/lib/threads/preselection";
import type { ThreadComposerDraft, ThreadDraftPatch } from "@/lib/threads/draft-storage";
import type { AvailableCliInfo } from "@/lib/threads/types";
import type { RememberedNewThreadCliEfforts, RememberedNewThreadCliModels } from "@/lib/threads/remembered-new-thread-cli-models";
import type { BaseRefSelection } from "@/lib/threads/base-ref-selection";

interface NewThreadComposerProfile {
  _id: string;
  isOnline: boolean;
  availableClis?: AvailableCliInfo[];
  paths: Array<{ id: string; kind?: CliProfilePathEntry["kind"]; parentPathId?: string }>;
}

interface UseNewThreadComposerParams {
  profiles: NewThreadComposerProfile[];
  draft: ThreadComposerDraft | undefined;
  setDraft: (patch: ThreadDraftPatch) => void;
  preselection?: ResolvedAgentContext | null;
  fallbackCliType: CliTypeSlug;
  rememberedCliModels?: RememberedNewThreadCliModels;
  rememberedCliEfforts?: RememberedNewThreadCliEfforts;
  rememberedCliType?: CliTypeSlug;
  backfillEnabled?: boolean;
  /** Active Project agents offered by the composer's Agent pill (OS-1138). */
  projectAgents?: ThreadProjectAgentOption[];
}

const EMPTY_PROJECT_AGENTS: ThreadProjectAgentOption[] = [];

export function useNewThreadComposer({
  profiles,
  draft,
  setDraft,
  preselection = null,
  fallbackCliType,
  rememberedCliModels = {},
  rememberedCliEfforts = {},
  rememberedCliType,
  backfillEnabled = true,
  projectAgents = EMPTY_PROJECT_AGENTS,
}: UseNewThreadComposerParams) {
  const defaultProfile = profiles.find((profile) => profile.isOnline) ?? profiles[0];
  const fallbackProfileId = defaultProfile?._id ?? "";
  const fallbackPathId = defaultProfile?.paths[0]?.id ?? "";

  const resolvedDraftState = useMemo(
    () =>
      resolveNewThreadDraftState({
        profiles,
        draft,
        preselection,
        fallbackCliType,
        fallbackProfileId,
        fallbackPathId,
        rememberedCliModels,
        rememberedCliEfforts,
        rememberedCliType,
        projectAgents,
      }),
    [draft, fallbackCliType, fallbackPathId, fallbackProfileId, projectAgents, rememberedCliEfforts, rememberedCliModels, rememberedCliType, preselection, profiles]
  );

  useEffect(() => {
    if (!backfillEnabled || profiles.length === 0) {
      return;
    }

    const hasInvalidPersistedAgentContext =
      draft?.profileId !== undefined &&
      draft?.pathId !== undefined &&
      (draft.profileId !== resolvedDraftState.profileId || draft.pathId !== resolvedDraftState.pathId);

    const shouldBackfillDraft =
      !draft ||
      !draft.cliType ||
      (resolvedDraftState.cliModel !== undefined && draft.cliModel === undefined) ||
      (resolvedDraftState.cliEffort !== undefined && draft.cliEffort === undefined) ||
      !draft.profileId ||
      !draft.pathId ||
      hasInvalidPersistedAgentContext ||
      (draft.mode === undefined && resolvedDraftState.mode !== undefined) ||
      !draft.attachments;

    if (!shouldBackfillDraft) {
      return;
    }

    setDraft({
      text: draft?.text ?? "",
      cliType: resolvedDraftState.cliType,
      mode: resolvedDraftState.mode,
      cliModel: resolvedDraftState.cliModel,
      cliEffort: resolvedDraftState.cliEffort,
      profileId: resolvedDraftState.profileId,
      pathId: resolvedDraftState.pathId,
      attachments: draft?.attachments ?? { pending: false },
    });
  }, [
    backfillEnabled,
    draft,
    profiles.length,
    resolvedDraftState.cliType,
    resolvedDraftState.cliModel,
    resolvedDraftState.cliEffort,
    resolvedDraftState.mode,
    resolvedDraftState.pathId,
    resolvedDraftState.profileId,
    setDraft,
  ]);

  const handleTextChange = useCallback(
    (value: string) => {
      setDraft({ text: value });
    },
    [setDraft]
  );

  const handleWorkingDirectoryChange = useCallback(
    (profileId: string, pathId: string) => {
      // Base-ref selections are scoped to a working directory.
      setDraft({ profileId, pathId, baseRef: undefined });
    },
    [setDraft]
  );

  const handleBaseRefChange = useCallback(
    (baseRef: BaseRefSelection | undefined) => {
      setDraft({ baseRef });
    },
    [setDraft]
  );

  const handleCliTypeChange = useCallback(
    (cliType: CliTypeSlug) => {
      setDraft({
        cliType,
        mode: getDefaultMode(cliType),
        cliModel: getDefaultCliModel(cliType),
        cliEffort: getDefaultCliEffort(cliType),
      });
    },
    [setDraft]
  );

  const handleModeChange = useCallback(
    (mode: string) => {
      setDraft({ mode });
    },
    [setDraft]
  );

  const handleCliModelChange = useCallback(
    (cliModel: CliModel) => {
      setDraft({ cliModel });
    },
    [setDraft]
  );

  const handleCliEffortChange = useCallback(
    (cliEffort: string) => {
      setDraft({ cliEffort });
    },
    [setDraft]
  );

  // Bumped when an agent selection seeds the automation prompt into the
  // draft: the tiptap editor only reads draft content on mount, so callers
  // fold this into the composer's draftScopeKey to remount it with the seed.
  const [agentSeedKey, setAgentSeedKey] = useState(0);
  // The draft's own seed count rides along: the artifact-comments handoff can
  // seed while this composer is mounted (OS-1716).
  const composerSeedKey = `${agentSeedKey}-seed:${draft?.seedCount ?? 0}`;

  const handleProjectAgentChange = useCallback(
    (projectAgentId: string | undefined) => {
      // Agents with an enabled automation config also default the other pills and seed the prompt
      // into an empty composer (or over the previous agent's unedited seed); each stays
      // overridable afterwards. Leaving an agent reverts its unedited seeds.
      const patch = buildProjectAgentDraftPatch(projectAgentId, projectAgents, draft);
      setDraft(patch);
      if (Object.prototype.hasOwnProperty.call(patch, "text")) {
        setAgentSeedKey((key) => key + 1);
      }
    },
    [draft, projectAgents, setDraft]
  );

  return {
    resolvedDraftState,
    composerSeedKey,
    handleTextChange,
    handleWorkingDirectoryChange,
    handleBaseRefChange,
    handleCliTypeChange,
    handleModeChange,
    handleCliModelChange,
    handleCliEffortChange,
    handleProjectAgentChange,
  };
}
