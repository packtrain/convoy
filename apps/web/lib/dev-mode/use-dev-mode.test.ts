/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  DEV_SETTINGS,
  DEV_SETTING_ENABLED_VALUE,
} from "./constants";
import {
  useDevSetting,
  useDevSettingState,
  useShowTaskListRank,
} from "./use-dev-mode";

describe("developer settings hooks", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("returns false by default", () => {
    const { result } = renderHook(() => useShowTaskListRank());

    expect(result.current).toBe(false);
  });

  test("falls back to the persisted local storage flag", () => {
    window.localStorage.setItem(
      DEV_SETTINGS.taskListShowRank.storageKey,
      DEV_SETTING_ENABLED_VALUE
    );

    const { result } = renderHook(() => useShowTaskListRank());

    expect(result.current).toBe(true);
  });

  test("keeps the generic and convenience hooks in sync", () => {
    const { result } = renderHook(() => {
      const generic = useDevSetting("taskListShowRank");
      const taskListRank = useShowTaskListRank();
      const [state, setState] = useDevSettingState("taskListShowRank");

      return {
        generic,
        taskListRank,
        state,
        setState,
      };
    });

    expect(result.current.generic).toBe(false);
    expect(result.current.taskListRank).toBe(false);
    expect(result.current.state).toBe(false);

    act(() => {
      result.current.setState(true);
    });

    expect(result.current.generic).toBe(true);
    expect(result.current.taskListRank).toBe(true);
    expect(result.current.state).toBe(true);
  });

  test("reacts to storage events for cross-tab updates", async () => {
    const { result } = renderHook(() => useDevSetting("taskListShowRank"));

    act(() => {
      window.localStorage.setItem(
        DEV_SETTINGS.taskListShowRank.storageKey,
        DEV_SETTING_ENABLED_VALUE
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DEV_SETTINGS.taskListShowRank.storageKey,
          newValue: DEV_SETTING_ENABLED_VALUE,
        })
      );
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});
