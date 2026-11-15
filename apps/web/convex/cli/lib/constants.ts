import { MAX_ATTACHMENT_SIZE, MAX_ATTACHMENT_SIZE_MB } from "../../lib/constants";

/**
 * Shared constants for CLI endpoints and sessions.
 */

// Session is considered online if heartbeat within this threshold
export const ONLINE_THRESHOLD_MS = 60 * 1000; // 60 seconds

// Session is visible in list if heartbeat within this threshold
export const VISIBLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Frequency for chat streaming watchdog checks
export const STREAM_WATCHDOG_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// Shared disconnect reasons for interrupted streaming recovery paths
export const STREAM_DISCONNECT_REASON =
  "CLI disconnected during response generation";
export const STREAM_SESSION_REPLACED_REASON =
  "CLI session replaced by a new connection";
export const STREAM_CLAIM_LEASE_EXPIRED_REASON =
  "CLI claim lease expired during response generation";
export const STREAM_CLAIM_RELEASED_REASON =
  "CLI claim released before response completion";
export const STREAM_CANCELLED_BY_USER_REASON = "Response stopped by user";
export const STREAM_THREAD_DELETED_REASON =
  "CLI thread deleted during response generation";
export const STREAM_PROFILE_DELETED_REASON =
  "CLI profile deleted";

/**
 * How many message envelopes a thread view loads. Threads have no length ceiling and
 * `listEnvelopesByThread` stays subscribed while the view is open, so an unbounded
 * read there is re-paid on every message write in the thread (OS-1600).
 *
 * The whole window is one subscription read set, so any write to a message in it
 * re-reads all of them — the window size is a direct multiplier (OS-1719). A
 * steady-state flush no longer writes a message doc (OS-1729), so raising it back
 * now waits on re-measured read volume rather than on that fix. 50 still
 * exceeds what the client's render budget reveals without ~10 "Show more" clicks.
 */
export const ENVELOPE_WINDOW_LIMIT = 50;

/** Largest blob a `downloadFile` op may complete with (OS-2050); the CLI checks before reading. Same as the attachment cap. */
export const MAX_DOWNLOAD_FILE_MB = MAX_ATTACHMENT_SIZE_MB;
export const MAX_DOWNLOAD_FILE_BYTES = MAX_ATTACHMENT_SIZE;
/** Cap on `revertWorkingTree`'s file list (OS-2234). */
export const MAX_REVERT_ALL_FILES = 2000;

/** Unsent composer uploads older than this are swept (OS-2141). Matches the web draft TTL. */
export const PENDING_UPLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PENDING_UPLOAD_SWEEP_BATCH = 200;
