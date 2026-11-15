import { stripVTControlCharacters } from "node:util";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { render, Box } from "ink";
import { Actions, ActionDialog } from "../actions/index.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { settle } from "./test-helpers.js";
import type { ActionState } from "../actions/validators.js";

const scenario = process.argv[2];
const browser = new Browser([{ id: "local", name: "Local", transport: "unix", endpoint: "fixture", open: async () => { throw new Error("offline"); } }]);
const recovery = "Outcome unknown. Inspect status before retrying. Request ID: 12345678-1234-4234-8234-123456789012. Service epoch: 87654321-4321-4321-8321-210987654321. END_OF_RECOVERY";
const message = scenario === "success" ? "Service stopped for all clients. Saved logs and start remain available." : scenario === "rejection" ? "Selected run is no longer active. Return to Runs and refresh the selected execution." : recovery;
const reason = browser.unavailable("status")!;
const action: ActionState | undefined = scenario === "menu" ? undefined : scenario === "busy" ? { kind: "logs", busy: true } : scenario === "duplicate" ? { kind: "status", message: reason } : { kind: "stop", message };
const stdout = Object.assign(new PassThrough(), { columns: 70, rows: 16, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let frame = "", content = "";
stdout.on("data", chunk => { if (plain(chunk.toString()).trim()) { frame = plain(chunk.toString()); const rows = stripVTControlCharacters(chunk.toString()).split("\n");
  const top = rows.findIndex(line => line.includes("╭"));
  const bottom = rows.findIndex(line => line.includes("╰"));
  content = top < 0 ? rows.filter(line => !line.includes("[ Back ]")).join("") : rows.slice(top + 2, bottom - 3).map(line => line.slice(rows[top].indexOf("╭") + 3, rows[top].indexOf("╮") - 2)).join(""); } });
const height = ["duplicate", "menu"].includes(scenario) ? 16 : scenario === "small" ? 10 : 14;
const width = scenario === "small" ? 23 : 68;
const instance = render(<Box width={width} height={height} flexDirection="column"><Actions browser={browser} state={{ ...browser.getSnapshot(), actions: true, action }} active width={width} height={height} /><ActionDialog state={{ ...browser.getSnapshot(), action }} browser={browser} width={width} height={height} /></Box>, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
try {
  await settle(70);
  if (scenario === "menu") {
    assert(!frame.includes("Pause project"), frame);
    assert(!frame.includes("Cancel selected run"), frame);
    assert(frame.includes("Saved service JSON logs"), frame);
  } else if (scenario === "busy") {
    assert(frame.includes("Working: Saved service JSON logs"), frame);
    assert(!frame.includes("Start this shared service"));
  } else if (scenario === "duplicate") {
    assert.equal(frame.split(reason).length - 1, 1, frame);
  } else {
    let seen = content;
    for (let i = 0; i < 12; i++) { stdin.write("\u001b[6~"); await settle(70); seen += content; }
    for (const part of message.split(" ")) assert(seen.replace(/\s/g, "").includes(part), seen);
  }
  console.log("Review renderer checks passed");
} finally { instance.unmount(); browser.dispose(); stdout.destroy(); stdin.destroy(); }
