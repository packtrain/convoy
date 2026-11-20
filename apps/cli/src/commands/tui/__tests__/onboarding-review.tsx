import { stripVTControlCharacters } from "node:util";
import { PassThrough } from "node:stream";
import { render } from "ink";
import assert from "node:assert/strict";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { inputBound } from "./test-helpers.js";
import type { ProjectAddOptions } from "../../project/workflow.js";
const scenario = process.argv[2];
const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 30, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
const stderr = new PassThrough();
let frame = "", rawFrame = "", output = "", signal: AbortSignal | undefined, disposed = 0;
stdout.on("data", chunk => { output += chunk.toString(); if (plain(chunk.toString()).trim()) { rawFrame = chunk.toString(); frame = stripVTControlCharacters(rawFrame); } });
const requests: { directory: string; options: ProjectAddOptions }[] = [];
const browser = new Browser([{ id: "fixture", name: "Fixture", transport: "unix", endpoint: "/socket", open: async () => { throw new Error(); },
  addProject: async (directory, options) => {
    requests.push({ directory, options });
    if (scenario === "uncertain") throw new Error("secret raw error");
    if (scenario === "target-incompatible") return { ok: false, registered: false, applied: false, retrySafe: true, phase: "validation", reason: "target-incompatible" };
    if (scenario === "safe-preflight") return { ok: false, registered: false, applied: false, retrySafe: true, phase: "validation", reason: "environment-unavailable" };
    if (scenario === "pending") return { ok: true, registered: true, applied: false, retrySafe: true, phase: "complete", projectId: options.project };
    return { ok: false, registered: false, applied: false, retrySafe: true, phase: "preparation", projectId: options.project ?? "created-project" };
  },
}]);
if (scenario.startsWith("entry-")) {
  browser.getSnapshot().observations[0].profiles.push({ profile: "existing-profile", status: "online", attempts: 1 });
  browser.targets.push({ ...browser.targets[0], id: "docker", name: "Docker", transport: "docker" });
  browser.getSnapshot().observations.push({ health: "unknown", profiles: [] });
}
if (scenario === "deployments") {
  browser.getSnapshot().observations[0].inspection = { nodeVersion: "22", profiles: [
    { profile: "one", projectId: "p1", endpoint: "https://one.convex.cloud" },
    { profile: "duplicate", projectId: "p2", endpoint: "https://one.convex.cloud" },
    { profile: "two", projectId: "p3", endpoint: "https://two.convex.cloud" },
  ] };
}
if (scenario === "sidebar-names") {
  browser.getSnapshot().observations[0].profiles.push(
    { profile: "ipb", status: "online", attempts: 1, ...{ displayName: "Isolation B" } },
    { profile: "legacy", status: "online", attempts: 1 });
}
const dispose = browser.dispose.bind(browser);
browser.dispose = () => { disposed++; dispose(); };
const instance = render(<App browser={browser} onboardingLoad={async (_url, _secret, providedSignal?: AbortSignal) => {
  signal = providedSignal;
  if (scenario.startsWith("discovery")) return new Promise((_, reject) => providedSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  if (scenario === "project-order") return { projects: [
    { _id: "z", name: "Alpha", alias: "ZZ", organizationName: "Zulu", organizationId: "z-org" },
    { _id: "b", name: "Beta", alias: "BB", organizationName: "Alpha", organizationId: "a-org" },
    { _id: "a", name: "Alpha", alias: "AA", organizationName: "Alpha", organizationId: "a-org" },
  ], organizations: [{ _id: "z-org", name: "Zulu", slug: "z" }, { _id: "a-org", name: "Alpha", slug: "a" }] };
  return { projects: [{ _id: "existing", name: "Existing", alias: "EX", organizationName: "Org", organizationId: "org" }], organizations: [{ _id: "org", name: "Org", slug: "org" }] };
}} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, stderr: stderr as unknown as NodeJS.WriteStream, debug: true, exitOnCtrlC: false, patchConsole: false });
async function settle() { for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve)); await inputBound(); }
async function wait(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error(frame); await new Promise<void>(resolve => setImmediate(resolve)); }
  await settle();
}
async function key(value: string) { const before = frame; stdin.write(value); await wait(() => frame !== before || !browser.getSnapshot().onboarding); }
async function resize(width: number, height: number) { stdout.columns = width; stdout.rows = height; stdout.emit("resize"); await settle(); }
async function review() { await key("\r"); await wait(() => frame.includes("Register")); await key("\t"); await key("\r"); await wait(() => frame.includes("result")); }
try {
  await wait(() => frame.includes("ENVIRONMENTS"));
  if (scenario === "sidebar-names") {
    const sidebarLines = frame.split("\n").map(line => line.slice(0, 30));
    const addIndex = sidebarLines.findIndex(line => line.includes("+ Add project"));
    assert.equal(sidebarLines[addIndex + 1].trim(), "", "A blank row separates actions from projects");
    assert(sidebarLines[addIndex + 2].includes("Isolation B (ipb)"));
    assert(frame.includes("Isolation B (ipb)"), "Sidebar must show the saved display name and key");
    assert(frame.includes("legacy"), "Old service profiles retain key-only labels");
    for (let i = 0; i < 4; i++) await key("\u001b[B");
    assert.equal(browser.getSnapshot().scope.profile, "ipb", "Display labels must not change selection identity");
    console.log(rawFrame);
    console.log("Onboarding review checks passed: " + scenario);
  } else if (scenario.startsWith("entry-")) {
    if (scenario.startsWith("entry-row")) {
      const sidebar = frame.split("\n").map(line => line.slice(0, 30)).join("\n");
      assert(sidebar.indexOf("+ Add project") > sidebar.indexOf("Credentials"), "Add project must appear below the environment views in the sidebar");
      assert(sidebar.indexOf("+ Add project") < sidebar.indexOf("existing-profile"));
      for (let i = 0; i < 3; i++) await key("\u001b[B");
      assert(browser.getSnapshot().scope.addProject);
      assert(!browser.getSnapshot().onboarding, "Selecting the row must not submit or open the form");
      await key("\u001b[B");
      assert.equal(browser.getSnapshot().scope.profile, "existing-profile");
      await key("\u001b[A");
      await key(scenario === "entry-row-space" ? " " : "\r");
    } else await key("+");
    assert.equal(browser.getSnapshot().onboarding, true, "Add project must open from + or its sidebar row");
    await wait(() => frame.includes("Deployment HTTPS"));
    await key("\u001b");
    assert(!browser.getSnapshot().onboarding);
    browser.select({ connection: 1, details: true }); await settle();
    await key("\u001b[D"); await key(" ");
    await key("\u001b[B"); await key("\u001b[B"); await key("\u001b[B"); await key("\r");
    await wait(() => frame.includes("Deployment HTTPS"));
    assert.equal(browser.getSnapshot().scope.connection, 1, "Second connection row must target that connection");
    console.log("Onboarding review checks passed: " + scenario);
  } else {
  await key("+");
  if (scenario === "button-arrows") {
    await key("\t"); await key("\t");
    assert(frame.includes("> [ Cancel ]"));
    stdin.write("\u001b[C"); await settle();
    assert(frame.includes("> [ Load choices ]"), "Right arrow must focus Load choices");
    stdin.write("\u001b[D"); await settle();
    assert(frame.includes("> [ Cancel ]"), "Left arrow must focus Cancel");
    console.log("Onboarding review checks passed: " + scenario);
  } else if (scenario === "deployments") {
    await wait(() => frame.includes("Saved deployment"));
    await key("\r");
    console.log(rawFrame);
    assert.equal(frame.split("https://one.convex.cloud").length - 1, 1, "Duplicate deployments appear once");
    await key("\r");
    assert(frame.includes("https://one.convex.cloud"));
    await key("\t"); await key("FIRST_SECRET");
    await key("\u001b[Z"); await key("\u001b[Z"); await key("\r");
    await key("\u001b[B"); await key("\r");
    assert(frame.includes("https://two.convex.cloud"));
    assert(!frame.includes("****"), "Changing deployment clears the old key");
    await key("\u001b[Z"); await key("\r"); await key("\u001b");
    assert(browser.getSnapshot().onboarding, "Escape closes the dropdown before closing the popup");
    await key("\r"); await key("\u001b[B"); await key("\r");
    await key("https://custom.convex.cloud");
    assert(frame.includes("https://custom.convex.cloud"));
    await resize(60, 24);
    assert(frame.includes("https://custom.convex.cloud"));
    assert.equal(requests.length, 0);
    assert(!output.includes("FIRST_SECRET"));
    console.log(rawFrame);
    console.log("Onboarding review checks passed: " + scenario);
  } else if (scenario === "popup" || scenario === "input-enter") {
    await wait(() => frame.includes("Deployment HTTPS"));
    if (scenario === "popup") {
      assert(!frame.includes("╭") && frame.includes("[ Cancel ]"), "Form must use the main panel with explicit buttons");
      assert(frame.includes("https://your-deployment.convex.cloud"), "Empty input needs a placeholder");
      console.log(rawFrame);
    } else {
      stdin.write("\r"); await settle();
      await key("https://example.convex.cloud");
      assert(frame.includes("https://example.convex.cloud"), "Enter must keep the URL input active instead of moving into the masked key");
      stdin.write("\u001b[D"); await settle(); await key("X");
      assert(frame.includes("https://example.convex.clouXd"), "Typing inserts at the visible caret");
      await key("\u007f"); assert(frame.includes("https://example.convex.cloud"));
      await key("\t"); await key("SECRET_POPUP_KEY");
      assert(!output.includes("SECRET_POPUP_KEY"));
      await key("\u001b[Z"); assert(frame.includes("> Deployment HTTPS URL"), "Shift+Tab returns to the previous input");
    }
    console.log("Onboarding review checks passed: " + scenario);
  } else {
  await key("https://example.convex.cloud"); await key("\t"); await key("PRIVATE_KEY_qard"); await key("\t"); await key("\t"); await key("\r");
  if (scenario.startsWith("discovery")) {
    await wait(() => frame.includes("Loading accessible"));
    if (scenario === "discovery-unmount") instance.unmount();
    else { stdin.write("\u001b"); await wait(() => Boolean(signal?.aborted)); }
    assert.equal(signal?.aborted, true, "Discovery must abort on Escape or unmount");
    if (scenario !== "discovery-unmount") { await wait(() => frame.includes("Deployment HTTPS")); assert(frame.includes("example.convex.cloud")); }
  } else {
    await wait(() => frame.includes("Link existing"));
    const creating = scenario.startsWith("defaults") || scenario === "overrides" || scenario === "recovery" || scenario === "creation-form";
    if (creating) await key("\u001b[B");
    await key("\r");
    if (scenario === "project-order") {
      assert(frame.indexOf("Alpha / Alpha") < frame.indexOf("Alpha / Beta") && frame.indexOf("Alpha / Beta") < frame.indexOf("Zulu / Alpha"), "Projects must sort by organization then name");
    }
    await key("\r");
    await wait(() => frame.includes("Profile name"));
    if (["workspace-dropdown", "repository-form", "form-visibility", "form-paging", "creation-form"].includes(scenario)) {
      for (let i = 0; i < (creating ? 5 : 3); i++) await key("\t");
      stdin.write("\r"); await settle();
      assert(frame.includes("Reuse existing directory") && frame.includes("Clone repository"), "Workspace mode must open a dropdown with named options");
      assert(frame.includes("Start without repository files"));
      await key("\u001b[B"); assert(frame.includes("Keep the files"));
      await key("\u001b"); assert(frame.includes("Empty directory"));
      await key(" "); await key("\u001b[B"); await key("\u001b[B");
      assert(frame.includes("Git repository"));
      if (scenario === "workspace-dropdown") { await resize(60, 24); assert(frame.includes("Git repository")); console.log(rawFrame); }
      await key("\r"); await key("\t");
      if (scenario !== "workspace-dropdown") {
        if (scenario === "repository-form") assert(frame.includes("Git repository URL (HTTPS)") && frame.includes("https://github.com/owner/repo.git"), "Repository input needs a plain label and example URL");
        if (scenario !== "form-paging") assert(frame.includes("Profile name") && frame.includes("Profile key") && frame.includes("Workspace path") && frame.includes("Workspace mode"), "All five link inputs must remain visible together at 100x30");
        if (scenario !== "form-paging") assert(!frame.includes("Tab for more"));
        if (creating) assert(frame.includes("Project name") && frame.includes("Project alias"), "All seven creation fields must fit together");
        console.log(rawFrame);
        await resize(60, 20);
        assert(frame.includes("PgUp/PgDn"), "Small forms need explicit paging controls");
        for (let i = 0; i < 3; i++) { stdin.write("\u001b[5~"); await settle(); }
        assert(frame.includes(creating ? "Project name" : "Profile name"), "PageUp must reveal earlier fields: " + frame);
        for (let i = 0; i < 3; i++) { stdin.write("\u001b[6~"); await settle(); }
        assert(frame.includes("Git repository URL"), "PageDown must reveal the repository field");
        await resize(100, 30);
      } else assert(frame.includes("> Git repository URL"));
      await key("https://example.com/repo.git");
      await key("\t"); await key("\u001b[C"); await review();
      assert.equal(requests[0].options.clone, "https://example.com/repo.git");
      assert.equal(requests[0].options.reuse, false);
    } else if (scenario === "project-order") {
      while (!frame.includes("> [ Review registration ]")) await key("\t");
      await review(); assert.equal(requests[0].options.project, "a", "Sorted label must select its own project ID");
    } else if (scenario === "ctrl-c") {
      stdin.write("\u0003"); await settle(); assert.equal(disposed, 1, "Ctrl+C must be owned by App once");
    } else if (scenario.startsWith("defaults") || scenario === "overrides") {
      await key(scenario === "defaults-billing" ? " Billing" : " Payments");
      if (scenario === "overrides") {
        await key("\t"); await key("X"); await key("\t"); await key(" custom"); await key("\t"); await key("-custom"); await key("\t"); await key("-custom");
        for (let i = 0; i < 4; i++) await key("\u001b[A");
        await key(" Europe");
      }
      while (!frame.includes("> [ Review registration ]")) await key("\t");
      await review();
      const sent = requests[0];
      assert.equal(sent.options.profileName, scenario === "defaults-billing" ? "New project Billing" : scenario === "defaults" ? "New project Payments" : "New project Payments custom");
      assert.equal(sent.options.profileKey, scenario === "defaults-billing" ? "new-project-billing" : scenario === "defaults" ? "new-project-payments" : "new-project-payments-custom");
      assert.equal(sent.directory, scenario === "defaults-billing" ? "new-project-billing" : scenario === "defaults" ? "new-project-payments" : "new-project-payments-custom");
    } else {
      const steps = creating ? 6 : 4;
      if (scenario === "narrow") {
        for (let i = 0; i < 2; i++) await key("\t");
        await resize(60, 24);
        await wait(() => frame.split("\n").some(line => line.includes("convoy") && line.length <= 60));
        assert(frame.includes("Project details") && !frame.includes("╭"));
        assert(/(?:>.*(?:Workspace|Path).*ex|>.*(?:Workspace|Path)[^\n]*\n[^\n]*ex)/.test(frame), "Focused workspace value must be visible with sidebar at 60 columns: " + frame);
        await key("\t");
        assert(frame.includes("Empty directory"), "Selected workspace mode must be visible");
      } else {
        for (let i = 0; i < steps - 1; i++) await key("\t");
        if (scenario === "clone") { await key(" "); await key("\u001b[B"); await key("\u001b[B"); await key("\r"); await key("\t"); await key("\t"); await key("\t"); }
        else { await key("\t"); await key("\t"); }
        if (scenario === "clone") {
          await key("\r"); assert(!frame.includes("Register"), "Blank clone must not reach confirmation");
          assert(frame.toLowerCase().includes("clone url")); assert.equal(requests.length, 0);
        } else {
          await review();
          if (scenario === "target-incompatible") {
            assert(frame.includes("Target CLI does not support") && frame.includes("Registration did not start"));
            await key("\r"); assert(frame.includes("Existing") && frame.includes("ex"));
          } else if (scenario === "safe-preflight") {
            assert(frame.includes("Registration did not start"));
            await key("\r"); assert(frame.includes("Existing") && frame.includes("ex"));
          } else if (scenario === "link-back") {
            await key("\r"); await key("\u001b");
            assert.equal(browser.getSnapshot().onboarding, true, "Failed link must allow return to project choices");
            assert(frame.includes("Existing")); assert(!output.includes("Remote project retained"));
          } else if (scenario === "pending") {
            assert(!frame.includes("open saved profile in Runs")); await key("\r");
            assert.equal(browser.getSnapshot().actions, true); assert.equal(browser.getSnapshot().scope.profile, undefined);
          } else if (scenario === "recovery" || scenario === "uncertain") {
            await resize(60, 15);
            const seen = [frame];
            for (let i = 0; i < 30 && !seen.join("\n").includes(scenario === "recovery" ? "created-project" : "API Keys"); i++) { await key("\u001b[B"); seen.push(frame); }
            assert(seen.join("\n").includes(scenario === "recovery" ? "created-project" : "API Keys"), "Recovery guidance must remain reachable after resize");
            assert(frame.includes("Retry") || frame.includes("Close") || frame.includes("Enter"), "Recovery action must remain visible");
          }
        }
      }
    }
  }
  assert(!output.includes("PRIVATE_KEY_qard")); console.log("Onboarding review checks passed: " + scenario);
  }
  }
} finally { instance.unmount(); instance.cleanup(); dispose(); }
