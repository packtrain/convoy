import { dirname } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { ServiceLogs } from "../../service/logs.js";
import { run } from "../render.js";
import { ServiceClient } from "../../service/client.js";
import { serviceServer } from "../../service/server.js";

const [mode, socket] = process.argv.slice(2);
if (!socket) throw new Error("Pass server|client and a temporary socket path");
if (mode === "server") {
  let status = "streaming";
  const logs = new ServiceLogs(dirname(socket));
  const supervisor = setInterval(() => {}, 1000);
  writeFileSync(socket + ".pid", String(process.pid));
  let latest = 129;
  const createControl = () => serviceServer(() => ({ pid: process.pid, stopping: false, profiles: ["alpha", "beta"].map(profile => ({ profile, status: "online", attempts: 1, activeRuns: status === "streaming" ? 1 : 0 })) }), async request => {
    if (request.op === "logs") return logs.read(request.after, request.profile);
    if (request.op === "status") return { pid: process.pid, stopping: false, profiles: [] };
    if (request.op === "stop") { logs.add("service", "Service stopped; saved logs remain"); return {}; }
    if (request.op === "runs.cancel") {
      if (request.runId !== "run-1" || status !== "streaming") throw new Error("Selected run is no longer active");
      status = "cancelled"; logs.add(request.profile!, "run cancelled");
      control.publish({ phase: "released", threadId: request.threadId }, request.profile);
      return { result: { cancelled: true, runId: request.runId } };
    }
    if (request.op === "inspect") return { result: { nodeVersion: process.version, profiles: ["alpha", "beta"].map(profile => ({ profile, projectId: profile, endpoint: "https://demo.convex.cloud", concurrency: 2, isolated: true })) } };
    if (request.op === "runs.logs") {
      const make = (order: number) => {
        const eventJson = JSON.stringify({ order, nested: { text: (order === 128 ? "LARGE_JSON_" : "RAW_JSON_") + "x".repeat(order === 128 ? 70000 : 2100) }, profile: request.profile });
        const offset = request.eventOffset ?? 0;
        const end = request.eventOrder !== undefined ? Math.min(eventJson.length, offset + 16384) : eventJson.length > 4096 ? 0 : eventJson.length;
        return { order, eventJson: eventJson.slice(offset, end), truncated: false, bytes: Buffer.byteLength(eventJson), length: eventJson.length, nextOffset: end < eventJson.length ? end : undefined, fidelity: "fixture stored JSON" };
      };
      const first = request.eventOrder ?? (request.chunkBefore !== undefined ? Math.max(0, Math.min(latest + 1, request.chunkBefore) - 10) : (request.chunkAfter ?? -1) + 1);
      const last = request.eventOrder ?? Math.min(latest, first + 9);
      const page = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => make(first + i));
      return { result: { raw: true, run: { status }, page, cursor: page.at(-1)?.order ?? -1, latest,
        hasMore: request.chunkBefore !== undefined ? first > 0 : last < latest } };
    }
    if (request.op === "runs.history") return { result: { page: ["run-1", "run-2"].map(runId => ({ threadId: request.threadId, messageId: runId, runId, status: runId === "run-1" ? status : "completed", createdAt: 1, updatedAt: 2 })), isDone: true, continueCursor: "" } };
    return { result: { page: Array.from({ length: 20 }, (_, index) => ({ threadId: `${request.profile}-${request.pageCursor ?? "first"}-${index}`, title: `${request.profile} 日本語 work ${index}`, status,
      associatedTaskId: index > 0 ? "same-task" : undefined, associatedTaskRef: index > 0 ? "DEMO-1" : undefined, cliType: "codex", lastActivityAt: Date.now() })), isDone: Boolean(request.pageCursor), continueCursor: "second" } };
  }, () => { control.dispose(); control.server.close(); });
  let control = createControl();
  await new Promise<void>(resolve => control.server.listen(socket, resolve));
  process.on("SIGUSR2", () => {
    control = createControl(); control.server.listen(socket); logs.add("service", "Service restarted");
  });
  process.on("SIGUSR1", () => { status = "streaming"; latest += 100; control.publish({ phase: "streaming", threadId: "alpha-first-0" }, "alpha"); });
  process.on("SIGTERM", () => { clearInterval(supervisor); control.dispose(); control.server.close(() => process.exit(0)); });
  console.log("ready");
} else {
  await run([{ id: "fixture", name: "Fixture", transport: "unix", endpoint: socket,
    start: async () => { process.kill(Number(readFileSync(socket + ".pid", "utf8")), "SIGUSR2"); },
    savedLogs: async (after, profile) => new ServiceLogs(dirname(socket), undefined, "reader").read(after, profile),
    open: signal => ServiceClient.open(socket, signal) }]);
}
