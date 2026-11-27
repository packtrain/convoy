import type { CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import {
  getAvailableCli,
  getCliModes,
  getDefaultCliEffort,
  getDefaultCliModel,
  getDefaultMode,
  isCliType,
  isSupportedCliEffort,
  isSupportedCliModel,
} from "@/lib/cli-runtime-ui/registry";
import {
  DEFAULT_FALLBACK_CLI_TYPE,
  type AvailableCliInfo,
  type CliModel,
  type CliTypeSlug,
} from "./types";
import { buildComposerJsonFromPromptContent, type ThreadComposerCommandRef } from "@/lib/slash-commands/composer";
import type { ThreadComposerDraft, ThreadDraftPatch } from "./draft-storage";
import type { RememberedNewThreadCliEfforts, RememberedNewThreadCliModels } from "./remembered-new-thread-cli-models";
import { isBaseRefSelectionValid, type BaseRefSelection } from "./base-ref-selection";

interface ProfilePath {
  id: string;
  kind?: CliProfilePathEntry["kind"];
  parentPathId?: string;
}

interface DraftProfile {
  _id: string;
  isOnline: boolean;
  availableClis?: AvailableCliInfo[];
  paths: ProfilePath[];
}

interface AgentContextPreselection {
  profileId: string;
  pathId: string;
}

/**
 * Assignment-automation config subset that seeds composer pills when the
 * agent is selected (OS-1138). Structural match for the Convex
 * `projectAgents.listByProject` item's `automation` field.
 */
export interface ThreadProjectAgentAutomation {
  enabled: boolean;
  prompt?: {
    displayContent: string;
    composerDocument?: { version: 1; refs: ThreadComposerCommandRef[] };
  };
  cliType?: string;
  cliModel?: CliModel;
  cliEffort?: string;
  mode?: string;
  workspace?: "local" | "worktree";
}

export interface ThreadProjectAgentOption {
  _id: string;
  automation?: ThreadProjectAgentAutomation;
}

export interface ResolvedNewThreadDraftState {
  text: string;
  cliType: CliTypeSlug;
  mode: string | undefined;
  cliModel: CliModel | undefined;
  cliEffort: string | undefined;
  profileId: string;
  pathId: string;
  projectAgentId: string | undefined;
  baseRef: BaseRefSelection | undefined;
}

function isValidProfilePath(profiles: DraftProfile[], profileId: string, pathId: string): boolean {
  const profile = profiles.find((entry) => entry._id === profileId);
  if (!profile) {
    return false;
  }

  // A detected repo is never a working directory (cli-multi-repo-projects.md#server).
  return profile.paths.some((path) => path.id === pathId && path.kind !== "repo");
}

function hasModeForCli(cliType: CliTypeSlug, mode: string | undefined): boolean {
  if (!mode) {
    return false;
  }

  return getCliModes(cliType).some((entry) => entry.value === mode);
}

function resolveCliType({
  draftCliType,
  rememberedCliType,
  canUseRememberedCliType,
  fallbackCliType,
}: {
  draftCliType: ThreadComposerDraft["cliType"];
  rememberedCliType: CliTypeSlug | undefined;
  canUseRememberedCliType: boolean;
  fallbackCliType: CliTypeSlug;
}): CliTypeSlug {
  if (draftCliType) {
    return draftCliType;
  }

  if (rememberedCliType && canUseRememberedCliType) {
    return rememberedCliType;
  }

  return fallbackCliType;
}

function resolveCliModel({
  cliType,
  availableClis,
  draftCliModel,
  rememberedCliModel,
  canUseRememberedCliModel,
}: {
  cliType: CliTypeSlug;
  availableClis: AvailableCliInfo[] | undefined;
  draftCliModel: ThreadComposerDraft["cliModel"];
  rememberedCliModel: CliModel | undefined;
  canUseRememberedCliModel: boolean;
}): CliModel | undefined {
  // A new thread has nothing to keep, so a profile's own default replaces the runtime's (OS-2105).
  const profileDefault = getDefaultCliModel(cliType, availableClis);
  const runtimeDefault = getDefaultCliModel(cliType);
  const usable = (model: unknown): model is CliModel =>
    isSupportedCliModel(cliType, model) && (model !== runtimeDefault || model === profileDefault);

  if (usable(draftCliModel)) {
    return draftCliModel;
  }

  if (canUseRememberedCliModel && usable(rememberedCliModel)) {
    return rememberedCliModel;
  }

  return profileDefault;
}

/**
 * `cliModel`/`availableClis` are the context per-model effort catalogs
 * (OpenCode variants, Cursor tiers) need: an effort is only supported relative
 * to the model the composer settled on, so a stale value dropped by the
 * selected model falls through to the runtime default instead of surviving in
 * the pills.
 */
function resolveCliEffort({
  cliType,
  cliModel,
  availableClis,
  draftCliEffort,
  rememberedCliEffort,
  canUseRememberedCliEffort,
}: {
  cliType: CliTypeSlug;
  cliModel: CliModel | undefined;
  availableClis: AvailableCliInfo[] | undefined;
  draftCliEffort: ThreadComposerDraft["cliEffort"];
  rememberedCliEffort: string | undefined;
  canUseRememberedCliEffort: boolean;
}): string | undefined {
  const context = { cliModel, availableClis };

  if (isSupportedCliEffort(cliType, draftCliEffort, context)) {
    return draftCliEffort;
  }

  if (canUseRememberedCliEffort && isSupportedCliEffort(cliType, rememberedCliEffort, context)) {
    return rememberedCliEffort;
  }

  return getDefaultCliEffort(cliType);
}

export function resolveNewThreadDraftState({
  profiles,
  draft,
  preselection,
  fallbackCliType,
  fallbackProfileId,
  fallbackPathId,
  rememberedCliModels,
  rememberedCliEfforts = {},
  rememberedCliType,
  projectAgents,
}: {
  profiles: DraftProfile[];
  draft: ThreadComposerDraft | undefined;
  preselection: AgentContextPreselection | null;
  fallbackCliType: CliTypeSlug;
  fallbackProfileId: string;
  fallbackPathId: string;
  rememberedCliModels: RememberedNewThreadCliModels;
  rememberedCliEfforts?: RememberedNewThreadCliEfforts;
  rememberedCliType?: CliTypeSlug;
  projectAgents?: readonly ThreadProjectAgentOption[];
}): ResolvedNewThreadDraftState {
  const draftProfileId = draft?.profileId;
  const draftPathId = draft?.pathId;

  const hasDraftSelection = !!draftProfileId && !!draftPathId && isValidProfilePath(profiles, draftProfileId, draftPathId);

  const hasPreselection = !!preselection && isValidProfilePath(profiles, preselection.profileId, preselection.pathId);

  const profileId = hasPreselection ? preselection.profileId : hasDraftSelection ? draftProfileId : fallbackProfileId;

  const pathId = hasPreselection ? preselection.pathId : hasDraftSelection ? draftPathId : fallbackPathId;
  const selectedProfile = profiles.find((profile) => profile._id === profileId);

  const cliType = resolveCliType({
    draftCliType: draft?.cliType,
    rememberedCliType,
    canUseRememberedCliType:
      rememberedCliType !== undefined &&
      selectedProfile !== undefined &&
      getAvailableCli(selectedProfile.availableClis, rememberedCliType) !== undefined,
    fallbackCliType,
  });

  const rememberedCliModel = rememberedCliModels[cliType];
  const rememberedCliEffort = rememberedCliEfforts[cliType];
  const canUseRememberedCliModel = selectedProfile !== undefined && getAvailableCli(selectedProfile.availableClis, cliType) !== undefined;

  const mode = hasModeForCli(cliType, draft?.mode) ? draft?.mode : getDefaultMode(cliType);
  const cliModel = resolveCliModel({
    cliType,
    availableClis: selectedProfile?.availableClis,
    draftCliModel: draft?.cliModel,
    rememberedCliModel,
    canUseRememberedCliModel,
  });
  const cliEffort = resolveCliEffort({
    cliType,
    cliModel,
    availableClis: selectedProfile?.availableClis,
    draftCliEffort: draft?.cliEffort,
    rememberedCliEffort,
    canUseRememberedCliEffort: canUseRememberedCliModel,
  });

  // A persisted agent selection must still resolve to one of the project's
  // active agents; stale ids (agent deleted since) fall back to "No agent".
  const projectAgentId =
    draft?.projectAgentId !== undefined &&
    (projectAgents ?? []).some((agent) => agent._id === draft.projectAgentId)
      ? draft.projectAgentId
      : undefined;

  // The persisted base-ref selection is scoped to the draft's working
  // directory; drop it when the resolved selection differs or went stale.
  const baseRef =
    draft?.baseRef !== undefined &&
    pathId === draftPathId &&
    selectedProfile !== undefined &&
    isBaseRefSelectionValid(draft.baseRef, pathId, selectedProfile.paths)
      ? draft.baseRef
      : undefined;

  return {
    text: draft?.text ?? "",
    cliType,
    mode,
    cliModel,
    cliEffort,
    profileId,
    pathId,
    projectAgentId,
    baseRef,
  };
}

/** The draft fields the agent-selection patch reads to detect unedited seeds. */
export type ProjectAgentPatchDraft = Pick<
  ThreadComposerDraft,
  "text" | "cliType" | "cliModel" | "cliEffort" | "mode" | "baseRef" | "projectAgentId"
>;

function isUneditedWorkspaceSeed(baseRef: BaseRefSelection | undefined): boolean {
  return (
    baseRef !== undefined &&
    baseRef.type === "branch" &&
    !baseRef.startFromOrigin &&
    baseRef.baseRef === undefined &&
    baseRef.branch === undefined
  );
}

/**
* The runtime an automation config's model/effort belong to (OS-1512).
*
* Model slots are runtime-scoped but not globally unique (`default` exists everywhere, OpenCode
* accepts any `provider/model` slug), so the runtime can never be inferred *from* the model.
*
* A config storing a model without a `cliType` was saved while the form displayed the fallback
* runtime, so the fallback is what the user intended — but only when the stored model actually
* belongs to it. The form now always persists the runtime it displays.
*/
function resolveAutomationCliType(
  automation: ThreadProjectAgentAutomation
): CliTypeSlug | undefined {
  if (isCliType(automation.cliType)) {
    return automation.cliType;
  }

  if (automation.cliModel === undefined && automation.cliEffort === undefined) {
    return undefined;
  }

  const modelFitsFallback =
    automation.cliModel === undefined ||
    isSupportedCliModel(DEFAULT_FALLBACK_CLI_TYPE, automation.cliModel);

  return modelFitsFallback ? DEFAULT_FALLBACK_CLI_TYPE : undefined;
}

/**
 * The draft fields an enabled automation config seeds into a new-thread composer
 * (OS-1512) — one source of truth for the Agent pill, the delegation dialog and the
 * headless auto-submit path, which each inlined this shape and drifted.
 *
 * `cliModel`/`cliEffort` are seeded whenever the config stores them, including without
 * a `cliType`: nesting them under `cliType` is what made a "Fable 5 / High" config
 * silently fall back to the remembered last-used model.
 *
 * Excludes the prompt — seeding it depends on what the composer already holds.
 */
export function buildAutomationDraftSeed(
  automation: ThreadProjectAgentAutomation | undefined
): ThreadDraftPatch {
  if (!automation) {
    return {};
  }

  const cliType = resolveAutomationCliType(automation);

  return {
    ...(cliType !== undefined
      ? { cliType, cliModel: automation.cliModel, cliEffort: automation.cliEffort }
      : {}),
    ...(automation.mode !== undefined ? { mode: automation.mode } : {}),
    ...(automation.workspace !== undefined
      ? {
          baseRef:
            automation.workspace === "worktree"
              ? ({ type: "branch", startFromOrigin: false } satisfies BaseRefSelection)
              : undefined,
        }
      : {}),
  };
}

/**
 * Unsets every pill that still holds the previous agent's unedited automation
 * seed, so the draft resolver falls back to the pre-agent defaults (remembered
 * last-used CLI/model from local storage, registry defaults). Pills the user
 * overrode after selecting the agent are kept.
 */
function buildAutomationRevertPatch(
  previousAgent: ThreadProjectAgentOption | undefined,
  draft: ProjectAgentPatchDraft | undefined
): ThreadDraftPatch {
  const automation = previousAgent?.automation;
  if (!automation) {
    return {};
  }

  // Compared against the same seed the agent applied, so revert can never
  // drift from seed again (OS-1512).
  const seed = buildAutomationDraftSeed(automation);
  const patch: ThreadDraftPatch = {};

  if (seed.cliType !== undefined && draft?.cliType === seed.cliType) {
    patch.cliType = undefined;
    if (draft.cliModel === seed.cliModel) {
      patch.cliModel = undefined;
    }
    if (draft.cliEffort === seed.cliEffort) {
      patch.cliEffort = undefined;
    }
  }
  if (seed.mode !== undefined && draft?.mode === seed.mode) {
    patch.mode = undefined;
  }
  if (automation.workspace === "worktree" && isUneditedWorkspaceSeed(draft?.baseRef)) {
    patch.baseRef = undefined;
  }

  return patch;
}

/**
 * Draft patch for selecting a Project agent in the new-thread composer (OS-1138). An
 * agent with an enabled `automation` config defaults the pills from it, each still
 * user-overridable. The automation prompt seeds the composer text only when it is
 * empty or still holds the previous agent's unedited seed — typed text is never
 * overwritten. Leaving an agent reverts its unedited seeds and keeps every edit.
 */
export function buildProjectAgentDraftPatch(
  projectAgentId: string | undefined,
  projectAgents: readonly ThreadProjectAgentOption[],
  draft?: ProjectAgentPatchDraft
): ThreadDraftPatch {
  const previousAgent = draft?.projectAgentId
    ? projectAgents.find((candidate) => candidate._id === draft.projectAgentId)
    : undefined;
  const previousSeed = previousAgent?.automation?.prompt?.displayContent.trim();
  const trimmedText = (draft?.text ?? "").trim();
  const composerIsSeedable = trimmedText.length === 0 || (previousSeed !== undefined && trimmedText === previousSeed);
  // A leftover seed from the previous agent is cleared whenever the new
  // selection doesn't replace it with its own prompt.
  const clearLeftoverSeedPatch =
    trimmedText.length > 0 && composerIsSeedable ? { text: "", composerContent: undefined } : {};
  const revertPatch = buildAutomationRevertPatch(previousAgent, draft);

  const agent = projectAgentId
    ? projectAgents.find((candidate) => candidate._id === projectAgentId)
    : undefined;
  if (!agent) {
    return { ...revertPatch, projectAgentId: undefined, ...clearLeftoverSeedPatch };
  }

  const automation = agent.automation;
  if (!automation?.enabled) {
    return { ...revertPatch, projectAgentId, ...clearLeftoverSeedPatch };
  }

  const prompt = automation.prompt;

  return {
    ...revertPatch,
    projectAgentId,
    ...(prompt !== undefined && composerIsSeedable
      ? {
          text: prompt.displayContent,
          composerContent: buildComposerJsonFromPromptContent(prompt.displayContent, prompt.composerDocument?.refs ?? []),
        }
      : clearLeftoverSeedPatch),
    ...buildAutomationDraftSeed(automation),
  };
}

/**
 * The composer pills for an open thread resolve from the local draft first,
 * then the thread's denormalized last-used selection (`metadata.cli`, OS-1454),
 * then the runtime default. A stored value that the runtime no longer supports
 * — a retired model on an old thread — falls through to the default.
 */
export function resolveChatDetailMode({
  cliType,
  draftMode,
  lastUsedMode,
}: {
  cliType: CliTypeSlug;
  draftMode: string | undefined;
  lastUsedMode: string | undefined;
}): string | undefined {
  if (hasModeForCli(cliType, draftMode)) {
    return draftMode;
  }

  if (hasModeForCli(cliType, lastUsedMode)) {
    return lastUsedMode;
  }

  return getDefaultMode(cliType);
}

export function resolveChatDetailModel({
  cliType,
  draftCliModel,
  lastUsedCliModel,
}: {
  cliType: CliTypeSlug;
  draftCliModel: ThreadComposerDraft["cliModel"];
  lastUsedCliModel: CliModel | undefined;
}): CliModel | undefined {
  if (isSupportedCliModel(cliType, draftCliModel)) {
    return draftCliModel;
  }

  if (isSupportedCliModel(cliType, lastUsedCliModel)) {
    return lastUsedCliModel;
  }

  return getDefaultCliModel(cliType);
}

/**
 * `cliModel` is the model the composer settled on. Runtimes like OpenCode expose
 * per-model effort variants, so an effort is only supported relative to a model —
 * validating without that context would accept an effort the selector cannot offer.
 * Without `availableClis` an OpenCode model reads as unadvertised and validation stays
 * lenient.
 */
export function resolveChatDetailEffort({
  cliType,
  cliModel,
  availableClis,
  draftCliEffort,
  lastUsedCliEffort,
}: {
  cliType: CliTypeSlug;
  cliModel: CliModel | undefined;
  availableClis?: AvailableCliInfo[];
  draftCliEffort: ThreadComposerDraft["cliEffort"];
  lastUsedCliEffort: string | undefined;
}): string | undefined {
  const context = { cliModel, availableClis };

  if (isSupportedCliEffort(cliType, draftCliEffort, context)) {
    return draftCliEffort;
  }

  if (isSupportedCliEffort(cliType, lastUsedCliEffort, context)) {
    return lastUsedCliEffort;
  }

  return getDefaultCliEffort(cliType);
}

/** Source-thread subset used to seed the add-to-group draft. */
export interface AddToGroupSeedThread {
  _id: string;
  profileId: string;
  pathId: string;
  cliType: CliTypeSlug;
  metadata?: {
    cli?: {
      lastUsedMode?: string;
      lastUsedModel?: CliModel;
      lastUsedEffort?: string;
    };
  };
  agent?: {
    projectAgentId: string;
    isDeleted: boolean;
  };
}

/**
 * Prefill for an add-to-group draft (OS-1477, docs/specs/thread-groups.md). The
 * composer starts from the source thread's settings, all freely changeable before send.
 * Model/effort/mode reuse the chat-detail resolvers, so retired values fall through to
 * runtime defaults exactly like the source's own composer. A source running in a
 * worktree seeds that *existing* worktree rather than spawning a new one.
 */
export function buildAddToGroupDraftSeed(chat: AddToGroupSeedThread, profiles: readonly DraftProfile[]): ThreadDraftPatch {
  const profile = profiles.find((candidate) => candidate._id === chat.profileId);
  const pathEntry = profile?.paths.find((path) => path.id === chat.pathId);
  const worktreeParentPathId = pathEntry?.kind === "worktree" ? pathEntry.parentPathId : undefined;

  const lastUsed = chat.metadata?.cli;
  const cliModel = resolveChatDetailModel({
    cliType: chat.cliType,
    draftCliModel: undefined,
    lastUsedCliModel: lastUsed?.lastUsedModel,
  });

  return {
    text: "",
    composerContent: undefined,
    profileId: chat.profileId,
    pathId: worktreeParentPathId ?? chat.pathId,
    baseRef: worktreeParentPathId ? { type: "worktree", pathId: chat.pathId } : undefined,
    cliType: chat.cliType,
    mode: resolveChatDetailMode({
      cliType: chat.cliType,
      draftMode: undefined,
      lastUsedMode: lastUsed?.lastUsedMode,
    }),
    cliModel,
    cliEffort: resolveChatDetailEffort({
      cliType: chat.cliType,
      cliModel,
      availableClis: profile?.availableClis,
      draftCliEffort: undefined,
      lastUsedCliEffort: lastUsed?.lastUsedEffort,
    }),
    projectAgentId: chat.agent && !chat.agent.isDeleted ? chat.agent.projectAgentId : undefined,
    attachments: { pending: false },
    // Distinguishes this source from a draft left by an earlier add-to-group flow,
    // so changing source re-seeds the inherited settings.
    seededFrom: chat._id,
  };
}
