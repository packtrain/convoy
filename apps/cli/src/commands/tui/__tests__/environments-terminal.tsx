import { spawn } from "node:child_process";
import { run } from "../render.js";
import { useEffect } from "react";
import { render } from "ink";
import assert from "node:assert/strict";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { gateInput } from "./test-helpers.js";
gateInput();
let updates = 0;
let maintenanceDone: Promise<void> | undefined;
const browser = new Browser([{ id: "managed-demo", name: "Managed demo", transport: "docker", endpoint: "docker exec managed-demo", open: async () => { throw new Error("fixture"); },
  maintenance: {
    status: async () => ({ serviceVersion: "0.100.0", serviceRunning: true }),
    release: async () => ({ installed: "0.100.0", proposed: "0.103.0" }),
    execute: async (operation, progress, options) => {
      assert.equal(operation, "update"); assert.equal(options?.version, "0.103.0"); updates++;
      if (process.argv[2] === "detach") {
        const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"] });
        process.once("SIGUSR1", () => child.stdin.end());
        progress("WAITING_OPERATION");
        maintenanceDone = new Promise<void>(resolve => child.once("close", () => resolve()));
        await maintenanceDone;
      }
      progress("npm installation, restart and readiness fixture");
      return { serviceVersion: "0.103.0", serviceRunning: true };
    },
  },
}]);
browser.refreshEnvironment = async () => {};
function Fixture() {
  useEffect(() => { process.stderr.write("INPUT_READY\n"); }, []);
  return <App browser={browser} />;
}
if (process.argv[2] === "detach") {
  process.stderr.write("INPUT_READY\n");
  await run(browser.targets);
  await maintenanceDone;
} else {
const instance = render(<Fixture />, { exitOnCtrlC: false, patchConsole: false });
await instance.waitUntilExit(); instance.cleanup(); browser.dispose();
}
assert.equal(updates, 1); assert.equal(process.stdin.isRaw, false);
console.log("PTY_ENVIRONMENTS_OK");
