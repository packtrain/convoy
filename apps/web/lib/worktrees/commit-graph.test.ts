import { describe, expect, it } from "vitest";
import { graphLanes, layoutGraph } from "./commit-graph";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe("layoutGraph (OS-2536)", () => {
  it("keeps a straight line in lane 0", () => {
    const rows = layoutGraph([c("c", "b"), c("b", "a"), c("a")]);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.after)).toEqual([["b"], ["a"], []]);
    expect(graphLanes(rows)).toBe(1);
  });

  it("opens a lane for a merged branch and joins it at the fork point", () => {
    // m merges f into a; both fork from x.
    const rows = layoutGraph([c("m", "a", "f"), c("f", "x"), c("a", "x"), c("x")]);

    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
    expect(rows[0].after).toEqual(["a", "f"]);
    expect(rows[2].after).toEqual(["x", "x"]);
    expect(rows[3].before).toEqual(["x", "x"]);
    expect(rows[3].after).toEqual([]);
  });

  it("gives an open branch tip a new lane", () => {
    // HEAD's branch h and the default branch d, both off x, not merged.
    const rows = layoutGraph([c("h", "x"), c("d", "x"), c("x")]);

    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0]);
    expect(rows[1].before).toEqual(["x"]);
    expect(rows[1].after).toEqual(["x", "x"]);
  });

  it("opens one lane per extra parent of an octopus merge", () => {
    const rows = layoutGraph([c("m", "a", "b", "z"), c("a", "x"), c("b", "x"), c("z", "x"), c("x")]);

    expect(rows[0].after).toEqual(["a", "b", "z"]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 2, 0]);
    expect(rows[4].before).toEqual(["x", "x", "x"]);
    expect(graphLanes(rows)).toBe(3);
  });

  it("sends an extra parent to the lane already waiting for it", () => {
    // d is waiting for x when m merges x in.
    const rows = layoutGraph([c("d", "x"), c("m", "a", "x"), c("a", "x"), c("x")]);

    expect(rows[1].lane).toBe(1);
    expect(rows[1].after).toEqual(["x", "a"]);
  });

  it("leaves lanes open at a page edge, and the next page continues them", () => {
    const all = [c("m", "a", "f"), c("f", "x"), c("a", "x"), c("x", "w"), c("w")];

    const page = layoutGraph(all.slice(0, 2));

    expect(page.at(-1)?.after).toEqual(["a", "x"]);
    expect(layoutGraph(all).slice(0, 2)).toEqual(page);
  });
});
