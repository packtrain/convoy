import { ConvexError } from "convex/values";

/**
 * The Convex client's own transport frame, prepended to every server-side
 * failure. Stable across deployments, unlike the message it wraps: production
 * redacts a plain `Error`'s text to "Server Error".
 */
const TRANSPORT_FRAME = "[CONVEX ";

/**
 * A caught error's user-facing message, with Convex's transport noise removed.
 *
 * A failed query rejects with the `[CONVEX Q(path)] ... Called by client`
 * stacktrace in `message`; a `ConvexError`'s clean text is in `data`. Mirrors
 * `getErrorMessage` in `apps/web/lib/errors.ts` — this package cannot import it.
 *
 * `cursor` is the caller's `--cursor`, if any. Convex raises an undeserializable
 * cursor as a plain `Error` from inside `.paginate()`, whose text production
 * redacts, so the cursor is named as the likely cause rather than matched on.
 */
export function toUserFacingError(error: unknown, cursor?: string): string {
  if (error instanceof ConvexError) {
    return typeof error.data === "string" ? error.data : error.message;
  }

  if (!(error instanceof Error)) {
    return String(error);
  }

  // Only a server-side failure carries the frame; anything we threw ourselves
  // (a missing thread, a bad --limit) already reads correctly.
  if (cursor !== undefined && error.message.includes(TRANSPORT_FRAME)) {
    return `${error.message}\nThis often means --cursor is no longer valid. Re-run without --cursor to start from the first page.`;
  }

  return error.message;
}
