import { describe, expect, test } from "vitest";
import { LexoRank } from "lexorank";
import { buildDuplicateRankHealingUpdates } from "./rank-healing";

describe("rank-healing", () => {
  test("returns null when insertion point is not inside a duplicate run", () => {
    const first = LexoRank.middle().toString();
    const second = LexoRank.parse(first).genNext().toString();

    expect(
      buildDuplicateRankHealingUpdates(
        [
          { _id: "a", rank: first },
          { _id: "b", rank: second },
        ],
        1,
        ["moved"]
      )
    ).toBeNull();
  });

  test("heals the duplicate run plus inserted tasks in final order", () => {
    const duplicateRank = LexoRank.middle().toString();
    const prevRank = LexoRank.parse(duplicateRank).genPrev().toString();
    const nextRank = LexoRank.parse(duplicateRank).genNext().toString();

    const updates = buildDuplicateRankHealingUpdates(
      [
        { _id: "a", rank: prevRank },
        { _id: "b", rank: duplicateRank },
        { _id: "c", rank: duplicateRank },
        { _id: "d", rank: nextRank },
      ],
      2,
      ["moved-1", "moved-2"]
    );

    expect(updates?.map((update) => update.id)).toEqual(["b", "moved-1", "moved-2", "c"]);
    expect(new Set(updates?.map((update) => update.rank)).size).toBe(4);
    expect(updates?.[0]?.rank.localeCompare(prevRank)).toBeGreaterThan(0);
    expect(updates?.at(-1)?.rank.localeCompare(nextRank)).toBeLessThan(0);
  });
});
