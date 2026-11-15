import { describe, expect, test } from "vitest";
import type { CliFavoriteCombo } from "./cli-favorite-combos";
import {
  sanitizeCliFavoriteCombos,
  toggleCliFavoriteCombo,
} from "./cli-favorite-combos";

describe("sanitizeCliFavoriteCombos", () => {
  test("keeps unsupported models as unavailable instead of dropping them", () => {
    const result = sanitizeCliFavoriteCombos([
      { cliType: "claude-code", cliModel: "opus", cliEffort: "high" },
      { cliType: "claude-code", cliModel: "retired-model", cliEffort: "xx" },
    ]);

    expect(result).toEqual([
      { cliType: "claude-code", cliModel: "opus", cliEffort: "high", isAvailable: true },
      // Unavailable combos keep their values verbatim for display.
      { cliType: "claude-code", cliModel: "retired-model", cliEffort: "xx", isAvailable: false },
    ]);
  });

  test("drops unknown cli types and unsupported efforts fall back to default", () => {
    const result = sanitizeCliFavoriteCombos([
      { cliType: "retired-cli", cliModel: "opus" } as unknown as CliFavoriteCombo,
      { cliType: "claude-code", cliModel: "opus", cliEffort: "not-an-effort" },
    ]);

    expect(result).toEqual([
      { cliType: "claude-code", cliModel: "opus", cliEffort: undefined, isAvailable: true },
    ]);
  });

  test("dedupes combos treating missing effort as default", () => {
    const result = sanitizeCliFavoriteCombos([
      { cliType: "claude-code", cliModel: "opus" },
      { cliType: "claude-code", cliModel: "opus", cliEffort: "default" },
    ]);

    expect(result).toHaveLength(1);
  });
});

describe("toggleCliFavoriteCombo", () => {
  test("adds when absent, removes when present, strips view fields", () => {
    const combo = { cliType: "claude-code" as const, cliModel: "opus", cliEffort: "high" };
    const view = { ...combo, isAvailable: true };

    const added = toggleCliFavoriteCombo([], view);
    expect(added).toEqual([combo]);

    const removed = toggleCliFavoriteCombo(added, view);
    expect(removed).toEqual([]);
  });
});
