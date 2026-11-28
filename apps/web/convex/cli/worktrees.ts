import { isWorktreeParent } from "../lib/contracts/validators";
import { mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { getAuthenticatedAccess } from "../lib/access/auth";
import { requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import { getCliProfileById, mergeWorktreeEntries, setProfilePaths, setProfilePathsIfChanged, upsertWorktreePathEntry } from "./lib/cliProfilesRepo";
import { getThreadById, repointThreadPath } from "./threads/lib/cliThreadsRepo";
import { requireSessionOwnership, requireThreadClaimedBySession } from "./lib/permissions";
import { cliExecutionWorkspaceValidator, toExecutionWorkspace } from "./lib/validators";
import { isContainerThread } from "./lib/watchStatus";
import { findWorktreeSetupForWorkspace } from "./lib/projectWorktreeSetupsRepo";
import { supportsWorktreeSetup, WORKTREE_SETUP_MIN_CLI_VERSION } from "../../lib/worktrees/cli-version";

/** Read the target under its execution claim. Spec: cli-worktrees.md. */
export const getExecutionWorkspace = query({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    apiKey: v.optional(v.string()),
  },
  returns: cliExecutionWorkspaceValidator,
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const { thread, profile } = await requireThreadClaimedBySession(ctx, principal, args.threadId, args.sessionId);
    return toExecutionWorkspace(thread, profile);
  },
});

/** Persist a verified target with a compare-and-set on its previous path. Spec: cli-worktrees.md. */
export const resolveExecutionWorkspace = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    apiKey: v.optional(v.string()),
    expectedPath: v.string(),
    path: v.string(),
    repositoryId: v.string(),
    worktreeId: v.optional(v.string()),
    branch: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const { thread, profile } = await requireThreadClaimedBySession(ctx, principal, args.threadId, args.sessionId);
    const workspace = toExecutionWorkspace(thread, profile);
    ensure(workspace.path).eq(args.expectedPath, errors.WORKSPACE_CHANGED);
    const worktree = await ensure(workspace.worktree).notNull(errors.WORKTREE_SPEC_MISSING);
    ensure(worktree.status).eq("created", errors.WORKTREE_SPEC_MISSING);
    const parent = await ensure(
      profile.paths.find((path) => path.id === worktree.parentPathId && isWorktreeParent(profile.paths, path))
    ).notNull(errors.WORKSPACE_PARENT_MISSING);
    ensure(worktree.parentPath).eq(parent.path, errors.WORKSPACE_REPOSITORY_CHANGED);
    if (worktree.repositoryId) {
      ensure(args.repositoryId).eq(worktree.repositoryId, errors.WORKSPACE_REPOSITORY_CHANGED);
    }
    const movedToParent = args.path === parent.path;
    if (!movedToParent) {
      ensure(args.worktreeId).notNull(errors.WORKSPACE_REPOSITORY_CHANGED);
      if (worktree.worktreeId) {
        ensure(args.worktreeId).eq(worktree.worktreeId, errors.WORKSPACE_REPOSITORY_CHANGED);
      }
    }
    const target = movedToParent
      ? { paths: profile.paths, entryId: parent.id }
      : upsertWorktreePathEntry(profile.paths, {
          parentPathId: parent.id,
          path: args.path,
          branch: args.branch ?? worktree.branch,
        });
    await setProfilePathsIfChanged(ctx, profile, target.paths);
    await repointThreadPath(ctx, thread._id, {
      pathId: target.entryId,
      path: args.path,
      worktree: movedToParent
        ? undefined
        : { ...worktree, repositoryId: args.repositoryId, worktreeId: args.worktreeId },
      previousWorkingDirectory: args.path !== workspace.path ? workspace.path : undefined,
      legacyCheckpointsUnsafe: movedToParent,
      executionBranch: args.branch,
    });
    return null;
  },
});

/** Agent-driven move into a worktree, effective from the next run. Spec: cli-worktrees.md#agent-driven-worktree-move. */
export const moveThread = mutation({
  args: {
    threadId: v.id("cliThreads"),
    path: v.string(),
    repositoryId: v.string(),
    worktreeId: v.string(),
    branch: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(thread.userId).eq(user._id, errors.NOT_AUTHORIZED);
    ensure(isContainerThread(thread)).isFalse(errors.CLI_ON_CONTAINER);
    await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);
    const profile = await ensure(getCliProfileById(ctx, thread.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);

    const workspace = toExecutionWorkspace(thread, profile);
    if (args.path === workspace.path) return null;
    const current = workspace.worktree;
    ensure(current?.status).notEq("pending", errors.MOVE_WORKTREE_PENDING);
    if (current?.repositoryId) {
      ensure(args.repositoryId).eq(current.repositoryId, errors.WORKSPACE_REPOSITORY_CHANGED);
    }
    const parent = await ensure(
      profile.paths.find((path) => path.id === (current?.parentPathId ?? thread.pathId) && path.kind !== "worktree")
    ).notNull(errors.WORKSPACE_PARENT_MISSING);
    ensure(isWorktreeParent(profile.paths, parent)).isTrue(errors.WORKTREE_PARENT_IS_FOLDER);
    const target = upsertWorktreePathEntry(profile.paths, { parentPathId: parent.id, path: args.path, branch: args.branch });
    ensure(target.paths.find((path) => path.id === target.entryId))
      .satisfies((entry) => entry?.kind === "worktree" && entry.parentPathId === parent.id, errors.MOVE_TARGET_NOT_WORKTREE);

    const ranIn = (thread.git?.movedByAgent && thread.git.previousWorkingDirectory) || workspace.path;
    await setProfilePathsIfChanged(ctx, profile, target.paths);
    await repointThreadPath(ctx, thread._id, {
      pathId: target.entryId,
      path: args.path,
      worktree: {
        parentPathId: parent.id,
        parentPath: parent.path,
        parentGitRemoteUrl: parent.gitRemoteUrl,
        repositoryId: args.repositoryId,
        worktreeId: args.worktreeId,
        branch: args.branch,
        status: "created",
      },
      // A run may still be executing in the directory before an earlier pending move.
      previousWorkingDirectory: ranIn === args.path ? null : ranIn,
      movedByAgent: true,
      // Old checkpoints lack the checkout identity; Undo must not apply them here.
      legacyCheckpointsUnsafe: true,
      executionBranch: args.branch,
    });
    return null;
  },
});

/**
 * CLI: sync scanned worktrees into the profile's path entries. Called after
 * registration, after fulfilling a rescan op, and after creating/removing a
 * worktree. The CLI speaks in absolute paths; the server owns entry ids.
 */
export const sync = mutation({
  args: {
    profileId: v.id("cliProfiles"),
    sessionId: v.id("cliSessions"),
    scannedParentPaths: v.array(v.string()),
    worktrees: v.array(
      v.object({
        parentPath: v.string(),
        path: v.string(),
        branch: v.string(),
      })
    ),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    ensure(session.profileId).eq(args.profileId, errors.SESSION_PROFILE_MISMATCH);

    const profile = await ensure(getCliProfileById(ctx, args.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);
    ensure(profile.userId).eq(user._id, errors.NOT_AUTHORIZED);
    await requireAuthorizedProject(ctx, principal, profile.projectId, ProjectPermission.CLI_THREAD);

    const merged = mergeWorktreeEntries(profile.paths, {
      scannedParentPaths: args.scannedParentPaths,
      worktrees: args.worktrees,
    });
    await setProfilePathsIfChanged(ctx, profile, merged);

    return null;
  },
});

/**
 * CLI: resolve a thread's pending worktree after creating it on disk.
 * Registers the worktree as a profile path entry (stable by path string) and
 * repoints the thread at it. Idempotent — safe to call again on retry.
 */
export const resolveCreated = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    path: v.string(),
    branch: v.string(),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const thread = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(thread.profileId).eq(session.profileId, errors.SESSION_PROFILE_MISMATCH);
    ensure(thread.userId).eq(user._id, errors.NOT_AUTHORIZED);
    // Containers have no checkout of their own to repoint (OS-1556). The
    // `worktree` ensure below would throw anyway — but on missing state, not
    // on the invariant, and only for as long as containers keep no `git`.
    ensure(isContainerThread(thread)).isFalse(errors.CLI_ON_CONTAINER);
    await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);

    const worktree = await ensure(thread.git?.worktree).notNull(errors.WORKTREE_SPEC_MISSING);

    const profile = await ensure(getCliProfileById(ctx, thread.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);

    // A CLI too old to run the repo's setup script must not report the worktree as ready.
    if (worktree.status === "pending" && !supportsWorktreeSetup(session.appVersion)) {
      const found = await findWorktreeSetupForWorkspace(ctx, thread.projectId, toExecutionWorkspace(thread, profile));
      if (found) throw new ConvexError(errors.worktreeSetupNeedsCliUpdate(found.repoKey, WORKTREE_SETUP_MIN_CLI_VERSION, args.path));
    }

    const { paths, entryId } = upsertWorktreePathEntry(profile.paths, {
      parentPathId: worktree.parentPathId,
      path: args.path,
      branch: args.branch,
    });
    if (paths !== profile.paths) {
      await setProfilePaths(ctx, profile._id, paths);
    }

    if (thread.pathId !== entryId || worktree.status !== "created") {
      await repointThreadPath(ctx, thread._id, {
        pathId: entryId,
        path: args.path,
        worktree: { ...worktree, status: "created" },
      });
    }

    return null;
  },
});
