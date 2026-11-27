import { getCliVersion } from "../../lib/version.js";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { ServiceOperationError } from "./errors.js";
import { frameParser } from "./parsers.js";
import { FRAME_LIMIT, RESPONSE_LIMIT, requestSchema, type ServiceRequest, type ServiceResponse } from "./validators.js";

export const CAPABILITIES = ["credentials-v1", "attach-v1", "runs-v1", "outcomes-v1", "host-cli-v1", "inspect-v1", "raw-logs-v1", "project-setup-v1", "local-shared-v1", "credentials-shared-v1", "project-configure-v1"];
const MUTATIONS = new Set(["stop", "reconcile", "project.add", "project.remove", "credentials.mutate", "project.configure", "runs.cancel"]);

export function serviceServer(
  snapshot: () => Omit<ServiceResponse, "v" | "id" | "ok">,
  execute: (request: ServiceRequest) => Promise<Partial<ServiceResponse>>,
  stopped: () => void,
) {
  const epoch = randomUUID();
  let cursor = 0;
  let stopReplies = 0;
  let stopNotified = false;
  let retainedBytes = 0;
  const events: ServiceResponse[] = [];
  const clients = new Set<Socket>();
  const subscriptions = new Map<Socket, { id: string; profile?: string }>();
  type Outcome = { hash: string; at: number; result?: ServiceResponse; promise: Promise<ServiceResponse> };
  const outcomes = new Map<string, Outcome>();
  const send = (socket: Socket, response: ServiceResponse) => {
    if (socket.destroyed) return;
    let frame = JSON.stringify(response) + "\n";
    if (Buffer.byteLength(frame) > RESPONSE_LIMIT) frame = JSON.stringify({ v: 1, id: response.id, ok: false, epoch, code: "response_too_large", error: "Response exceeds frame limit. Reduce the requested page size." }) + "\n";
    if (socket.writableLength + Buffer.byteLength(frame) > RESPONSE_LIMIT * 2) {
      socket.destroy(); return;
    }
    socket.write(frame);
  };
  const filtered = (response: ServiceResponse, profile?: string): ServiceResponse => ({ ...response,
    ...(response.profiles && { profiles: response.profiles.filter(p => !profile || p.profile === profile) }),
  });
  const publish = (result?: unknown, profile?: string) => {
    const response: ServiceResponse = { v: 1, id: "event", ok: true, epoch, event: "change", cursor: ++cursor,
      ...(result === undefined ? snapshot() : { result }) };
    // A profile-specific execution event never reaches another profile's subscriber.
    const stored = structuredClone({ ...response, result: result === undefined ? undefined : { profile, event: result } });
    const size = Buffer.byteLength(JSON.stringify(stored));
    events.push(stored); retainedBytes += size;
    while (events.length > 512 || retainedBytes > 2 * RESPONSE_LIMIT) retainedBytes -= Buffer.byteLength(JSON.stringify(events.shift()));
    for (const [socket, sub] of subscriptions) {
      if (profile && sub.profile && sub.profile !== profile) continue;
      send(socket, filtered({ ...stored, id: sub.id }, sub.profile));
    }
  };
  let previous = "";
  const timer = setInterval(() => {
    const value = JSON.stringify(snapshot());
    if (value !== previous) { previous = value; publish(); }
    for (const [socket, sub] of subscriptions) send(socket, { v: 1, id: sub.id, ok: true, epoch, event: "heartbeat", cursor });
  }, 1000);
  timer.unref();
  const server = createServer(socket => {
    clients.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => { clients.delete(socket); subscriptions.delete(socket); });
    socket.setTimeout(45000, () => socket.destroy());
    let negotiated = false;
    let rejected = false;
    let inFlight = 0;
    const parse = frameParser(FRAME_LIMIT, value => {
      if (rejected || socket.destroyed) return;
      const parsed = requestSchema.safeParse(value);
      const id = typeof value === "object" && value && "id" in value && typeof value.id === "string" && value.id.length <= 80 && value.id ? value.id : "invalid";
      const fail = (code: string, error: string) => send(socket, { v: 1, id, ok: false, code, error, epoch });
      if (!parsed.success) { rejected = true; fail("invalid_request", "Invalid version 1 service request."); socket.end(); return; }
      const request = parsed.data;
      const base = { v: 1 as const, id, ok: true, epoch };
      if (request.op === "hello") { negotiated = true; send(socket, { ...base, capabilities: CAPABILITIES, version: getCliVersion() }); return; }
      if (!negotiated) { fail("hello_required", "Negotiate hello before service operations."); return; }
      if (request.op === "subscribe") {
        if (subscriptions.has(socket)) { fail("already_subscribed", "Connection already has a subscription."); return; }
        if (request.profile && !snapshot().profiles?.some(p => p.profile === request.profile)) { fail("unknown_profile", "Unknown service profile."); return; }
        const gap = request.after !== undefined && (request.epoch !== epoch || request.after > cursor || request.after < (events[0]?.cursor ?? cursor + 1) - 1);
        // Registration and snapshot are synchronous, so no event can fall between them.
        subscriptions.set(socket, { id, profile: request.profile });
        if (request.after !== undefined && !gap) {
          for (const event of events) {
            const payload = event.result as { profile?: string } | undefined;
            if (event.cursor! > request.after && (!request.profile || !payload?.profile || request.profile === payload.profile)) send(socket, filtered({ ...event, id }, request.profile));
          }
        }
        send(socket, filtered({ ...base, ...snapshot(), event: "snapshot", cursor, gap }, request.profile));
        return;
      }
      if (request.op === "outcome") {
        const found = request.epoch === epoch && request.requestId ? outcomes.get(request.requestId) : undefined;
        const current = found && (!found.result || Date.now() - found.at < 600000) ? found : undefined;
        send(socket, { ...base, outcome: current ? current.result ? "complete" : "pending" : "unknown", result: current?.result }); return;
      }
      if (inFlight >= 8) { fail("busy", "Too many pending requests on this connection."); return; }
      const mutation = MUTATIONS.has(request.op);
      if (mutation && request.epoch !== epoch) { fail("stale_epoch", "Service restarted. Inspect state before issuing a new command."); return; }
      let operation: Promise<ServiceResponse>;
      if (mutation) {
        for (const [key, entry] of outcomes) if (entry.result && Date.now() - entry.at >= 600000) outcomes.delete(key);
        const hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
        const existing = outcomes.get(id);
        if (existing && existing.hash !== hash) { fail("request_conflict", "Request ID already used for different arguments."); return; }
        if (existing) operation = existing.promise;
        else {
          if ([...outcomes.values()].filter(o => !o.result).length >= 64) { fail("busy", "Service mutation queue is full."); return; }
          while (outcomes.size >= 1024) {
            const oldest = [...outcomes].find(([, o]) => o.result);
            if (!oldest) break;
            outcomes.delete(oldest[0]);
          }
          operation = perform();
          const entry: Outcome = { hash, at: Date.now(), promise: operation };
          outcomes.set(id, entry);
          void operation.then(result => { entry.result = result; entry.at = Date.now(); });
        }
      } else operation = perform();
      inFlight++;
      if (request.op === "stop") stopReplies++;
      void operation.then(result => {
        send(socket, result);
        if (request.op === "stop") {
          let drained = false;
          const finishReply = () => {
            if (drained) return;
            drained = true; clearTimeout(deadline); socket.off("close", finishReply);
            if (--stopReplies === 0 && !stopNotified) { stopNotified = true; stopped(); }
          };
          const deadline = setTimeout(finishReply, 1000);
          if (socket.destroyed) finishReply();
          else { socket.once("close", finishReply); socket.end(finishReply); }
        }
      }).finally(() => { inFlight--; });
      async function perform(): Promise<ServiceResponse> {
        try { return { ...base, ...await execute(request) }; }
        catch (error) {
          const message = error instanceof ServiceOperationError ? error.message : error instanceof Error && /^(Project connection|Invalid configuration|Service is stopping|Missing|No isolated|Registration changed|Managed |Invalid managed|Claude Code needs|Codex needs|Cursor needs|OpenCode needs|Unsafe credential|Credential directory|Cannot read managed|Cannot inspect project registry|Unknown service profile|Selected run|Worker cleanup)/.test(error.message)
            ? error.message.slice(0, 512) : "Service operation failed. Check selected profile, backend access and current state before retrying.";
          return { ...base, ok: false, code: "operation_failed", error: message };
        }
      }
    }, () => socket.destroy());
    socket.on("data", parse); socket.on("end", () => parse.end());
  });
  server.maxConnections = 64;
  return { server, publish, dispose() { clearInterval(timer); for (const client of clients) client.destroy(); } };
}
