import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { THREAD_BATCH_ACTION_MAX } from "./constants";
import {
  EMPTY_THREAD_BATCH_SELECTION,
  intersectVisibleThreadIds,
  toggleThreadBatchSelection,
} from "./thread-batch-selection";

const id = (n: number) => `thread_${n}` as Id<"cliThreads">;
const orderedIds = Array.from({ length: 60 }, (_, index) => id(index));

describe("toggleThreadBatchSelection", () => {
  test("selects a thread and sets it as anchor", () => {
    const next = toggleThreadBatchSelection(
      EMPTY_THREAD_BATCH_SELECTION,
      orderedIds,
      id(3),
      false
    );

    expect(next.ids).toEqual([id(3)]);
    expect(next.anchorId).toBe(id(3));
  });

  test("deselects an already selected thread", () => {
    const next = toggleThreadBatchSelection(
      { ids: [id(1), id(3)], anchorId: id(1) },
      orderedIds,
      id(3),
      false
    );

    expect(next.ids).toEqual([id(1)]);
    expect(next.anchorId).toBe(id(3));
  });

  test("shift+click selects the forward range from the anchor", () => {
    const next = toggleThreadBatchSelection(
      { ids: [id(2)], anchorId: id(2) },
      orderedIds,
      id(5),
      true
    );

    expect(next.ids).toEqual([id(2), id(3), id(4), id(5)]);
    expect(next.anchorId).toBe(id(5));
  });

  test("shift+click selects the backward range from the anchor", () => {
    const next = toggleThreadBatchSelection(
      { ids: [id(5)], anchorId: id(5) },
      orderedIds,
      id(2),
      true
    );

    expect(new Set(next.ids)).toEqual(new Set([id(2), id(3), id(4), id(5)]));
    expect(next.anchorId).toBe(id(2));
  });

  test("shift+click unions the range with the existing selection", () => {
    const next = toggleThreadBatchSelection(
      { ids: [id(10), id(2)], anchorId: id(2) },
      orderedIds,
      id(4),
      true
    );

    expect(new Set(next.ids)).toEqual(new Set([id(10), id(2), id(3), id(4)]));
  });

  test("shift+click without a visible anchor toggles a single thread", () => {
    const next = toggleThreadBatchSelection(
      { ids: [id(1)], anchorId: "gone" as Id<"cliThreads"> },
      orderedIds,
      id(4),
      true
    );

    expect(next.ids).toEqual([id(1), id(4)]);
  });

  test("clamps the selection at the batch action cap", () => {
    const next = toggleThreadBatchSelection(
      { ids: [id(0)], anchorId: id(0) },
      orderedIds,
      id(59),
      true
    );

    expect(next.ids).toHaveLength(THREAD_BATCH_ACTION_MAX);
  });
});

describe("intersectVisibleThreadIds", () => {
  test("drops ids that are no longer visible, preserving order", () => {
    expect(
      intersectVisibleThreadIds([id(5), id(99), id(1)], orderedIds)
    ).toEqual([id(5), id(1)]);
  });

  test("returns empty for an empty selection", () => {
    expect(intersectVisibleThreadIds([], orderedIds)).toEqual([]);
  });
});
