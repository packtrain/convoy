import { describe, expect, test } from "vitest";
import {
  compareChunkOrder,
  compareChunkOrderDesc,
  mergeOrderedChunkGroups,
} from "./chunkOrder";

describe("chunkOrder", () => {
  test("orders by createdAt first", () => {
    expect(
      compareChunkOrder(
        { createdAt: 1, messageId: "b", chunkOrder: 10 },
        { createdAt: 2, messageId: "a", chunkOrder: 0 }
      )
    ).toBeLessThan(0);
  });

  test("orders by messageId when createdAt is equal", () => {
    expect(
      compareChunkOrder(
        { createdAt: 1, messageId: "a", chunkOrder: 10 },
        { createdAt: 1, messageId: "b", chunkOrder: 0 }
      )
    ).toBeLessThan(0);
  });

  test("orders by chunkOrder when createdAt and messageId are equal", () => {
    expect(
      compareChunkOrder(
        { createdAt: 1, messageId: "a", chunkOrder: 1 },
        { createdAt: 1, messageId: "a", chunkOrder: 2 }
      )
    ).toBeLessThan(0);
  });

  test("desc variant reverses the ascending order", () => {
    expect(
      compareChunkOrderDesc(
        { createdAt: 1, messageId: "a", chunkOrder: 1 },
        { createdAt: 1, messageId: "a", chunkOrder: 2 }
      )
    ).toBeGreaterThan(0);
  });
});

describe("mergeOrderedChunkGroups", () => {
  test("merges per-message groups into one ascending composite stream", () => {
    const groupA = [
      { createdAt: 1, messageId: "a", chunkOrder: 0 },
      { createdAt: 1, messageId: "a", chunkOrder: 1 },
    ];
    const groupB = [
      { createdAt: 1, messageId: "b", chunkOrder: 0 },
      { createdAt: 3, messageId: "b", chunkOrder: 0 },
    ];

    expect(mergeOrderedChunkGroups([groupA, groupB])).toEqual([
      { createdAt: 1, messageId: "a", chunkOrder: 0 },
      { createdAt: 1, messageId: "a", chunkOrder: 1 },
      { createdAt: 1, messageId: "b", chunkOrder: 0 },
      { createdAt: 3, messageId: "b", chunkOrder: 0 },
    ]);
  });

  test("interleaves groups by createdAt across messages", () => {
    const groupA = [
      { createdAt: 1, messageId: "a", chunkOrder: 0 },
      { createdAt: 4, messageId: "a", chunkOrder: 0 },
    ];
    const groupB = [
      { createdAt: 2, messageId: "b", chunkOrder: 0 },
      { createdAt: 3, messageId: "b", chunkOrder: 0 },
    ];

    expect(mergeOrderedChunkGroups([groupA, groupB]).map((c) => c.createdAt)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  test("handles empty and single-group inputs", () => {
    expect(mergeOrderedChunkGroups<{ createdAt: number; messageId: string; chunkOrder: number }>([])).toEqual([]);
    const only = [{ createdAt: 1, messageId: "a", chunkOrder: 0 }];
    expect(mergeOrderedChunkGroups([[], only, []])).toEqual(only);
  });
});
