import type { Binding, ManagedCredentialStatus, ManagedRuntime } from "../../../lib/config/credentials/validators.js";

export type Runtime = ManagedRuntime;
export type Entry = ManagedCredentialStatus["entries"][number];
export type Draft = Record<string, Binding>;
export interface BindingRow { key: string; profile: string; runtime: Runtime; saved: Binding; project?: ManagedCredentialStatus["projects"][number] }
