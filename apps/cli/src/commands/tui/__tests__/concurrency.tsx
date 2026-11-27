import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { render, Box } from "ink";
import { ActionDialog } from "../actions/index.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { settle } from "./test-helpers.js";

// Set concurrency dialog (OS-2612): invalid input is refused whole, never truncated into a valid limit.
const browser = new Browser([{ id: "local", name: "Local", transport: "unix", endpoint: "fixture", open: async () => { throw new Error("offline"); } }]);
const base = browser.getSnapshot();
const state = { ...base, scope: { connection: 0, details: false, profile: "a" }, observations: [{ ...base.observations[0],
  profiles: [{ profile: "a", identity: "a", status: "online" as const, attempts: 1, activeRuns: 2 }],
  inspection: { nodeVersion: "v22", profiles: [{ profile: "a", projectId: "p", endpoint: "x", concurrency: 8 }] } }],
  action: { kind: "concurrency" as const, pending: true, profile: "a", identity: "a" } };
const confirmed: unknown[] = [];
browser.confirmAction = choice => { confirmed.push(choice); };
let frame = "";
const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
stdout.on("data", chunk => { if (chunk.toString().includes("Concurrency:")) frame = plain(chunk.toString()); });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
const instance = render(<Box width={80} height={24} flexDirection="column"><ActionDialog state={state} browser={browser} width={80} height={24} /></Box>,
  { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
const type = async (...keys: string[]) => { for (const key of keys) { stdin.write(key); await settle(30); } };
try {
  await settle(70);
  assert(frame.includes("Concurrency: 8"), frame);
  assert(!frame.includes("Enter saves"), frame);
  for (const value of ["100", "500", "12abc"]) {
    await type("\x7f", "\x7f", "\x7f", "\x7f", "\x7f", ...value, "\r");
    assert(frame.includes("whole number from 1 to 50"), frame);
    assert.equal(confirmed.length, 0, `${value} was saved`);
  }
  await type("\x7f", "\x7f", "\x7f", "\x7f", "\x7f", "1", "2", "\r");
  await type("\t", "\t", "\t", "\r");
  assert.deepEqual(confirmed, [{ concurrency: 12, interrupt: false }, { concurrency: 12, interrupt: true }]);
  console.log("Concurrency dialog checks passed");
} catch (error) { console.error(error); process.exitCode = 1; } finally { instance.unmount(); process.exit(process.exitCode ?? 0); }
