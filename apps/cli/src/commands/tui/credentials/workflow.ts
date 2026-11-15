import { managedRuntimeSchema, runtimeDescriptor, type Binding, type CredentialMutation, type ManagedCredentialStatus } from "../../../lib/config/credentials/validators.js";
import type { WorkerState } from "../../service/validators.js";
import type { BindingRow, Draft, Entry, Runtime } from "./validators.js";

/** Runtimes each provider's key serves (OS-2108, OS-2016, OS-2017). */
const PROVIDER_RUNTIMES: Record<string, Runtime[]> = {
  openai: ["codex"], anthropic: ["claude-code"], cursor: ["cursor"], mantle: ["codex", "claude-code"], bedrock: ["codex", "claude-code"],
};
export const entryRuntimes = (entry: Entry): Runtime[] => Object.hasOwn(PROVIDER_RUNTIMES, entry.provider) ? PROVIDER_RUNTIMES[entry.provider] : [];
export const sameBinding = (a: Binding, b: Binding) => JSON.stringify(a) === JSON.stringify(b);

function toBinding(descriptor?: { mode: string; name?: string }): Binding {
  if (descriptor?.name) return { mode: "managed", name: descriptor.name };
  return { mode: descriptor?.mode === "disabled" ? "disabled" : "native" };
}

/** Saved bindings of the observed projects, one row per project and runtime. */
export function bindingRows(status: ManagedCredentialStatus, profiles: WorkerState[], only: readonly Runtime[] = managedRuntimeSchema.options): BindingRow[] {
  return profiles.flatMap(worker => {
    const project = status.projects.find(p => (worker.identity && p.identity === worker.identity) || p.profiles.includes(worker.profile));
    return only.map(runtime => ({ key: `${worker.profile}:${runtime}`, profile: worker.profile, runtime, project,
      saved: toBinding(runtimeDescriptor(runtime, project?.desired)) }));
  });
}

/** Values a row can take; disabled entries stay listed only where already saved. */
export function choices(row: BindingRow, entries: Entry[], entry?: Entry): Binding[] {
  if (entry) {
    const assigned: Binding = { mode: "managed", name: entry.name };
    if (sameBinding(row.saved, assigned)) return [{ mode: "disabled" }, assigned];
    return entry.enabled ? [row.saved, assigned] : [row.saved];
  }
  return [{ mode: "native" }, ...entries
    .filter(value => entryRuntimes(value).includes(row.runtime) && (value.enabled || sameBinding(row.saved, { mode: "managed", name: value.name })))
    .map(value => ({ mode: "managed" as const, name: value.name })), { mode: "disabled" }];
}

/** Changed rows as bind requests; Codex omits `runtime`, as older services expect. */
export function draftMutations(rows: BindingRow[], draft: Draft) {
  return rows.filter(row => draft[row.key] && !sameBinding(draft[row.key], row.saved)).map(row => ({ row, request: {
    action: "bind", profile: row.profile, ...(row.runtime !== "codex" ? { runtime: row.runtime } : {}), binding: draft[row.key],
  } satisfies CredentialMutation }));
}

/** Saved assignments of one entry, which rotation, rollback and disabling affect. */
export const assignedRows = (rows: BindingRow[], name: string) => rows.filter(row => sameBinding(row.saved, { mode: "managed", name }));
/** Profiles whose worker reports an applied descriptor other than the saved one for a row's runtime. */
export const pendingProfiles = (rows: BindingRow[]) => [...new Set(rows.filter(({ project, runtime }) => project?.pending !== undefined && !["failed", "blocked"].includes(project.state)
  && JSON.stringify(runtimeDescriptor(runtime, project.applied) ?? null) !== JSON.stringify(runtimeDescriptor(runtime, project.desired) ?? null)).map(row => row.profile))];

export const rollbackRevision = (entry: Entry) => Math.max(0, ...entry.retainedRevisions.filter(revision => revision < entry.revision)) || undefined;
