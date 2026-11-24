import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { render } from "ink";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import type { BrowseState } from "../validators.js";
import { plain } from "../formatters.js";
import stringWidth from "string-width";
import chalk from "chalk";
import { inputBound, settle } from "./test-helpers.js";

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Terminal assertion timed out: " + JSON.stringify(frame));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  await inputBound();
}
const truecolor = chalk.level === 3;
const selectedFill = truecolor ? "\u001b[48;2;52;81;95m" : "\u001b[44m";
/** Columns painted with the selection fill on one rendered line. */
function filledColumns(line: string) {
  let filled = false, columns = 0;
  // eslint-disable-next-line no-control-regex -- walks SGR codes to measure the fill
  for (const [, codes, text] of line.matchAll(/\u001b\[([\d;]*)m|([^\u001b]+)/g)) {
    if (text !== undefined) { if (filled) columns += stringWidth(text); }
    else if (`\u001b[${codes}m` === selectedFill) filled = true;
    else if (/^(0|49|4\d|10\d|48;.*)$/.test(codes)) filled = false;
  }
  return columns;
}
const selected = (line: string, text: RegExp) => text.test(plain(line)) && line.includes(selectedFill);
const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 24, isTTY: true });
let raw = false;
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (value: boolean) => { raw = value; }, ref() {}, unref() {} });
const stderr = new PassThrough();
stderr.on("data", chunk => process.stderr.write(chunk));
const browser = new Browser([{ id: "a", name: "Local 日本語", transport: "unix", endpoint: "/socket", open: async () => { throw new Error("not started"); } }]);
let state: BrowseState = { ...browser.getSnapshot(), observations: [{ health: "connected", profiles: ["all", "details", "zeta"].map(profile => ({ profile, status: "online", attempts: 1 })) }] };
const rows = Array.from({ length: 20 }, (_, i) => ({ profile: "zeta", thread: { threadId: `thread-${i}`, title: `row-${i}`, lastActivityAt: 1 } }));
const listeners = new Set<() => void>();
browser.getSnapshot = () => state;
browser.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
browser.select = scope => { state = { ...state, scope, rows }; for (const listener of listeners) listener(); };
browser.showActions = actions => { state = { ...state, actions, credentials: undefined }; for (const listener of listeners) listener(); };
browser.showCredentials = value => { state = { ...state, actions: false, credentials: value ? "view" : undefined }; for (const listener of listeners) listener(); };
browser.logs = row => { state = { ...state, detail: row }; for (const listener of listeners) listener(); };
browser.readLogs = async () => ({ v: 1, id: "raw", ok: true, result: { raw: true, run: { status: "completed" },
  page: [{ order: 0, eventJson: '{"nested":{"text":"RAW_JSON_PROOF"}}', bytes: 36, length: 36, truncated: false, fidelity: "stored" }, ...(process.argv[2] === "spacing" ? [{ order: 1, eventJson: '{"proof":"NEXT_JSON_PROOF"}', bytes: 27, length: 27, truncated: false, fidelity: "stored" }] : [])], cursor: 0, latest: 0, hasMore: false } });
browser.history = row => { state = { ...state, history: row, rows: rows.map((r, i) => ({ ...r, run: { threadId: r.thread.threadId, messageId: `message-${i}`, runId: `run-${i}`, status: "completed", createdAt: 1, updatedAt: 1 } })) }; for (const listener of listeners) listener(); };
const exportDirectory = await mkdtemp(join(tmpdir(), "convoy-resize-"));
let frame = "";
stdout.on("data", chunk => { if (plain(chunk.toString()).trim()) frame = chunk.toString(); });
const instance = render(createElement(App, { browser }), {
  stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, stderr: stderr as unknown as NodeJS.WriteStream,
  debug: true, exitOnCtrlC: false, patchConsole: false,
});
try {
  await until(() => plain(frame).includes("+ Add project"));
  if (truecolor) {
    assert(frame.includes("\u001b[48;2;21;23;25m"), "the design background fills the terminal");
    assert(!/[│─┌┐└┘]/.test(plain(frame)), "panes are separated by fills, not box-drawing lines: " + plain(frame));
  }
  const sidebarLabels = frame.split("\n").slice(2).map(line => plain(line).slice(0, 30));
  const actions = sidebarLabels.find(label => label.trim() === "Actions")!;
  for (const profile of ["all", "details", "zeta"]) {
    const label = sidebarLabels.find(value => value.replace("●", "").trim() === profile)!;
    assert.equal(label.indexOf(profile), actions.indexOf("Actions"), "projects and environment views must align as siblings");
  }
  const selectedLine = frame.split("\n").find(line => /▾ Local 日本語/.test(plain(line)) && line.includes(selectedFill))!;
  assert.equal(filledColumns(selectedLine), 28, "selection must fill the sidebar row including trailing spaces: " + JSON.stringify(selectedLine));
  const selectedText = plain(selectedLine);
  assert.match(selectedText, /Local 日本語 +unix ●/);
  assert.equal(stringWidth(selectedText.slice(0, selectedText.indexOf("●") + 1)), 28, "type and status sit one column inside the sidebar's right edge: " + selectedText);
  stdin.write(" ");
  await until(() => !plain(frame).includes("+ Add project"));
  assert(browser.getSnapshot().scope.details);
  stdin.write(" ");
  await until(() => plain(frame).includes("+ Add project"));
  stdin.write("\u001b[B");
  await until(() => Boolean(state.actions));
  stdin.write("\u001b[C");
  await inputBound();
  stdin.write("d");
  await until(() => !state.actions && state.scope.details);
  const beforeEscape = frame;
  stdin.write("\u001b");
  await until(() => frame !== beforeEscape);
  stdin.write("\u001b[B");
  await until(() => Boolean(state.actions));
  stdin.write("d");
  await until(() => !state.actions);
  stdout.columns = 50; stdout.rows = 14; stdout.emit("resize");
  stdin.write("\u001b[C");
  await until(() => plain(frame).includes("Details  Local"));
  stdout.columns = 100; stdout.rows = 12; stdout.emit("resize");
  await inputBound();
  stdin.write("\u001b[D"); await inputBound();
  stdin.write("\u001b[B"); await until(() => Boolean(state.actions));
  stdin.write("\u001b[B"); await until(() => state.credentials === "view");
  stdin.write("\u001b[B"); await until(() => Boolean(state.scope.addProject));
  stdin.write("\u001b[B"); await until(() => state.scope.profile === "all");
  stdin.write("\u001b[B"); await until(() => state.scope.profile === "details");
  stdin.write("\u001b[B"); await until(() => state.scope.profile === "zeta");
  const scopeBeforeEnter = state.scope;
  stdin.write("\r");
  await until(() => frame.split("\n").some(line => selected(line, /row-0\b/)));
  assert.equal(state.scope, scopeBeforeEnter, "Enter focuses the selected project without changing scope");
  assert.equal(Boolean(state.history), false, "Enter from the sidebar must not open a thread");
  for (let i = 1; i < 20; i++) {
    stdin.write("j");
    await until(() => frame.split("\n").some(line => selected(line, new RegExp(`row-${i}\\b`))));
  }
  stdin.write("\r"); await until(() => Boolean(state.history));
  assert.equal(state.history?.thread.threadId, "thread-19");
  for (let i = 1; i < 20; i++) {
    stdin.write("j");
    await until(() => frame.split("\n").some(line => selected(line, new RegExp(`run-${i}\\b`))));
  }
  assert(plain(frame).includes("Cancel unavailable"), "Completed runs must explain cancellation availability beside the run");
  stdin.write("\r"); await until(() => plain(frame).includes(process.argv[2] === "spacing" ? "NEXT_JSON_PROOF" : "RAW_JSON_PROOF"));
  const scenario = process.argv[2];
  if (scenario) {
    if (scenario === "spacing") { stdout.rows = 24; stdout.emit("resize"); await until(() => plain(frame).includes("NEXT_JSON_PROOF")); }
    stdin.write(" "); await until(() => plain(frame).includes("Paused"));
    if (scenario === "spacing") {
      const rendered = frame.split("\n").map(line => plain(line));
      assert.equal(rendered.findIndex(line => line.includes("NEXT_JSON_PROOF")) - rendered.findIndex(line => line.includes("RAW_JSON_PROOF")), 2, "exactly one visible empty row separates events");
    } else if (scenario === "resize") {
      stdout.columns = 30; stdout.rows = 8; stdout.emit("resize");
      await until(() => plain(frame).includes("Resize"));
      stdout.columns = 100; stdout.rows = 24; stdout.emit("resize");
      await until(() => plain(frame).includes("Raw JSON"));
      assert(plain(frame).includes("Paused"), "resize preserves paused state");
    } else if (scenario === "small-detach") {
      stdout.columns = 30; stdout.emit("resize");
      await until(() => plain(frame).includes("Resize"));
      stdin.write("q"); await until(() => !raw);
    } else if (["paste", "destination", "export-resize", "overwrite", "confirm-resize"].includes(scenario)) {
      stdout.rows = 24; stdout.emit("resize");
      stdin.write("e"); await until(() => plain(frame).includes("Export path:"));
      assert(plain(frame).includes("╭") && plain(frame).includes("[ Cancel ]") && plain(frame).includes("[ Continue ]"), "export path must open in a dialog with buttons: " + plain(frame));
      if (scenario === "paste") console.log("Export path popup:\n" + stripVTControlCharacters(frame));
      if (scenario === "confirm-resize") {
        stdout.columns = 45; stdout.rows = 10; stdout.emit("resize");
        await until(() => plain(frame).includes("Resize"));
        stdin.write("\r"); await until(() => !plain(frame).includes("╭"));
        stdout.columns = 100; stdout.rows = 24; stdout.emit("resize");
        stdin.write("e"); await until(() => plain(frame).includes("Export path:"));
      }
      for (let i = 0; i < "convoy-message-19.jsonl".length; i++) { const previous = frame; stdin.write("\u007f"); await until(() => frame !== previous); }
      await until(() => !plain(frame).includes("convoy-message"));
      if (scenario === "overwrite" || scenario === "confirm-resize") {
        const destination = join(exportDirectory, "run.jsonl");
        await writeFile(destination, "original");
        stdin.write(destination); await until(() => plain(frame).includes("run.jsonl"));
        stdin.write("\r"); await until(() => plain(frame).includes("[ Overwrite ]"));
        if (scenario === "overwrite") {
          stdin.write("\r"); await until(() => !plain(frame).includes("╭"));
          assert.equal(await readFile(destination, "utf8"), "original", "default Cancel must retain the existing file");
          stdin.write("e"); await until(() => plain(frame).includes("Export path:"));
          stdin.write("\r"); await until(() => plain(frame).includes("[ Overwrite ]"));
        } else {
          stdout.columns = 45; stdout.rows = 10; stdout.emit("resize");
          await until(() => plain(frame).includes("Resize"));
          stdin.write("y"); await settle(70);
          assert.equal(await readFile(destination, "utf8"), "original", "clipped confirmation must not overwrite a file");
          stdout.columns = 100; stdout.rows = 24; stdout.emit("resize");
          await until(() => plain(frame).includes("[ Overwrite ]"));
        }
        stdin.write("\t"); await settle(70);
        stdin.write("\r"); await until(() => plain(frame).includes("Exported 1 events"));
        assert((await readFile(destination, "utf8")).includes("RAW_JSON_PROOF"));
        assert(plain(frame).includes("[ Close ]"));
      } else if (scenario === "export-resize") {
        const destination = join(exportDirectory, "run.jsonl");
        stdin.write(destination); await until(() => plain(frame).includes("run.jsonl"));
        const original = browser.readLogs;
        let release!: () => void;
        browser.readLogs = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
        stdin.write("\r"); await until(() => Boolean(release));
        stdout.columns = 30; stdout.rows = 8; stdout.emit("resize");
        await until(() => plain(frame).includes("Resize"));
        stdout.columns = 120; stdout.rows = 24; stdout.emit("resize");
        await until(() => plain(frame).includes("Exporting"));
        assert(plain(frame).includes("Exporting"), "resize must preserve the export");
        release(); await until(() => plain(frame).includes("Exported 1 events"));
        assert((await readFile(destination, "utf8")).includes("RAW_JSON_PROOF"));
      } else if (scenario === "paste") {
        stdin.write("/tmp/pasted-log.jsonl\n");
        await until(() => plain(frame).includes("/tmp/pasted-log.jsonl"));
        assert(plain(frame).includes("Export path:"), "paste must not submit");
      } else {
        stdin.write("\r"); await until(() => plain(frame).includes("✗ Enter a file path."));
        stdin.write("/tmp"); await until(() => plain(frame).includes("Export path: /tmp"));
        stdin.write("\r"); await until(() => plain(frame).includes("✗ Cannot use that destination"));
        assert(plain(frame).includes("Export path:"), "validation remains editable");
        assert(plain(frame).includes("Type path"), "the error does not replace the hint");
        // A failed read is marked as an error, not shown like the standing disclaimer.
        browser.readLogs = async () => { throw new Error("offline"); };
        stdin.write("\u001b"); await until(() => !plain(frame).includes("Export path:"));
        stdin.write("r"); await until(() => plain(frame).includes("✗ "));
      }
    }
  } else {
  assert(plain(frame).includes("ENVIRONMENTS"), "sidebar remains visible in detail");
  stdin.write(" "); await until(() => plain(frame).includes("Paused"));
  stdout.rows = 24; stdout.emit("resize");
  stdin.write("e"); await until(() => plain(frame).includes("Export path:"));
  for (let i = 0; i < "convoy-message-19.jsonl".length; i++) { const previous = frame; stdin.write("\u007f"); await until(() => frame !== previous); }
  const destination = join(exportDirectory, "new-run.jsonl");
  stdin.write(destination); await until(() => plain(frame).includes("new-run.jsonl"));
  stdin.write("\r"); await until(() => plain(frame).includes("Exported 1 events"));
  assert(!plain(frame).includes("╭"), "Export success belongs in the panel");
  assert((await readFile(destination, "utf8")).includes("RAW_JSON_PROOF"));
  stdin.write("\u001b"); await until(() => !plain(frame).includes("Exported"));
  stdin.write("\u001b"); await until(() => !state.detail);
  assert(state.history, "Escape from logs must preserve history");
  stdout.columns = 30; stdout.emit("resize");
  await until(() => plain(frame).includes("Resize to 45×10"));
  stdin.write("q");
  await until(() => !raw);
  }
  console.log("Terminal keyboard, resize and detach checks passed");
} finally { browser.dispose(); instance.unmount(); stdout.destroy(); stdin.destroy(); stderr.destroy(); await rm(exportDirectory, { recursive: true, force: true }); }
