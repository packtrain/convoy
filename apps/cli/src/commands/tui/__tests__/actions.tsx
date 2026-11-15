import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render } from "ink";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { inputBound, settle } from "./test-helpers.js";
import { serviceServer } from "../../service/server.js";
import { ServiceClient } from "../../service/client.js";
import type { ServiceRequest } from "../../service/validators.js";

const directory = await mkdtemp(join(tmpdir(), "tui-actions-"));
const socket = join(directory, "s");
const requests: ServiceRequest[] = [];
let status = "streaming";
const snapshot = () => ({ pid: process.pid, stopping: false, profiles: [{ profile: "project", status: "online" as const, attempts: 1, activeRuns: status === "streaming" ? 1 : 0 }] });
const control = serviceServer(snapshot, async request => {
  requests.push(request);
  if (request.op === "inspect") return { result: { nodeVersion: process.version, profiles: [] } };
  if (request.op === "status") return snapshot();
  if (request.op === "runs.cancel") {
    assert.equal(request.runId, "12345678-1234-4234-8234-123456789012"); status = "cancelled";
    control.publish({ phase: "released", threadId: "ms7fhe8f3s99h133293hj0ycyh8gec37" }, "project");
    return { result: { cancelled: true } };
  }
  if (request.op === "runs.history") return { result: { page: [{ threadId: "ms7fhe8f3s99h133293hj0ycyh8gec37", messageId: "message", runId: "12345678-1234-4234-8234-123456789012", status, createdAt: 1, updatedAt: 1 }], isDone: true, continueCursor: "" } };
  if (request.op === "stop") return {};
  return { result: { page: [{ threadId: "ms7fhe8f3s99h133293hj0ycyh8gec37", title: "Work", status, lastActivityAt: 1 }], isDone: true, continueCursor: "" } };
}, () => {});
await new Promise<void>(resolve => control.server.listen(socket, resolve));
const connection = { id: "fixture", name: "Fixture", transport: "unix", endpoint: socket, open: (signal: AbortSignal) => ServiceClient.open(socket, signal),
  start: async () => {}, savedLogs: async () => ({ entries: [{ seq: 1, ts: 1, profile: "project", message: "SERVICE_STOPPED_PROOF" }], cursor: 1, gap: false }) };
const browser = new Browser([connection]);
const peer = new Browser([connection]);
const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 24, isTTY: true });
let raw = false;
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (value: boolean) => { raw = value; }, ref() {}, unref() {} });
const stderr = new PassThrough(); stderr.on("data", chunk => process.stderr.write(chunk));
let frame = "";
let screen = "";
let frames = 0;
stdout.on("data", chunk => { if (plain(chunk.toString()).trim()) { frame = plain(chunk.toString()); screen = stripVTControlCharacters(chunk.toString()); frames++; } });
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Terminal assertion timed out: " + frame); await new Promise<void>(resolve => setImmediate(resolve)); }
  await inputBound();
}
const instance = render(<App browser={browser} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, stderr: stderr as unknown as NodeJS.WriteStream, debug: true, exitOnCtrlC: false, patchConsole: false });
try {
  browser.start(); peer.start();
  await until(() => browser.getSnapshot().observations[0].health === "connected" && peer.getSnapshot().observations[0].health === "connected");
  // Actions, Credentials and + Add project sit between the environment and its project.
  for (let i = 0; i < 4; i++) { const before = frames; stdin.write("\u001b[B"); await until(() => frames > before); }
  await until(() => browser.getSnapshot().scope.profile === "project" && browser.getSnapshot().rows.length === 1);
  assert(/[⠖⠲⢲⢰⣰⣠⣄⣆⡆⡖] project/.test(frame), "The sidebar shows a spinner from the pushed active runs: " + frame);
  const beforeFocus = frames; stdin.write("\u001b[C"); await until(() => frames > beforeFocus);
  stdin.write("\r"); await until(() => Boolean(browser.getSnapshot().rows[0]?.run));
  await until(() => frame.includes("Cancel selected run"));
  stdin.write("c"); await until(() => frame.includes("Cancel run 12345678-1234-4234-8234-123456789012"));
  const popupRows = screen.split("\n");
  const top = popupRows.findIndex(line => line.includes("╭"));
  assert(top > 2, "confirmation must have a floating border below the screen header: " + screen);
  const left = popupRows[top].indexOf("╭");
  const right = popupRows[top].indexOf("╮");
  const bottom = popupRows.findIndex(line => line.includes("╰"));
  assert.equal(left, Math.floor((stdout.columns - (right - left + 1)) / 2), "popup must be centered horizontally");
  assert.equal(top, Math.floor((stdout.rows - 1 - (bottom - top + 1)) / 2), "popup must be centered vertically");
  assert.equal(popupRows[top + 1].slice(left + 1, right).trim(), "", "popup padding must hide the underlying screen");
  assert(right - left < 80, "popup width must be bounded");
  assert(frame.includes("execution history"), "Run history must remain visible behind the popup");
  console.log("Confirmation popup:\n" + screen);
  assert(frame.includes("[ Cancel ]") && frame.includes("[ Cancel selected run ]"), "popup must show buttons: " + screen);
  stdin.write("\r"); await until(() => !browser.locked);
  assert.equal(requests.filter(request => request.op === "runs.cancel").length, 0, "Enter must default to Cancel");
  stdin.write("c"); await until(() => browser.locked);
  if (process.argv[2] !== "escape") {
  stdout.columns = 45; stdout.rows = 10; stdout.emit("resize");
  await settle(70);
  stdin.write("y"); await settle(70);
  assert.equal(requests.filter(request => request.op === "runs.cancel").length, 0, "hidden confirmation must not execute");
  assert(frame.includes("Resize"), frame);
  }
  const scope = browser.getSnapshot().scope;
  stdin.write("d"); stdin.write("\u001b[B");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(browser.getSnapshot().scope, scope);
  assert(browser.getSnapshot().action?.pending);
  stdout.columns = 50; stdout.rows = 18; stdout.emit("resize");
  await until(() => screen.includes("╭"));
  stdin.write("\u001b"); await until(() => !browser.locked);
  assert(!requests.some(request => request.op === "runs.cancel"));
  stdout.columns = 100; stdout.rows = 24; stdout.emit("resize");
  stdin.write("c"); await until(() => browser.locked);
  stdin.write("\t"); await settle(70);
  stdin.write("\r"); await until(() => browser.getSnapshot().action?.message?.includes("Cancellation accepted") === true);
  if (process.argv[2] !== "escape") await until(() => frame.includes("Return to Runs to refresh."));
  assert(!frame.includes("╭") && frame.includes("[ Back ]"), "action outcome must stay in the panel: " + screen);
  assert.equal(requests.filter(request => request.op === "runs.cancel").length, 1);
  await until(() => peer.getSnapshot().observations[0].profiles[0].activeRuns === 0);
  const history = browser.getSnapshot().history;
  stdin.write("\u001b[D"); await settle(70);
  stdin.write("\u001b"); await until(() => !browser.getSnapshot().action);
  assert.equal(browser.getSnapshot().history, history);
  assert.equal(browser.getSnapshot().history, history);
  stdin.write("r"); await until(() => !browser.getSnapshot().actions && browser.getSnapshot().rows[0]?.run?.status === "cancelled");
  stdin.write("d"); await until(() => browser.getSnapshot().scope.details);
  stdin.write("a"); await until(() => frame.includes("Stop shared service"));
  stdin.write("x"); await until(() => frame.includes("Stop this shared service"));
  stdin.write("y"); await until(() => browser.getSnapshot().action?.message?.includes("Service stopped") === true);
  control.dispose(); await until(() => browser.getSnapshot().observations[0].health === "reconnecting");
  stdin.write("\u001b"); await until(() => !browser.getSnapshot().action);
  stdin.write("l"); await until(() => frame.includes("SERVICE_STOPPED_PROOF"));
  assert(frame.includes("ENVIRONMENTS"));
  console.log("Saved logs after service disconnect:\n" + frame);
  stdin.write("\u001b"); await until(() => !browser.getSnapshot().action);
  stdin.write("b"); await until(() => browser.getSnapshot().action?.pending === true);
  stdout.columns = 30; stdout.rows = 8; stdout.emit("resize"); await until(() => frame.includes("Resize"));
  stdin.write("\u001b"); await until(() => !browser.locked);
  stdout.columns = 100; stdout.rows = 24; stdout.emit("resize"); await until(() => frame.includes("Start shared service"));
  stdin.write("b"); await until(() => frame.includes("Start this shared service"));
  stdin.write("y"); await until(() => browser.getSnapshot().observations[0].health === "connected");
  stdin.write("q"); await until(() => !raw);
  assert.equal(peer.getSnapshot().scope.details, true);
  console.log("Action confirmation, two-client state, saved logs, restart, resize and detach checks passed");
} finally {
  browser.dispose(); peer.dispose(); instance.unmount(); stdout.destroy(); stdin.destroy(); stderr.destroy(); control.dispose();
  await new Promise<void>(resolve => control.server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
}
