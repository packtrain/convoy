/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import {
  formatHotkeyForCrossPlatformLabel,
  formatHotkeyForPlatformLabel,
} from "./hotkeys";
import { setTestHotkeyPlatform } from "@/test-utils/hotkeys";

describe("hotkeys", () => {
  afterEach(() => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0",
    });
  });

  test("formats a platform-aware label for mac", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    expect(formatHotkeyForPlatformLabel("Shift+Tab")).toBe("Shift+Tab");
  });

  test("preserves the cross-platform label formatter", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    expect(formatHotkeyForCrossPlatformLabel("Shift+Tab")).toBe("Shift+Tab");
  });
});
