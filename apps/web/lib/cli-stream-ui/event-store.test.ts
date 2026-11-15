import { describe, expect, test } from "vitest";
import { initFromSnapshot, applyDeltaPage } from "./event-store";
import type { NormalizedChunkRow, DeltaPage } from "./types";
import type { Id } from "@/convex/_generated/dataModel";

function cliMessageId(value: string): Id<"cliMessages"> {
  return value as Id<"cliMessages">;
}

function cliThreadId(value: string): Id<"cliThreads"> {
  return value as Id<"cliThreads">;
}

function row(
  messageIdValue: string,
  chunkOrder: number,
  createdAt: number
): NormalizedChunkRow {
  return {
    messageId: cliMessageId(messageIdValue),
    threadId: cliThreadId("thread-1"),
    createdAt,
    chunkOrder,
    timestamp: createdAt,
    event: { kind: "text", text: `chunk-${chunkOrder}` },
  };
}

describe("event-store", () => {
  describe("initFromSnapshot", () => {
    test("sorts rows by (createdAt, messageId, chunkOrder)", () => {
      const rows = [
        row("msg-a", 1, 3000),
        row("msg-a", 0, 1000),
        row("msg-a", 2, 2000),
      ];

      const state = initFromSnapshot(rows);

      expect(state.rows.map((r) => r.chunkOrder)).toEqual([0, 2, 1]);
      expect(state.rows.map((r) => r.createdAt)).toEqual([1000, 2000, 3000]);
    });

    test("deduplicates by messageId:chunkOrder", () => {
      const rows = [
        row("msg-a", 0, 1000),
        row("msg-a", 0, 1000), // duplicate
        row("msg-a", 1, 2000),
      ];

      const state = initFromSnapshot(rows);

      expect(state.rows).toHaveLength(2);
      expect(state.dedupKeys.size).toBe(2);
    });

    test("sets cursor to last row", () => {
      const rows = [row("msg-a", 0, 1000), row("msg-a", 1, 2000)];
      const state = initFromSnapshot(rows);

      expect(state.cursor).toEqual({
        createdAt: 2000,
        messageId: cliMessageId("msg-a"),
        chunkOrder: 1,
      });
    });

    test("returns null cursor for empty snapshot", () => {
      const state = initFromSnapshot([]);
      expect(state.cursor).toBeNull();
      expect(state.rows).toHaveLength(0);
    });
  });

  describe("applyDeltaPage", () => {
    test("merges new rows into existing state", () => {
      const state = initFromSnapshot([
        row("msg-a", 0, 1000),
        row("msg-a", 1, 2000),
      ]);

      const delta: DeltaPage = {
        page: [row("msg-a", 2, 3000)],
        nextCursor: {
          createdAt: 3000,
          messageId: cliMessageId("msg-a"),
          chunkOrder: 2,
        },
        resetRequired: false,
      };

      const result = applyDeltaPage(state, delta);

      expect(result.state.rows).toHaveLength(3);
      expect(result.appliedCount).toBe(1);
      expect(result.appliedRows[0].chunkOrder).toBe(2);
    });

    test("deduplicates rows already in state", () => {
      const state = initFromSnapshot([
        row("msg-a", 0, 1000),
        row("msg-a", 1, 2000),
      ]);

      const delta: DeltaPage = {
        page: [row("msg-a", 1, 2000), row("msg-a", 2, 3000)],
        nextCursor: {
          createdAt: 3000,
          messageId: cliMessageId("msg-a"),
          chunkOrder: 2,
        },
        resetRequired: false,
      };

      const result = applyDeltaPage(state, delta);

      expect(result.state.rows).toHaveLength(3);
      expect(result.appliedCount).toBe(1);
    });

    test("append-only optimization: skips sort when new rows are all after existing", () => {
      const state = initFromSnapshot([
        row("msg-a", 0, 1000),
        row("msg-a", 1, 2000),
      ]);

      const delta: DeltaPage = {
        page: [row("msg-a", 2, 3000), row("msg-a", 3, 4000)],
        nextCursor: {
          createdAt: 4000,
          messageId: cliMessageId("msg-a"),
          chunkOrder: 3,
        },
        resetRequired: false,
      };

      const result = applyDeltaPage(state, delta);

      expect(result.state.rows).toHaveLength(4);
      expect(result.state.rows.map((r) => r.chunkOrder)).toEqual([0, 1, 2, 3]);
    });

    test("handles out-of-order delta by sorting", () => {
      const state = initFromSnapshot([
        row("msg-a", 0, 1000),
        row("msg-a", 2, 3000),
      ]);

      // Row with createdAt=2000 is between existing rows
      const delta: DeltaPage = {
        page: [row("msg-a", 1, 2000)],
        nextCursor: {
          createdAt: 3000,
          messageId: cliMessageId("msg-a"),
          chunkOrder: 2,
        },
        resetRequired: false,
      };

      const result = applyDeltaPage(state, delta);

      expect(result.state.rows).toHaveLength(3);
      expect(result.state.rows.map((r) => r.createdAt)).toEqual([
        1000, 2000, 3000,
      ]);
    });

    test("returns appliedRows in chronological order for older history pages", () => {
      const state = initFromSnapshot([
        row("msg-a", 2, 3000),
      ]);

      const result = applyDeltaPage(state, {
        page: [
          row("msg-a", 1, 2000),
          row("msg-a", 0, 1000),
        ],
        nextCursor: {
          createdAt: 1000,
          messageId: cliMessageId("msg-a"),
          chunkOrder: 0,
        },
        resetRequired: false,
      });

      expect(result.appliedRows.map((r) => r.createdAt)).toEqual([1000, 2000]);
      expect(result.state.rows.map((r) => r.createdAt)).toEqual([
        1000, 2000, 3000,
      ]);
    });

    test("updates cursor from delta page", () => {
      const state = initFromSnapshot([row("msg-a", 0, 1000)]);
      const newCursor = {
        createdAt: 5000,
        messageId: cliMessageId("msg-a"),
        chunkOrder: 4,
      };

      const result = applyDeltaPage(state, {
        page: [row("msg-a", 4, 5000)],
        nextCursor: newCursor,
        resetRequired: false,
      });

      expect(result.state.cursor).toEqual(newCursor);
    });

    test("returns zero appliedCount when all rows are duplicates", () => {
      const state = initFromSnapshot([row("msg-a", 0, 1000)]);

      const result = applyDeltaPage(state, {
        page: [row("msg-a", 0, 1000)],
        nextCursor: {
          createdAt: 1000,
          messageId: cliMessageId("msg-a"),
          chunkOrder: 0,
        },
        resetRequired: false,
      });

      expect(result.appliedCount).toBe(0);
      expect(result.state.rows).toHaveLength(1);
    });
  });
});
