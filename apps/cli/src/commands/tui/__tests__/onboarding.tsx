import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { Box, render } from "ink";
import assert from "node:assert/strict";
import { Onboarding } from "../onboarding/index.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { inputBound, settle } from "./test-helpers.js";
import type { ProjectAddOptions } from "../../project/workflow.js";
const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
const stderr = new PassThrough();
let frame = "", screen = "", output = "", calls = 0;
stdout.on("data", chunk => { output += chunk.toString(); if (plain(chunk.toString()).trim()) { frame = plain(chunk.toString()); screen = stripVTControlCharacters(chunk.toString()); } });
const requests: ProjectAddOptions[] = [];
const browser = new Browser([{ id: "fixture", name: "Fixture", transport: "unix", endpoint: "/socket", open: async () => { throw new Error(); },
  addProject: async (_directory, options) => {
    requests.push(options); calls++;
    return calls === 1 ? { ok: false, registered: false, applied: false, retrySafe: true, phase: "preparation", projectId: "created-project" }
      : { ok: true, registered: true, applied: true, retrySafe: true, phase: "complete", projectId: "created-project" };
  },
}]);
if (["access", "remount"].includes(process.argv[2])) {
  browser.targets[0].credentials = { status: async () => ({ service: true, compatible: true, configurationError: false, entries: [], projects: [] }) };
  browser.prepareOnboardingAccess = async profile => ({ profile, status: "online", attempts: 1, runtimes: ["codex"] });
}
browser.openOnboarding();
const leave: { current: ((then: () => void) => void) | undefined } = { current: undefined };
const mount = () => render(<Box width={80} height={23}><Onboarding browser={browser} leave={leave} width={80} height={23} load={async (_url, secret) => {
  assert.equal(secret, "PRIVATE_API_KEY_qard");
  // The mouse run sorts 19 projects above the target, past the menu's visible rows.
  const filler = process.argv[2] === "mouse" ? Array.from({ length: 19 }, (_, i) => ({ _id: `f${i}`, name: `Filler ${i}`, alias: `F${i}`, organizationName: "Alpha", organizationId: "alpha" })) : [];
  return { projects: [...filler, { _id: "existing", name: "Existing", alias: "EX", organizationName: "Org", organizationId: "org" }], organizations: [{ _id: "org", name: "Org", slug: "org" }] };
}} /></Box>, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, stderr: stderr as unknown as NodeJS.WriteStream, debug: true, exitOnCtrlC: false, patchConsole: false });
let instance = mount();
async function wait(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error(frame); await new Promise<void>(resolve => setImmediate(resolve)); }
  await inputBound();
}
async function key(value: string) { const before = frame; stdin.write(value); await wait(() => frame !== before || browser.getSnapshot().onboarding === false); }
try {
  await wait(() => frame.includes("Deployment HTTPS"));
  const click = async (text: string) => {
    const y = screen.split("\n").findIndex(line => line.includes(text));
    assert(y >= 0, `${text} is on screen:\n${screen}`);
    const x = screen.split("\n")[y].indexOf(text) + 1;
    await key(`\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`);
  };
  await key("https://example.convex.cloud");
  if (process.argv[2] === "mouse") {
    await click("Convoy API key"); await key("PRIVATE_API_KEY_qard");
    await click("Deployment HTTPS URL");
    assert(screen.includes("> Deployment HTTPS URL") && screen.includes("https://example.convex.cloud") && screen.includes("*".repeat(16)), "Moving focus by click keeps both inputs:\n" + screen);
  } else { await key("\t"); await key("PRIVATE_API_KEY_qard"); }
  assert(!output.includes("PRIVATE_API_KEY_qard"), frame);
  browser.select({ connection: 0, details: false }); assert(browser.getSnapshot().scope.details);
  if (process.argv[2] === "mouse") await click("[ Load choices ]");
  else { await key("\t"); await key("\t"); await key("\r"); }
  await wait(() => frame.includes("Link existing"));
  if (process.argv[2] === "mouse") {
    await click("Link existing project");
    assert(!screen.includes("Org / Existing (EX)"), "The target project starts below the visible rows:\n" + screen);
    await key("\u001b[<65;10;10M".repeat(30));
    await click("Org / Existing (EX)"); await wait(() => frame.includes("Profile name"));
    await click("Workspace mode"); await click("Reuse existing directory");
    assert(screen.includes("[ Reuse existing directory ▾ ]"), "Clicking a dropdown option picks it:\n" + screen);
    await click("Profile key"); await key("-custom");
    assert(screen.includes("ex-custom"), "A clicked field takes typed text:\n" + screen);
    await click("[ Review registration ]"); await wait(() => frame.includes("[ Register ]"));
    await click("[ Back ]"); await wait(() => frame.includes("Profile name"));
    await click("[ Review registration ]"); await wait(() => frame.includes("[ Register ]"));
    await click("[ Register ]"); await wait(() => frame.includes("preparation failed"));
    assert.equal(calls, 1, "Clicking Register submits once");
    assert.equal(requests[0].reuse, true); assert.equal(requests[0].profileKey, "ex-custom");
  } else if (process.argv[2] === "leave") {
    // A sidebar click on a filled form asks to discard it, then runs the navigation.
    let navigated = 0;
    assert(leave.current, "An open form registers a leave handler");
    leave.current(() => navigated++); await wait(() => frame.includes("Discard project draft"));
    assert.equal(navigated, 0);
    stdin.write("\t"); await settle(70); await key("\r");
    assert.equal(browser.getSnapshot().onboarding, false); assert.equal(navigated, 1);
  } else if (process.argv[2] === "cancel") {
    await key("\u001b"); await key("\u001b");
    assert(frame.includes("Discard project draft"), "Leaving a nonempty form requires an explicit discard");
    await key("\r"); assert(frame.includes("Deployment HTTPS"));
    await key("\u001b"); stdin.write("\t"); await settle(70); await key("\r");
    assert.equal(browser.getSnapshot().onboarding, false, "Explicit discard closes the form");
  } else if (process.argv[2] === "link") {
    await key("\r"); await key("\r"); await wait(() => frame.includes("Profile name"));
    await key(" custom"); await key("\t"); await key("-custom"); await key("\t");
    await key("-workspace"); await key("\t"); await key(" "); await key("\u001b[B"); await key("\r"); await key("\t"); await key("\t"); await key("\r");
    await wait(() => frame.includes("Back")); await key("\t"); await key("\r");
    await wait(() => frame.includes("preparation failed"));
    assert.equal(requests[0].project, "existing"); assert.equal(requests[0].profileName, "Existing custom");
    assert.equal(requests[0].profileKey, "ex-custom"); assert.equal(requests[0].reuse, true);
  } else {
    await key("\u001b[B"); await key("\r"); await key("\r");
    await wait(() => frame.includes("Project name"));
    for (let i = 0; i < 7; i++) await key("\t");
    await key("\r");
    await wait(() => frame.includes("Back")); assert.equal(calls, 0);
    if (process.argv[2] === "small") {
      instance.rerender(<Box width={45} height={10}><Onboarding browser={browser} width={45} height={10} /></Box>);
      await wait(() => frame.includes("Create") || frame.includes("Resize"));
      stdin.write("\t"); await new Promise<void>(resolve => setImmediate(resolve));
      stdin.write("\r"); await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(calls, 0, "Cannot register while confirmation is clipped");
      assert(frame.includes("Resize"));
    } else {
      await key("\t"); await key("\r"); await wait(() => frame.includes("preparation failed"));
      assert.equal(requests[0].create, true);
      await key("\r"); await wait(() => frame.includes("Profile name"));
      for (let i = 0; i < 5; i++) await key("\t");
      await key("\r");
      await key("\t"); await key("\r");
      if (["access", "remount"].includes(process.argv[2])) {
        await wait(() => frame.includes("Runtime access") && frame.includes("Skip"));
        assert(!frame.includes("Service applied"));
        assert.equal(calls, 2);
        if (process.argv[2] === "remount") {
          instance.unmount(); instance.cleanup();
          frame = "";
          instance = mount();
          await wait(() => frame.includes("Runtime access"));
          assert(!frame.includes("Deployment HTTPS"));
        }
        for (let i = 0; i < 30; i++) await new Promise<void>(resolve => setImmediate(resolve));
        if (process.argv[2] === "access") await click("> Skip"); else await key("\r");
      }
      await wait(() => frame.includes("Service applied"));
      assert.equal(calls, 2); assert.equal(requests[1].project, "created-project"); assert.equal(requests[1].create, undefined);
      assert(!output.includes("PRIVATE_API_KEY_qard"), frame);
    }
  }
  console.log("Onboarding renderer checks passed");
} finally { instance.unmount(); instance.cleanup(); browser.dispose(); }
