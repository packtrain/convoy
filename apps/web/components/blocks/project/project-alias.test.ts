import { describe, expect, test } from "vitest";
import { generateAliasFromName } from "./project-alias";

describe("generateAliasFromName", () => {
  test("removes separators from generated project aliases", () => {
    expect(generateAliasFromName("Someday / Maybe")).toBe("SM");
  });

  test("keeps generated aliases uppercase alphanumeric", () => {
    expect(generateAliasFromName("2026 launch")).toBe("P2L");
  });
});
