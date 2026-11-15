import { z } from "zod";
import type { ServiceRequest, ServiceResponse } from "../../service/validators.js";

export const eventSchema = z.object({
  order: z.number().int().nonnegative(), eventJson: z.string(), truncated: z.literal(false),
  bytes: z.number().int().nonnegative(), length: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().optional(), fidelity: z.string(),
});
export const pageSchema = z.object({
  raw: z.literal(true), run: z.object({ status: z.string() }),
  page: z.array(eventSchema).max(10), cursor: z.number().int(), hasMore: z.boolean(), latest: z.number().int(),
});
export type LogEvent = z.infer<typeof eventSchema>;
export type ReadLogs = (args: Pick<ServiceRequest, "chunkAfter" | "chunkBefore" | "eventOrder" | "eventOffset">) => Promise<ServiceResponse>;
export const WINDOW_BYTES = 128 * 1024;
export const WINDOW_EVENTS = 100;
export const EVENT_BYTES = 64 * 1024;
export interface LogState {
  events: LogEvent[]; bytes: number; following: boolean; loading: boolean;
  latest: number; seen: number; error?: string; status?: string;
}
