import { z } from "zod";
import type { LoginRuntime } from "../project/validators.js";

export const environmentName = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export const packageVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
/** Spec: docs/specs/cli-shared-environments.md#mode */
export const environmentModeSchema = z.enum(["shared", "isolated"]);
export type EnvironmentMode = z.infer<typeof environmentModeSchema>;
export const environmentSchema = z.object({
  schema: z.literal(1), name: environmentName, owner: z.string().uuid(),
  daemon: z.string().min(1), version: packageVersion,
  networkMode: z.enum(["open", "strict"]).optional(),
  /** Missing means isolated: records from before CLI 0.139.0. */
  mode: environmentModeSchema.optional(),
  /** Host folders bind-mounted at the same path; shared mode only. Spec: docs/specs/cli-shared-environments.md#host-folder-mounts */
  mounts: z.array(z.string().regex(/^\/[^,\n]*$/)).max(32).optional(),
  deployment: z.string().regex(/^[a-z0-9-]*$/), domains: z.string().regex(/^[a-zA-Z0-9.,-]*$/),
}).strict();
export type Environment = z.infer<typeof environmentSchema>;
export const localEnvironmentSchema = z.object({ schema: z.literal(1), mode: environmentModeSchema }).strict();
export type LocalEnvironment = z.infer<typeof localEnvironmentSchema>;
/** What isolated mode's prerequisites depend on; `userns` holds bubblewrap's error when its probe failed. */
export interface LauncherFacts { bwrap?: string; userns?: string; apparmor: boolean; node: string; nodeRootOwned: boolean; cli: string; cliRootOwned: boolean }
export interface Prerequisite { name: string; fix?: string }
export const LABEL = "build.convoy.environment";
export const OWNER = "build.convoy.owner";
export const HELPER = "/usr/local/libexec/convoy-environment";
export const isolatedMounts = {
  workspace: "/workspace", projects: "/var/lib/convoy-projects", config: "/home/node/.config/convoy",
  service: "/home/node/.convoy", installation: "/opt/convoy",
} as const;
/** One `home` volume replaces `config` and `service`. Spec: docs/specs/cli-shared-environments.md#home */
export const sharedMounts = { workspace: "/workspace", home: "/home/node", installation: "/opt/convoy" } as const;
export function volumeMounts(environment: Environment): Record<string, string> { return environment.mode === "shared" ? sharedMounts : isolatedMounts; }
/** Baked into each managed image, so the helper and the container CLI read the mode and mounts. */
export const IMAGE_RECORD = "/etc/convoy-environment.json";
export const imageRecordSchema = z.object({ mode: environmentModeSchema, mounts: z.array(z.string()) }).strict();
// Volumes older CLIs created; delete removes them, nothing else touches them (OS-2262).
export const retiredMounts = ["browsers"] as const;
export function containerName(environment: Environment) { return `convoy-${environment.name}-${environment.owner.slice(0, 8)}`; }

export const dockerInfoSchema = z.object({ ID: z.string().min(1), OSType: z.string() });
export const containerSchema = z.array(z.object({
  Id: z.string().min(1), State: z.object({ Running: z.boolean() }),
  Config: z.object({ Labels: z.record(z.string(), z.string()).nullable().optional() }),
})).length(1);
export const volumeSchema = z.array(z.object({ Labels: z.record(z.string(), z.string()).nullable().optional() })).length(1);
export const setupRequestSchema = z.object({
  guided: z.literal(true).optional(),
  directory: z.string().min(1).max(256),
  options: z.object({ url: z.string().url(), apiKey: z.string().min(1).max(4096),
    profileName: z.string().trim().min(1).max(50).optional(),
    profileKey: z.string().min(1).max(80), project: z.string().max(256).optional(),
    create: z.boolean().optional(), org: z.string().max(256).optional(),
    projectName: z.string().max(256).optional(), projectAlias: z.string().max(5).optional(),
    reuse: z.boolean().optional(), clone: z.string().max(4096).optional(),
  }).strict(),
}).strict();

export const targetStatusSchema = z.object({
  serviceVersion: packageVersion.nullable(), serviceRunning: z.boolean(),
  recoveryPending: z.boolean(),
});

/** `mounts` holds the folders as typed; `resolveMounts` checks them. */
export const environmentFormSchema = environmentSchema.pick({ name: true, deployment: true, domains: true, networkMode: true, mode: true })
  .extend({ mounts: z.array(z.string().max(4096)).max(32).optional() });
export type EnvironmentForm = z.infer<typeof environmentFormSchema>;
export type EnvironmentOperation = "delete" | "status" | "start" | "stop" | "restart" | "update";
export type EnvironmentProgress = (message: string) => void;
export type EnvironmentProposal = EnvironmentForm & { version: string; owner?: string; daemon?: string; install: boolean };
export interface UpdateProposal { installed: string; proposed: string }
/** "unknown": the offered version could not be resolved, so nothing can be installed. */
export type RuntimeState = "missing" | "update" | "current" | "newer" | "unknown";
export interface RuntimeVersion { runtime: LoginRuntime; label: string; installed?: string; offered?: string; state: RuntimeState; error?: string }
export interface EnvironmentMaintenance {
  status(): Promise<Record<string, unknown>>;
  release(): Promise<UpdateProposal>;
  execute(operation: EnvironmentOperation, progress: EnvironmentProgress, options?: { version?: string }): Promise<Record<string, unknown>>;
  /** Agent runtimes in the container. Spec: docs/specs/cli-tui.md#agent-runtimes-cli-01240-os-2236 */
  runtimes?(): Promise<RuntimeVersion[]>;
  installRuntime?(runtime: LoginRuntime, version: string, progress: EnvironmentProgress): Promise<string>;
}
