/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEV_SETTINGS,
  DEV_SETTINGS_STORAGE_EVENT,
  DEV_SETTING_ENABLED_VALUE,
} from "./constants";
import { readStoredDevSetting, setStoredDevSetting } from "./storage";

describe("developer settings storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("reads the current shared storage key", () => {
    window.localStorage.setItem(
      DEV_SETTINGS.taskListShowRank.storageKey,
      DEV_SETTING_ENABLED_VALUE
    );

    expect(readStoredDevSetting("taskListShowRank")).toBe(true);
  });

  test("writes the shared storage key", () => {
    setStoredDevSetting("taskListShowRank", true);

    expect(
      window.localStorage.getItem(DEV_SETTINGS.taskListShowRank.storageKey)
    ).toBe(DEV_SETTING_ENABLED_VALUE);
  });

  test("dispatches a change event when a setting changes", () => {
    const handler = vi.fn();
    window.addEventListener(DEV_SETTINGS_STORAGE_EVENT, handler);

    try {
      setStoredDevSetting("extraProjectSettings", true);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(DEV_SETTINGS_STORAGE_EVENT, handler);
    }
  });
});
