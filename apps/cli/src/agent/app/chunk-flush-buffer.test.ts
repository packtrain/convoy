import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createChunkFlushBuffer,
  type StampedContentChunk,
} from "./chunk-flush-buffer.js";
import type { ChunkStreamPolicy, ContentChunk } from "../runtimes/contracts.js";
import { redactSecrets } from "../../lib/config/convex-client.js";
import { claudeCodeChunkStreamPolicy } from "../runtimes/claudeCode/streaming.js";
import { codexChunkStreamPolicy } from "../runtimes/codex/streaming.js";
import { cursorChunkStreamPolicy } from "../runtimes/cursor/streaming.js";
import { opencodeChunkStreamPolicy } from "../runtimes/opencode/streaming.js";

/** Merges consecutive chunks whose data shares the same first character. */
const testPolicy: ChunkStreamPolicy = {
  isDeferrable: (chunk) => chunk.type === "delta",
  coalesce: (prev, next) =>
    prev.type === "delta" &&
    next.type === "delta" &&
    prev.data[0] === next.data[0]
      ? { type: "delta", data: prev.data + next.data }
      : null,
  text: (chunk) => (chunk.type === "delta" ? chunk.data : null),
  withText: (chunk, text) => ({ ...chunk, data: text }),
};

/** Drops the agent-side stamps; only the timestamp tests assert on them. */
function strip(batches: StampedContentChunk[][]): ContentChunk[][] {
  return batches.map((batch) =>
    batch.map(({ type, data }) => ({ type, data }))
  );
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("chunk-flush-buffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("non-deferrable chunks flush immediately", async () => {
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "assistant", data: "whole" });
    await buffer.drain();

    expect(strip(sent)).toEqual([[{ type: "assistant", data: "whole" }]]);
  });

  test("deferrable chunks wait for the flush window and coalesce", async () => {
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      flushIntervalMs: 250,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "delta", data: "aaa" });
    buffer.enqueue({ type: "delta", data: "abb" });
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(250);
    expect(strip(sent)).toEqual([[{ type: "delta", data: "aaaabb" }]]);
  });

  test("non-mergeable deltas stay separate chunks in one batch", async () => {
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "delta", data: "aaa" });
    buffer.enqueue({ type: "delta", data: "bbb" });
    await vi.advanceTimersByTimeAsync(250);

    expect(strip(sent)).toEqual([
      [
        { type: "delta", data: "aaa" },
        { type: "delta", data: "bbb" },
      ],
    ]);
  });

  test("only one send is in flight; chunks buffer and batch behind it", async () => {
    const firstSend = deferred();
    const sent: StampedContentChunk[][] = [];
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: (chunks) => {
        sent.push(chunks);
        calls += 1;
        return calls === 1 ? firstSend.promise : Promise.resolve();
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    expect(sent).toHaveLength(1);

    // Arrives while the first send is in flight: buffered, not sent.
    buffer.enqueue({ type: "assistant", data: "second" });
    buffer.enqueue({ type: "assistant", data: "third" });
    expect(sent).toHaveLength(1);

    firstSend.resolve();
    await buffer.drain();

    expect(strip(sent)).toEqual([
      [{ type: "assistant", data: "first" }],
      [
        { type: "assistant", data: "second" },
        { type: "assistant", data: "third" },
      ],
    ]);
  });

  test("a large buffer flushes before the time window", async () => {
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      flushIntervalMs: 60_000,
      maxBufferBytes: 8,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "delta", data: "aaaa" });
    expect(sent).toHaveLength(0);
    buffer.enqueue({ type: "delta", data: "aaaaa" });
    expect(sent).toHaveLength(1);
  });

  test("oversized non-deferrable chunks are scrubbed before buffering (OS-1521)", async () => {
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({
      type: "user",
      data: JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_img",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: "a".repeat(300_000),
                  },
                },
              ],
            },
          ],
        },
      }),
    });
    await buffer.drain();

    const chunk = sent[0]![0]!;
    expect(chunk.data.length).toBeLessThanOrEqual(100_000);
    const parsed = JSON.parse(chunk.data) as {
      message: {
        content: Array<{
          tool_use_id: string;
          content: Array<{ source: { media_type: string; data: string } }>;
        }>;
      };
    };
    const source = parsed.message.content[0]!.content[0]!.source;
    expect(source.data).toBe("");
    expect(source.media_type).toBe("image/png");
    expect(parsed.message.content[0]!.tool_use_id).toBe("toolu_img");
  });

  test("oversized deferrable chunks pass through unscrubbed (server splits them)", async () => {
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    const oversizedDelta = JSON.stringify({ text: "d".repeat(200_000) });
    buffer.enqueue({ type: "delta", data: oversizedDelta });
    await buffer.drain();

    expect(sent[0]![0]!.data).toBe(oversizedDelta);
  });

  test("coalescing stops growing a chunk past the size cap while a send is stalled", async () => {
    const firstSend = deferred();
    const sent: StampedContentChunk[][] = [];
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: (chunks) => {
        sent.push(chunks);
        calls += 1;
        return calls === 1 ? firstSend.promise : Promise.resolve();
      },
    });

    // Urgent chunk starts a send that stays in flight.
    buffer.enqueue({ type: "assistant", data: "first" });
    expect(sent).toHaveLength(1);

    // 100KB of mergeable deltas stream in behind the stalled send (OS-1521).
    const piece = "a".repeat(1024);
    for (let i = 0; i < 100; i++) {
      buffer.enqueue({ type: "delta", data: piece });
    }

    firstSend.resolve();
    await buffer.drain();

    const buffered = sent.slice(1).flat();
    expect(buffered.length).toBeGreaterThan(1);
    for (const chunk of buffered) {
      expect(chunk.data.length).toBeLessThanOrEqual(33 * 1024);
    }
    expect(buffered.map((chunk) => chunk.data).join("")).toBe(
      piece.repeat(100)
    );
  });

  test("caps a batch at 256 chunks and sends the remainder next (OS-1761)", async () => {
    const firstSend = deferred();
    const sent: StampedContentChunk[][] = [];
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: (chunks) => {
        sent.push(chunks);
        calls += 1;
        return calls === 1 ? firstSend.promise : Promise.resolve();
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    for (let i = 0; i < 600; i++) {
      buffer.enqueue({ type: "assistant", data: `chunk-${i}` });
    }

    firstSend.resolve();
    // No timer advance: a capped flush leaves the remainder urgent, so the
    // follow-up sends must not wait for the flush window.
    await vi.advanceTimersByTimeAsync(0);

    expect(sent.map((batch) => batch.length)).toEqual([1, 256, 256, 88]);
    await buffer.drain();
  });

  test("caps a batch at 1 MiB of chunk data (OS-1761)", async () => {
    const firstSend = deferred();
    const sent: StampedContentChunk[][] = [];
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: (chunks) => {
        sent.push(chunks);
        calls += 1;
        return calls === 1 ? firstSend.promise : Promise.resolve();
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    // 40 × 32KB = 1.25 MiB behind the stalled send.
    for (let i = 0; i < 40; i++) {
      buffer.enqueue({ type: "assistant", data: "a".repeat(32 * 1024) });
    }

    firstSend.resolve();
    await buffer.drain();

    for (const batch of sent) {
      const bytes = batch.reduce((sum, chunk) => sum + chunk.data.length, 0);
      expect(bytes).toBeLessThanOrEqual(1024 * 1024);
    }
    expect(sent.slice(1).flat()).toHaveLength(40);
  });

  test("an over-budget chunk goes out alone instead of stalling the drain", async () => {
    const firstSend = deferred();
    const sent: StampedContentChunk[][] = [];
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: (chunks) => {
        sent.push(chunks);
        calls += 1;
        return calls === 1 ? firstSend.promise : Promise.resolve();
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    // Deferrable chunks skip the scrub, so one can exceed the batch byte cap.
    const huge = JSON.stringify({ text: "d".repeat(2 * 1024 * 1024) });
    buffer.enqueue({ type: "delta", data: huge });
    buffer.enqueue({ type: "delta", data: "zzz" });

    firstSend.resolve();
    await buffer.drain();

    expect(strip(sent.slice(1))).toEqual([
      [{ type: "delta", data: huge }],
      [{ type: "delta", data: "zzz" }],
    ]);
  });

  test("a send that keeps failing surfaces via failure and drain rejects", async () => {
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async () => {
        calls += 1;
        throw new Error("network down");
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    await vi.advanceTimersByTimeAsync(0);
    expect(buffer.failure).toBeNull();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(calls).toBe(5);
    expect(buffer.failure?.message).toBe("network down");
    buffer.enqueue({ type: "assistant", data: "ignored after failure" });
    await expect(buffer.drain()).rejects.toThrow("network down");
  });

  test("a batch that fails on a Convex stall is resent, in order", async () => {
    const sent: StampedContentChunk[][] = [];
    let stalls = 2;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async (chunks) => {
        if (stalls-- > 0) {
          throw new Error("Your request timed out performing too many system operations.");
        }
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    await vi.advanceTimersByTimeAsync(0);
    buffer.enqueue({ type: "assistant", data: "second" });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(buffer.failure).toBeNull();
    await buffer.drain();
    expect(strip(sent)).toEqual([
      [{ type: "assistant", data: "first" }],
      [{ type: "assistant", data: "second" }],
    ]);
  });

  test("an app error fails the stream without a resend", async () => {
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async () => {
        calls += 1;
        throw new ConvexError("Message not claimed by this session");
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    await vi.advanceTimersByTimeAsync(0);

    expect(buffer.failure?.message).toContain("Message not claimed by this session");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
  });

  test("stop during a resend wait prevents the resend", async () => {
    let calls = 0;
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: async () => {
        calls += 1;
        throw new Error("network down");
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    await vi.advanceTimersByTimeAsync(0);
    buffer.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(calls).toBe(1);
  });

  test("stop discards buffered chunks and prevents further sends", async () => {
    const firstSend = deferred();
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      send: (chunks) => {
        sent.push(chunks);
        return firstSend.promise;
      },
    });

    buffer.enqueue({ type: "assistant", data: "first" });
    buffer.enqueue({ type: "assistant", data: "buffered" });
    buffer.stop();

    firstSend.resolve();
    await buffer.drain();
    await vi.advanceTimersByTimeAsync(1_000);

    buffer.enqueue({ type: "assistant", data: "after stop" });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(strip(sent)).toEqual([[{ type: "assistant", data: "first" }]]);
  });

  test("stamps each chunk with its arrival time, not the flush time", async () => {
    vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      flushIntervalMs: 250,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "delta", data: "aaa" });
    await vi.advanceTimersByTimeAsync(100);
    buffer.enqueue({ type: "delta", data: "bbb" });
    await vi.advanceTimersByTimeAsync(150);

    expect(sent).toHaveLength(1);
    expect(sent[0].map((chunk) => chunk.timestamp)).toEqual([
      Date.parse("2026-07-25T12:00:00.000Z"),
      Date.parse("2026-07-25T12:00:00.100Z"),
    ]);
  });

  test("a coalesced run keeps the timestamp of its first chunk", async () => {
    vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: testPolicy,
      flushIntervalMs: 250,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "delta", data: "aaa" });
    await vi.advanceTimersByTimeAsync(100);
    buffer.enqueue({ type: "delta", data: "abb" });
    await vi.advanceTimersByTimeAsync(150);

    expect(sent).toEqual([
      [
        {
          type: "delta",
          data: "aaaabb",
          timestamp: Date.parse("2026-07-25T12:00:00.000Z"),
        },
      ],
    ]);
  });

  test("works without a policy: every chunk is urgent", async () => {
    const sent: StampedContentChunk[][] = [];
    const buffer = createChunkFlushBuffer({
      policy: null,
      send: async (chunks) => {
        sent.push(chunks);
      },
    });

    buffer.enqueue({ type: "delta", data: "a" });
    await buffer.drain();
    expect(strip(sent)).toEqual([[{ type: "delta", data: "a" }]]);
  });

  describe("secret hold-back (OS-2109)", () => {
    // Uppercase only, so no fragment can occur in the lowercase test text. Self-overlapping on purpose.
    const secret = "XQZVWJXQZVWJ";

    function collect(policy: ChunkStreamPolicy) {
      const sent: StampedContentChunk[][] = [];
      const buffer = createChunkFlushBuffer({
        policy,
        secrets: [secret],
        // The Convex client redacts each batch; see convex-client.ts.
        send: async (chunks) => {
          sent.push(redactSecrets(chunks, [secret]));
        },
      });
      const uploaded = () => sent.flat();
      const texts = (from = policy) => uploaded().map((chunk) => from.text(chunk)).filter((text) => text !== null);
      return { sent, buffer, uploaded, texts };
    }

    const claude = (text: string, parent: string | null = null, delta: Record<string, unknown> = { type: "text_delta", text }): ContentChunk => ({
      type: "stream_event",
      data: JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta }, parent_tool_use_id: parent, session_id: "s" }),
    });
    const codex = (text: string): ContentChunk => ({
      type: "item/agentMessage/delta",
      data: JSON.stringify({ threadId: "t", turnId: "u", itemId: "i", delta: text }),
    });
    const opencode = (text: string): ContentChunk => ({
      type: "text.delta",
      data: JSON.stringify({ sessionID: "s", partID: "p", text }),
    });

    const shapes: Array<[string, ChunkStreamPolicy, (text: string) => ContentChunk]> = [
      ["claude-code", claudeCodeChunkStreamPolicy, (text) => claude(text)],
      ["claude-code tool input", claudeCodeChunkStreamPolicy, (text) => claude(text, null, { type: "input_json_delta", partial_json: text })],
      ["codex", codexChunkStreamPolicy, codex],
      ["codex child", codexChunkStreamPolicy, (text) => ({
        type: "convoy/child",
        data: JSON.stringify({ method: "item/agentMessage/delta", source: { threadId: "c" }, params: { threadId: "t", turnId: "u", itemId: "i", delta: text } }),
      })],
      ["opencode", opencodeChunkStreamPolicy, opencode],
      ["cursor assistant", cursorChunkStreamPolicy, (text) => ({
        type: "assistant",
        data: JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }),
      })],
      ["cursor thinking", cursorChunkStreamPolicy, (text) => ({
        type: "thinking",
        data: JSON.stringify({ type: "thinking", subtype: "delta", text }),
      })],
    ];

    test.each(shapes)("a %s secret split at any offset across flush windows is never uploaded", async (_name, policy, delta) => {
      for (let offset = 1; offset <= secret.length; offset += 1) {
        const { buffer, uploaded, texts } = collect(policy);
        buffer.enqueue(delta(`key ${secret.slice(0, offset)}`));
        await vi.advanceTimersByTimeAsync(250);
        buffer.enqueue(delta(`${secret.slice(offset)} done`));
        await vi.advanceTimersByTimeAsync(250);
        await buffer.drain();

        expect(uploaded().map((chunk) => chunk.data).join("")).not.toMatch(/[XQZVWJ]/);
        expect(texts().join("")).toBe("key [redacted] done");
      }
    });

    test("ordinary text is not held", async () => {
      const { buffer, texts } = collect(opencodeChunkStreamPolicy);
      buffer.enqueue(opencode("abc"));
      await vi.advanceTimersByTimeAsync(250);
      expect(texts()).toEqual(["abc"]);
    });

    test("only the suspect ending is held, so a failed run keeps the safe text", async () => {
      const { buffer, texts } = collect(opencodeChunkStreamPolicy);
      buffer.enqueue(opencode(`${"a".repeat(19_000)}X`));
      await vi.advanceTimersByTimeAsync(250);
      buffer.stop();
      expect(texts()).toEqual(["a".repeat(19_000)]);
    });

    test("repeated suspect endings never grow a chunk past the coalescing cap", async () => {
      const { buffer, uploaded, texts } = collect(opencodeChunkStreamPolicy);
      for (let i = 0; i < 150; i += 1) buffer.enqueue(opencode(`${"a".repeat(999)}X`));
      expect(uploaded().length).toBeGreaterThan(0);
      buffer.enqueue(opencode(" done"));
      await buffer.drain();
      expect(Math.max(...uploaded().map((chunk) => chunk.data.length))).toBeLessThan(40 * 1024);
      expect(texts().join("")).toBe(`${`${"a".repeat(999)}X`.repeat(150)} done`);
    });

    test("a held ending goes out before the next chunk of its own stream", async () => {
      const { buffer, uploaded } = collect(claudeCodeChunkStreamPolicy);
      buffer.enqueue(claude("key XQ"));
      await vi.advanceTimersByTimeAsync(250);
      buffer.enqueue({ type: "stream_event", data: JSON.stringify({ type: "stream_event", event: { type: "content_block_stop", index: 0 }, parent_tool_use_id: null, session_id: "s" }) });
      await buffer.drain();
      expect(uploaded().map((chunk) => claudeCodeChunkStreamPolicy.text(chunk) ?? (JSON.parse(chunk.data) as { event: { type: string } }).event.type))
        .toEqual(["key ", "XQ", "content_block_stop"]);
    });

    test("a Claude subagent's chunks between the halves don't release the held ending", async () => {
      const { buffer, uploaded, texts } = collect(claudeCodeChunkStreamPolicy);
      buffer.enqueue(claude("key XQZ"));
      await vi.advanceTimersByTimeAsync(250);
      buffer.enqueue(claude("sub", "toolu_1"));
      buffer.enqueue({ type: "assistant", data: JSON.stringify({ type: "assistant", parent_tool_use_id: "toolu_1", message: { content: [] } }) });
      await vi.advanceTimersByTimeAsync(250);
      buffer.enqueue(claude("VWJXQZVWJ done"));
      await buffer.drain();
      expect(uploaded().map((chunk) => chunk.data).join("")).not.toMatch(/[XQZVWJ]/);
      expect(texts().join("")).toBe("key sub[redacted] done");
    });

    test("Codex child events between the halves don't release the parent's held ending", async () => {
      const { buffer, uploaded } = collect(codexChunkStreamPolicy);
      buffer.enqueue(codex("key XQZ"));
      await vi.advanceTimersByTimeAsync(250);
      buffer.enqueue({ type: "convoy/child", data: JSON.stringify({ method: "item/started", source: { threadId: "c" }, params: { item: {} } }) });
      await vi.advanceTimersByTimeAsync(250);
      buffer.enqueue(codex("VWJXQZVWJ done"));
      await buffer.drain();
      expect(uploaded().map((chunk) => chunk.data).join("")).not.toMatch(/[XQZVWJ]/);
    });

    test("drain releases a held ending", async () => {
      const { buffer, texts } = collect(opencodeChunkStreamPolicy);
      buffer.enqueue(opencode("key XQ"));
      await buffer.drain();
      expect(texts().join("")).toBe("key XQ");
    });

    test("a held ending after a capped chunk still joins the rest of the secret", async () => {
      const { buffer, texts } = collect(opencodeChunkStreamPolicy);
      buffer.enqueue(opencode(`${"a".repeat(32 * 1024)}XQZ`));
      buffer.enqueue(opencode("VWJXQZVWJ"));
      await buffer.drain();
      expect(texts().join("")).toBe(`${"a".repeat(32 * 1024)}[redacted]`);
    });
  });
});
