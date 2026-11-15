import { describe, expect, test } from "vitest";
import { toSafeFileName } from "./file-name.js";

describe("toSafeFileName", () => {
  test.each([
    ["../outside.txt", "outside.txt"],
    ["/etc/passwd", "passwd"],
    ["..\\..\\evil.txt", "evil.txt"],
    ["C:\\Windows\\win.ini", "win.ini"],
    ["C:evil.txt", "evil.txt"],
    ["\\\\server\\share\\x.txt", "x.txt"],
    ["foo/..", "attachment"],
    ["..", "attachment"],
    [".", "attachment"],
    ["", "attachment"],
    ["   ", "attachment"],
    ["bad:name\u0001?.txt", "bad_name__.txt"],
    ["CON", "_CON"],
    ["nul.txt", "_nul.txt"],
    ["screen shot.png", "screen shot.png"],
  ])("reduces %j to %j", (input, expected) => {
    expect(toSafeFileName(input)).toBe(expected);
  });
});
