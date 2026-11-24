import type { PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { ONLINE_THRESHOLD_MS } from "./constants";

type Ctx = QueryCtx | MutationCtx;

/** A page of sessions for a profile, oldest heartbeat first, for batched cleanup. */
export async function paginateSessionsByProfile(
  ctx: Ctx,
  profileId: Id<"cliProfiles">,
  opts: { cursor: string | null; numItems: number }
): Promise<PaginationResult<Doc<"cliSessions">>> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_profile_lastHeartbeat", (q) => q.eq("profileId", profileId))
    .paginate(opts);
}

/** A single CLI session by id, or null when it no longer exists. */
export async function getSessionById(
  ctx: Ctx,
  sessionId: Id<"cliSessions">
): Promise<Doc<"cliSessions"> | null> {
  return ctx.db.get("cliSessions", sessionId);
}

/** The session for a CLI process `instanceId` (unique), or null. */
export async function getSessionByInstanceId(
  ctx: Ctx,
  instanceId: string
): Promise<Doc<"cliSessions"> | null> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_instanceId", (q) => q.eq("instanceId", instanceId))
    .unique();
}

/**
 * Sessions for a project whose last heartbeat is at or after `cutoff`, ordered
 * by most-recent heartbeat first (so the first per profile is the freshest).
 */
export async function listRecentSessionsByProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  cutoff: number
): Promise<Doc<"cliSessions">[]> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_project_and_lastHeartbeatAt", (q) =>
      q.eq("projectId", projectId).gte("lastHeartbeatAt", cutoff)
    )
    .order("desc")
    .collect();
}

/**
 * Sessions owned by a user whose heartbeat is at or after `cutoff`, newest
 * first. Modern sessions always carry the denormalized user id.
 */
export async function listRecentSessionsByUser(
  ctx: Ctx,
  userId: Id<"users">,
  cutoff: number
): Promise<Doc<"cliSessions">[]> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_user_and_lastHeartbeatAt", (q) =>
      q.eq("userId", userId).gte("lastHeartbeatAt", cutoff)
    )
    .order("desc")
    .collect();
}

/**
 * The freshest active session for a profile (heartbeat at or after `since`), or
 * null when the profile has no live session.
 */
export async function getLatestActiveSessionForProfile(
  ctx: Ctx,
  profileId: Id<"cliProfiles">,
  since: number
): Promise<Doc<"cliSessions"> | null> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_profile_lastHeartbeat", (q) =>
      q.eq("profileId", profileId).gte("lastHeartbeatAt", since)
    )
    .order("desc")
    .first();
}

/** The profile's freshest session still within the online threshold, or null — the cross-domain "is a CLI connected" read (OS-1895). */
export async function getOnlineSessionForProfile(ctx: Ctx, profileId: Id<"cliProfiles">, now: number): Promise<Doc<"cliSessions"> | null> {
  return getLatestActiveSessionForProfile(ctx, profileId, now - ONLINE_THRESHOLD_MS);
}

/**
* The freshest active session per profile — the batched {@link getLatestActiveSessionForProfile},
* one indexed read per distinct id. Profiles with no live session are absent.
*
* Keyed on profiles, not a project: `cliSessions.projectId` is optional, so a session predating
* that denorm is invisible to `by_project_and_lastHeartbeatAt` and a project-keyed scan would
* call its target offline while this calls it online. Lives here because "freshest wins" is a
* property of the index it reads.
*/
export async function getLatestActiveSessionsByProfiles(
  ctx: Ctx,
  profileIds: Id<"cliProfiles">[],
  since: number
): Promise<Map<Id<"cliProfiles">, Doc<"cliSessions">>> {
  const entries = await Promise.all(
    [...new Set(profileIds)].map(
      async (profileId) => [profileId, await getLatestActiveSessionForProfile(ctx, profileId, since)] as const
    )
  );
  return new Map(
    entries.filter((entry): entry is [Id<"cliProfiles">, Doc<"cliSessions">] => entry[1] !== null)
  );
}

/** Sessions for a profile whose last heartbeat is at or after `since`. */
export async function listActiveSessionsByProfile(
  ctx: Ctx,
  profileId: Id<"cliProfiles">,
  since: number
): Promise<Doc<"cliSessions">[]> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_profile_lastHeartbeat", (q) =>
      q.eq("profileId", profileId).gte("lastHeartbeatAt", since)
    )
    .collect();
}

type InsertSessionProps = {
  profileId: Id<"cliProfiles">;
  instanceId: string;
  apiKeyId: Id<"apiKeys">;
  userId: Id<"users">;
  projectId: Id<"projects">;
  availableClis: Doc<"cliSessions">["availableClis"];
  appVersion?: string;
  supportsPartialStreaming?: boolean;
  supportsInteractiveApprovals?: boolean;
  supportsSteering?: boolean;
  steeringCliTypes?: string[];
};

/** Insert a new session, stamping `startedAt`/`lastHeartbeatAt` to now. */
export async function insertSession(
  ctx: MutationCtx,
  props: InsertSessionProps
): Promise<Id<"cliSessions">> {
  const now = Date.now();
  return ctx.db.insert("cliSessions", {
    ...props,
    startedAt: now,
    lastHeartbeatAt: now,
  });
}

type SessionReconnectPatch = {
  profileId: Id<"cliProfiles">;
  apiKeyId: Id<"apiKeys">;
  userId: Id<"users">;
  projectId: Id<"projects">;
  availableClis: Doc<"cliSessions">["availableClis"];
  appVersion?: string;
  supportsPartialStreaming?: boolean;
  supportsInteractiveApprovals?: boolean;
  supportsSteering?: boolean;
  steeringCliTypes?: string[];
};

/**
 * Whether this session's connection can steer runs of the given cliType.
 * Newer CLIs (>= 0.8.0) advertise per-runtime `steeringCliTypes` (codex
 * steers only over the app-server transport); older CLIs only sent the
 * boolean `supportsSteering`, which meant Claude Code.
 */
export function sessionSupportsSteeringForCliType(
  session: Pick<Doc<"cliSessions">, "supportsSteering" | "steeringCliTypes">,
  cliType: string
): boolean {
  if (session.steeringCliTypes !== undefined) {
    return session.steeringCliTypes.includes(cliType);
  }
  return cliType === "claude-code" && session.supportsSteering === true;
}

/**
 * Update an existing session when the same CLI process reconnects, refreshing
 * its identity fields and stamping `lastHeartbeatAt` so callers never repeat it.
 */
export async function updateSessionOnReconnect(
  ctx: MutationCtx,
  sessionId: Id<"cliSessions">,
  patch: SessionReconnectPatch
): Promise<void> {
  await ctx.db.patch("cliSessions", sessionId, {
    ...patch,
    lastHeartbeatAt: Date.now(),
  });
}

/** Stamp a session's `lastHeartbeatAt` to now. */
export async function touchSessionHeartbeat(
  ctx: MutationCtx,
  sessionId: Id<"cliSessions">
): Promise<void> {
  await ctx.db.patch("cliSessions", sessionId, {
    lastHeartbeatAt: Date.now(),
  });
}

export async function deleteSession(
  ctx: MutationCtx,
  sessionId: Id<"cliSessions">
): Promise<void> {
  await ctx.db.delete("cliSessions", sessionId);
}
