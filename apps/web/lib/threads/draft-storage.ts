import type { CliModel, CliTypeSlug } from "./types";
import { getDefaultCliEffort, getDefaultCliModel, isSupportedCliEffort, isSupportedCliModel } from "@/lib/cli-runtime-ui/registry";
import { isCliType } from "@/lib/cli-runtime-ui/registry";
import { isRecord } from "@/lib/type-guards";
import type { ImageDimensions } from "@/convex/lib/contracts/validators";
import { readLocalJson, writeLocalJson } from "@/lib/browser/local-storage";
import { sanitizeBaseRefSelection, type BaseRefSelection } from "./base-ref-selection";

export type ThreadComposerSerializedContent =
  | string
  | number
  | boolean
  | null
  | ThreadComposerSerializedContent[]
  | { [key: string]: ThreadComposerSerializedContent };

/** An uploaded, unsent file kept with the draft so it survives remounts (OS-2141). */
export interface ThreadComposerDraftAttachment {
  filePartId: string;
  storageId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  url?: string;
  dimensions?: ImageDimensions;
}

export interface ThreadComposerDraftAttachments {
  pending: boolean;
  uploaded?: ThreadComposerDraftAttachment[];
}

export interface ThreadComposerDraft {
  text: string;
  composerContent?: ThreadComposerSerializedContent;
  mode?: string;
  cliType?: CliTypeSlug;
  cliModel?: CliModel;
  cliEffort?: string;
  profileId?: string;
  pathId?: string;
  /** Bound Project agent for the new thread (OS-1138); undefined = "No agent". */
  projectAgentId?: string;
  baseRef?: BaseRefSelection;
  attachments?: ThreadComposerDraftAttachments;
  /**
   * Thread id an add-to-group draft seed came from (OS-1477). The add flow
   * re-seeds a draft whose stamp doesn't match the current source thread, so
   * pills only survive close/reopen from the same thread.
   */
  seededFrom?: string;
  /**
   * Times this draft was seeded from outside the composer (OS-1716) — the
   * artifact-comments handoff. A mounted composer adopts the text whenever this
   * changes.
   */
  seedCount?: number;
  updatedAt: number;
}

export type ThreadDraftMap = Record<string, ThreadComposerDraft>;
export type ThreadDraftPatch = Partial<Omit<ThreadComposerDraft, "updatedAt">>;

export interface PersistedThreadComposerDraftsV1 {
  version: 1;
  drafts: ThreadDraftMap;
}

const STORAGE_PREFIX = "convoy.thread-composer-drafts";
const STORAGE_VERSION = 1;
const MAX_DRAFTS_PER_PROJECT = 100;
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isCliTypeSlug(value: unknown): value is CliTypeSlug {
  return isCliType(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseUploadedAttachment(value: unknown): ThreadComposerDraftAttachment | null {
  if (!isRecord(value)) return null;
  const { filePartId, storageId, fileName, fileSize, contentType, url, dimensions } = value;
  if (
    typeof filePartId !== "string" || typeof storageId !== "string" || typeof fileName !== "string" ||
    typeof fileSize !== "number" || typeof contentType !== "string"
  ) {
    return null;
  }
  return {
    filePartId, storageId, fileName, fileSize, contentType,
    ...(typeof url === "string" ? { url } : {}),
    ...(isRecord(dimensions) && typeof dimensions.width === "number" && typeof dimensions.height === "number"
      ? { dimensions: { width: dimensions.width, height: dimensions.height } }
      : {}),
  };
}

function parseAttachments(value: unknown): ThreadComposerDraftAttachments | undefined {
  if (!isRecord(value) || typeof value.pending !== "boolean") {
    return undefined;
  }

  const uploaded = Array.isArray(value.uploaded)
    ? value.uploaded.map(parseUploadedAttachment).filter((item) => item !== null)
    : [];
  return uploaded.length > 0 ? { pending: value.pending, uploaded } : { pending: value.pending };
}

function sanitizeSerializedContent(value: unknown): ThreadComposerSerializedContent | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeSerializedContent).filter((item): item is ThreadComposerSerializedContent => item !== undefined);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const sanitized: { [key: string]: ThreadComposerSerializedContent } = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitizedItem = sanitizeSerializedContent(item);
    if (sanitizedItem !== undefined) {
      sanitized[key] = sanitizedItem;
    }
  }

  return sanitized;
}

function sanitizeDraft(value: unknown): ThreadComposerDraft | null {
  if (!isRecord(value)) {
    return null;
  }

  const text = typeof value.text === "string" ? value.text : "";
  const composerContent = sanitizeSerializedContent(value.composerContent);
  const mode = asNonEmptyString(value.mode);
  const cliType = isCliTypeSlug(value.cliType) ? value.cliType : undefined;
  const cliModel = typeof value.cliModel === "string" ? value.cliModel : undefined;
  const cliEffort = typeof value.cliEffort === "string" ? value.cliEffort : undefined;
  const profileId = asNonEmptyString(value.profileId);
  const pathId = asNonEmptyString(value.pathId);
  const projectAgentId = asNonEmptyString(value.projectAgentId);
  const baseRef = sanitizeBaseRefSelection(value.baseRef);
  const attachments = parseAttachments(value.attachments);
  const seededFrom = asNonEmptyString(value.seededFrom);
  const seedCount = typeof value.seedCount === "number" && Number.isFinite(value.seedCount) ? value.seedCount : undefined;
  const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now();

  return {
    text,
    composerContent,
    mode,
    cliType,
    cliModel: cliType && isSupportedCliModel(cliType, cliModel) ? cliModel : getDefaultCliModel(cliType ?? "other"),
    cliEffort: cliType && isSupportedCliEffort(cliType, cliEffort) ? cliEffort : getDefaultCliEffort(cliType ?? "other"),
    profileId,
    pathId,
    projectAgentId,
    baseRef,
    attachments,
    seededFrom,
    seedCount,
    updatedAt,
  };
}

function sanitizeDraftMap(value: unknown): ThreadDraftMap {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: ThreadDraftMap = {};

  for (const [threadKey, draftValue] of Object.entries(value)) {
    const normalizedThreadKey = asNonEmptyString(threadKey);
    if (!normalizedThreadKey) {
      continue;
    }

    const draft = sanitizeDraft(draftValue);
    if (!draft) {
      continue;
    }

    sanitized[normalizedThreadKey] = draft;
  }

  return sanitized;
}

function createPayload(drafts: ThreadDraftMap): PersistedThreadComposerDraftsV1 {
  return {
    version: STORAGE_VERSION,
    drafts,
  };
}

function pruneDrafts(drafts: ThreadDraftMap): ThreadDraftMap {
  const now = Date.now();
  const entries = Object.entries(drafts)
    .filter(([, draft]) => now - draft.updatedAt <= DRAFT_MAX_AGE_MS)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_DRAFTS_PER_PROJECT);

  return Object.fromEntries(entries);
}

export function saveProjectDrafts(storageKey: string, drafts: ThreadDraftMap): ThreadDraftMap {
  const pruned = pruneDrafts(drafts);
  writeLocalJson(storageKey, createPayload(pruned));
  return pruned;
}

export function buildProjectDraftStorageKey(organizationSlug: string, projectAlias: string): string {
  return `${STORAGE_PREFIX}:${organizationSlug}:${projectAlias}`;
}

export function loadProjectDrafts(storageKey: string): ThreadDraftMap {
  const parsed = readLocalJson(storageKey);

  if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
    return {};
  }

  return pruneDrafts(sanitizeDraftMap(parsed.drafts));
}

export function mergeThreadDraft(previous: ThreadComposerDraft | undefined, patch: ThreadDraftPatch): ThreadComposerDraft {
  const hasText = Object.prototype.hasOwnProperty.call(patch, "text");
  const hasMode = Object.prototype.hasOwnProperty.call(patch, "mode");
  const hasComposerContent = Object.prototype.hasOwnProperty.call(patch, "composerContent");
  const hasCliType = Object.prototype.hasOwnProperty.call(patch, "cliType");
  const hasCliModel = Object.prototype.hasOwnProperty.call(patch, "cliModel");
  const hasCliEffort = Object.prototype.hasOwnProperty.call(patch, "cliEffort");
  const hasProfileId = Object.prototype.hasOwnProperty.call(patch, "profileId");
  const hasPathId = Object.prototype.hasOwnProperty.call(patch, "pathId");
  const hasProjectAgentId = Object.prototype.hasOwnProperty.call(patch, "projectAgentId");
  const hasBaseRef = Object.prototype.hasOwnProperty.call(patch, "baseRef");
  const hasAttachments = Object.prototype.hasOwnProperty.call(patch, "attachments");
  const hasSeededFrom = Object.prototype.hasOwnProperty.call(patch, "seededFrom");
  const hasSeedCount = Object.prototype.hasOwnProperty.call(patch, "seedCount");

  return {
    text: hasText ? (patch.text ?? "") : (previous?.text ?? ""),
    composerContent: hasComposerContent ? patch.composerContent : previous?.composerContent,
    mode: hasMode ? patch.mode : previous?.mode,
    cliType: hasCliType ? patch.cliType : previous?.cliType,
    cliModel: hasCliModel ? patch.cliModel : previous?.cliModel,
    cliEffort: hasCliEffort ? patch.cliEffort : previous?.cliEffort,
    profileId: hasProfileId ? patch.profileId : previous?.profileId,
    pathId: hasPathId ? patch.pathId : previous?.pathId,
    projectAgentId: hasProjectAgentId ? patch.projectAgentId : previous?.projectAgentId,
    baseRef: hasBaseRef ? patch.baseRef : previous?.baseRef,
    attachments: hasAttachments ? patch.attachments : previous?.attachments,
    seededFrom: hasSeededFrom ? patch.seededFrom : previous?.seededFrom,
    seedCount: hasSeedCount ? patch.seedCount : previous?.seedCount,
    updatedAt: Date.now(),
  };
}
