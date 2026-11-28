import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { sameStoredValue } from "../../lib/shared/patch";
import { getBasename } from "./paths";
import { isConfiguredPath, isInsideRelativePath, isWorktreeParent } from "../../lib/contracts/validators";

type Ctx = QueryCtx | MutationCtx;

export type ProfilePathEntry = Doc<"cliProfiles">["paths"][number];
type IncomingPath = { path: string; label?: string; gitRemoteUrl?: string };

/** A single profile by id, or null when it no longer exists. */
export async function getCliProfileById(ctx: Ctx, profileId: Id<"cliProfiles">): Promise<Doc<"cliProfiles"> | null> {
  return ctx.db.get("cliProfiles", profileId);
}

/**
 * Batch-load profiles by id (including soft-deleted), `null` for missing rows.
 * Results align with input order, matching the `join` loader contract — for a
 * left join that keeps rows whose profile is gone. Use
 * {@link getActiveCliProfilesByIds} when soft-deleted profiles should drop out.
 */
export async function getCliProfilesByIds(ctx: Ctx, profileIds: Id<"cliProfiles">[]): Promise<(Doc<"cliProfiles"> | null)[]> {
  return Promise.all(profileIds.map((profileId) => getCliProfileById(ctx, profileId)));
}

/**
 * Batch-load profiles by id, returning `null` for missing OR soft-deleted rows
 * (so an inner `join` drops sessions whose profile is gone). Results align with
 * the input order, matching the `join` loader contract.
 */
export async function getActiveCliProfilesByIds(ctx: Ctx, profileIds: Id<"cliProfiles">[]): Promise<(Doc<"cliProfiles"> | null)[]> {
  const profiles = await Promise.all(profileIds.map((profileId) => ctx.db.get("cliProfiles", profileId)));
  return profiles.map((profile) => (profile && !profile.isDeleted ? profile : null));
}

/** Active profiles owned by a user in a project, newest first. */
export async function listActiveProfilesByUserAndProject(
  ctx: Ctx,
  userId: Id<"users">,
  projectId: Id<"projects">
): Promise<Doc<"cliProfiles">[]> {
  return ctx.db
    .query("cliProfiles")
    .withIndex("by_user_project_and_isDeleted_and_createdAt", (q) =>
      q.eq("userId", userId).eq("projectId", projectId).eq("isDeleted", false)
    )
    .order("desc")
    .collect();
}

/** Active profiles owned by a user, ordered by newest `createdAt` first. */
export async function listActiveProfilesByUser(ctx: Ctx, userId: Id<"users">): Promise<Doc<"cliProfiles">[]> {
  return ctx.db
    .query("cliProfiles")
    .withIndex("by_user_and_isDeleted_and_createdAt", (q) => q.eq("userId", userId).eq("isDeleted", false))
    .order("desc")
    .collect();
}

/**
 * The non-deleted profile uniquely identified by user + project + profileKey,
 * or null. The identity tuple a CLI reconnects under.
 */
export async function getActiveProfileByIdentity(
  ctx: Ctx,
  identity: {
    userId: Id<"users">;
    projectId: Id<"projects">;
    profileKey?: string;
  }
): Promise<Doc<"cliProfiles"> | null> {
  return ctx.db
    .query("cliProfiles")
    .withIndex("by_user_project_profileKey_and_isDeleted", (q) =>
      q.eq("userId", identity.userId).eq("projectId", identity.projectId).eq("profileKey", identity.profileKey).eq("isDeleted", false)
    )
    .unique();
}

type InsertProfileProps = {
  userId: Id<"users">;
  projectId: Id<"projects">;
  profileKey?: string;
  name: string;
  hostname?: string;
  paths?: ProfilePathEntry[];
  lastKnownClis?: Doc<"cliProfiles">["lastKnownClis"];
};

/**
 * Insert a new profile, stamping `createdAt`/`lastConnectedAt` and
 * `isDeleted: false` so callers pass only the identity + display props.
 */
export async function insertCliProfile(ctx: MutationCtx, props: InsertProfileProps): Promise<Id<"cliProfiles">> {
  const now = Date.now();
  return ctx.db.insert("cliProfiles", {
    userId: props.userId,
    projectId: props.projectId,
    profileKey: props.profileKey,
    name: props.name,
    hostname: props.hostname,
    paths: props.paths ?? [],
    lastKnownClis: props.lastKnownClis?.length ? props.lastKnownClis : undefined,
    createdAt: now,
    lastConnectedAt: now,
    isDeleted: false,
  });
}

type ProfileReconnectInput = {
  hostname?: string;
  /** Merged path entries; omit to leave `paths` untouched. */
  paths?: ProfilePathEntry[];
  /** Advertised runtimes; empty never overwrites the snapshot. */
  availableClis?: Doc<"cliProfiles">["lastKnownClis"];
  now: number;
};

/**
 * The single patch a registration applies to an existing profile. One patch, not
 * three: `ctx.db.patch` rewrites the whole document, so each extra patch re-paid
 * this fat row in full (OS-1721).
 */
export function buildProfileReconnectPatch(input: ProfileReconnectInput): Partial<Doc<"cliProfiles">> {
  return {
    hostname: input.hostname,
    lastConnectedAt: input.now,
    ...(input.paths !== undefined ? { paths: input.paths } : {}),
    // An empty detection (fixture/stream mode) must not wipe the snapshot.
    ...(input.availableClis?.length ? { lastKnownClis: input.availableClis } : {}),
  };
}

/** Refresh identity fields on reconnect, stamping `lastConnectedAt` to now. */
export async function patchProfileOnReconnect(
  ctx: MutationCtx,
  profile: Doc<"cliProfiles">,
  input: Omit<ProfileReconnectInput, "now">
): Promise<void> {
  await ctx.db.patch("cliProfiles", profile._id, buildProfileReconnectPatch({ ...input, now: Date.now() }));
}

/** Set a profile's display name. */
export async function setProfileName(ctx: MutationCtx, profileId: Id<"cliProfiles">, name: string): Promise<void> {
  await ctx.db.patch("cliProfiles", profileId, { name });
}

/** Replace a profile's path entries. */
export async function setProfilePaths(ctx: MutationCtx, profileId: Id<"cliProfiles">, paths: ProfilePathEntry[]): Promise<void> {
  await ctx.db.patch("cliProfiles", profileId, { paths });
}

/**
 * Replace a profile's path entries only when the merge actually changed them,
 * returning whether it wrote. Both sync paths (CLI path sync and worktree sync)
 * usually re-report an identical list, and this row is fat enough that the no-op
 * rewrite plus its four index updates was showing up in Database I/O (OS-1721).
 */
export async function setProfilePathsIfChanged(
  ctx: MutationCtx,
  profile: Doc<"cliProfiles">,
  paths: ProfilePathEntry[]
): Promise<boolean> {
  if (sameStoredValue(paths, profile.paths)) {
    return false;
  }
  await setProfilePaths(ctx, profile._id, paths);
  return true;
}

/** Soft-delete a profile, stamping `deletedAt`/`deletedBy`. */
export async function softDeleteCliProfile(ctx: MutationCtx, profileId: Id<"cliProfiles">, deletedBy: Id<"users">): Promise<void> {
  await ctx.db.patch("cliProfiles", profileId, {
    isDeleted: true,
    deletedAt: Date.now(),
    deletedBy,
  });
}

/** Build a brand-new path entry, defaulting a missing label to the basename. */
function newProfilePathEntry(incoming: IncomingPath): ProfilePathEntry {
  return {
    id: crypto.randomUUID(),
    path: incoming.path,
    label: incoming.label ?? getBasename(incoming.path),
    gitRemoteUrl: incoming.gitRemoteUrl,
  };
}

/** Path entries for a freshly created profile from the paths a CLI reports. */
export function buildInitialProfilePaths(incomingPaths: IncomingPath[]): ProfilePathEntry[] {
  return incomingPaths.map(newProfilePathEntry);
}

/**
 * Merge incoming paths into an existing set, keeping stable ids/labels for paths
 * already known and minting fresh entries for new ones. Only regular paths in
 * the incoming list survive (paths not reported are dropped). Worktree and repo
 * entries have their own syncs, so they are carried over while their parent survives.
 */
export function mergeProfilePaths(existingPaths: ProfilePathEntry[], incomingPaths: IncomingPath[]): ProfilePathEntry[] {
  const existingByPath = new Map(existingPaths.map((p) => [p.path, p]));
  const mergedRegular = incomingPaths.map((incoming) => {
    const existing = existingByPath.get(incoming.path);
    if (!existing || !isConfiguredPath(existing)) {
      return newProfilePathEntry(incoming);
    }
    return {
      id: existing.id,
      path: incoming.path,
      label: incoming.label ?? existing.label,
      gitRemoteUrl: incoming.gitRemoteUrl ?? existing.gitRemoteUrl,
    };
  });

  const survivingParentIds = new Set(mergedRegular.map((entry) => entry.id));
  const regularPathStrings = new Set(mergedRegular.map((entry) => entry.path));
  const survives = (entry: ProfilePathEntry) =>
    !isConfiguredPath(entry) &&
    entry.parentPathId !== undefined &&
    survivingParentIds.has(entry.parentPathId) &&
    // A path promoted to a regular configured entry wins over its old
    // worktree or repo entry.
    !regularPathStrings.has(entry.path);
  // Repos first: a repo's worktrees survive with it.
  for (const repo of existingPaths.filter((entry) => entry.kind === "repo" && survives(entry))) {
    survivingParentIds.add(repo.id);
  }
  const keptChildren = existingPaths.filter(survives);

  return [...mergedRegular, ...keptChildren];
}

export type IncomingRepo = { path: string; relativePath: string; gitRemoteUrl?: string; branch?: string };

/**
 * Replace the repo entries of the configured path at `parentPath` with the CLI's
 * latest scan, ids stable by path. An unknown parent is a no-op. Output order is
 * configured paths, repos by folder, worktrees, as `mergeWorktreeEntries` keeps
 * it, so a repeated scan writes nothing. Spec: docs/specs/cli-multi-repo-projects.md#server
 */
export function mergeRepoEntries(
  existingPaths: ProfilePathEntry[],
  input: { parentPath: string; repos: IncomingRepo[] }
): ProfilePathEntry[] {
  const parent = existingPaths.find((entry) => isConfiguredPath(entry) && entry.path === input.parentPath);
  if (!parent) {
    return existingPaths;
  }
  const isOwnRepo = (entry: ProfilePathEntry) => entry.kind === "repo" && entry.parentPathId === parent.id;
  const existingByPath = new Map(existingPaths.filter(isOwnRepo).map((entry) => [entry.path, entry]));
  // Never shadow another entry (a configured path or worktree at the same path).
  const takenPaths = new Set(existingPaths.filter((entry) => !isOwnRepo(entry)).map((entry) => entry.path));

  const repos: ProfilePathEntry[] = [];
  for (const repo of input.repos) {
    if (!isInsideRelativePath(repo.relativePath) || takenPaths.has(repo.path)) {
      continue;
    }
    takenPaths.add(repo.path);
    repos.push({
      id: existingByPath.get(repo.path)?.id ?? crypto.randomUUID(),
      path: repo.path,
      label: repo.relativePath,
      gitRemoteUrl: repo.gitRemoteUrl,
      kind: "repo",
      parentPathId: parent.id,
      branch: repo.branch,
    });
  }

  // Repos grouped by their folder in configured order, so the order never depends on which folder synced last.
  const configured = existingPaths.filter(isConfiguredPath);
  const reposOf = (folder: ProfilePathEntry) =>
    folder.id === parent.id ? repos : existingPaths.filter((entry) => entry.kind === "repo" && entry.parentPathId === folder.id);
  const merged = [...configured, ...configured.flatMap(reposOf)];
  // A removed repo takes its worktree entries with it.
  const parentIds = new Set(merged.map((entry) => entry.id));
  return [...merged, ...existingPaths.filter((entry) => isWorktreeEntry(entry) && entry.parentPathId !== undefined && parentIds.has(entry.parentPathId))];
}

/**
 * Find an existing (non-deleted) profile for the identity tuple or create a new
 * one. A reconnect refreshes hostname + `lastConnectedAt` and folds the reported
 * paths and advertised runtimes into that **one** patch — three separate writes
 * to this fat row cost three full rewrites (OS-1721).
 */
export async function findOrCreateProfile(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    projectId: Id<"projects">;
    profileKey?: string;
    hostname?: string;
    name?: string;
    /** Paths as reported by the CLI; omit to leave a reconnecting profile's alone. */
    incomingPaths?: IncomingPath[];
    availableClis?: Doc<"cliProfiles">["lastKnownClis"];
  }
): Promise<Id<"cliProfiles">> {
  const existing = await getActiveProfileByIdentity(ctx, {
    userId: args.userId,
    projectId: args.projectId,
    profileKey: args.profileKey,
  });

  if (existing) {
    await patchProfileOnReconnect(ctx, existing, {
      hostname: args.hostname,
      paths: args.incomingPaths ? mergeProfilePaths(existing.paths, args.incomingPaths) : undefined,
      availableClis: args.availableClis,
    });
    return existing._id;
  }

  const name = args.name?.trim() || args.hostname || "CLI";
  return insertCliProfile(ctx, {
    userId: args.userId,
    projectId: args.projectId,
    profileKey: args.profileKey,
    name,
    hostname: args.hostname,
    paths: buildInitialProfilePaths(args.incomingPaths ?? []),
    lastKnownClis: args.availableClis,
  });
}

export type IncomingWorktree = {
  parentPath: string;
  path: string;
  branch: string;
};

function isWorktreeEntry(entry: ProfilePathEntry): boolean {
  return entry.kind === "worktree";
}

/**
 * Merge CLI-scanned worktrees into a profile's path entries. Regular paths are never
 * touched. Worktrees under a scanned parent are replaced (ids stable by path), under
 * an unscanned parent kept, and pruned when their parent is gone — as are incoming
 * worktrees colliding with a regular path (the main checkout appears in `git worktree
 * list`; the CLI filters it, this is the server-side guard).
 */
export function mergeWorktreeEntries(
  existingPaths: ProfilePathEntry[],
  input: { scannedParentPaths: string[]; worktrees: IncomingWorktree[] }
): ProfilePathEntry[] {
  // Configured paths and detected repos are worktree parents (cli-multi-repo-projects.md#picking-a-repo).
  const regularPaths = existingPaths.filter((entry) => !isWorktreeEntry(entry));
  const parents = regularPaths.filter((entry) => isWorktreeParent(existingPaths, entry));
  const parentByPath = new Map(parents.map((entry) => [entry.path, entry]));
  const regularIds = new Set(parents.map((entry) => entry.id));
  const regularPathStrings = new Set(regularPaths.map((entry) => entry.path));

  const scannedParentIds = new Set(
    [...input.scannedParentPaths, ...input.worktrees.map((wt) => wt.parentPath)]
      .map((path) => parentByPath.get(path)?.id)
      .filter((id): id is string => id !== undefined)
  );

  const existingWorktrees = existingPaths.filter(isWorktreeEntry);
  const existingByPath = new Map(existingWorktrees.map((entry) => [entry.path, entry]));

  const keptWorktrees = existingWorktrees.filter(
    (entry) => entry.parentPathId !== undefined && regularIds.has(entry.parentPathId) && !scannedParentIds.has(entry.parentPathId)
  );

  const incomingWorktrees: ProfilePathEntry[] = [];
  const seenIncomingPaths = new Set<string>();
  for (const incoming of input.worktrees) {
    const parent = parentByPath.get(incoming.parentPath);
    if (!parent) {
      continue;
    }
    if (regularPathStrings.has(incoming.path) || seenIncomingPaths.has(incoming.path)) {
      continue;
    }
    seenIncomingPaths.add(incoming.path);

    const existing = existingByPath.get(incoming.path);
    incomingWorktrees.push({
      id: existing?.id ?? crypto.randomUUID(),
      path: incoming.path,
      label: existing?.label ?? incoming.branch,
      gitRemoteUrl: parent.gitRemoteUrl,
      kind: "worktree",
      parentPathId: parent.id,
      branch: incoming.branch,
    });
  }

  return [...regularPaths, ...keptWorktrees, ...incomingWorktrees];
}

/**
 * Ensure a worktree path entry exists (used when the CLI resolves a thread's
 * pending worktree creation). Idempotent by path string.
 */
export function upsertWorktreePathEntry(
  existingPaths: ProfilePathEntry[],
  input: { parentPathId: string; path: string; branch: string }
): { paths: ProfilePathEntry[]; entryId: string } {
  const existing = existingPaths.find((entry) => entry.path === input.path);
  if (existing) {
    return { paths: existingPaths, entryId: existing.id };
  }

  const parent = existingPaths.find((entry) => entry.id === input.parentPathId && isWorktreeParent(existingPaths, entry));
  const entry: ProfilePathEntry = {
    id: crypto.randomUUID(),
    path: input.path,
    label: input.branch,
    gitRemoteUrl: parent?.gitRemoteUrl,
    kind: "worktree",
    parentPathId: input.parentPathId,
    branch: input.branch,
  };
  return { paths: [...existingPaths, entry], entryId: entry.id };
}
