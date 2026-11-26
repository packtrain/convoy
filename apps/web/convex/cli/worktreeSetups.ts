import { v, type Infer } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getAuthenticatedAccess } from "../lib/access/auth";
import { requireAuthorizedProject, type AuthenticatedAccess } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { getUsersByIds } from "../users/lib/usersRepo";
import { getActiveOrganizationById } from "../organizations/lib/organizationsRepo";
import { getAppUrlBase } from "../lib/shared/appUrl";
import { appRoute } from "../../lib/navigation/routes";
import { href } from "../../lib/navigation/target";
import { errors } from "./errors";
import { MAX_WORKTREE_SETUP_SCRIPT_LENGTH, MAX_WORKTREE_SETUPS_PER_PROJECT } from "./lib/constants";
import { listActiveProfilesByUserAndProject } from "./lib/cliProfilesRepo";
import { isRepoKey, toRepoKey } from "./lib/normalize";
import {
  deleteWorktreeSetup,
  findWorktreeSetup,
  findWorktreeSetupApproval,
  getWorktreeSetupById,
  insertWorktreeSetup,
  listWorktreeSetupsByProject,
  updateWorktreeSetupScript,
  upsertWorktreeSetupApproval,
} from "./lib/projectWorktreeSetupsRepo";

const worktreeSetupRowValidator = v.object({
  repoKey: v.string(),
  // Null: one of the caller's CLIs registered this repo, and it has no script yet.
  setup: v.union(
    v.null(),
    v.object({
      _id: v.id("projectWorktreeSetups"),
      script: v.string(),
      revision: v.number(),
      updatedByName: v.union(v.string(), v.null()),
      updatedAt: v.number(),
      // "never": no approval row; "changed": the caller approved an older revision.
      approval: v.union(v.literal("approved"), v.literal("never"), v.literal("changed")),
    }),
  ),
});

/** Only a web session approves a script; an agent holding the user's API key must not. */
function isWebSession(principal: AuthenticatedAccess) {
  return principal.apiKeyScope === null;
}

function requireWebSession(principal: AuthenticatedAccess) {
  ensure(isWebSession(principal)).isTrue(errors.WORKTREE_SETUP_APPROVE_WEB_ONLY);
}

function approvalStatus(approved: number | undefined, current: number) {
  return approved === undefined ? "never" : approved === current ? "approved" : "changed";
}

/**
 * The project's setups plus the caller's registered repos without one, in
 * repo-key order. Spec: cli-worktrees.md#worktree-setup-scripts.
 */
export const list = query({
  args: { projectId: v.id("projects"), apiKey: v.optional(v.string()) },
  returns: v.array(worktreeSetupRowValidator),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.CLI_THREAD);

    const [setups, profiles] = await Promise.all([
      listWorktreeSetupsByProject(ctx, args.projectId, MAX_WORKTREE_SETUPS_PER_PROJECT),
      listActiveProfilesByUserAndProject(ctx, user._id, args.projectId),
    ]);
    const [approvals, editors] = await Promise.all([
      Promise.all(setups.map((setup) => findWorktreeSetupApproval(ctx, user._id, setup._id))),
      getUsersByIds(ctx, [...new Set(setups.map((setup) => setup.updatedBy))]),
    ]);
    const editorNames = new Map(editors.flatMap((editor) => (editor ? [[editor._id, editor.name ?? null] as const] : [])));

    const rows: Infer<typeof worktreeSetupRowValidator>[] = setups.map((setup, index) => ({
      repoKey: setup.repoKey,
      setup: {
        _id: setup._id,
        script: setup.script,
        revision: setup.revision,
        updatedByName: editorNames.get(setup.updatedBy) ?? null,
        updatedAt: setup.updatedAt,
        approval: approvalStatus(approvals[index]?.revision, setup.revision),
      },
    }));
    const known = new Set(rows.map((row) => row.repoKey));
    for (const path of profiles.flatMap((profile) => profile.paths)) {
      const repoKey = toRepoKey(path.gitRemoteUrl);
      if (repoKey && !known.has(repoKey)) {
        known.add(repoKey);
        rows.push({ repoKey, setup: null });
      }
    }
    return rows.sort((a, b) => (a.repoKey < b.repoKey ? -1 : a.repoKey > b.repoKey ? 1 : 0));
  },
});

/** A web save approves the new revision for the saver; a save by API key approves for nobody. */
export const save = mutation({
  args: { projectId: v.id("projects"), repoKey: v.string(), script: v.string(), apiKey: v.optional(v.string()) },
  returns: v.object({ setupId: v.id("projectWorktreeSetups"), revision: v.number(), changed: v.boolean(), settingsUrl: v.string() }),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const { project } = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);

    ensure(isRepoKey(args.repoKey)).isTrue(errors.WORKTREE_SETUP_REPO_KEY_INVALID);
    const script = args.script.trim();
    ensure(script.length).gt(0, errors.WORKTREE_SETUP_SCRIPT_REQUIRED);
    ensure(script.length).lte(MAX_WORKTREE_SETUP_SCRIPT_LENGTH, errors.worktreeSetupScriptTooLong(MAX_WORKTREE_SETUP_SCRIPT_LENGTH));

    const existing = await findWorktreeSetup(ctx, args.projectId, args.repoKey);
    let setupId: Id<"projectWorktreeSetups">;
    let revision: number;
    if (existing) {
      setupId = existing._id;
      revision = existing.script === script ? existing.revision : await updateWorktreeSetupScript(ctx, existing, script, user._id);
    } else {
      const setups = await listWorktreeSetupsByProject(ctx, args.projectId, MAX_WORKTREE_SETUPS_PER_PROJECT);
      ensure(setups.length).lt(MAX_WORKTREE_SETUPS_PER_PROJECT, errors.worktreeSetupLimitReached(MAX_WORKTREE_SETUPS_PER_PROJECT));
      setupId = await insertWorktreeSetup(ctx, { projectId: args.projectId, repoKey: args.repoKey, script }, user._id);
      revision = 1;
    }
    if (isWebSession(principal)) await upsertWorktreeSetupApproval(ctx, user._id, setupId, revision);

    const organization = await ensure(getActiveOrganizationById(ctx, project.organizationId)).notNull(errors.PROJECT_NOT_FOUND);
    const settingsUrl = `${getAppUrlBase()}${href(appRoute.projectSettings(organization.slug, project.alias, "worktrees"))}`;
    return { setupId, revision, changed: existing?.script !== script, settingsUrl };
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects"), repoKey: v.string(), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    const setup = await ensure(findWorktreeSetup(ctx, args.projectId, args.repoKey)).notNull(errors.WORKTREE_SETUP_NOT_FOUND);
    await deleteWorktreeSetup(ctx, setup._id);
    return null;
  },
});

/** Web session only: an API key never approves. `revision` is the one the page showed; a newer one rejects it. */
export const approve = mutation({
  args: { setupId: v.id("projectWorktreeSetups"), revision: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    requireWebSession(principal);
    const setup = await ensure(getWorktreeSetupById(ctx, args.setupId)).notNull(errors.WORKTREE_SETUP_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, setup.projectId, ProjectPermission.CLI_THREAD);
    ensure(args.revision).eq(setup.revision, errors.WORKTREE_SETUP_REVISION_CHANGED);
    await upsertWorktreeSetupApproval(ctx, user._id, setup._id, setup.revision);
    return null;
  },
});
