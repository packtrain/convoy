import { stripVTControlCharacters } from "node:util";
import { PassThrough } from "node:stream";
import { render } from "ink";
import assert from "node:assert/strict";
import { RuntimeAccess } from "../onboarding/runtime-access.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { inputBound } from "./test-helpers.js";
import type { CredentialMutation, ManagedCredentialStatus } from "../../../lib/config/credentials/validators.js";
const scenario = process.argv[2];
const stdout = Object.assign(new PassThrough(), { columns: 90, rows: 24, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let output = "";
let screen = "";
let frame = "", finished = false, reloads = 0;
stdout.on("data", chunk => { screen = stripVTControlCharacters(chunk.toString()); output += plain(chunk.toString()); if (plain(chunk.toString()).trim()) frame = plain(chunk.toString()); });
const entries: ManagedCredentialStatus["entries"] = [
  { name: "openai-key", provider: "openai", enabled: true },
  { name: "aws-key", provider: "bedrock", enabled: true },
  { name: "disabled-key", provider: "openai", enabled: false },
].map(entry => ({ ...entry, auth: "api-key", billing: "api", revision: 1, retainedRevisions: [] }));
let reads = 0, preparations = 0, accountReads = 0;
let desired: string | undefined = scenario === "retained" ? "openai-key" : undefined;
const longError = "Cannot change runtime access because the service connection was lost. Reconnect to the environment and refresh credential status before retrying.";
const browser = new Browser([{ id: "fixture", name: "Fixture", transport: "unix", endpoint: "/socket", ...(scenario === "shared" ? { mode: "shared" as const } : {}), open: async () => { throw new Error(); },
  account: async () => { accountReads++; if ((scenario === "account-error" || scenario === "layout") && accountReads === 1) throw new Error("private diagnostic"); return ({ codex: { status: scenario === "account" ? "signed-in" : "signed-out", method: "ChatGPT" }, "claude-code": { status: scenario === "shared" ? "unknown" : "signed-out" } }); },
  shell: async () => {}, credentials: { status: async () => { reads++; return ({ service: true, compatible: scenario !== "old", configurationError: false, entries: ["account", "layout"].includes(scenario) ? [] : entries, projects: [{ identity: "identity", profiles: ["new"], desired: desired ? { mode: "managed", name: desired } : { mode: "native" }, state: "online", verified: false }] }); } },
}]);
const mutations: CredentialMutation[] = [];
browser.prepareOnboardingAccess = async () => {
  preparations++;
  return scenario === "loading" ? new Promise(() => {}) : { profile: "new", identity: "identity", status: scenario === "delayed" ? "connecting" : "online", attempts: 1,
    runtimes: ["unknown", "delayed"].includes(scenario) ? undefined : ["codex", "claude-code", "cursor"] };
};
let observation = browser.getSnapshot();
const listeners = new Set<() => void>();
browser.getSnapshot = () => observation;
browser.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };

browser.mutateCredentials = async request => { mutations.push(request);
  if (request.action === "bind" && (!request.runtime || request.runtime === "codex")) desired = request.binding.mode === "managed" ? request.binding.name : undefined;
  if (scenario === "lost" && mutations.length === 1) throw new Error("Outcome unknown. Refresh status.");
  if (scenario === "narrow") throw new Error(longError);
  if (scenario === "partial" && mutations.length === 2) throw new Error("Second assignment failed");
  return true;
};
browser.reloadProjects = async profiles => { assert.deepEqual(profiles, ["new"]); reloads++; if (scenario === "reload-native" && reloads <= 2) throw new Error("Reload failed"); };
let login: string | undefined;
browser.beginAction = kind => { login = kind; };
const instance = render(<RuntimeAccess browser={browser} profile="new" width={scenario === "narrow" ? 48 : scenario === "layout" ? 120 : 90} height={scenario === "narrow" ? 17 : scenario === "layout" ? 32 : 24} onDone={() => { finished = true; }} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, stderr: new PassThrough() as unknown as NodeJS.WriteStream, debug: true, exitOnCtrlC: false, patchConsole: false });
async function wait(check: () => boolean) { const deadline = Date.now() + 3000; while (!check()) { if (Date.now() > deadline) throw new Error(frame); await new Promise<void>(resolve => setImmediate(resolve)); } await inputBound(); }
async function idle() { for (let i = 0; i < 30; i++) await new Promise<void>(resolve => setImmediate(resolve)); await inputBound(); }
async function key(value: string) { await idle(); stdin.write(value); await idle(); }
async function choose(label: string) {
  for (let i = 0; i < 20 && !frame.includes(`> ${label}`); i++) await key("\t");
  assert(frame.includes(`> ${label}`), frame); await key("\r");
}
try {
  await wait(() => frame.includes(scenario === "loading" ? "Skip" : "Registration is complete"));
  assert(!frame.includes("Cursor:"));
  if (["skip", "loading"].includes(scenario)) { await choose("Skip"); assert(finished); }
  else if (scenario === "layout") {
    await wait(() => accountReads === 1 && frame.includes("Couldn't check account"));
    const lines = screen.split("\n").map(line => line.trim());
    assert(lines.includes("Codex"), screen);
    assert(lines.includes("Claude Code"), screen);
    assert.equal(lines.filter(line => line === "Account: Couldn't check account").length, 2, screen);
    assert.equal((frame.match(/Refresh or update/g) ?? []).length, 1, frame);
    assert(!frame.includes("subscription or quota"), frame);
    assert(!frame.includes("Save reloads"), frame);
    assert(lines.includes("Actions"), screen);
    console.log(screen);
  }
  else if (scenario === "account-error") {
    await wait(() => frame.includes("Couldn't check account"));
    assert(!frame.includes("private diagnostic")); assert.equal(accountReads, 1);
    await choose("Refresh"); await wait(() => frame.includes("Not signed in"));
    assert.equal(accountReads, 2); assert.equal(mutations.length, 0); assert.equal(reloads, 0);
  }
  else if (scenario === "account") { await wait(() => frame.includes("Signed in with ChatGPT")); assert(!frame.includes("Codex authentication: Native account")); await choose("Sign in again to Codex"); assert.equal(login, "login-codex"); }
  else if (scenario === "old") { assert(!frame.includes("Codex: Native")); await choose("Sign in to Codex"); assert.equal(login, "login-codex"); }
  else if (scenario === "unknown") { assert(frame.includes("Runtimes are unknown")); assert(!frame.includes("Sign in to Codex")); }
  else if (scenario === "delayed") {
    assert(!frame.includes("Sign in to Codex"));
    observation = { ...observation, observations: [{ ...observation.observations[0], profiles: [{ profile: "new", identity: "identity", status: "online", attempts: 1, runtimes: ["codex", "claude-code"] }] }] };
    for (const listener of listeners) listener();
    await wait(() => frame.includes("Sign in to Codex") && frame.includes("Sign in to Claude Code"));
    assert.equal(preparations, 1); assert.equal(reads, 1); assert.equal(reloads, 0);
    await choose("Codex authentication: Native account"); await choose("openai-key");
    observation = { ...observation, observations: [{ ...observation.observations[0], profiles: [{ profile: "new", identity: "identity", status: "online", attempts: 1, runtimes: ["codex", "claude-code"], activeRuns: 1 }] }] };
    for (const listener of listeners) listener();
    await wait(() => frame.includes("Codex authentication: openai-key"));
    await choose("Skip"); assert(finished); assert.equal(mutations.length, 0);
  }
  else if (scenario === "shared") {
    // Managed choices as anywhere else; no launcher to update for an unknown account (OS-2248).
    await wait(() => frame.includes("Account: Not signed in"));
    assert(frame.includes("Account: Couldn't check account") && frame.includes("Codex authentication: Native account"), frame);
    assert(frame.includes("Refresh or update Codex and Claude Code to check accounts.") && !frame.includes("launcher"), frame);
    await choose("Sign in to Codex"); assert.equal(login, "login-codex");
  }
  else if (scenario === "login") { await choose("Sign in to Claude Code"); assert.equal(login, "login-claude-code"); }
  else if (scenario === "retained") {
    assert(frame.includes("Codex authentication: openai-key"), frame);
    assert(!frame.includes("Sign in to Codex"), frame);
  }
  else {
    await choose("Codex authentication: Native account");
    assert(!frame.includes("disabled-key"));
    await choose("openai-key");
    if (scenario === "partial") { await choose("Claude Code authentication: Native account"); assert(!frame.includes("openai-key")); await choose("aws-key"); }
    await choose("Save and reload");
    if (scenario === "lost") {
      await wait(() => frame.includes("Outcome unknown"));
      await choose("Refresh");
      await wait(() => frame.includes("Codex authentication: openai-key"));
      await choose("Codex authentication: openai-key"); await choose("Native login");
      assert(!frame.includes("Sign in to Codex"), frame);
      await choose("Save and reload");
      assert.deepEqual(mutations[1], { action: "bind", profile: "new", binding: { mode: "native" } });
    }
    if (scenario === "reload-native") {
      await wait(() => frame.includes("Reload failed"));
      await choose("Codex authentication: openai-key"); await choose("Native login");
      await choose("Save and reload");
      await wait(() => reloads === 2);
      await choose("Save and reload");
      assert.equal(mutations.length, 2);
    }
    if (scenario === "narrow") {
      for (let i = 0; i < 8; i++) await key("\u001b[6~");
      assert(output.replace(/\s+/g, "").includes("refreshcredentialstatusbeforeretrying."), output);
    } else {
      if (scenario === "partial") { await wait(() => frame.includes("Second assignment failed")); assert.equal(reloads, 0); assert(!finished); await choose("Save and reload"); }
      await wait(() => finished);
      assert.equal(reloads, scenario === "reload-native" ? 3 : 1);
      assert.deepEqual(mutations[0], { action: "bind", profile: "new", binding: { mode: "managed", name: "openai-key" } });
      if (scenario === "partial") { assert.equal(mutations.length, 3); assert.equal(mutations[2].action, "bind"); assert.deepEqual(mutations[1], mutations[2]); }
    }
  }
  if (["skip", "loading", "old", "unknown", "login", "shared"].includes(scenario)) { assert.equal(mutations.length, 0); assert.equal(reloads, 0); }
  console.log("Runtime access passed");
} finally { instance.unmount(); instance.cleanup(); browser.dispose(); }
