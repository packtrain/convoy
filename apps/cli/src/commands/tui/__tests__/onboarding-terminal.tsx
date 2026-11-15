import { useEffect, useSyncExternalStore } from "react";
import { render, Text } from "ink";
import assert from "node:assert/strict";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { gateInput } from "./test-helpers.js";
gateInput();
let calls = 0;
const browser = new Browser([{ id: "fixture", name: "Fixture", transport: "unix", endpoint: "/fixture", open: async () => { throw new Error("fixture"); },
  addProject: async (directory, options) => {
    calls++; assert.equal(directory, "new-project"); assert.equal(options.apiKey, "PRIVATE_TERMINAL_KEY");
    if (calls === 1) { assert.equal(options.create, true); return { ok: false, registered: false, applied: false, retrySafe: true, phase: "preparation", projectId: "created-project" }; }
    assert.equal(options.project, "created-project"); assert.equal(options.create, undefined);
    return { ok: true, registered: true, applied: true, retrySafe: true, phase: "complete", projectId: "created-project" };
  },
}]);
function Fixture() {
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot);
  useEffect(() => { assert.equal(process.stdin.isRaw, true); process.stderr.write("INPUT_READY\n"); }, []);
  return <><App browser={browser} onboardingLoad={async (_url, secret) => {
    assert.equal(secret, "PRIVATE_TERMINAL_KEY");
    return { projects: [], organizations: [{ _id: "org", name: "Fixture Org", slug: "fixture" }] };
  }} />{!state.onboarding && state.scope.profile && <Text>DONE_PROFILE {state.scope.profile} · q detach</Text>}</>;
}
const instance = render(<Fixture />, { exitOnCtrlC: false, patchConsole: false });
await instance.waitUntilExit(); instance.cleanup(); browser.dispose();
assert.equal(calls, 2); assert.equal(process.stdin.isRaw, false);
console.log("PTY_ONBOARDING_OK");
