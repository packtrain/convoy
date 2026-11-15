import type { RuntimeVersion } from "../../environment/validators.js";

export const STATUS: Record<RuntimeVersion["state"], { text: string; tone: "accent" | "muted" | "success" | "danger" }> = {
  update: { text: "Update available", tone: "accent" }, missing: { text: "Not installed", tone: "muted" },
  current: { text: "Up to date", tone: "success" }, newer: { text: "Newer than offered", tone: "muted" },
  unknown: { text: "Version check failed", tone: "danger" },
};
/** Only a missing or outdated runtime with a resolved offered version can be installed. */
export const actionable = (row: RuntimeVersion) => Boolean(row.offered) && (row.state === "missing" || row.state === "update");
export const versions = (row: RuntimeVersion) => row.state === "current" ? row.installed ?? "" : row.state === "newer" ? `${row.installed} (offered ${row.offered})`
  : row.state === "unknown" ? row.installed ?? "not installed" : `${row.installed ?? "not installed"} → ${row.offered}`;
export const plural = (count: number) => `${count} runtime${count === 1 ? "" : "s"}`;
export const IMPACT = [
  "Installs as root in the environment's container.",
  "Runs already using a runtime may fail while its files are replaced.",
  "Reload project or Restart service to use a new runtime.",
];
