import { describe, expect, test } from "vitest";
import { clampChars, countStringOccurrences, isSafeFileName } from "./strings";

describe("isSafeFileName", () => {
  test.each(["note.txt", "screen shot.png", ".env", "résumé.pdf"])("accepts %j", (name) => {
    expect(isSafeFileName(name)).toBe(true);
  });

  test.each(["", ".", "..", "../outside.txt", "/etc/passwd", "..\\evil.txt", "C:\\x.txt", "bad\u0000.txt", "bad\u007f.txt", "a".repeat(256)])(
    "rejects %j",
    (name) => {
      expect(isSafeFileName(name)).toBe(false);
    }
  );
});

describe("clampChars", () => {
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

  test("returns short input unchanged, so callers can compare lengths", () => {
    expect(clampChars("hello", 10)).toBe("hello");
    expect(clampChars("hello", 5)).toBe("hello");
  });

  test("truncates to the cap", () => {
    expect(clampChars("abcdef", 3)).toBe("abc");
  });

  test("drops the high surrogate rather than splitting a pair", () => {
    // The emoji straddles the cap: cutting at 4 would emit its high half alone.
    const clamped = clampChars(`abc\u{1F600}tail`, 4);
    expect(clamped).toBe("abc");
    expect(loneSurrogate.test(clamped)).toBe(false);
  });

  test("keeps a pair that fits entirely inside the cap", () => {
    const clamped = clampChars(`abc\u{1F600}tail`, 5);
    expect(clamped).toBe(`abc\u{1F600}`);
    expect(loneSurrogate.test(clamped)).toBe(false);
  });
});

describe("countStringOccurrences", () => {
  test("counts exact non-overlapping occurrences", () => {
    expect(countStringOccurrences("same same", "same")).toBe(2);
    expect(countStringOccurrences("aaaa", "aa")).toBe(2);
    expect(countStringOccurrences("artifact", "missing")).toBe(0);
  });
});
