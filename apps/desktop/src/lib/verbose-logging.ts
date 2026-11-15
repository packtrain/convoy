/**
 * "Verbose agent logging" preference (OS-1360). Off by default: with it on,
 * the CLI writes a line per stream chunk (CONVOY_CLI_DEBUG=1) into the
 * shared daily log, which is what let that file reach gigabytes. Webview-only
 * setting, so it lives in localStorage rather than config.toml; it applies to
 * agents started after the toggle changes.
 */
const STORAGE_KEY = "convoy.verboseLogging";

export function getVerboseLoggingPref(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setVerboseLoggingPref(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}
