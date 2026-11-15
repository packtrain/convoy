import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { runService } from "./workflow.js";
import { servicePaths } from "./paths.js";
import { serviceRequest } from "./client.js";

it("runs two actual terminal clients and run commands against the service", async () => {
  const home = mkdtempSync(join(tmpdir(), "cv-attach-"));
  const calls: Array<{ path: string; args: Array<Record<string, unknown>> }> = [];
  const backend = createServer((request, response) => {
    let body = "";
    request.on("data", data => { body += data; });
    request.on("end", () => {
      const call = JSON.parse(body); calls.push(call);
      const value = call.path.endsWith("listServiceSummaries") ? { page: [{ threadId: "thread-a", status: "streaming" }], isDone: true, continueCursor: "" }
        : call.path.endsWith("getSummary") ? { threadId: "thread-a", projectId: "project-a" }
        : call.path.endsWith("listServiceRuns") ? { page: [{ messageId: "message-a", runId: "run-a", status: "streaming" }], isDone: true, continueCursor: "" }
        : call.path.endsWith("getServiceRunLogs") ? { run: { status: "completed" }, page: [{ order: 0, eventJson: '{"kind":"text","text":"hello"}', truncated: false }], cursor: 0, hasMore: false } : null;
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ status: "success", value }));
    });
  });
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as import("node:net").AddressInfo).port;
  const paths = servicePaths(home);
  const entries = ["a", "b"].map(key => ({ key, identity: key.repeat(64), config: {
    convexUrl: `http://127.0.0.1:${port}`, apiKey: `private-${key}`, projectId: `project-${key}`, organizationId: "org", profileKey: key,
  } }));
  const service = await runService(paths, entries, () => spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"]), 1000, 100);
  const children: ChildProcessWithoutNullStreams[] = [];
  const launch = (args: string[]) => {
    const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("../../../bin/convoy.ts", import.meta.url)), ...args], { env: { ...process.env, HOME: home } });
    children.push(child); let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    const done = new Promise<number | null>(resolve => child.once("close", resolve));
    return { child, done, output: () => stdout, error: () => stderr };
  };
  try {
    const a = launch(["attach", "--profile", "a", "--json"]), b = launch(["attach", "--profile", "b", "--json"]);
    await vi.waitFor(() => { expect(a.output()).toContain('"snapshot"'); expect(b.output()).toContain('"snapshot"'); }, { timeout: 10000 });
    expect(a.output()).not.toContain('"profile":"b"');
    a.child.kill("SIGINT"); expect(await a.done).toBe(0);
    expect((await serviceRequest(paths.socket, { op: "status" })).profiles).toHaveLength(2);
    expect(b.child.exitCode).toBeNull();
    for (const args of [["list"], ["get", "thread-a"], ["history", "thread-a"], ["logs", "thread-a", "--message", "message-a"], ["cancel", "thread-a", "--run", "run-a"]]) {
      const command = launch(["service", "runs", ...args, "--profile", "a", "--json"]);
      expect(await command.done, command.error()).toBe(0);
      expect(command.output()).not.toContain("private-a");
      expect(command.output().trim()).not.toBe("");
    }
    const cancellation = calls.find(call => call.path.endsWith("cancelProcessing"));
    expect(cancellation?.args[0]).toMatchObject({ apiKey: "private-a", threadId: "thread-a", expectedRunId: "run-a" });
    b.child.kill("SIGINT"); expect(await b.done).toBe(0);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await service.close(); await new Promise<void>(resolve => backend.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);

it("detaches a real attach subprocess when stdout is blocked", async () => {
  const { serviceServer } = await import("./server.js");
  const home = mkdtempSync(join(tmpdir(), "cv-blocked-")); const paths = servicePaths(home);
  const control = serviceServer(() => ({ pid: 1, profiles: [] }), async () => ({}), () => {});
  await new Promise<void>(resolve => control.server.listen(paths.socket, resolve));
  const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("../../../bin/convoy.ts", import.meta.url)), "attach", "--json"], { env: { ...process.env, HOME: home } });
  // Deliberately never read child.stdout. The OS pipe eventually fills.
  let stderr = ""; child.stderr.on("data", data => { stderr += data; });
  const publish = setInterval(() => { for (let i = 0; i < 20; i++) control.publish({ text: "x".repeat(2000) }, "a"); }, 10);
  try {
    await vi.waitFor(() => expect(child.exitCode, stderr).toBe(1), { timeout: 8000 });
    expect(stderr).toMatch(/stdout.*(slow|blocked)|output.*(slow|blocked)/i);
    expect(control.server.listening).toBe(true);
  } finally { clearInterval(publish); child.kill("SIGKILL"); child.stdout.destroy(); control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(home, { recursive: true, force: true }); }
}, 10000);
