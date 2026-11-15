import type { ChunkStreamPolicy, ContentChunk } from "../runtimes/contracts.js";
import { scrubOversizedChunk } from "./chunk-scrub.js";
import { redactAuth } from "../../lib/config/convex-client.js";

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024;

/**
 * Stop coalescing into a chunk once it reaches this size and start a new one.
 * While a send is stalled (network hiccup, Convex reconnect) deltas keep
 * merging into the buffered tail; without a cap one chunk can outgrow the
 * server's per-row storage budget and kill the stream (OS-1521).
 */
const MAX_COALESCED_CHUNK_BYTES = 32 * 1024;

/**
 * Per-send batch caps. The server inserts one row per chunk in one transaction,
 * so an unbounded batch exceeds Convex's system-op and data-written limits and
 * the append can never commit (OS-1761).
 */
const MAX_BATCH_CHUNKS = 256;
const MAX_BATCH_BYTES = 1024 * 1024;

/**
 * A chunk stamped with its agent-side emit time. The server would otherwise
 * date every chunk in a batch by its own append time, which collapses the span
 * of any tool call that resolves inside one flush window.
 */
export type StampedContentChunk = ContentChunk & { timestamp: number };

export interface ChunkFlushBufferOptions {
  /** Sends one batch upstream. Called with at least one chunk, never concurrently. */
  send: (chunks: StampedContentChunk[]) => Promise<void>;
  /** Runtime coalescing/deferral policy; null = flush every chunk immediately. */
  policy: ChunkStreamPolicy | null;
  /** Provider tokens the client redacts; a delta ending in the start of one holds that ending back. */
  secrets?: readonly string[];
  flushIntervalMs?: number;
  maxBufferBytes?: number;
}

export interface ChunkFlushBuffer {
  enqueue(chunk: ContentChunk): void;
  /** First send error, if any. Checked by the producer loop to abort early. */
  readonly failure: Error | null;
  /** Flush remaining chunks and wait for all sends. Rejects on send failure. */
  drain(): Promise<void>;
  /**
   * Discard buffered chunks and prevent any further sends. Called on the
   * error path so a stray flush cannot land after the fail mutation.
   */
  stop(): void;
}

/**
 * Outgoing transport buffer implementing the OS-991 delta protocol:
 * one in-flight send per message, buffering while in flight, batched sends,
 * coalescing of consecutive deltas, immediate flush for non-deferrable chunks.
 */
export function createChunkFlushBuffer(
  options: ChunkFlushBufferOptions
): ChunkFlushBuffer {
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const policy = options.policy;
  const secrets = options.secrets ?? [];
  const longestSecret = Math.max(0, ...secrets.map((secret) => secret.length));

  const buffered: StampedContentChunk[] = [];
  let bufferedBytes = 0;
  let hasUrgentChunk = false;
  let lastFlushAt = Date.now();
  let inFlight: Promise<void> | null = null;
  let flushTimer: NodeJS.Timeout | null = null;
  let failure: Error | null = null;
  let stopped = false;
  /** Per stream, a text delta's ending that could start a secret, waiting for the rest (OS-2109). */
  const held = new Map<string, StampedContentChunk>();

  /** Length of the longest ending of `text` that a secret starts with. */
  function suspectLength(text: string): number {
    for (let length = Math.min(longestSecret - 1, text.length); length > 0; length -= 1) {
      const ending = text.slice(-length);
      if (secrets.some((secret) => secret.startsWith(ending))) return length;
    }
    return 0;
  }

  /**
   * Chunks to buffer for `chunk`. A delta joins its stream's held ending; any other chunk
   * from that stream releases the ending first. A new suspect ending is split off and held.
   */
  function holdBack(chunk: StampedContentChunk): StampedContentChunk[] {
    if (!policy || secrets.length === 0) return [chunk];
    const stream = policy.stream?.(chunk) ?? "";
    const pending = held.get(stream);
    held.delete(stream);
    const joined = pending && policy.isDeferrable(chunk) ? policy.coalesce(pending, chunk) : null;
    const released = pending && !joined ? [pending] : [];
    const current = joined && pending ? { ...joined, timestamp: pending.timestamp } : chunk;
    const text = policy.isDeferrable(current) ? policy.text(current) : null;
    if (text === null) return [...released, current];

    // Redact first, so a self-overlapping secret can't be split into the safe part and the ending.
    const redacted = secrets.reduce((value, secret) => redactAuth(value, secret), text);
    const length = suspectLength(redacted);
    const piece = (part: string) => ({ ...policy.withText(current, part), timestamp: current.timestamp });
    if (length === 0) return [...released, redacted === text ? current : piece(redacted)];
    held.set(stream, piece(redacted.slice(-length)));
    return length < redacted.length ? [...released, piece(redacted.slice(0, -length))] : released;
  }

  function clearFlushTimer(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function shouldFlushNow(): boolean {
    if (buffered.length === 0) {
      return false;
    }
    return (
      hasUrgentChunk ||
      bufferedBytes >= maxBufferBytes ||
      Date.now() - lastFlushAt >= flushIntervalMs
    );
  }

  /** Chunks up to the batch caps; always at least one, however large it is. */
  function takeBatch(): StampedContentChunk[] {
    let count = 0;
    let bytes = 0;
    while (count < buffered.length && count < MAX_BATCH_CHUNKS) {
      const size = buffered[count]!.data.length;
      if (count > 0 && bytes + size > MAX_BATCH_BYTES) {
        break;
      }
      bytes += size;
      count += 1;
    }
    return buffered.splice(0, count);
  }

  function startFlush(): void {
    clearFlushTimer();
    const chunks = takeBatch();
    bufferedBytes -= chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    // A capped batch leaves a remainder: keep it urgent so the tail goes out on
    // the next cycle instead of waiting a flush window.
    hasUrgentChunk = buffered.length > 0;
    lastFlushAt = Date.now();

    inFlight = options
      .send(chunks)
      .catch((error) => {
        failure ??= error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        inFlight = null;
        maybeFlush();
      });
  }

  function maybeFlush(): void {
    if (stopped || inFlight || failure || buffered.length === 0) {
      return;
    }

    if (shouldFlushNow()) {
      startFlush();
      return;
    }

    if (!flushTimer) {
      const delay = Math.max(1, flushIntervalMs - (Date.now() - lastFlushAt));
      flushTimer = setTimeout(() => {
        flushTimer = null;
        maybeFlush();
      }, delay);
      flushTimer.unref?.();
    }
  }

  function push(chunk: StampedContentChunk): void {
    const deferrable = policy?.isDeferrable(chunk) ?? false;
    const tail = buffered[buffered.length - 1];
    const merged =
      deferrable && tail && policy && tail.data.length < MAX_COALESCED_CHUNK_BYTES
        ? policy.coalesce(tail, chunk)
        : null;

    if (merged && tail) {
      bufferedBytes += merged.data.length - tail.data.length;
      // A coalesced run keeps the timestamp of the chunk that started it.
      buffered[buffered.length - 1] = { ...merged, timestamp: tail.timestamp };
    } else {
      buffered.push(chunk);
      bufferedBytes += chunk.data.length;
    }

    if (!deferrable) {
      hasUrgentChunk = true;
    }
  }

  return {
    enqueue(chunk: ContentChunk): void {
      if (stopped || failure) {
        return;
      }

      const deferrable = policy?.isDeferrable(chunk) ?? false;
      // Deferrable delta chunks are exempt from scrubbing: coalescing caps them below the
      // budget, and Claude Code — the one runtime whose deltas can exceed it — has a
      // server-side splitter that recovers the text losslessly where a scrub would clamp it
      // (OS-1521). Other runtimes' deltas are token-sized, and the server's backstop covers
      // stragglers.
      const incoming = deferrable ? chunk : scrubOversizedChunk(chunk);
      // Stamped on arrival, not on flush: enqueue runs as the runtime yields.
      const stamped: StampedContentChunk = { ...incoming, timestamp: Date.now() };
      holdBack(stamped).forEach(push);
      maybeFlush();
    },

    get failure(): Error | null {
      return failure;
    },

    async drain(): Promise<void> {
      if (!stopped && !failure) held.forEach(push);
      held.clear();
      while (inFlight || (buffered.length > 0 && !failure && !stopped)) {
        if (inFlight) {
          await inFlight;
        } else {
          startFlush();
        }
      }

      clearFlushTimer();

      if (failure) {
        throw failure;
      }
    },

    stop(): void {
      stopped = true;
      buffered.length = 0;
      held.clear();
      bufferedBytes = 0;
      hasUrgentChunk = false;
      clearFlushTimer();
    },
  };
}
