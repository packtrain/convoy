/**
 * Which CLI binary the supervisor spawns. "convoy-dev" is a developer
 * alias pointing at the source checkout — only offered in dev builds; the
 * Rust side whitelists both regardless.
 */
export type CliBin = "convoy" | "convoy-dev";

const STORAGE_KEY = "convoy.cliBin";

export function getCliBin(): CliBin {
  if (!import.meta.env.DEV) return "convoy";
  return localStorage.getItem(STORAGE_KEY) === "convoy-dev" ? "convoy-dev" : "convoy";
}

export function setCliBin(bin: CliBin): void {
  localStorage.setItem(STORAGE_KEY, bin);
}
