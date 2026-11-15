import { PassThrough } from "node:stream";
import { Box, render } from "ink";
import assert from "node:assert/strict";
import { Onboarding } from "../onboarding/index.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { inputBound } from "./test-helpers.js";
import type { EnvironmentMode, Prerequisite } from "../../environment/validators.js";

// Driver for Add project's first-setup mode choice. Scenarios: shared, missing, install, failed.
const scenario = process.argv[2];
const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let frame = "";
stdout.on("data", chunk => { if (plain(chunk.toString()).trim()) frame = plain(chunk.toString()); });
let open = true, handedOff = 0;
const applied: EnvironmentMode[] = [];
const checks: Prerequisite[] = scenario === "missing" ? [{ name: "bubblewrap installed", fix: "Install it: sudo apt-get install bubblewrap" }] : [{ name: "bubblewrap installed" }];
const mount = () => render(<Box width={80} height={23}><Onboarding browser={browser} width={80} height={23} /></Box>,
  { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
const browser = new Browser([{ id: "local", name: "Local", transport: "unix", endpoint: "/socket", mode: "shared", open: async () => { throw new Error(); },
  addProject: async () => { throw new Error("not reached"); },
  chooseMode: {
    open: () => open,
    checks: async () => checks,
    apply: async (mode, log) => {
      applied.push(mode); log("Project launcher installed.");
      if (scenario === "failed") throw new Error("The launcher install failed or was cancelled. This machine stays shared and no mode was saved.");
      open = false;
    },
  },
}], 0, async operation => { handedOff++; instance.unmount(); await operation(new AbortController().signal); instance = mount(); });
browser.openOnboarding();
let instance = mount();
async function wait(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error(frame); await new Promise<void>(resolve => setImmediate(resolve)); }
  await inputBound();
}
const key = async (value: string) => { stdin.write(value); await inputBound(); };
try {
  await wait(() => frame.includes("Project separation") && frame.includes("[ Shared ]"));
  assert(frame.includes("Projects can read each other's files"), frame);
  if (scenario === "shared") {
    await key("\r");
    await wait(() => frame.includes("Deployment HTTPS"));
    assert.deepEqual(applied, ["shared"]); assert.equal(handedOff, 0);
  } else {
    await key("\t"); await key("\r");
    await wait(() => frame.includes("Isolated mode prerequisites"));
    if (scenario === "missing") {
      assert(frame.includes("✗ bubblewrap installed: Install it"), frame);
      assert(frame.includes("Check again") && !frame.includes("Install with sudo"), frame);
      assert(frame.replace(/\s+/g, " ").includes("then choose Check again. Help for each item:"), frame);
      await key("\t"); await key("\r"); await wait(() => frame.includes("Isolated mode prerequisites"));
      assert.deepEqual(applied, []); assert.equal(handedOff, 0);
    } else {
      assert(frame.includes("✓ bubblewrap installed"), frame);
      await key("\t"); await key("\r");
      await wait(() => handedOff === 1 && frame.includes("Project separation · result"));
      assert(frame.includes("Project launcher installed."), frame);
      assert.deepEqual(applied, ["isolated"]);
      assert.equal(frame.includes("stays shared"), scenario === "failed", frame);
      await key("\r");
      if (scenario === "failed") {
        assert.equal(browser.targets[0].mode, "shared");
        await wait(() => frame.includes("[ Isolated ]"));
      } else {
        assert.equal(browser.targets[0].mode, "isolated");
        await wait(() => frame.includes("Deployment HTTPS"));
      }
    }
  }
  console.log(`Onboarding mode checks passed: ${scenario}`);
} finally { instance.unmount(); instance.cleanup(); browser.dispose(); }
