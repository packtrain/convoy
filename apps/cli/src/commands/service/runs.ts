import { createConvexHttpClient } from "../../lib/config/convex-client.js";
import { toUserFacingError } from "../../lib/convex-error.js";
import { ServiceOperationError } from "./errors.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { api } from "../../convex/_generated/api.js";
import type { ServiceProfile, ServiceRequest } from "./validators.js";

const clients = new WeakMap<ServiceProfile, { url: string; key: string; client: ReturnType<typeof createConvexHttpClient> }>();
const safeMessages = new Set([
  "Selected run is no longer active", "Select a run ID before cancelling from the service",
  "Thread not found", "Message not found", "Thread does not belong to the selected project",
  "Invalid stored run log cursor",
]);

/** Backend requests use the selected worker credential, never client-supplied authority. */
export async function serviceRuns(entry: ServiceProfile, request: ServiceRequest): Promise<unknown> {
  let cached = clients.get(entry);
  if (!cached || cached.url !== entry.config.convexUrl || cached.key !== entry.config.apiKey) {
    cached = { url: entry.config.convexUrl, key: entry.config.apiKey, client: createConvexHttpClient({ url: entry.config.convexUrl, apiKey: entry.config.apiKey }) };
    clients.set(entry, cached);
  }
  try { return await readRuns(cached.client, entry, request); }
  catch (error) {
    const message = toUserFacingError(error);
    if (safeMessages.has(message)) throw new ServiceOperationError(message);
    // Do not expose arbitrary backend strings through the service's local-error allowlist.
    throw new Error("Backend run request failed.");
  }
}

async function readRuns(client: ReturnType<typeof createConvexHttpClient>, entry: ServiceProfile, request: ServiceRequest): Promise<unknown> {
  const apiKey = entry.config.apiKey;
  const projectId = entry.config.projectId as Id<"projects">;
  const paginationOpts = { numItems: request.limit ?? 20, cursor: request.pageCursor ?? null };
  if (request.op === "runs.list") return client.query(api.cli.threads.summaries.listServiceSummaries, { apiKey, projectId, paginationOpts });
  if (!request.threadId) throw new Error("Missing thread ID.");
  const threadId = request.threadId as Id<"cliThreads">;
  if (request.op === "runs.history") return client.query(api.cli.messages.listServiceRuns, { apiKey, projectId, threadId, paginationOpts });
  if (request.op === "runs.logs") {
    if (!request.messageId) throw new Error("Missing assistant message ID. Select one from runs history.");
    return client.query(api.cli.messages.getServiceRunLogs, { apiKey, projectId, threadId, messageId: request.messageId as Id<"cliMessages">, after: request.chunkAfter, ...(request.rawLogs ? { raw: true, before: request.chunkBefore, eventOrder: request.eventOrder, offset: request.eventOffset } : {}) });
  }
  const thread = await client.query(api.cli.threads.summaries.getSummary, { apiKey, threadId });
  if (!thread || thread.projectId !== projectId) throw new Error("Thread does not belong to the selected project");
  if (request.op === "runs.get") return thread;
  if (request.op === "runs.cancel") {
    if (!request.runId) throw new Error("Missing selected run ID.");
    await client.mutation(api.cli.threads.runControl.cancelProcessing, { apiKey, threadId, expectedRunId: request.runId });
    return { cancelled: true, threadId, runId: request.runId };
  }
  throw new Error("Missing supported run operation.");
}
