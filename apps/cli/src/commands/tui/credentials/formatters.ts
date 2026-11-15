import { MANAGED_PROVIDER_LABELS } from "../../../lib/config/provider-keys.js";
import { MANAGED_RUNTIME_LABELS, type Binding } from "../../../lib/config/credentials/validators.js";
import { pendingProfiles, sameBinding } from "./workflow.js";
import type { BindingRow, Entry } from "./validators.js";

export const providerLabel = (entry: Pick<Entry, "provider" | "region">) =>
  `${MANAGED_PROVIDER_LABELS[entry.provider] ?? entry.provider}${entry.region ? ` ${entry.region}` : ""}`;
export const assignmentNames = (rows: BindingRow[]) => rows.map(row => `${row.profile} (${MANAGED_RUNTIME_LABELS[row.runtime]})`).join(", ") || "none";

export function entryLine(entry: Entry, assigned: number) {
  return `${entry.name} · ${entry.enabled ? "enabled" : "disabled"} · ${assigned} assigned · rev ${entry.revision} · ${providerLabel(entry)}${entry.provider === "cursor" ? "" : " · API key"}`;
}

export function bindingLabel(binding: Binding, entries: Entry[], shared = false) {
  if (binding.mode === "native") return shared ? "Native login (this account)" : "Native login (private shell)";
  if (binding.mode === "disabled") return "Unassigned · runtime disabled";
  return `${binding.name}${entries.find(entry => entry.name === binding.name)?.enabled === false ? " (disabled)" : ""}`;
}

/** Service-reported application of the saved binding; never inferred from a save. Auth outcomes are Codex-only. */
export function delivery(row: BindingRow) {
  const project = row.project;
  if (!project || project.pending === undefined) return project ? `applied unknown (${project.state})` : "default native login";
  if (["failed", "blocked"].includes(project.state)) return `connection ${project.state}`;
  if (pendingProfiles([row]).length) return "pending reconnect · [u] Reload project";
  if (row.runtime !== "codex") return "applied";
  const result = project.authResult?.result;
  if (result && !["configured", "request-succeeded"].includes(result)) return `failed: ${result}`;
  return project.verified ? "applied · request succeeded" : "applied";
}

/** Draft effect beside a row, including the same-runtime credential it replaces. */
export function draftNote(row: BindingRow, value: Binding) {
  if (sameBinding(value, row.saved)) return delivery(row);
  if (value.mode === "managed" && row.saved.mode === "managed") return `unsaved · replaces ${row.saved.name}`;
  return `unsaved · was ${row.saved.mode === "managed" ? row.saved.name : row.saved.mode === "native" ? "native login" : "unassigned"}`;
}
