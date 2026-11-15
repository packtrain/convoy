import { expect, test, describe } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

function textChunk(text: string, createdAt?: number) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    }),
    createdAt,
  };
}

function resultChunk(createdAt?: number) {
  return {
    type: "result",
    data: JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "session-1",
      total_cost_usd: 0.05,
      duration_ms: 3000,
      usage: { input_tokens: 100, output_tokens: 200 },
      modelUsage: {
        "claude-opus-4-6": {
          inputTokens: 100,
          outputTokens: 200,
        },
      },
    }),
    createdAt,
  };
}

describe("cliMessageChunks", () => {
  describe("listWindowByThread", () => {
    test("loads ten complete messages on open and in each older window", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);

      // 22 single-chunk messages: a 2-chunk batch must keep fetching until
      // the initial and next older windows each cover 10 complete messages.
      const messages = [];
      for (let index = 0; index < 22; index++) {
        const message = await ctx.cliMessage(thread._id, profile._id, {
          role: "assistant",
          content: [],
          status: "completed",
        });
        await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
          textChunk(`message-${index + 1}`, 1000 * (index + 1)),
        ]);
        messages.push(message);
      }

      const result = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        limit: 2,
      });

      expect(result.page).toHaveLength(10);
      expect(new Set(result.page.map((row) => row.messageId)).size).toBe(10);
      expect(result.hasMore).toBe(true);
      expect(result.nextOlderCursor?.messageId).toBe(messages[12]!._id);

      const olderPage = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        before: result.nextOlderCursor ?? undefined,
        limit: 2,
      });

      expect(olderPage.page).toHaveLength(10);
      expect(new Set(olderPage.page.map((row) => row.messageId)).size).toBe(10);
      expect(olderPage.hasMore).toBe(true);
      expect(olderPage.nextOlderCursor?.messageId).toBe(messages[2]!._id);

      const oldestPage = await asUser.query(
        api.cli.messageChunks.listWindowByThread,
        {
          threadId: thread._id,
          before: olderPage.nextOlderCursor ?? undefined,
          limit: 2,
        }
      );

      expect(oldestPage.page).toHaveLength(2);
      expect(oldestPage.page.map((row) => row.messageId)).toEqual([
        messages[1]!._id,
        messages[0]!._id,
      ]);
      expect(oldestPage.hasMore).toBe(false);
      expect(oldestPage.nextOlderCursor).toBeNull();
    });

    test("covers a chunk-heavy message plus its older neighbors in one page", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);

      // 5 small older messages, then a 60-chunk run (codex shape). The old
      // fixed-50 window covered only part of the newest run.
      for (let index = 0; index < 5; index++) {
        const message = await ctx.cliMessage(thread._id, profile._id, {
          role: "assistant",
          content: [],
          status: "completed",
        });
        await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
          textChunk(`old-${index}-a`, 1000 + index * 10),
          textChunk(`old-${index}-b`, 1001 + index * 10),
        ]);
      }
      const heavyMessage = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });
      await ctx.cliMessageChunks(heavyMessage._id, thread._id, profile._id, Array.from(
        { length: 60 },
        (_, index) => textChunk(`heavy-${index + 1}`, 2000 + index)
      ));

      const result = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        limit: 50,
      });

      expect(result.page).toHaveLength(70);
      expect(result.hasMore).toBe(false);
      expect(result.nextOlderCursor).toBeNull();
    });

    test("cuts the page at a message boundary instead of splitting an older message", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);

      // Oldest → newest: 9×20-chunk, 5×12-chunk, then a 60-chunk run. The
      // page must stop at a boundary, never returning a partial message.
      const chunkCounts = new Map<string, number>();
      let createdAt = 1000;
      const addMessage = async (chunkCount: number, label: string) => {
        const message = await ctx.cliMessage(thread._id, profile._id, {
          role: "assistant",
          content: [],
          status: "completed",
        });
        await ctx.cliMessageChunks(message._id, thread._id, profile._id, Array.from(
          { length: chunkCount },
          (_, index) => textChunk(`${label}-${index + 1}`, createdAt + index)
        ));
        createdAt += chunkCount;
        chunkCounts.set(message._id, chunkCount);
        return message;
      };
      for (let index = 0; index < 9; index++) {
        await addMessage(20, `deep-${index}`);
      }
      for (let index = 0; index < 5; index++) {
        await addMessage(12, `mid-${index}`);
      }
      await addMessage(60, "heavy");

      const result = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        limit: 50,
      });

      const loadedPerMessage = new Map<string, number>();
      for (const row of result.page) {
        loadedPerMessage.set(row.messageId, (loadedPerMessage.get(row.messageId) ?? 0) + 1);
      }
      for (const [messageId, loaded] of loadedPerMessage) {
        expect(loaded).toBe(chunkCounts.get(messageId));
      }
      expect(loadedPerMessage.size).toBeGreaterThanOrEqual(10);
      expect(result.hasMore).toBe(true);
      expect(result.nextOlderCursor).not.toBeNull();

      // Paging on from the boundary eventually loads every remaining chunk
      // exactly once.
      let cursor = result.nextOlderCursor;
      const seen = new Set(result.page.map((row) => `${row.messageId}:${row.chunkOrder}`));
      while (cursor) {
        const older = await asUser.query(api.cli.messageChunks.listWindowByThread, {
          threadId: thread._id,
          before: cursor,
          limit: 50,
        });
        for (const row of older.page) {
          seen.add(`${row.messageId}:${row.chunkOrder}`);
        }
        cursor = older.hasMore ? older.nextOlderCursor : null;
      }
      const totalChunks = [...chunkCounts.values()].reduce((sum, count) => sum + count, 0);
      expect(seen.size).toBe(totalChunks);
    });

    test("keeps a mid-page interleaved message partial until the next older page (documented limitation)", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);

      // Message M streams across a long createdAt range (order 0 at t=1000,
      // order 1 at t=3000) while ten 2-chunk messages complete in between —
      // so M's rows interleave with theirs in the composite scan order.
      const interleaved = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });
      await ctx.cliMessageChunks(interleaved._id, thread._id, profile._id, [
        textChunk("m-old", 1000),
        textChunk("m-new", 3000),
      ]);
      for (let index = 0; index < 10; index++) {
        const message = await ctx.cliMessage(thread._id, profile._id, {
          role: "assistant",
          content: [],
          status: "completed",
        });
        await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
          textChunk(`mid-${index}-a`, 1100 + index * 100),
          textChunk(`mid-${index}-b`, 1101 + index * 100),
        ]);
      }

      // limit 21 makes the first batch end exactly between M's two rows:
      // the page holds M's newest row plus the ten complete messages, and
      // the loop breaks on the complete-message target with M still open.
      const result = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        limit: 21,
      });

      const interleavedOrders = result.page
        .filter((row) => row.messageId === interleaved._id)
        .map((row) => row.chunkOrder);
      expect(interleavedOrders).toEqual([1]);
      expect(result.hasMore).toBe(true);

      // The partial message heals on the next older page.
      const olderPage = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        before: result.nextOlderCursor ?? undefined,
        limit: 21,
      });
      expect(
        olderPage.page
          .filter((row) => row.messageId === interleaved._id)
          .map((row) => row.chunkOrder)
      ).toEqual([0]);
    });

    test("derives the fetch count from the chunk budget so a large limit stays a single fetch", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);

      for (let index = 0; index < 5; index++) {
        const message = await ctx.cliMessage(thread._id, profile._id, {
          role: "assistant",
          content: [],
          status: "completed",
        });
        await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
          textChunk(`old-${index}`, 100 + index),
        ]);
      }
      const heavyMessage = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });
      await ctx.cliMessageChunks(heavyMessage._id, thread._id, profile._id, Array.from(
        { length: 450 },
        (_, index) => textChunk(`heavy-${index + 1}`, 1000 + index)
      ));

      // limit 400 → floor(400-chunk budget / 400) = 1 fetch: the page stops
      // inside the heavy message instead of iterating up to 8 batches.
      const result = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        limit: 400,
      });

      expect(result.page).toHaveLength(400);
      expect(
        result.page.every((row) => row.messageId === heavyMessage._id)
      ).toBe(true);
      expect(result.hasMore).toBe(true);
    });

    test("splits a single message larger than the whole fetch budget", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "streaming",
      });

      // limit 2 × max 8 fetches = 16-chunk budget; the message has 20.
      await ctx.cliMessageChunks(message._id, thread._id, profile._id, Array.from(
        { length: 20 },
        (_, index) => textChunk(`chunk-${index + 1}`, 1000 + index)
      ));

      const result = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        limit: 2,
      });

      expect(result.page).toHaveLength(16);
      expect(result.page[0]?.chunkOrder).toBe(19);
      expect(result.hasMore).toBe(true);
      expect(result.nextOlderCursor?.chunkOrder).toBe(4);

      const olderPage = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        before: result.nextOlderCursor ?? undefined,
        limit: 2,
      });

      expect(olderPage.page).toHaveLength(4);
      expect(olderPage.hasMore).toBe(false);
    });

    test("returns the next older page when before cursor is provided", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "streaming",
      });

      const chunks = await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
        textChunk("first", 1000),
        textChunk("second", 2000),
        textChunk("third", 3000),
      ]);

      const result = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        before: {
          createdAt: chunks[1]!.createdAt,
          messageId: chunks[1]!.messageId,
          chunkOrder: chunks[1]!.chunkOrder,
        },
        limit: 2,
      });

      expect(result.page).toHaveLength(1);
      expect(result.page[0]?.chunkOrder).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextOlderCursor).toBeNull();
    });

    test("covers overlapping createdAt buckets without duplicating or dropping rows", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);

      const oldestMessage = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });
      const middleMessage = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });
      const latestMessage = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });

      await ctx.cliMessageChunks(oldestMessage._id, thread._id, profile._id, Array.from(
        { length: 40 },
        (_, index) => textChunk(`oldest-${index + 1}`, 70 + index)
      ));
      await ctx.cliMessageChunks(middleMessage._id, thread._id, profile._id, [
        textChunk("middle", 90),
      ]);
      const latestChunks = await ctx.cliMessageChunks(
        latestMessage._id,
        thread._id,
        profile._id,
        Array.from(
          { length: 79 },
          (_, index) => textChunk(`latest-${index + 1}`, 100 + index)
        )
      );

      const initial = await asUser.query(api.cli.messageChunks.listWindowByThread, {
        threadId: thread._id,
        limit: 50,
      });

      // The three messages (40 + 1 + 79 chunks) interleave in createdAt
      // order; the message-aligned window keeps extending until all three
      // are complete, which here covers the whole thread.
      expect(initial.page).toHaveLength(120);
      expect(initial.hasMore).toBe(false);
      expect(initial.nextOlderCursor).toBeNull();
      const uniqueRows = new Set(
        initial.page.map((row) => `${row.messageId}:${row.chunkOrder}`)
      );
      expect(uniqueRows.size).toBe(120);
      expect(
        initial.page.filter((row) => row.messageId === latestMessage._id)
      ).toHaveLength(latestChunks.length);
    });

    test("re-normalizes legacy metadata chunks from raw stored data", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });

      const [chunk] = await ctx.cliMessageChunks(
        message._id,
        thread._id,
        profile._id,
        [resultChunk(1000)]
      );

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessageChunks", chunk._id, {
          normalizedEvent: {
            kind: "metadata",
            sessionId: "session-1",
            otherJson: JSON.stringify({
              subtype: "success",
              totalCostUsd: 0.05,
              durationMs: 3000,
              usage: { input_tokens: 100, output_tokens: 200 },
            }),
          },
        });
      });

      const result = await asUser.query(
        api.cli.messageChunks.listWindowByThread,
        { threadId: thread._id }
      );

      expect(result.page).toHaveLength(1);
      expect(result.page[0].event).toEqual({
        kind: "metadata",
        sessionId: "session-1",
        otherJson: JSON.stringify({
          resultSubtype: "success",
          totalCostUsd: 0.05,
          durationMs: 3000,
          usage: { input_tokens: 100, output_tokens: 200 },
          modelUsage: {
            "claude-opus-4-6": {
              inputTokens: 100,
              outputTokens: 200,
            },
          },
        }),
      });
    });

    test("re-normalizes legacy unknown events on read and backfills rawData", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "completed",
      });

      const [chunk] = await ctx.cliMessageChunks(
        message._id,
        thread._id,
        profile._id,
        [
          {
            type: "assistant",
            data: JSON.stringify({
              type: "assistant",
              message: {
                role: "assistant",
                content: [{ type: "unknown_block", value: "???" }],
              },
            }),
            createdAt: 1000,
          },
        ]
      );

      await t.run(async (runCtx) => {
        await runCtx.db.patch("cliMessageChunks", chunk._id, {
          normalizedEvent: {
            kind: "unknown",
            reason: "legacy-unknown",
            rawType: "assistant",
          },
        });
      });

      const result = await asUser.query(
        api.cli.messageChunks.listWindowByThread,
        { threadId: thread._id }
      );

      expect(result.page).toHaveLength(1);
      // Stored unknown events are re-normalized on read, so the reason
      // reflects the current normalizer rather than the stored value.
      expect(result.page[0].event).toEqual({
        kind: "unknown",
        reason: "no-recognized-content-blocks",
        rawType: "assistant",
        rawData: JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "unknown_block", value: "???" }],
          },
        }),
      });
    });
  });

  describe("listLiveByThread", () => {
    test("returns only chunks after the cursor in ascending order", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(user._id, project._id, profile._id);
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "streaming",
      });

      const chunks = await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
        textChunk("first", 1000),
        textChunk("second", 2000),
        textChunk("third", 3000),
      ]);

      const result = await asUser.query(api.cli.messageChunks.listLiveByThread, {
        threadId: thread._id,
        after: {
          createdAt: chunks[0]!.createdAt,
          messageId: chunks[0]!.messageId,
          chunkOrder: chunks[0]!.chunkOrder,
        },
      });

      expect(result.page).toHaveLength(2);
      expect(result.page[0]?.chunkOrder).toBe(1);
      expect(result.page[1]?.chunkOrder).toBe(2);
      expect(result.nextCursor?.chunkOrder).toBe(2);
      expect(result.resetRequired).toBe(false);
    });

    test("returns resetRequired when the cursor anchor was deleted", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(
        user._id,
        project._id,
        profile._id
      );
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "streaming",
      });

      const chunks = await ctx.cliMessageChunks(
        message._id,
        thread._id,
        profile._id,
        [textChunk("first", 1000), textChunk("second", 2000)]
      );

      const cursor = {
        createdAt: chunks[0].createdAt,
        messageId: chunks[0].messageId,
        chunkOrder: chunks[0].chunkOrder,
      };

      // Delete the anchor chunk
      await t.run(async (runCtx) => {
        await runCtx.db.delete("cliMessageChunks", chunks[0]._id);
      });

      const result = await asUser.query(
        api.cli.messageChunks.listLiveByThread,
        { threadId: thread._id, after: cursor }
      );

      expect(result.resetRequired).toBe(true);
      expect(result.page).toHaveLength(0);
    });

    test("respects limit", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(
        user._id,
        project._id,
        profile._id
      );
      const message = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        content: [],
        status: "streaming",
      });

      const chunks = await ctx.cliMessageChunks(
        message._id,
        thread._id,
        profile._id,
        [
          textChunk("a", 1000),
          textChunk("b", 2000),
          textChunk("c", 3000),
          textChunk("d", 4000),
        ]
      );

      const cursor = {
        createdAt: chunks[0].createdAt,
        messageId: chunks[0].messageId,
        chunkOrder: chunks[0].chunkOrder,
      };

      const result = await asUser.query(
        api.cli.messageChunks.listLiveByThread,
        { threadId: thread._id, after: cursor, limit: 2 }
      );

      expect(result.page).toHaveLength(2);
      expect(result.page[0].chunkOrder).toBe(1);
      expect(result.page[1].chunkOrder).toBe(2);
    });
  });

  describe("listNormalizedByMessages", () => {
    test("returns chunks only for the requested assistant messages", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(
        user._id,
        project._id,
        profile._id
      );
      const assistantA = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        nextChunkOrder: 2,
        content: [],
        status: "completed",
      });
      const assistantB = await ctx.cliMessage(thread._id, profile._id, {
        role: "assistant",
        nextChunkOrder: 1,
        content: [],
        status: "completed",
      });

      await ctx.cliMessageChunks(assistantA._id, thread._id, profile._id, [
        textChunk("first-a", 1000),
        textChunk("second-a", 2000),
      ]);
      await ctx.cliMessageChunks(assistantB._id, thread._id, profile._id, [
        textChunk("only-b", 3000),
      ]);

      const result = await asUser.query(
        api.cli.messageChunks.listNormalizedByMessages,
        {
          threadId: thread._id,
          messageIds: [assistantB._id],
        }
      );

      expect(result.page).toHaveLength(1);
      expect(result.page[0]?.messageId).toBe(assistantB._id);
      expect(result.nextCursor?.messageId).toBe(assistantB._id);
      expect(result.resetRequired).toBe(false);
    });

    test("returns empty when no message ids are provided", async () => {
      const ctx = createTestContext();
      const { user, project, asUser } = await ctx.setupProject();
      const profile = await ctx.cliProfile(user._id, project._id);
      const thread = await ctx.cliThread(
        user._id,
        project._id,
        profile._id
      );

      const result = await asUser.query(
        api.cli.messageChunks.listNormalizedByMessages,
        {
          threadId: thread._id,
          messageIds: [],
        }
      );

      expect(result.page).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.resetRequired).toBe(false);
    });
  });
});

describe("normalized Codex narrative identity", () => {
  test("returns normalized identity without reconstructing it from message context", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id, { cliType: "codex" });
    const message = await ctx.cliMessage(thread._id, profile._id, {
      role: "assistant", cliContext: { continuationId: "root-provider" },
    });
    await ctx.t.run(async (runCtx) => {
      for (const [index, provider] of ["root-provider", "child-provider"].entries()) {
        await runCtx.db.insert("cliMessageChunks", {
          messageId: message._id, threadId: thread._id, profileId: profile._id,
          chunkOrder: 100 + index, createdAt: 1000, timestamp: 1000, type: "item/completed",
          data: JSON.stringify({ threadId: provider, turnId: "turn", item: { id: provider, type: "agentMessage", text: provider } }),
          normalizedEvent: { kind: "text", text: provider, source: { threadId: provider } },
        });
      }
    });
    const result = await asUser.query(api.cli.messageChunks.listWindowByThread, { threadId: thread._id });
    expect(result.page.map((row) => row.event)).toEqual(expect.arrayContaining([
      { kind: "text", text: "root-provider", source: { threadId: "root-provider" } },
      { kind: "text", text: "child-provider", source: { threadId: "child-provider" } },
    ]));
  });
});
