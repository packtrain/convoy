import { describe, expect, test } from "vitest";
import { LexoRank } from "lexorank";
import {
  calculateRankBetween,
  detectDuplicateRankRun,
  redistributeRanks,
  resolveInsertIndex,
} from "./rank";

describe("rank", () => {
  test("calculateRankBetween recovers when neighbors have duplicate rank", () => {
    const duplicateRank = "0|hzzzzz:";
    const next = calculateRankBetween(duplicateRank, duplicateRank);

    expect(next).not.toBe(duplicateRank);
    expect(next.localeCompare(duplicateRank)).toBeGreaterThan(0);
  });

  test("calculateRankBetween supports standard between behavior", () => {
    const base = LexoRank.middle().toString();
    const upper = LexoRank.parse(base).genNext().toString();

    const between = calculateRankBetween(base, upper);
    expect(between.localeCompare(base)).toBeGreaterThan(0);
    expect(between.localeCompare(upper)).toBeLessThan(0);
  });

  test("calculateRankBetween supports one-sided boundaries", () => {
    const middle = LexoRank.middle().toString();

    const beforeMiddle = calculateRankBetween(undefined, middle);
    const afterMiddle = calculateRankBetween(middle, undefined);

    expect(beforeMiddle.localeCompare(middle)).toBeLessThan(0);
    expect(afterMiddle.localeCompare(middle)).toBeGreaterThan(0);
  });

  test("calculateRankBetween handles malformed ranks safely", () => {
    expect(() => calculateRankBetween("invalid-rank", "also-invalid")).not.toThrow();
    expect(calculateRankBetween("invalid-rank", "also-invalid")).toBe(
      LexoRank.middle().toString()
    );
  });

  test("resolveInsertIndex handles missing anchors safely", () => {
    const ids = ["a", "b", "c"];

    expect(resolveInsertIndex(ids, { beforeId: "missing" })).toBe(0);
    expect(resolveInsertIndex(ids, { afterId: "missing" })).toBe(3);
    expect(resolveInsertIndex(ids, { beforeId: "b" })).toBe(1);
    expect(resolveInsertIndex(ids, { afterId: "b" })).toBe(2);
  });

  test("resolveInsertIndex defaults to end when no options are provided", () => {
    expect(resolveInsertIndex(["a", "b", "c"])).toBe(3);
  });

  test("detectDuplicateRankRun finds the full run around an insertion point", () => {
    const duplicateRank = LexoRank.middle().toString();
    const prevRank = LexoRank.parse(duplicateRank).genPrev().toString();
    const nextRank = LexoRank.parse(duplicateRank).genNext().toString();

    const run = detectDuplicateRankRun(
      [
        { _id: "a", rank: prevRank },
        { _id: "b", rank: duplicateRank },
        { _id: "c", rank: duplicateRank },
        { _id: "d", rank: duplicateRank },
        { _id: "e", rank: nextRank },
      ],
      2
    );

    expect(run).toEqual({
      duplicateRank,
      startIndex: 1,
      endIndex: 4,
      insertOffset: 1,
      tasks: [
        { _id: "b", rank: duplicateRank },
        { _id: "c", rank: duplicateRank },
        { _id: "d", rank: duplicateRank },
      ],
      prevDistinctRank: prevRank,
      nextDistinctRank: nextRank,
    });
  });

  test("redistributeRanks returns strictly increasing ranks inside boundaries", () => {
    const prevRank = LexoRank.middle().toString();
    const nextRank = LexoRank.parse(prevRank).genNext().toString();

    const ranks = redistributeRanks(prevRank, nextRank, 4);

    expect(new Set(ranks).size).toBe(4);
    expect(ranks[0].localeCompare(prevRank)).toBeGreaterThan(0);
    expect(ranks.at(-1)?.localeCompare(nextRank)).toBeLessThan(0);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i].localeCompare(ranks[i - 1])).toBeGreaterThan(0);
    }
  });

  test("detectDuplicateRankRun supports runs at list edges", () => {
    const duplicateRank = LexoRank.middle().toString();
    const prevRank = LexoRank.parse(duplicateRank).genPrev().toString();
    const nextRank = LexoRank.parse(duplicateRank).genNext().toString();

    expect(
      detectDuplicateRankRun(
        [
          { _id: "a", rank: duplicateRank },
          { _id: "b", rank: duplicateRank },
          { _id: "c", rank: nextRank },
        ],
        1
      )
    ).toMatchObject({
      startIndex: 0,
      endIndex: 2,
      prevDistinctRank: undefined,
      nextDistinctRank: nextRank,
    });

    expect(
      detectDuplicateRankRun(
        [
          { _id: "a", rank: prevRank },
          { _id: "b", rank: duplicateRank },
          { _id: "c", rank: duplicateRank },
        ],
        2
      )
    ).toMatchObject({
      startIndex: 1,
      endIndex: 3,
      prevDistinctRank: prevRank,
      nextDistinctRank: undefined,
    });
  });

  test("redistributeRanks supports an entirely duplicated list", () => {
    const ranks = redistributeRanks(undefined, undefined, 3);

    expect(new Set(ranks).size).toBe(3);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i].localeCompare(ranks[i - 1])).toBeGreaterThan(0);
    }
  });

  test("redistributeRanks keeps strict ordering when boundaries are inverted", () => {
    const prevRank = LexoRank.middle().genNext().toString();
    const nextRank = LexoRank.middle().toString();

    const ranks = redistributeRanks(prevRank, nextRank, 3);

    expect(new Set(ranks).size).toBe(3);
    expect(ranks[0].localeCompare(prevRank)).toBeGreaterThan(0);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i].localeCompare(ranks[i - 1])).toBeGreaterThan(0);
    }
  });
});
