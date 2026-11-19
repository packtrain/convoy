import { describe, expect, test } from "vitest";
import {
  getAvailableDevSettingItemId,
  isDevSettingItemAvailable,
} from "./selection";

const ITEMS = [
  { id: "general" },
  { id: "templates", devSettingId: "extraProjectSettings" },
  { id: "danger" },
] as const;

const DISABLED_SETTINGS = {
  extraProjectSettings: false,
  taskListShowRank: false,
  showUnfinishedItems: false,
  toolCallDebug: false,
} as const;

describe("developer settings selection helpers", () => {
  test("treats ungated items as available when feature toggles are off", () => {
    expect(isDevSettingItemAvailable(ITEMS[0], DISABLED_SETTINGS)).toBe(true);
  });

  test("treats gated items as available when their setting is enabled", () => {
    expect(
      isDevSettingItemAvailable(ITEMS[1], {
        ...DISABLED_SETTINGS,
        extraProjectSettings: true,
      })
    ).toBe(true);
  });

  test("falls back when the requested item's setting is disabled", () => {
    expect(
      getAvailableDevSettingItemId(
        ITEMS,
        "templates",
        DISABLED_SETTINGS,
        "general"
      )
    ).toBe("general");
  });

  test("keeps the requested item when its setting is enabled", () => {
    expect(
      getAvailableDevSettingItemId(
        ITEMS,
        "templates",
        {
          ...DISABLED_SETTINGS,
          extraProjectSettings: true,
        },
        "general"
      )
    ).toBe("templates");
  });
});
