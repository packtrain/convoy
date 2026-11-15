import {
  DEV_SETTINGS,
  DEV_SETTINGS_STORAGE_EVENT,
  DEV_SETTING_DISABLED_VALUE,
  DEV_SETTING_ENABLED_VALUE,
  DEV_SETTING_IDS,
  type DevSettingId,
} from "./constants";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

export type DevSettingsSnapshot = Record<DevSettingId, boolean>;
let cachedSnapshot: DevSettingsSnapshot | null = null;

function isEnabledValue(value: string | null): boolean {
  return value === DEV_SETTING_ENABLED_VALUE;
}

function createEmptySnapshot(): DevSettingsSnapshot {
  return DEV_SETTING_IDS.reduce(
    (snapshot, settingId) => {
      snapshot[settingId] = false;
      return snapshot;
    },
    {} as DevSettingsSnapshot
  );
}

function snapshotsMatch(
  left: DevSettingsSnapshot,
  right: DevSettingsSnapshot
): boolean {
  return DEV_SETTING_IDS.every((settingId) => left[settingId] === right[settingId]);
}

function isKnownStorageKey(key: string | null): boolean {
  if (key === null) {
    return true;
  }

  return DEV_SETTING_IDS.some(
    (settingId) => DEV_SETTINGS[settingId].storageKey === key
  );
}

export function readStoredDevSetting(settingId: DevSettingId): boolean {
  return isEnabledValue(readLocalString(DEV_SETTINGS[settingId].storageKey));
}

export function readStoredDevSettings(): DevSettingsSnapshot {
  const nextSnapshot = createEmptySnapshot();

  for (const settingId of DEV_SETTING_IDS) {
    nextSnapshot[settingId] = readStoredDevSetting(settingId);
  }

  if (cachedSnapshot && snapshotsMatch(cachedSnapshot, nextSnapshot)) {
    return cachedSnapshot;
  }

  cachedSnapshot = nextSnapshot;
  return nextSnapshot;
}

function dispatchDevSettingsStorageEvent(settingId: DevSettingId): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(DEV_SETTINGS_STORAGE_EVENT, {
      detail: { settingId },
    })
  );
}

export function subscribeToStoredDevSettings(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorageChange = (event: Event) => {
    if (event instanceof StorageEvent && !isKnownStorageKey(event.key)) {
      return;
    }

    onChange();
  };

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(DEV_SETTINGS_STORAGE_EVENT, handleStorageChange);

  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(DEV_SETTINGS_STORAGE_EVENT, handleStorageChange);
  };
}

export function setStoredDevSetting(
  settingId: DevSettingId,
  enabled: boolean
): void {
  const stored = writeLocalString(
    DEV_SETTINGS[settingId].storageKey,
    enabled ? DEV_SETTING_ENABLED_VALUE : DEV_SETTING_DISABLED_VALUE
  );

  // Nothing changed when storage refused the write — subscribers would only
  // re-read the same value, so stay quiet (matches the pre-helper behaviour).
  if (stored) {
    dispatchDevSettingsStorageEvent(settingId);
  }
}
