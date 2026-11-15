import type { ActionState } from "./actions/validators.js";
import { z } from "zod";
import type { ServiceInspection, ServiceResponse, WorkerState } from "../service/validators.js";

const threadSchema = z.object({
  threadId: z.string(), title: z.string(), status: z.string().optional(),
  kind: z.string().optional(), associatedTaskId: z.string().optional(), associatedTaskRef: z.string().optional(),
  cliType: z.string().optional(), lastActivityAt: z.number(),
  hasPendingUserMessages: z.boolean().optional(),
});
const runSchema = z.object({
  threadId: z.string(), messageId: z.string(), runId: z.string().optional(),
  status: z.string(), createdAt: z.number(), updatedAt: z.number(),
});
export const threadPageSchema = z.object({ page: z.array(threadSchema).max(20), isDone: z.boolean(), continueCursor: z.string().max(8192) });
export const runPageSchema = z.object({ page: z.array(runSchema).max(20), isDone: z.boolean(), continueCursor: z.string().max(8192) });
export type ThreadRow = z.infer<typeof threadSchema>;
export type RunRow = z.infer<typeof runSchema>;
export type Row = { profile: string; thread: ThreadRow; run?: RunRow };
export type Health = "unknown" | "connecting" | "connected" | "reconnecting" | "incompatible";
export interface Observation {
  health: Health;
  profiles: WorkerState[];
  version?: string;
  snapshot?: ServiceResponse;
  inspection?: ServiceInspection;
  guidance?: string[];
  environmentStatus?: Record<string, unknown>;
  checkingEnvironment?: boolean;
  environmentError?: string;
}
export interface Scope { connection: number; profile?: string; details: boolean; addProject?: boolean }
export interface PagePosition { profile: string; cursor?: string }
export interface BrowseState {
  environment?: "delete" | "create" | "update" | "start" | "stop" | "restart";
  onboarding?: boolean;
  actions?: boolean;
  /** Credentials panel; "editing" (draft, form, popup or project editor) locks navigation like a workflow. */
  credentials?: "view" | "editing";
  /** Managed agent runtimes panel; "editing" while its batch popup is open. */
  runtimes?: "view" | "editing";
  action?: ActionState;
  scope: Scope;
  observations: Observation[];
  rows: Row[];
  loading: boolean;
  stale: boolean;
  error?: string;
  next?: PagePosition;
  history?: Row;
  detail?: Row;
  pageNumber: number;
  updatedAt?: number;
}
