import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { render } from "ink";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { inputBound, settle } from "./test-helpers.js";
import type { RuntimeVersion } from "../../environment/validators.js";
import type { LoginRuntime } from "../../project/validators.js";

const scenario = process.argv[2] ?? "batch";
const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 34, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let frame = "", raw = "", reads = 0, failRead = scenario === "status-error";
let release: (() => void) | undefined;
const installs: [LoginRuntime, string][] = [];
const installed: Partial<Record<LoginRuntime, string>> = { "claude-code": "2.1.3", codex: "0.156.1", cursor: "2026.11.20-bbbbbbb" };
const offered: Record<LoginRuntime, string> = { "claude-code": "2.1.9", codex: "0.156.1", opencode: "1.19.5", cursor: "2026.10.22-27dcf5f" };
const labels: Record<LoginRuntime, string> = { "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode", cursor: "Cursor" };
const state = (runtime: LoginRuntime): RuntimeVersion["state"] => !installed[runtime] ? "missing" : installed[runtime] === offered[runtime] ? "current" : runtime === "cursor" ? "newer" : "update";
stdout.on("data", chunk => { if (plain(chunk.toString()).trim()) { frame = plain(chunk.toString()); raw = chunk.toString(); } });
const browser = new Browser([{ id: "fixture", name: "Managed fixture", transport: "docker", endpoint: "fixture container", open: async () => { throw new Error("offline"); },
  maintenance: {
    status: async () => ({}), release: async () => ({ installed: "0.100.0", proposed: "0.103.0" }), execute: async () => ({}),
    ...(scenario === "local" ? {} : {
      runtimes: async () => {
        reads++;
        if (scenario === "loading" && reads === 1) await new Promise<void>(resolve => { release = resolve; });
        if (failRead) { failRead = false; throw new Error("Environment is stopped. Start environment from Actions, then check runtimes again."); }
        return (Object.keys(labels) as LoginRuntime[]).map(runtime => ({ runtime, label: labels[runtime], installed: installed[runtime], offered: offered[runtime], state: state(runtime) }));
      },
      installRuntime: async (runtime: LoginRuntime, version: string, progress: (text: string) => void) => {
        installs.push([runtime, version]); progress(`added 1 package for ${runtime}`);
        if (scenario === "failure" && runtime === "opencode") throw new Error("npm ERR! 404 opencode-ai not found");
        installed[runtime] = version; return version;
      },
    }),
  },
}]);
const instance = render(<App browser={browser} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
async function wait(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error(frame); await new Promise(resolve => setTimeout(resolve, 10)); }
  await inputBound();
}
async function key(value: string) { stdin.write(value); await settle(60); }
const down = "\u001b[B";
try {
  await settle(60);
  // Environment Actions → Maintenance → [r] Agent runtimes, opened in the Actions panel.
  await key(down); await key("\r");
  assert(frame.includes("Update CLI"), frame);
  assert(!frame.includes("  Runtimes"), "Runtimes is an action, not a sidebar row");
  if (scenario === "local") {
    assert(!frame.includes("Agent runtimes"), "A target without runtime maintenance has no runtimes action");
  } else {
    await key("r");
    assert.equal(browser.getSnapshot().runtimes, "view", frame);
    assert.equal(browser.getSnapshot().actions, true, "The sidebar keeps Actions selected");
    if (scenario === "loading") {
      await wait(() => frame.includes("Checking installed runtimes"));
      const spinner = () => /[⠖⠲⢲⢰⣰⣠⣄⣆⡆⡖] Checking installed runtimes/.exec(frame)?.[0];
      const first = spinner();
      assert(first, "An animated spinner leads the loading line: " + frame);
      await wait(() => spinner() !== undefined && spinner() !== first);
      const lines = raw.split("\n").map(line => plain(line).slice(30).trim());
      const at = lines.findIndex(line => line.includes("Checking installed runtimes"));
      assert.equal(lines[at - 1], "", "The loading line is set apart by a blank line");
      release!();
      await wait(() => frame.includes("Claude Code") && !frame.includes("Checking installed runtimes"));
    } else if (scenario === "highlight") {
      await wait(() => frame.includes("2.1.3 → 2.1.9"));
      const line = raw.split("\n").find(value => plain(value).includes("Claude Code"))!;
      // Every cell of the selected row keeps the selection background: no background reset before the status text.
      const background = (text: string) => [...line.slice(0, line.indexOf(text)).matchAll(new RegExp(`${String.fromCharCode(27)}\\[48;[\\d;]+m`, "g"))].at(-1)?.[0];
      assert(background("Claude Code"), JSON.stringify(line));
      assert.equal(background("Update available"), background("Claude Code"), "Status cell lost the selection background: " + JSON.stringify(line));
    } else if (scenario === "status-error") {
      await wait(() => frame.includes("Environment is stopped"));
      await key("f");
      await wait(() => frame.includes("Claude Code"));
      assert.equal(reads, 2);
    } else {
      await wait(() => frame.includes("2.1.3 → 2.1.9"));
      assert(frame.includes("Update available") && frame.includes("Up to date") && frame.includes("Not installed") && frame.includes("Newer than offered"), frame);
      await key(" "); await key(down); await key(" "); await key(down); await key(" ");
      assert(/\[x\] Claude Code/.test(frame) && /\[x\] OpenCode/.test(frame), frame);
      assert(!/\[x\] Codex/.test(frame), "An up-to-date runtime cannot be checked");
      await key(down); await key(down);
      assert(frame.includes("> [ Install / update 2 ]"), frame);
      await key("\u001b[C");
      assert(frame.includes("> [ Refresh ]"), "→ moves between the buttons: " + frame);
      await key("\u001b[D");
      assert(frame.includes("> [ Install / update 2 ]"), "← moves back without leaving the panel: " + frame);
      await key("\r");
      await wait(() => frame.includes("Cancel leaves the environment unchanged"));
      assert(frame.includes("Claude Code 2.1.3 → 2.1.9") && frame.includes("OpenCode not installed → 1.19.5"), frame);
      assert.equal(browser.getSnapshot().runtimes, "editing", "The popup locks navigation");
      await key("\r");
      assert.equal(installs.length, 0, "Enter on the default Cancel installs nothing");
      await wait(() => frame.includes("Install / update 2") && !frame.includes("Cancel leaves"));
      await key("\r"); await wait(() => frame.includes("Cancel leaves")); await key("\t"); await key("\r");
      if (scenario === "failure") {
        await wait(() => frame.includes("1 of 2 runtimes failed"));
        assert(frame.includes("✗ 1 of 2 runtimes failed"), frame);
        assert(frame.includes("✓ Claude Code 2.1.9") && frame.includes("✗ OpenCode: npm ERR! 404"), frame);
        assert(frame.includes("added 1 package for opencode"), "Installer output stays visible");
        await key("\r");
        await wait(() => reads === 2 && frame.includes("2.1.9 ") && !frame.includes("runtimes failed"));
        assert(/\[x\] OpenCode/.test(frame) && !/\[x\] Claude Code/.test(frame), "Failed runtimes stay checked for retry");
      } else {
        await wait(() => frame.includes("2 runtimes installed"));
        assert(frame.includes("✓ Claude Code 2.1.9") && frame.includes("✓ OpenCode 1.19.5"), frame);
        assert(frame.includes("Reload project or Restart service"), frame);
        await key("\r");
        await wait(() => reads === 2 && !frame.includes("runtimes installed"));
        assert.equal(browser.getSnapshot().runtimes, "view");
        await key("\u001b");
        assert.equal(browser.getSnapshot().runtimes, undefined, "Esc returns to the Actions list");
        assert(frame.includes("Update CLI") && browser.getSnapshot().actions, frame);
      }
      assert.deepEqual(installs, [["claude-code", "2.1.9"], ["opencode", "1.19.5"]]);
    }
  }
  console.log("Runtime renderer checks passed: " + scenario);
} finally { instance.unmount(); instance.cleanup(); browser.dispose(); }
