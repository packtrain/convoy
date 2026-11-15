import { profileKeySchema, type WorkerLaunchConfig } from "../project/validators.js";
import { ProfileSchema } from "../../lib/config/types.js";
import { authResultSchema, authDescriptorSchema, credentialMutationSchema, type AuthDescriptor, type CredentialMutation } from "../../lib/config/credentials/validators.js";
import { environmentModeSchema, type EnvironmentMode } from "../environment/validators.js";
import { z } from "zod";

export const requestSchema = z.object({
  v: z.literal(1), id: z.string().min(1).max(80),
  op: z.enum(["status", "inspect", "logs", "stop", "reconcile", "project.remove", "project.add", "credentials.mutate", "hello", "subscribe", "outcome", "runs.list", "runs.get", "runs.history", "runs.logs", "runs.cancel"]),
  epoch: z.string().uuid().optional(),
  requestId: z.string().min(1).max(80).optional(),
  threadId: z.string().min(1).max(256).optional(), runId: z.string().min(1).max(256).optional(),
  messageId: z.string().min(1).max(256).optional(),
  pageCursor: z.string().max(8192).optional(), limit: z.number().int().min(1).max(50).optional(),
  rawLogs: z.boolean().optional(),
  chunkBefore: z.number().int().nonnegative().optional(),
  eventOrder: z.number().int().nonnegative().optional(),
  eventOffset: z.number().int().nonnegative().optional(),
  chunkAfter: z.number().int().min(-1).optional(),
  credentials: credentialMutationSchema.optional(),
  interrupt: z.boolean().optional(), pause: z.boolean().optional(),
  registration: z.object({ key: profileKeySchema, profile: ProfileSchema }).optional(),
  after: z.number().int().nonnegative().optional(),
  profile: profileKeySchema.optional(),
}).strict();
export type ServiceRequest = z.infer<typeof requestSchema>;
export const statusSchema = z.enum(["connecting", "online", "retrying", "blocked", "failed", "stopped"]);
export type WorkerStatus = z.infer<typeof statusSchema>;
export const logSchema = z.object({
  seq: z.number().int().positive(), ts: z.number(), profile: z.string().max(80), message: z.string().max(256),
});
export type LogEntry = z.infer<typeof logSchema>;
export const workerStateSchema = z.object({
  authResult: authResultSchema.optional(),
  auth: authDescriptorSchema.optional(), desiredAuth: authDescriptorSchema.optional(),
  displayName: z.string().max(100).optional(),
  profile: profileKeySchema, status: statusSchema, attempts: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
  identity: z.string().optional(), activeRuns: z.number().int().nonnegative().optional(),
  pending: z.boolean().optional(), paused: z.boolean().optional(),
  /** Runtimes the launcher detected at the last worker start; kept while paused. */
  runtimes: z.array(z.enum(["codex", "claude-code", "opencode", "cursor"])).max(4).optional(),
  /** Service-owned guidance for the latest failed attempt; never worker text. */
  warning: z.string().max(256).optional(),
});
export type WorkerState = z.infer<typeof workerStateSchema>;
export const serviceInspectionSchema = z.object({
  nodeVersion: z.string(), mode: environmentModeSchema.optional(),
  profiles: z.array(z.object({
    profile: profileKeySchema, projectId: z.string(), endpoint: z.string(), mode: environmentModeSchema.optional(),
    concurrency: z.number().optional(), isolated: z.boolean().optional(),
    streaming: z.boolean().optional(),
  })).max(128),
});
export type ServiceInspection = z.infer<typeof serviceInspectionSchema>;
export function toServiceInspection(entries: ServiceProfile[], mode?: EnvironmentMode): ServiceInspection {
  return { nodeVersion: process.version, mode, profiles: entries.map(({ key, config }) => ({
    profile: key, projectId: config.projectId,
    endpoint: new URL(config.convexUrl).origin, mode: config.mode ?? "isolated",
    concurrency: config.concurrency, isolated: config.isolated, streaming: config.partialStreaming,
  })) };
}
export const responseSchema = z.object({
  v: z.literal(1), id: z.string().min(1).max(80), ok: z.boolean(), error: z.string().max(512).optional(),
  code: z.string().max(80).optional(), epoch: z.string().uuid().optional(),
  event: z.enum(["snapshot", "change", "heartbeat"]).optional(),
  result: z.unknown().optional(),
  outcome: z.enum(["pending", "complete", "unknown"]).optional(),
  capabilities: z.array(z.string()).optional(), version: z.string().max(80).optional(),
  registered: z.boolean().optional(), applied: z.boolean().optional(),
  configurationError: z.boolean().optional(),
  pid: z.number().int().positive().optional(), stopping: z.boolean().optional(),
  mode: environmentModeSchema.optional(),
  profiles: z.array(workerStateSchema).max(128).optional(),
  entries: z.array(logSchema).max(100).optional(), cursor: z.number().int().nonnegative().optional(), gap: z.boolean().optional(),
});
export type ServiceResponse = z.infer<typeof responseSchema>;
export const startupFailureSchema = z.object({ error: z.string().min(1).max(512) }).strict();
export const FRAME_LIMIT = 65536;
export const RESPONSE_LIMIT = 262144;

export interface ServiceProfile {
  key: string;
  displayName?: string;
  identity: string;
  config: WorkerLaunchConfig;
  /** Project folder of a shared registration; isolated workers get theirs from the launcher. */
  path?: string;
  auth?: AuthDescriptor;
}

export type ProjectRegistration = NonNullable<ServiceRequest["registration"]>;
export interface ServiceManagement {
  /** Reported by status, subscribe and inspect. */
  mode?: EnvironmentMode;
  /** `accounted`: identities of live workers whose applied auth does not name a removed entry. */
  credentials?(request: CredentialMutation, accounted?: string[]): void | Promise<void>;
  snapshot(): ServiceProfile[] | Promise<ServiceProfile[]>;
  register?(registration: ProjectRegistration): void | Promise<void>;
  removal?(profile: string): { identity: string; last: boolean };
  remove?(profile: string, identity: string): void;
}
