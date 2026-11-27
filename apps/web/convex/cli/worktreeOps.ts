import { mutation, query, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthenticatedAccess, getAuthenticatedUser, getOptionalAuthenticatedAccess, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { hasProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import { cliHistoryScopeValidator, cliWorktreeOpKindValidator, cliWorktreeOpStatusValidator, type CliProfilePathEntry } from "../lib/contracts/validators";
import { getCliProfileById } from "./lib/cliProfilesRepo";
import { listOnlineSessionsByProfile } from "./lib/cliSessionsRepo";
import { getThreadByCheckpointRef, listThreadsClaimedBySession } from "./threads/lib/cliThreadsRepo";
import { requireSessionOwnership } from "./lib/permissions";
import { MAX_DOWNLOAD_FILE_BYTES, MAX_REVERT_ALL_FILES } from "./lib/constants";
import { deleteStorageIfUnreferenced, getStorageSize, isStorageClaimed } from "../lib/storageRepo";
import {
  deleteWorktreeOp,
  getWorktreeOpById,
  insertWorktreeOp,
  listPendingWorktreeOpsByProfile,
  updateWorktreeOp,
} from "./lib/cliWorktreeOpsRepo";

/** Ops are ephemeral request/response rows; prune them after this TTL. */
const WORKTREE_OP_TTL_MS = 60 * 60 * 1000;
// File ops carry file contents/patches in resultJson — prune them fast so
// nothing durably lives in Convex (OS-1143).
const FILE_OP_TTL_MS = 10 * 60 * 1000;
// Full object hashes only: the CLI hands them to git as revisions (OS-2534).
const COMMIT_HASH = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
// `<tip>[,<tip>[,<tip>]]:<skip>`: HEAD, plus origin's and the local default branch when they differ (OS-2586).
// A `^` tip is excluded: the branch scope's default branches (OS-2595).
const HISTORY_CURSOR = /^\^?[0-9a-f]{40}([0-9a-f]{24})?(,\^?[0-9a-f]{40}([0-9a-f]{24})?){0,2}:\d+$/;

const worktreeOpItemValidator = v.object({
  _id: v.id("cliWorktreeOps"),
  profileId: v.id("cliProfiles"),
  kind: cliWorktreeOpKindValidator,
  pathId: v.string(),
  path: v.string(),
  parentPath: v.optional(v.string()),
  filePath: v.optional(v.string()),
  filePaths: v.optional(v.array(v.string())),
  allowLegacyCheckpoint: v.optional(v.boolean()),
  preRef: v.optional(v.string()),
  postRef: v.optional(v.string()),
  query: v.optional(v.string()),
  cursor: v.optional(v.string()),
  scope: v.optional(cliHistoryScopeValidator),
  status: cliWorktreeOpStatusValidator,
  error: v.optional(v.string()),
  resultJson: v.optional(v.string()),
  /** downloadFile, once done: signed URL of the uploaded blob (OS-2050). */
  downloadUrl: v.optional(v.string()),
  createdAt: v.number(),
});

function toWorktreeOpItem(doc: Doc<"cliWorktreeOps">) {
  return {
    _id: doc._id,
    profileId: doc.profileId,
    kind: doc.kind,
    pathId: doc.pathId,
    path: doc.path,
    parentPath: doc.parentPath,
    filePath: doc.filePath,
    filePaths: doc.filePaths,
    preRef: doc.preRef,
    allowLegacyCheckpoint: doc.allowLegacyCheckpoint,
    postRef: doc.postRef,
    query: doc.query,
    cursor: doc.cursor,
    scope: doc.scope,
    status: doc.status,
    error: doc.error,
    resultJson: doc.resultJson,
    createdAt: doc.createdAt,
  };
}

/**
 * Whether any active session holds a claim on a thread in this path (a repo entry's folder counts), or still
 * running in it after an agent move (OS-2622).
 */
async function isPathInUse(
  ctx: Parameters<typeof listOnlineSessionsByProfile>[0],
  profile: Doc<"cliProfiles">,
  entry: Pick<CliProfilePathEntry, "id" | "path" | "kind" | "parentPathId">
): Promise<boolean> {
  const sessions = await listOnlineSessionsByProfile(ctx, profile._id);
  const claimedPerSession = await Promise.all(sessions.map((session) => listThreadsClaimedBySession(ctx, session._id)));
  const folderId = entry.kind === "repo" ? entry.parentPathId : undefined;
  return claimedPerSession.flat().some((thread) => !thread.isDeleted && (thread.pathId === entry.id || (folderId !== undefined && thread.pathId === folderId) ||
    (thread.git?.movedByAgent === true && thread.git.previousWorkingDirectory === entry.path)));
}

/**
 * Web: enqueue a worktree op for the profile's CLI to fulfill. Rescan ops are
 * deduped against an already-pending rescan of the same path; remove ops
 * validate the target is a worktree entry not currently in use.
 */
export const enqueue = mutation({
  args: {
    profileId: v.id("cliProfiles"),
    kind: cliWorktreeOpKindValidator,
    pathId: v.string(),
    filePath: v.optional(v.string()),
    filePaths: v.optional(v.array(v.string())),
    preRef: v.optional(v.string()),
    postRef: v.optional(v.string()),
    query: v.optional(v.string()),
    cursor: v.optional(v.string()),
    scope: v.optional(cliHistoryScopeValidator),
  },
  returns: v.id("cliWorktreeOps"),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const profile = await ensure(getCliProfileById(ctx, args.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);
    ensure(profile.userId).eq(user._id, errors.NOT_AUTHORIZED);
    await requireAuthorizedProject(ctx, user._id, profile.projectId, ProjectPermission.CLI_THREAD);

    const entry = await ensure(profile.paths.find((path) => path.id === args.pathId)).notNull(errors.PATH_NOT_FOUND_IN_PROFILE);

    const now = Date.now();

    if (args.kind === "rescan") {
      ensure(entry.kind).notEq("worktree", errors.WORKTREE_PARENT_NOT_REPO_PATH);
      const pending = await listPendingWorktreeOpsByProfile(ctx, args.profileId);
      const existing = pending.find((op) => op.kind === "rescan" && op.pathId === args.pathId);
      if (existing) {
        return existing._id;
      }
    }

    // worktreeChanges needs nothing beyond the path; it is a file op for the
    // short TTL (its result carries a patch). revertWorkingFile and
    // downloadFile need the path and filePath, no refs (OS-2043, OS-2050).
    const isFileOp =
      args.kind === "readFile" ||
      args.kind === "diffFile" ||
      args.kind === "revertRun" ||
      args.kind === "revertFile" ||
      args.kind === "worktreeChanges" ||
      args.kind === "revertWorkingFile" ||
      args.kind === "revertWorkingTree" ||
      args.kind === "downloadFile";
    // Read-only history (OS-2534): short TTL like file ops, but only its own field.
    const isHistoryOp = args.kind === "gitLog" || args.kind === "commitPatch";
    if (args.kind === "revertWorkingFile" || args.kind === "downloadFile") {
      ensure(args.filePath).notNull(errors.FILE_OP_ARGS_MISSING);
    }
    if (args.kind === "revertWorkingTree") {
      const count = args.filePaths?.length ?? 0;
      ensure(count >= 1 && count <= MAX_REVERT_ALL_FILES).isTrue(errors.REVERT_ALL_FILE_PATHS_INVALID);
    }
    if (args.kind === "revertWorkingFile" || args.kind === "revertWorkingTree") {
      const inUse = await isPathInUse(ctx, profile, entry);
      ensure(inUse).isFalse(errors.REVERT_RUN_IN_USE);
    }
    if (args.kind === "searchFiles") {
      // Empty string is a valid query (a bare `@` lists the top files).
      ensure(args.query).notNull(errors.SEARCH_FILES_QUERY_MISSING);
    }
    if (args.kind === "commitPatch") {
      ensure(COMMIT_HASH.test(args.postRef ?? "")).isTrue(errors.COMMIT_HASH_INVALID);
    }
    if (args.kind === "gitLog" && args.cursor !== undefined) {
      ensure(HISTORY_CURSOR.test(args.cursor)).isTrue(errors.HISTORY_CURSOR_INVALID);
    }
    // readFile without postRef reads the working tree (OS-2041).
    if (args.kind === "readFile") {
      ensure(args.filePath).notNull(errors.FILE_OP_ARGS_MISSING);
    }
    if (args.kind === "diffFile") {
      // diffFile without filePath diffs the whole run.
      ensure(args.preRef).notNull(errors.FILE_OP_ARGS_MISSING);
      ensure(args.postRef).notNull(errors.FILE_OP_ARGS_MISSING);
    }

    let allowLegacyCheckpoint: boolean | undefined;
    if (args.kind === "revertRun" || args.kind === "revertFile") {
      ensure(args.preRef).notNull(errors.FILE_OP_ARGS_MISSING);
      if (args.kind === "revertFile") {
        ensure(args.filePath).notNull(errors.FILE_OP_ARGS_MISSING);
      }
      const inUse = await isPathInUse(ctx, profile, entry);
      ensure(inUse).isFalse(errors.REVERT_RUN_IN_USE);
      const thread = await getThreadByCheckpointRef(ctx, args.preRef!);
      allowLegacyCheckpoint = !!thread && !thread.isDeleted &&
        thread.profileId === profile._id && thread.pathId === entry.id && thread.path === entry.path &&
        !thread.git?.legacyCheckpointsUnsafe;
    }

    let parentPath: string | undefined;
    if (args.kind === "remove") {
      ensure(entry.kind).eq("worktree", errors.WORKTREE_REMOVE_NOT_WORKTREE);
      const parent = await ensure(profile.paths.find((path) => path.id === entry.parentPathId)).notNull(errors.PATH_NOT_FOUND_IN_PROFILE);
      parentPath = parent.path;

      const inUse = await isPathInUse(ctx, profile, entry);
      ensure(inUse).isFalse(errors.WORKTREE_REMOVE_IN_USE);
    }

    const opId = await insertWorktreeOp(ctx, {
      profileId: args.profileId,
      requestedBy: user._id,
      kind: args.kind,
      pathId: args.pathId,
      path: entry.path,
      parentPath,
      allowLegacyCheckpoint,
      ...(isFileOp ? { filePath: args.filePath, preRef: args.preRef, postRef: args.postRef } : {}),
      ...(args.kind === "revertWorkingTree" ? { filePaths: args.filePaths } : {}),
      ...(args.kind === "searchFiles" ? { query: args.query } : {}),
      ...(args.kind === "gitLog" ? { cursor: args.cursor, scope: args.scope } : {}),
      ...(args.kind === "worktreeChanges" ? { scope: args.scope } : {}),
      ...(args.kind === "commitPatch" ? { postRef: args.postRef } : {}),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(isFileOp || isHistoryOp || args.kind === "searchFiles" ? FILE_OP_TTL_MS : WORKTREE_OP_TTL_MS, internal.cli.worktreeOps.prune, {
      opId,
    });

    return opId;
  },
});

/** Web: watch a single op row (the enqueue caller polls this reactively). */
export const get = query({
  args: {
    opId: v.id("cliWorktreeOps"),
  },
  returns: v.union(worktreeOpItemValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const op = await getWorktreeOpById(ctx, args.opId);
    if (!op || op.requestedBy !== user._id) {
      return null;
    }

    const downloadUrl = op.storageId ? ((await ctx.storage.getUrl(op.storageId)) ?? undefined) : undefined;
    return { ...toWorktreeOpItem(op), downloadUrl };
  },
});

/** CLI: upload URL for a pending downloadFile op's bytes (OS-2050). */
export const generateUploadUrl = mutation({
  args: {
    opId: v.id("cliWorktreeOps"),
    sessionId: v.id("cliSessions"),
    apiKey: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { user } = await getAuthenticatedAccess(ctx, args.apiKey);
    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const op = await ensure(getWorktreeOpById(ctx, args.opId)).notNull(errors.WORKTREE_OP_NOT_FOUND);
    ensure(op.profileId).eq(session.profileId, errors.SESSION_PROFILE_MISMATCH);
    ensure(op.status).eq("pending", errors.WORKTREE_OP_NOT_PENDING);
    ensure(op.kind).eq("downloadFile", errors.WORKTREE_OP_NOT_DOWNLOAD);
    return await ctx.storage.generateUploadUrl();
  },
});

/** CLI: pending ops for a profile (standing realtime subscription). */
export const listPending = query({
  args: {
    profileId: v.id("cliProfiles"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(worktreeOpItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { user, principal } = auth;

    const profile = await getCliProfileById(ctx, args.profileId);
    if (!profile || profile.isDeleted || profile.userId !== user._id) {
      return [];
    }

    const hasAccess = await hasProjectAccess(ctx, principal, profile.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return [];
    }

    const pending = await listPendingWorktreeOpsByProfile(ctx, args.profileId);
    return pending.map(toWorktreeOpItem);
  },
});

/** CLI: mark an op fulfilled (done with optional result, or failed). */
export const complete = mutation({
  args: {
    opId: v.id("cliWorktreeOps"),
    sessionId: v.id("cliSessions"),
    error: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await getAuthenticatedAccess(ctx, args.apiKey);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const existing = await getWorktreeOpById(ctx, args.opId);
    // A download that lands after the op was pruned or settled has no owner
    // left: reclaim the blob and return, since a throw would roll the delete
    // back (OS-2050). Never touches a blob an attachment still references.
    if (args.storageId && (!existing || existing.status !== "pending")) {
      await deleteStorageIfUnreferenced(ctx, args.storageId);
      return null;
    }
    const op = await ensure(existing).notNull(errors.WORKTREE_OP_NOT_FOUND);
    ensure(op.profileId).eq(session.profileId, errors.SESSION_PROFILE_MISMATCH);
    ensure(op.status).eq("pending", errors.WORKTREE_OP_NOT_PENDING);

    // Session ownership proves the op, not the blob: a download op only adopts
    // a blob nothing else claims, and only one under the cap (OS-2050).
    if (args.storageId) {
      ensure(op.kind).eq("downloadFile", errors.WORKTREE_OP_NOT_DOWNLOAD);
      const failure = await downloadBlobFailure(ctx, args.storageId);
      if (failure) {
        await updateWorktreeOp(ctx, op._id, { status: "failed", error: failure });
        return null;
      }
    }

    await updateWorktreeOp(
      ctx,
      op._id,
      args.error !== undefined
        ? { status: "failed", error: args.error }
        : { status: "done", resultJson: args.resultJson, storageId: args.storageId }
    );

    return null;
  },
});

/** Why a download op cannot adopt `storageId`, or null when it can. An oversize blob is deleted. */
async function downloadBlobFailure(ctx: Parameters<typeof deleteWorktreeOp>[0], storageId: Id<"_storage">): Promise<string | null> {
  if (await isStorageClaimed(ctx, storageId)) {
    return errors.DOWNLOAD_UPLOAD_NOT_OWN;
  }
  const size = await getStorageSize(ctx, storageId);
  if (size === null) {
    return errors.DOWNLOAD_UPLOAD_NOT_FOUND;
  }
  if (size > MAX_DOWNLOAD_FILE_BYTES) {
    await ctx.storage.delete(storageId);
    return errors.DOWNLOAD_FILE_TOO_LARGE;
  }
  return null;
}

/** Web: drop a finished op and its blob as soon as the browser has saved the download (OS-2050). */
export const discard = mutation({
  args: {
    opId: v.id("cliWorktreeOps"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const op = await getWorktreeOpById(ctx, args.opId);
    if (!op || op.requestedBy !== user._id || op.status === "pending") {
      return null;
    }
    await deleteOpAndBlob(ctx, op);
    return null;
  },
});

// Row first: it is itself a storage reference (`storageRepo.ts`), so the blob
// only goes once nothing else points at it.
async function deleteOpAndBlob(ctx: Parameters<typeof deleteWorktreeOp>[0], op: Doc<"cliWorktreeOps">): Promise<void> {
  await deleteWorktreeOp(ctx, op._id);
  if (op.storageId) {
    await deleteStorageIfUnreferenced(ctx, op.storageId);
  }
}

/** Scheduled TTL cleanup for an op row. */
export const prune = internalMutation({
  args: {
    opId: v.id("cliWorktreeOps"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const op = await getWorktreeOpById(ctx, args.opId);
    if (op) {
      await deleteOpAndBlob(ctx, op);
    }
    return null;
  },
});
