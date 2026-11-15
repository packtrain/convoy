import { describe, expect, it } from "vitest";

import { locateAnchor, locateAnchorLines, type CommentAnchor } from "./locate-anchor";

function anchor(over: Partial<CommentAnchor> & { text: string }): CommentAnchor {
  return { prefix: "", suffix: "", startOffset: 0, ...over };
}

describe("locateAnchor", () => {
  it("finds the snippet at the hint", () => {
    const content = "The quick brown fox jumps over the lazy dog.";
    const at = content.indexOf("brown fox");
    expect(locateAnchor(content, anchor({ text: "brown fox", startOffset: at }))).toEqual({
      start: at,
      end: at + "brown fox".length,
    });
  });

  it("disambiguates duplicate snippets by context", () => {
    const content = "alpha TODO beta ... gamma TODO delta";
    const secondTodo = content.lastIndexOf("TODO");
    // Same snippet twice; prefix/suffix pin the second one.
    const located = locateAnchor(
      content,
      anchor({ text: "TODO", prefix: "gamma ", suffix: " delta", startOffset: 0 })
    );
    expect(located).toEqual({ start: secondTodo, end: secondTodo + 4 });
  });

  it("re-finds a snippet shifted far beyond the search window via global context", () => {
    const filler = "x".repeat(2000);
    const content = filler + "unique-prefix TARGET unique-suffix";
    const at = content.indexOf("TARGET");
    // hint points at the old (pre-insert) location, way outside the window.
    const located = locateAnchor(
      content,
      anchor({ text: "TARGET", prefix: "unique-prefix ", suffix: " unique-suffix", startOffset: 5 })
    );
    expect(located).toEqual({ start: at, end: at + "TARGET".length });
  });

  it("falls back to bare text when surrounding context changed", () => {
    const content = "completely rewritten sentence containing KEEPME somewhere";
    const at = content.indexOf("KEEPME");
    const located = locateAnchor(
      content,
      anchor({ text: "KEEPME", prefix: "old context ", suffix: " gone now", startOffset: at })
    );
    expect(located).toEqual({ start: at, end: at + "KEEPME".length });
  });

  it("detaches (null) when the snippet text is gone", () => {
    expect(
      locateAnchor("the snippet was deleted entirely", anchor({ text: "NONEXISTENT", startOffset: 3 }))
    ).toBeNull();
  });

  it("returns null for an empty snippet", () => {
    expect(locateAnchor("anything", anchor({ text: "" }))).toBeNull();
  });
});

describe("locateAnchorLines", () => {
  it("returns the 1-based line for a single-line snippet", () => {
    const content = "line one\nline two with TARGET here\nline three";
    expect(
      locateAnchorLines(content, anchor({ text: "TARGET", startOffset: content.indexOf("TARGET") }))
    ).toEqual({ start: 2, end: 2 });
  });

  it("spans the full range of a multiline snippet", () => {
    const content = "intro\nfirst line\nsecond line\noutro";
    expect(
      locateAnchorLines(content, anchor({ text: "first line\nsecond line", startOffset: 6 }))
    ).toEqual({ start: 2, end: 3 });
  });

  it("returns null when the snippet is gone", () => {
    expect(locateAnchorLines("nothing here", anchor({ text: "GONE" }))).toBeNull();
  });
});
