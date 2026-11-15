import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getInteractionRequestByRequestId(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  requestId: string
): Promise<Doc<"cliInteractionRequests"> | null> {
  return ctx.db
    .query("cliInteractionRequests")
    .withIndex("by_thread_and_requestId", (q) =>
      q.eq("threadId", threadId).eq("requestId", requestId)
    )
    .unique();
}

export async function listInteractionRequestsByThreadAndStatus(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  status: Doc<"cliInteractionRequests">["status"]
): Promise<Doc<"cliInteractionRequests">[]> {
  return ctx.db
    .query("cliInteractionRequests")
    .withIndex("by_thread_and_status_and_expiresAt", (q) =>
      q.eq("threadId", threadId).eq("status", status)
    )
    .collect();
}

/** Pending requests whose lease-tied expiry is still in the future. */
export async function listLivePendingInteractionRequests(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  now: number
): Promise<Doc<"cliInteractionRequests">[]> {
  return ctx.db
    .query("cliInteractionRequests")
    .withIndex("by_thread_and_status_and_expiresAt", (q) =>
      q.eq("threadId", threadId).eq("status", "pending").gt("expiresAt", now)
    )
    .collect();
}

const MAX_ANSWERED_SUBSCRIPTION_ROWS = 200;

export async function listInteractionRequestsBySessionAndStatus(
  ctx: Ctx,
  sessionId: Id<"cliSessions">,
  status: Doc<"cliInteractionRequests">["status"]
): Promise<Doc<"cliInteractionRequests">[]> {
  // ponytail: newest 200 answered rows; the CLI router only needs answers for
  // currently parked requests, add an ack/cursor if sessions outgrow this.
  return ctx.db
    .query("cliInteractionRequests")
    .withIndex("by_session_and_status", (q) =>
      q.eq("sessionId", sessionId).eq("status", status)
    )
    .order("desc")
    .take(MAX_ANSWERED_SUBSCRIPTION_ROWS);
}

type InteractionRequestInsert = Omit<
  Doc<"cliInteractionRequests">,
  "_id" | "_creationTime"
>;

export async function insertInteractionRequest(
  ctx: MutationCtx,
  request: InteractionRequestInsert
): Promise<Id<"cliInteractionRequests">> {
  return ctx.db.insert("cliInteractionRequests", request);
}

export async function updateInteractionRequest(
  ctx: MutationCtx,
  requestId: Id<"cliInteractionRequests">,
  patch: Partial<
    Pick<
      Doc<"cliInteractionRequests">,
      "status" | "responseJson" | "answeredAt" | "cancelledReason" | "expiresAt"
    >
  >,
  now: number
): Promise<void> {
  await ctx.db.patch("cliInteractionRequests", requestId, {
    ...patch,
    updatedAt: now,
  });
}
