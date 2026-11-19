"use client";

import { useCallback, useSyncExternalStore } from "react";
import { type DevSettingId } from "./constants";
import {
  type DevSettingsSnapshot,
  readStoredDevSettings,
  setStoredDevSetting,
  subscribeToStoredDevSettings,
} from "./storage";

const EMPTY_SNAPSHOT = readStoredDevSettings();

export type { DevSettingId } from "./constants";
export type { DevSettingsSnapshot } from "./storage";

export function useDevSettings(): DevSettingsSnapshot {
  return useSyncExternalStore(
    subscribeToStoredDevSettings,
    readStoredDevSettings,
    () => EMPTY_SNAPSHOT
  );
}

export function useDevSetting(settingId: DevSettingId): boolean {
  const storedSettings = useDevSettings();

  return storedSettings[settingId];
}

export function useSetDevSetting(
  settingId: DevSettingId
): (enabled: boolean) => void {
  return useCallback(
    (enabled: boolean) => {
      setStoredDevSetting(settingId, enabled);
    },
    [settingId]
  );
}

export function useDevSettingState(
  settingId: DevSettingId
): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useDevSetting(settingId);
  const setEnabled = useSetDevSetting(settingId);

  return [enabled, setEnabled] as const;
}

export function useShowTaskListRank(): boolean {
  return useDevSetting("taskListShowRank");
}

export function useShowUnfinishedItems(): boolean {
  return useDevSetting("showUnfinishedItems");
}

export function useShowToolCallDebug(): boolean {
  return useDevSetting("toolCallDebug");
}
