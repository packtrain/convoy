import { setDockIconVisible } from "@/lib/backend";

/**
 * "Show Dock icon" preference (OS-1239). Default on: crowded menu bars can
 * hide the tray icon, so the Dock icon is the reliable "is it running?"
 * signal. Persisted here (webview-only setting, not part of the CLI's
 * config.toml schema) and re-applied on every startup.
 */
const STORAGE_KEY = "convoy.dockIcon";

export function getDockIconPref(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "hidden";
}

export async function applyDockIconPref(visible: boolean): Promise<void> {
  localStorage.setItem(STORAGE_KEY, visible ? "visible" : "hidden");
  await setDockIconVisible(visible);
}

/** Startup: only invoke when hidden — Regular is already the launch policy. */
export function applyDockIconPrefOnStartup(): void {
  if (!getDockIconPref()) void setDockIconVisible(false).catch(() => {});
}
