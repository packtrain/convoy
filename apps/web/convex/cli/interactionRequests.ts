import { mutation, query, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  getAuthenticatedAccess,
  getAuthenticatedUser,
  getOptionalAuthenticatedAccess,
  getOptionalAuthenticatedUser,
} from "../lib/access/auth";
import { hasProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import {
  cliInteractionKindValidator,
  cliInteractionStatusValidator,
} from "../lib/contracts/validators";
import { getAccessibleThread, requireSessionOwnership } from "./lib/permissions";
import { assertThreadClaimedBySession } from "./lib/claims";
import { getSessionById } from "./lib/cliSessionsRepo";
import { getThreadById, setThreadHasPendingInteraction } from "./threads/lib/cliThreadsRepo";
import { emitEvent } from "../lib/events";
import {
  getInteractionRequestByRequestId,
  insertInteractionRequest,
  listInteractionRequestsBySessionAndStatus,
  listInteractionRequestsByThreadAndStatus,
  listLivePendingInteractionRequests,
  updateInteractionRequest,
} from "./lib/cliInteractionRequestsRepo";

const interactionRequestItemValidator = v.object({
  _id: v.id("cliInteractionRequests"),
  threadId: v.id("cliThreads"),
  messageId: v.id("cliMessages"),
  sessionId: v.id("cliSessions"),
  requestId: v.string(),
  kind: cliInteractionKindValidator,
  payloadJson: v.string(),
  status: cliInteractionStatusValidator,
  responseJson: v.optional(v.string()),
  answeredAt: v.optional(v.number()),
  cancelledReason: v.optional(v.string()),
  expiresAt: v.number(),
  createdAt: v.number(),
});

function toInteractionRequestItem(doc: Doc<"cliInteractionRequests">) {
  return {
    _id: doc._id,
    threadId: doc.threadId,
    messageId: doc.messageId,
    sessionId: doc.sessionId,
    requestId: doc.requestId,
    kind: doc.kind,
    payloadJson: doc.payloadJson,
    status: doc.status,
    responseJson: doc.responseJson,
    answeredAt: doc.answeredAt,
    cancelledReason: doc.cancelledReason,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
  };
}

/** Cancel stale cards and return the blocking count for run wind-down. */
export async function cancelPendingInteractionRequestsForThread(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  reason: string,
  now: number
): Promise<number> {
  const pending = await listInteractionRequestsByThreadAndStatus(
    ctx,
    threadId,
    "pending"
  );
  await Promise.all(
    pending.map((request) =>
      updateInteractionRequest(
        ctx,
        request._id,
        { status: "cancelled", cancelledReason: reason },
        now
      )
    )
  );
  await setThreadHasPendingInteraction(ctx, threadId, false);
  return pending.filter(request => isBlockingInteraction(request.payloadJson)).length;
}

function isBlockingInteraction(payloadJson: string): boolean {
  try {
    const payload: unknown = JSON.parse(payloadJson);
    return typeof payload !== "object" || payload === null ||
      !("isBlocking" in payload) || payload.isBlocking !== false;
  } catch {
    return true;
  }
}

/** Clear the thread's pending-interaction flag once no pending requests remain. */
async function syncThreadPendingInteractionFlag(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">
): Promise<void> {
  const pending = await listInteractionRequestsByThreadAndStatus(
    ctx,
    threadId,
    "pending"
  );
  if (!pending.some(request => isBlockingInteraction(request.payloadJson))) {
    await setThreadHasPendingInteraction(ctx, threadId, false);
  }
}

/** Extend pending request expiry alongside a claim-lease renewal. */
export async function extendPendingInteractionRequestExpiry(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  expiresAt: number,
  now: number
): Promise<void> {
  const pending = await listInteractionRequestsByThreadAndStatus(
    ctx,
    threadId,
    "pending"
  );
  await Promise.all(
    pending.map((request) =>
      updateInteractionRequest(ctx, request._id, { expiresAt }, now)
    )
  );
}

/**
 * CLI: create (or refresh) a pending interaction request. Idempotent by
 * (threadId, requestId) — repeated calls update the payload/lease expiry.
 */
export const create = mutation({
  args: {
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"),
    sessionId: v.id("cliSessions"),
    requestId: v.string(),
    kind: cliInteractionKindValidator,
    payloadJson: v.string(),
    expiresAt: v.number(),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("cliInteractionRequests"),
  handler: async (ctx, args) => {
    const { user } = await getAuthenticatedAccess(ctx, args.apiKey);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(
      errors.THREAD_NOT_FOUND
    );
    ensure(chat.profileId).eq(session.profileId, errors.SESSION_PROFILE_MISMATCH);
    ensure(chat.userId).eq(user._id, errors.NOT_AUTHORIZED);
    assertThreadClaimedBySession(chat, args.sessionId);

    const now = Date.now();
    // Expiry is tied to the claim lease: never trust the CLI clock beyond it.
    const expiresAt = Math.min(
      args.expiresAt,
      chat.claimLeaseExpiresAt ?? args.expiresAt
    );
    const existing = await getInteractionRequestByRequestId(
      ctx,
      args.threadId,
      args.requestId
    );

    if (existing) {
      // Refresh only while still pending; answered/cancelled rows are final.
      if (existing.status === "pending") {
        await updateInteractionRequest(ctx, existing._id, { expiresAt }, now);
        if (isBlockingInteraction(existing.payloadJson)) {
          await setThreadHasPendingInteraction(ctx, args.threadId, true);
        }
      }
      return existing._id;
    }

    if (isBlockingInteraction(args.payloadJson)) {
      await setThreadHasPendingInteraction(ctx, args.threadId, true);
      // Only blocking prompts put the run in the waiting-input bucket.
      await emitEvent(ctx, {
        type: "thread.waiting_input",
        projectId: chat.projectId,
        subject: { kind: "thread", id: args.threadId },
        payload: { messageId: args.messageId },
      });
    }
    return await insertInteractionRequest(ctx, {
      threadId: args.threadId,
      messageId: args.messageId,
      sessionId: args.sessionId,
      profileId: chat.profileId,
      requestId: args.requestId,
      kind: args.kind,
      payloadJson: args.payloadJson,
      status: "pending",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Web: answer a pending request. Only the thread owner may respond; only a
 * `pending` request transitions to `answered` (idempotent for repeat clicks).
 */
export const respond = mutation({
  args: {
    threadId: v.id("cliThreads"),
    requestId: v.string(),
    responseJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(
      errors.THREAD_NOT_FOUND
    );
    ensure(chat.userId).eq(user._id, errors.NOT_AUTHORIZED);
    await requireAuthorizedProject(
      ctx,
      user._id,
      chat.projectId,
      ProjectPermission.CLI_THREAD
    );

    const request = await ensure(
      getInteractionRequestByRequestId(ctx, args.threadId, args.requestId)
    ).notNull(errors.INTERACTION_REQUEST_NOT_FOUND);

    const now = Date.now();
    if (request.status === "answered") {
      // Idempotent: a second click on an already-answered card is a no-op.
      return null;
    }
    ensure(request.status).eq("pending", errors.INTERACTION_REQUEST_NOT_PENDING);
    ensure(request.expiresAt > now).isTrue(errors.INTERACTION_REQUEST_EXPIRED);

    await updateInteractionRequest(
      ctx,
      request._id,
      { status: "answered", responseJson: args.responseJson, answeredAt: now },
      now
    );
    await syncThreadPendingInteractionFlag(ctx, args.threadId);

    return null;
  },
});

/**
 * CLI: cancel a pending request (run ended, provider cancelled it, abort).
 * Idempotent; answered rows stay answered.
 */
export const cancel = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    requestId: v.string(),
    reason: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await getAuthenticatedAccess(ctx, args.apiKey);

    await requireSessionOwnership(ctx, user._id, args.sessionId);
    const request = await getInteractionRequestByRequestId(
      ctx,
      args.threadId,
      args.requestId
    );
    if (!request || request.status !== "pending") {
      return null;
    }
    ensure(request.sessionId).eq(args.sessionId, errors.NOT_AUTHORIZED);

    await updateInteractionRequest(
      ctx,
      request._id,
      { status: "cancelled", cancelledReason: args.reason ?? "cancelled" },
      Date.now()
    );
    await syncThreadPendingInteractionFlag(ctx, args.threadId);

    return null;
  },
});

/** Web: pending interaction requests for a thread (reactive card source). */
export const listPendingByThread = query({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.array(interactionRequestItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const chat = await getAccessibleThread(ctx, user._id, args.threadId);
    if (!chat) {
      return [];
    }
    const hasAccess = await hasProjectAccess(
      ctx,
      user._id,
      chat.projectId,
      ProjectPermission.CLI_THREAD
    );
    if (!hasAccess) {
      return [];
    }

    // Lease-expired requests are dead even if no lifecycle hook ran yet.
    const now = Date.now();
    const pending = await listLivePendingInteractionRequests(
      ctx,
      args.threadId,
      now
    );
    if (pending.length === 0) {
      return [];
    }

    // A row whose CLI died is equally dead, and the lease outlives the process by up to its
    // full duration (OS-1463): answering it writes into a row nobody is subscribed to, so the
    // click appears to do nothing and the run only fails minutes later. Session liveness is
    // the real signal, so rows whose claiming session went offline are dropped. One `db.get`
    // per distinct session (usually exactly one).
    const sessionOnlineById = new Map<Id<"cliSessions">, boolean>();
    await Promise.all(
      [...new Set(pending.map((request) => request.sessionId))].map(
        async (sessionId) => {
          const session = await getSessionById(ctx, sessionId);
          sessionOnlineById.set(
            sessionId,
            session?.isOnline === true
          );
        }
      )
    );

    return pending
      .filter((request) => sessionOnlineById.get(request.sessionId) === true)
      .map(toInteractionRequestItem);
  },
});

/**
 * CLI: answered requests for this session. The CLI holds one standing
 * subscription and resolves parked provider callbacks by `requestId`
 * (deduping re-fires client-side).
 */
export const listAnsweredBySession = query({
  args: {
    sessionId: v.id("cliSessions"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(interactionRequestItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }

    // A stale subscription from a replaced/disconnected CLI process may
    // outlive its session row — that is ownership semantics, not an error.
    const session = await getSessionById(ctx, args.sessionId);
    if (!session || (session.userId && session.userId !== auth.user._id)) {
      return [];
    }

    const answered = await listInteractionRequestsBySessionAndStatus(
      ctx,
      session._id,
      "answered"
    );
    return answered.map(toInteractionRequestItem);
  },
});
