import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker } from "../../environment/docker.js";
import { PassThrough } from "node:stream";
import { render } from "ink";
import assert from "node:assert/strict";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { inputBound } from "./test-helpers.js";
import type { EnvironmentOperation } from "../../environment/validators.js";
const scenario = process.argv[2] ?? "update";
const diagnosticDirectory = scenario === "diagnostics" ? mkdtempSync(join(tmpdir(), "convoy-progress-")) : undefined;
if (diagnosticDirectory) {
  writeFileSync(join(diagnosticDirectory, "docker"), "#!/usr/bin/env node\nconsole.error('NPM_DETAILED_FAILURE: registry ENOTFOUND');process.exitCode=1;\n", { mode: 0o755 });
  process.env.PATH = `${diagnosticDirectory}:${process.env.PATH}`;
}
const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 30, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
const stderr = new PassThrough();
let frame = "", output = "", releases = 0, registrations = 0, creations = 0, refreshes = 0;
let support = ["retained", "probe-retry", "probe-start"].includes(scenario);
let probeFailed = false;
const operations: EnvironmentOperation[] = [];
stdout.on("data", chunk => { output += chunk.toString(); if (plain(chunk.toString()).trim()) frame = plain(chunk.toString()); });
const browser = new Browser([{ id: "fixture", name: "Managed fixture", transport: "docker", endpoint: "fixture container", open: async () => { throw new Error("fixture offline"); },
  checkProject: async () => { if (["probe-retry", "probe-start"].includes(scenario) && refreshes && !probeFailed) { probeFailed = true; throw new Error("transient"); } return support; },
  addProject: async (_directory, options) => {
    registrations++;
    assert.equal(options.apiKey, "PRIVATE_RETAINED_KEY");
    if (registrations === 1) return { ok: false, registered: false, applied: false, retrySafe: true, phase: "preparation", reason: "target-incompatible" };
    assert.equal(options.profileKey, "ex-custom");
    return { ok: true, registered: true, applied: true, retrySafe: true, phase: "complete" };
  },
  addProjectUnavailable: scenario === "transport" ? "Update the CLI on vm, restart its service, then retry." : undefined,
  maintenance: scenario === "transport" ? undefined : {
    status: async () => ({ serviceVersion: "0.100.0", serviceRunning: true }),
    release: async () => { releases++; if (scenario === "unpublished") throw new Error("Required release is not published on npm."); return { installed: "0.100.0", proposed: "0.103.0" }; },
    execute: async (operation, progress, options) => {
      operations.push(operation); progress("Installing exact npm release");
      if (operation === "update") assert.equal(options?.version, "0.103.0");
      if (scenario === "diagnostics") await docker(["exec"], { progress: true, onProgress: progress });
      if (scenario === "failure") throw new Error("Readiness failed; previous installation restored.");
      support = true; return { serviceVersion: "0.103.0", serviceRunning: true };
    },
  },
}]);
browser.refreshEnvironment = async result => { assert.equal(result.serviceVersion, "0.103.0"); refreshes++; };
browser.prepareEnvironment = async form => ({ ...form, version: "0.103.0", install: true, ...(scenario === "create-local" ? { localPackage: "/tmp/cli.tgz" } : {}) });
browser.createEnvironment = async (form, progress) => { creations++; assert.equal(form.name, "new-env"); progress("Building image"); };
const instance = render(<App browser={browser} onboardingLoad={async () => ({ projects: [{ _id: "existing", name: "Existing", alias: "EX", organizationId: "org", organizationName: "Org" }], organizations: [] })} />,
  { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, stderr: stderr as unknown as NodeJS.WriteStream, debug: true, exitOnCtrlC: false, patchConsole: false });
async function wait(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error(frame); await new Promise<void>(resolve => setImmediate(resolve)); }
  await inputBound();
}
async function key(value: string) { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); const before = output; stdin.write(value); await wait(() => output !== before || !browser.getSnapshot().environment && !browser.getSnapshot().onboarding); await new Promise<void>(resolve => setImmediate(resolve)); }
try {
  await wait(() => frame.includes("ENVIRONMENTS"));
  if (scenario === "create" || scenario === "create-local") {
    await key("E"); await wait(() => frame.includes("Environment name"));
    await key("new-env");
    for (let i = 0; i < 5; i++) await key("\t");
    await key("\r"); await wait(() => frame.includes("Create / resume"));
    assert(frame.includes(scenario === "create-local" ? "install /tmp/cli.tgz" : "install from npm"), frame);
    assert.equal(creations, 0); await key("\t"); await key("\r");
    await wait(() => frame.includes("is ready")); assert.equal(creations, 1);
  } else if (["retained", "probe-retry", "probe-start"].includes(scenario)) {
    await key("+"); await wait(() => frame.includes("Deployment HTTPS URL"));
    await key("https://example.convex.cloud"); await key("\t"); await key("PRIVATE_RETAINED_KEY");
    await key("\t"); await key("\t"); await key("\r");
    await wait(() => frame.includes("Link existing project")); await key("\r"); await key("\r");
    await wait(() => frame.includes("Profile name")); await key("\t"); await key("-custom");
    for (let i = 0; i < 4; i++) await key("\t");
    await key("\r"); await wait(() => frame.includes("Review registration")); await key("\t"); await key("\r");
    await wait(() => frame.includes("Remote update required"));
    await key("\t"); await key("\r"); await wait(() => frame.includes("Install @useconvoy/cli@0.103.0"));
    await key("\t"); await key("\r"); await wait(() => frame.includes("Project inputs retained"));
    assert.equal(registrations, 1); await key("\r");
    if (["probe-retry", "probe-start"].includes(scenario)) {
      await wait(() => frame.includes("Target support unknown"));
      assert(frame.includes("Retry"), "Support failure must offer Retry without closing the retained form");
      await key("\t");
      if (scenario === "probe-start") await key("\t");
      await key("\r");
      if (scenario === "probe-start") {
        await wait(() => frame.includes("Cancel leaves the target unchanged"));
        assert.equal(operations.filter(op => op === "start").length, 0);
        await key("\t"); await key("\r");
        await wait(() => frame.includes("Project inputs retained"));
        assert(operations.includes("start")); assert.equal(registrations, 1);
        await key("\r");
      }
    }
    await wait(() => frame.includes("Add project · result")); await key("\r");
    await wait(() => frame.includes("ex-custom"));
    for (let i = 0; i < 5; i++) await key("\t");
    await key("\r"); await wait(() => frame.includes("Review registration")); await key("\t"); await key("\r");
    await wait(() => frame.includes("Service applied"));
    assert.equal(registrations, 2); assert(!output.includes("PRIVATE_RETAINED_KEY"));
  } else {
    browser.openOnboarding(); await wait(() => frame.includes("Remote update required"));
    assert.equal(registrations, 0);
    if (scenario === "transport") { assert(!frame.includes("Update CLI")); assert(frame.includes("Update the CLI on vm, restart its service"), "A target without maintenance names how to update it"); }
    else {
      await key("\t"); await key("\r");
      if (scenario === "unpublished") { await wait(() => frame.includes("Required release")); assert(frame.includes("✗ Update CLI failed"), "Release lookup failure must name Update CLI"); assert.equal(operations.length, 0); }
      else {
        await wait(() => frame.includes("Install @useconvoy/cli@0.103.0")); assert.equal(operations.length, 0);
        if (scenario === "cancel") { await key("\r"); assert.equal(operations.length, 0); }
        else if (scenario === "narrow") {
          stdout.columns = 45; stdout.rows = 10; stdout.emit("resize");
          await wait(() => frame.includes("Resize")); await key("\r"); assert.equal(operations.length, 0);
        } else {
          if (scenario === "installed") assert(frame.includes("Installed 0.100.0"), "Confirmation must show inspected installed version");
          await key("\t"); await key("\r");
          await wait(() => frame.includes(scenario === "failure" ? "Readiness failed" : scenario === "diagnostics" ? "Docker exec failed" : "completed"));
          if (scenario === "diagnostics") assert(frame.includes("NPM_DETAILED_FAILURE"), "Failure must retain diagnostic progress");
          if (scenario === "failure") {
            assert(frame.includes("✗ Update CLI failed: Readiness failed"), "Failure must lead with a marked error naming the operation");
            assert(!frame.includes("Working."), "A failed result must not still say Working");
          }
          assert(frame.includes("[ Back ]") && !frame.includes("[ Close ]"), "A result has one Back button: " + frame);
          assert.deepEqual(operations, ["update"]); assert.equal(refreshes, ["failure", "diagnostics"].includes(scenario) ? 0 : 1);
          assert.equal(registrations, 0);
        }
      }
      assert.equal(releases, 1);
    }
  }
  console.log("Environment renderer checks passed: " + scenario);
} finally { instance.unmount(); instance.cleanup(); browser.dispose(); if (diagnosticDirectory) rmSync(diagnosticDirectory, { recursive: true, force: true }); }
