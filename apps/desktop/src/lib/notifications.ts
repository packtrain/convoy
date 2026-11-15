import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Native notifications (OS-1240), fired by the tray engine off the same Convex
 * subscription that feeds the tray menu. The preference is app-local (localStorage,
 * default on); macOS gates delivery behind its own per-app permission on top.
 *
 * ponytail: no click-to-open — Tauri's notification plugin has no desktop click callback.
 */

const PREF_KEY = "convoy.notifications-enabled";

export function getNotificationsPref(): boolean {
  return localStorage.getItem(PREF_KEY) !== "false";
}

export function setNotificationsPref(enabled: boolean): void {
  localStorage.setItem(PREF_KEY, String(enabled));
}

/** Prompts the OS permission dialog if not yet granted (used on toggle-on). */
export async function ensureNotificationPermission(): Promise<void> {
  try {
    if (!(await isPermissionGranted())) {
      await requestPermission();
    }
  } catch {
    // Notifications must never break the tray engine.
  }
}

export async function notify(title: string, body: string): Promise<void> {
  if (!getNotificationsPref()) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // Notifications must never break the tray engine.
  }
}
