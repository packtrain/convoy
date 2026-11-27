import type { PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { ONLINE_THRESHOLD_MS } from "./constants";

type Ctx = QueryCtx | MutationCtx;

/** A page of every session for a profile, for batched cleanup. */
export async function paginateSessionsByProfile(
  ctx: Ctx,
  profileId: Id<"cliProfiles">,
  opts: { cursor: string | null; numItems: number }
): Promise<PaginationResult<Doc<"cliSessions">>> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_profile_and_isOnline", (q) => q.eq("profileId", profileId))
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

/** A user's online sessions, newest first. */
export async function listOnlineSessionsByUser(ctx: Ctx, userId: Id<"users">): Promise<Doc<"cliSessions">[]> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_user_and_isOnline", (q) => q.eq("userId", userId).eq("isOnline", true))
    .order("desc")
    .collect();
}

/** A profile's online sessions. */
export async function listOnlineSessionsByProfile(ctx: Ctx, profileId: Id<"cliProfiles">): Promise<Doc<"cliSessions">[]> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_profile_and_isOnline", (q) => q.eq("profileId", profileId).eq("isOnline", true))
    .collect();
}

/** The profile's newest online session, or null — the cross-domain "is a CLI connected" read (OS-1895). */
export async function getOnlineSessionForProfile(ctx: Ctx, profileId: Id<"cliProfiles">): Promise<Doc<"cliSessions"> | null> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_profile_and_isOnline", (q) => q.eq("profileId", profileId).eq("isOnline", true))
    .order("desc")
    .first();
}

/**
 * The batched {@link getOnlineSessionForProfile}, one indexed read per distinct id. Profiles with
 * no online session are absent. Keyed on profiles: `cliSessions.projectId` is optional on old rows.
 */
export async function getOnlineSessionsByProfiles(
  ctx: Ctx,
  profileIds: Id<"cliProfiles">[]
): Promise<Map<Id<"cliProfiles">, Doc<"cliSessions">>> {
  const entries = await Promise.all(
    [...new Set(profileIds)].map(async (profileId) => [profileId, await getOnlineSessionForProfile(ctx, profileId)] as const)
  );
  return new Map(entries.filter((entry): entry is [Id<"cliProfiles">, Doc<"cliSessions">] => entry[1] !== null));
}

async function getHeartbeat(ctx: Ctx, sessionId: Id<"cliSessions">): Promise<Doc<"cliSessionHeartbeats"> | null> {
  return ctx.db
    .query("cliSessionHeartbeats")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();
}

/** Whether the session heartbeated within ONLINE_THRESHOLD_MS. Liveness gates only: it reads the hot heartbeat row. */
export async function isSessionLive(ctx: Ctx, sessionId: Id<"cliSessions">, now: number): Promise<boolean> {
  const heartbeat = await getHeartbeat(ctx, sessionId);
  if (heartbeat) {
    return heartbeat.lastHeartbeatAt > now - ONLINE_THRESHOLD_MS;
  }
  // A legacy row not yet heartbeated or migrated still carries its own timestamp (OS-2549).
  const session = await getSessionById(ctx, sessionId);
  return session?.isOnline === undefined && (session?.lastHeartbeatAt ?? 0) > now - ONLINE_THRESHOLD_MS;
}

/** Insert a session's heartbeat row. Outside this file, only the legacy-session migration calls it. */
export async function insertHeartbeat(ctx: MutationCtx, sessionId: Id<"cliSessions">, lastHeartbeatAt: number): Promise<void> {
  await ctx.db.insert("cliSessionHeartbeats", { sessionId, lastHeartbeatAt });
}

/** Heartbeat rows older than `before`, oldest first: the sessions the offline sweep flips. */
export async function listStaleHeartbeats(ctx: Ctx, before: number, limit: number): Promise<Doc<"cliSessionHeartbeats">[]> {
  return ctx.db
    .query("cliSessionHeartbeats")
    .withIndex("by_lastHeartbeatAt", (q) => q.lt("lastHeartbeatAt", before))
    .take(limit);
}

/** Offline sessions whose `offlineAt` is before `before`, oldest first: the ones the sweep deletes. */
export async function listSessionsOfflineSince(ctx: Ctx, before: number, limit: number): Promise<Doc<"cliSessions">[]> {
  return ctx.db
    .query("cliSessions")
    .withIndex("by_isOnline_and_offlineAt", (q) => q.eq("isOnline", false).lt("offlineAt", before))
    .take(limit);
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

/** Insert a new online session, stamping `startedAt` and its first heartbeat to now. */
export async function insertSession(
  ctx: MutationCtx,
  props: InsertSessionProps
): Promise<Id<"cliSessions">> {
  const now = Date.now();
  const sessionId = await ctx.db.insert("cliSessions", { ...props, startedAt: now, isOnline: true });
  await insertHeartbeat(ctx, sessionId, now);
  return sessionId;
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

/** Update an existing session when the same CLI process reconnects, refreshing its identity fields and heartbeat. */
export async function updateSessionOnReconnect(
  ctx: MutationCtx,
  session: Doc<"cliSessions">,
  patch: SessionReconnectPatch
): Promise<void> {
  await ctx.db.patch("cliSessions", session._id, patch);
  await touchSessionHeartbeat(ctx, session);
}

/**
 * Stamp the session's heartbeat row to now. A session the sweep took offline (laptop woke up)
 * gets its row back and flips online; a healthy heartbeat writes only the heartbeat row.
 */
export async function touchSessionHeartbeat(ctx: MutationCtx, session: Doc<"cliSessions">): Promise<void> {
  const now = Date.now();
  const heartbeat = await getHeartbeat(ctx, session._id);
  if (heartbeat) {
    await ctx.db.patch("cliSessionHeartbeats", heartbeat._id, { lastHeartbeatAt: now });
  } else {
    await insertHeartbeat(ctx, session._id, now);
  }
  if (session.isOnline !== true) {
    await ctx.db.patch("cliSessions", session._id, { isOnline: true, offlineAt: undefined });
  }
}

/** The offline sweep's flip: stamp the session offline and drop its heartbeat row. */
export async function markSessionOffline(ctx: MutationCtx, heartbeat: Doc<"cliSessionHeartbeats">, now: number): Promise<void> {
  await ctx.db.delete("cliSessionHeartbeats", heartbeat._id);
  if (await ctx.db.get("cliSessions", heartbeat.sessionId)) {
    await ctx.db.patch("cliSessions", heartbeat.sessionId, { isOnline: false, offlineAt: now });
  }
}

export async function deleteSession(
  ctx: MutationCtx,
  sessionId: Id<"cliSessions">
): Promise<void> {
  const heartbeat = await getHeartbeat(ctx, sessionId);
  if (heartbeat) {
    await ctx.db.delete("cliSessionHeartbeats", heartbeat._id);
  }
  await ctx.db.delete("cliSessions", sessionId);
}
