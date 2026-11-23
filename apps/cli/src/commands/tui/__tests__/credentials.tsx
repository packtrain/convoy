import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import assert from "node:assert/strict";
import { render } from "ink";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { gateInput, settle } from "./test-helpers.js";
import { serviceServer } from "../../service/server.js";
import { ServiceClient } from "../../service/client.js";
import type { Binding, CredentialMutation, ManagedCredentialStatus } from "../../../lib/config/credentials/validators.js";

const scenario = process.argv[2];
const SECRET = "sk-FIXTURE-SECRET-0123456789";
const directory = await mkdtemp(join(tmpdir(), "tui-credentials-"));
const socket = join(directory, "s");
const requests: CredentialMutation[] = [];
const allowed: string[] = [];
const reconciles: unknown[] = [];
let statusReads = 0, failStatus = scenario === "status-error";
const reject = scenario === "rejection";
// In-memory stand-in for the environment's credential store and its service.
const entries: Record<string, { region?: string; provider: string; enabled: boolean; revision: number; retained: number[] }> = {
  "work-openai": { provider: "openai", enabled: true, revision: 2, retained: [1, 2] },
  "work-old": { provider: "openai", enabled: true, revision: 1, retained: [1] },
};
const bindings: Record<string, Record<string, Binding>> = { codex: { a: { mode: "managed", name: "work-openai" }, b: { mode: "managed", name: "work-old" } }, "claude-code": {}, cursor: {}, antigravity: {} };
const applied = structuredClone(bindings);
const descriptor = (binding?: Binding) => binding && (binding.mode === "managed" ? { mode: entries[binding.name].enabled ? "managed" as const : "disabled" as const, name: binding.name, revision: entries[binding.name].revision } : { mode: binding.mode });
const auth = (source: typeof bindings, profile: string) => {
  const claude = descriptor(source["claude-code"][profile]);
  const codex = descriptor(source.codex[profile]);
  const cursor = descriptor(source.cursor[profile]);
  const antigravity = descriptor(source.antigravity[profile]);
  return claude || cursor || antigravity
    ? { ...(codex ?? { mode: "native" as const }), ...(claude ? { claude } : {}), ...(cursor ? { cursor } : {}), ...(antigravity ? { antigravity } : {}) } : codex;
};
const status = async (): Promise<ManagedCredentialStatus> => {
  statusReads++;
  if (failStatus) { failStatus = false; throw new Error("Permission denied reading credentials-v1.json"); }
  return { service: true, compatible: scenario !== "shared-stale", configurationError: false,
    entries: Object.entries(entries).map(([name, e]) => ({ name, provider: e.provider, ...(e.region ? { region: e.region } : {}), auth: "api-key", billing: "API usage", enabled: e.enabled, revision: e.revision, retainedRevisions: e.retained })),
    projects: ["a", "b"].map(profile => ({ identity: profile.repeat(64), profiles: [profile], state: "online", verified: false,
      desired: auth(bindings, profile), applied: auth(applied, profile), pending: JSON.stringify(auth(bindings, profile)) !== JSON.stringify(auth(applied, profile)) })) };
};
const snapshot = () => ({ pid: process.pid, stopping: false, profiles: ["a", "b"].map(profile => ({ profile, identity: profile.repeat(64), status: "online" as const, attempts: 1, activeRuns: 0 })) });
const control = serviceServer(snapshot, async request => {
  if (request.op === "status") return snapshot();
  if (request.op === "inspect") return { result: { nodeVersion: process.version, profiles: [] } };
  if (request.op === "reconcile") { reconciles.push({ profile: request.profile, interrupt: request.interrupt }); return { registered: true, applied: true }; }
  if (request.op !== "credentials.mutate" || !request.credentials) return { result: { page: [], isDone: true, continueCursor: "" } };
  const change = request.credentials;
  requests.push(change);
  if (reject) throw new Error("Managed credentials require a registered isolated profile.");
  if (scenario === "add-rejected") throw new Error("Managed Anthropic keys require an updated launcher. Follow the VM upgrade instructions.");
  if (change.action === "bind") bindings[change.runtime ?? "codex"][change.profile] = change.binding;
  if (change.action === "add") entries[change.name] = { provider: change.provider ?? change.aws?.provider ?? "openai", region: change.aws?.region, enabled: true, revision: 1, retained: [1] };
  if (change.action === "rotate") { const e = entries[change.name]; e.revision = Math.max(...e.retained) + 1; e.retained.push(e.revision); e.enabled = true; }
  if (change.action === "rollback") entries[change.name].revision = change.revision;
  if (change.action === "disable") entries[change.name].enabled = false;
  if (change.action === "remove") delete entries[change.name];
  return { registered: true, applied: false };
}, () => {});
await new Promise<void>(resolve => control.server.listen(socket, resolve));
const connection = { id: "fixture", name: "Fixture", transport: "docker", endpoint: socket, ...(scenario.startsWith("shared") ? { mode: "shared" as const } : {}), open: (signal: AbortSignal) => ServiceClient.open(socket, signal), shell: async () => {},
  ...(scenario === "unsupported" ? {} : { credentials: { status, allowDomain: async (host: string) => { allowed.push(host); } } }) };
if (scenario === "pty") {
  // credentials-terminal.py drives the production render loop in a real PTY.
  const { run } = await import("../render.js");
  gateInput();
  await run([connection]);
  control.server.close();
  assert.deepEqual(requests, [{ action: "bind", profile: "b", binding: { mode: "managed", name: "work-openai" } }, { action: "rotate", name: "work-openai", secret: SECRET }]);
  assert.equal(process.stdin.isRaw, false);
  console.log("PTY_CREDENTIALS_OK");
  process.exit(0);
}
const browser = new Browser([connection]);
let retries = 0;
const retry = browser.retryNow.bind(browser);
browser.retryNow = () => { retries++; retry(); };
const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 34, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let frame = "", screen = "", leaked = false;
stdout.on("data", chunk => { const text = plain(chunk.toString()); if (text.includes(SECRET.slice(3, 12))) leaked = true; if (text.trim()) { frame = text; screen = stripVTControlCharacters(chunk.toString()); } });
const instance = render(<App browser={browser} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
async function key(...values: string[]) { for (const value of values) { stdin.write(value); await settle(60); } }
async function until(text: string) {
  const deadline = Date.now() + 4000;
  while (!frame.includes(text)) { if (Date.now() > deadline) throw new Error(`Missing ${text}\n${frame}`); await settle(20); }
  await settle(50);
}
const [TAB, ENTER, ESC, UP, DOWN, LEFT, RIGHT, DEL] = ["\t", "\r", "\u001b", "\u001b[A", "\u001b[B", "\u001b[D", "\u001b[C", "\u007f"];
try {
  browser.start();
  await settle(300);
  if (scenario === "unsupported") {
    await key("c"); await until("Runtime credentials are unavailable");
    assert(frame.includes("convoy keys"), frame);
    await key(ESC, DOWN, DOWN, "a"); await until("Assign or unassign credentials");
    await key("c"); await until("Runtime credentials need a shared environment, a managed Docker target");
    assert.equal(browser.getSnapshot().credentials, undefined);
  } else {
    await key("c");
    if (scenario === "status-error") { await until("✗ Cannot read credential status: Permission denied reading credentials-v1.json"); await key("f"); }
    await until("work-openai · enabled · 1 assigned · rev 2");
    const reads = statusReads;
    if (scenario === "status-error") { assert.equal(statusReads, 2); assert.equal(retries, 0, "f rereads status only"); }
    else if (scenario === "mouse") {
      // SGR press and release at the first cell of `text`.
      const click = async (text: string) => {
        const y = screen.split("\n").findIndex(line => line.includes(text));
        if (y < 0) throw new Error(`Missing ${text}\n${screen}`);
        const x = screen.split("\n")[y].indexOf(text) + 1;
        await key(`\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`);
      };
      await click("work-old · enabled"); await until("Assignments · work-old");
      assert(!frame.includes("Assign work-old ·"), "The first click on a credential only selects it");
      await click("work-old · enabled"); await until("Assign work-old");
      await key(ESC); await until("Assignments · work-old");
      await click("[o] Rotate"); await until("Rotate work-old");
      await key(ESC); await until("Assignments · work-old");
      await key(UP, UP); await until("[Enter/n] Add credential");
      const before = statusReads;
      await click("[f] Refresh"); await settle(100);
      assert.equal(statusReads, before + 1, "Clicking [f] Refresh rereads status");
      await click("+ Add credential"); await until("Add credential · Fixture");
      await click("[ Review ]"); await until("Name uses letters");
      await click("[ Cancel ]"); await until("work-openai · enabled");
      assert.equal(requests.length, 0);
    }
    else if (scenario === "vanish") {
      await key(DOWN, DOWN, ENTER); await until("Assign work-old");
      delete entries["work-old"]; delete bindings.codex.b; delete applied.codex.b;
      await key("f"); await until("1 assigned · rev 2");
      assert(!frame.includes("work-old"), frame);
      assert.equal(browser.getSnapshot().credentials, "view", "A vanished entry releases the lock");
      await key(ESC); assert.equal(browser.getSnapshot().credentials, "view", "Esc returns to the sidebar and keeps Credentials");
    } else if (scenario === "narrow-forms") {
      await key("n"); await until("Add credential · Fixture");
      await key("k", "e", "e", "p"); await until("[ keep");
      stdout.columns = 44; stdout.emit("resize"); await until("Resize to 45");
      stdout.columns = 110; stdout.emit("resize"); await until("[ keep");
      await key(ESC); await until("Discard credential draft?"); await key(RIGHT, ENTER); await until("work-openai · enabled");
      await key(DOWN, "o"); await until("Affected assignments");
      stdin.write(SECRET); await settle(60);
      stdout.columns = 44; stdout.emit("resize"); await until("Resize");
      stdout.columns = 110; stdout.emit("resize"); await until("(masked): ****************");
      assert.equal(requests.length, 0);
    }
    else if (scenario === "assign" || scenario === "leave" || scenario === "rejection" || scenario === "narrow") {
      await key(DOWN, ENTER); await until("Assign work-openai");
      assert(frame.includes("[x] a · Codex") && frame.includes("[ ] b · Codex"), frame);
      await key(DOWN, " "); await until("unsaved · replaces work-old");
      await key("d", "q"); assert.equal(browser.getSnapshot().credentials, "editing", "A dirty draft locks tabs and detach shortcuts");
      if (scenario === "narrow") {
        stdout.columns = 44; stdout.emit("resize"); await until("Resize");
        await key(TAB, ENTER); assert.equal(requests.length, 0, "Hidden controls cannot save");
        stdout.columns = 110; stdout.emit("resize"); await until("unsaved · replaces work-old");
      }
      if (scenario === "leave") {
        await key(ESC); await until("Save assignment changes?");
        await key(ENTER); await until("unsaved · replaces work-old");
        await key(ESC, TAB, ENTER); await until("work-old · enabled");
        assert.equal(requests.length, 0); assert.equal(browser.getSnapshot().credentials, "view");
      } else {
        await key(TAB, ENTER);
        if (scenario === "rejection") {
          await until("✗ Saved 0 of 1. b (Codex): Managed credentials require");
          assert(frame.includes("unsaved · replaces work-old"), "Draft retained after rejection");
        } else {
          await until("Saved 1 change for b.");
          assert(frame.includes("[ Reload project ]"), frame);
          await key(ENTER); await until("pending reconnect · [u] Reload project");
          assert.deepEqual(requests, [{ action: "bind", profile: "b", binding: { mode: "managed", name: "work-openai" } }]);
          assert.deepEqual(reconciles, [], "Close does not reload");
          assert(statusReads > reads, "Status reread after save");
          await key(ESC); await until("work-openai · enabled · 2 assigned · rev 2");
        }
      }
    } else if (scenario === "add") {
      await key("n"); await until("Add credential · Fixture");
      await key("w", "o", "r", "k", "-", "m", TAB, RIGHT, TAB); await until("AWS Region (default us-east-1)");
      await key(TAB); // Region left empty takes the default.
      stdin.write(SECRET); await settle(60); await key("q");
      await until("Region"); assert(frame.includes("**"), frame);
      await key(TAB, TAB, ENTER); await until("Allows bedrock-mantle.us-east-1.api.aws");
      await key(RIGHT, ENTER); await until("✓ Added work-m.");
      assert(frame.indexOf("✓ Added work-m.") < frame.indexOf("+ Add credential"), "Result leads the panel");
      assert.deepEqual(requests, [{ action: "add", name: "work-m", secret: SECRET + "q", aws: { provider: "mantle", region: "us-east-1" } }]);
      assert.deepEqual(allowed, ["bedrock-mantle.us-east-1.api.aws"]);
      await until("work-m · enabled · 0 assigned · rev 1 · AWS Bedrock (Mantle)");
      await until("No assignments. Enter to assign projects.");
    } else if (scenario === "add-anthropic") {
      await key("n"); await until("Add credential · Fixture");
      await key("w", "o", "r", "k", "-", "a", TAB, RIGHT, RIGHT, RIGHT, TAB); await until("(●) Anthropic API");
      assert(!frame.includes("AWS Region"), frame);
      stdin.write(SECRET); await settle(60);
      await key(TAB, TAB, ENTER); await until("Runtimes: Claude Code · Key: entered, hidden");
      await key(RIGHT, ENTER); await until("Added work-a.");
      assert.deepEqual(requests, [{ action: "add", name: "work-a", secret: SECRET, provider: "anthropic" }]);
      assert.deepEqual(allowed, []);
      await until("work-a · enabled · 0 assigned · rev 1 · Anthropic · API key");
    } else if (scenario === "add-rejected") {
      await key("n"); await until("Add credential · Fixture");
      await key("w", "o", "r", "k", "-", "a", TAB, RIGHT, RIGHT, RIGHT, TAB);
      stdin.write(SECRET); await settle(60);
      await key(TAB, TAB, ENTER, RIGHT, ENTER); await until("updated launcher");
      const at = frame.indexOf("✗ Not added: Managed Anthropic keys require");
      assert(at >= 0 && at < frame.indexOf("Add credential to Fixture"), frame);
      assert.equal(entries["work-a"], undefined);
    } else if (scenario === "rotate") {
      await key(DOWN, "o"); await until("Affected assignments: a (Codex).");
      stdin.write(SECRET); await settle(60);
      await key(TAB, TAB, ENTER); await until("Rotated work-openai.");
      assert.deepEqual(requests, [{ action: "rotate", name: "work-openai", secret: SECRET }]);
      await until("rev 3 · OpenAI · API key");
    } else if (scenario === "disable-rollback") {
      await key(DOWN, "b"); await until("Select retained revision 1 instead of revision 2.");
      await key(RIGHT, ENTER); await until("work-openai selects revision 1.");
      await key("x"); await until("Prevents future grants");
      assert(frame.includes("Affected assignments: a (Codex)."), frame);
      await key(RIGHT, ENTER); await until("work-openai disabled.");
      await until("work-openai · disabled");
      await key(ENTER, DOWN, " "); await until("work-openai is disabled and cannot gain assignments.");
      assert.deepEqual(requests, [{ action: "rollback", name: "work-openai", revision: 1 }, { action: "disable", name: "work-openai" }]);
    } else if (scenario === "remove") {
      await key(DOWN, DEL); await until("! Unassign work-openai first: a (Codex).");
      delete bindings.codex.b; delete applied.codex.b;
      await key("f", DOWN, DEL); await until("Delete work-old?");
      assert(frame.includes("Deletes every stored revision"), frame);
      await key(RIGHT, ENTER); await until("✓ Deleted work-old.");
      assert(!frame.includes("work-old ·"), frame);
      assert.deepEqual(requests, [{ action: "remove", name: "work-old" }]);
    } else if (scenario === "project") {
      await key(ESC, DOWN, DOWN, "a"); await until("Assign or unassign credentials");
      await key("c"); await until("Credentials · a");
      assert(frame.includes("[ work-openai ▾ ]"), frame);
      await key(LEFT, RIGHT); assert(frame.includes("[ work-openai ▾ ]"), "Arrows no longer cycle values");
      await key(ENTER); await until("↑/↓ select · Enter choose · Esc cancel");
      assert(frame.includes("Codex credential") && frame.includes("> work-openai") && frame.includes("Native login (private shell)") && frame.includes("Unassigned · runtime disabled"), frame);
      await key(ESC); await until("[ work-openai ▾ ]");
      assert.equal(browser.getSnapshot().credentials, "editing", "Esc closes only the dropdown");
      await key(" ", UP, ENTER); await until("[ Native login (private shell) ▾ ]");
      await key(TAB, TAB, TAB, TAB, ENTER); await until("Pause and log in");
      assert(frame.includes("Codex's own login"), frame);
      assert.deepEqual(requests, [{ action: "bind", profile: "a", binding: { mode: "native" } }]);
      await key(ESC); await until("Private project shell");
      assert.equal(browser.getSnapshot().credentials, undefined); assert.equal(browser.getSnapshot().actions, true);
    } else if (scenario === "project-cursor") {
      // Restoring Cursor's native login names the CLI login; the TUI has no Cursor login action (OS-2017).
      entries["work-cursor"] = { provider: "cursor", enabled: true, revision: 1, retained: [1] };
      bindings.cursor.a = applied.cursor.a = { mode: "managed", name: "work-cursor" };
      await key(ESC, DOWN, DOWN, "a"); await until("Assign or unassign credentials");
      await key("c"); await until("[ work-cursor ▾ ]");
      await key(TAB, TAB, ENTER); await until("Cursor credential");
      assert(!frame.includes("> work-openai"), frame);
      await key(UP, ENTER, TAB, TAB, ENTER); await until("Native login: run convoy project login a --runtime cursor in a terminal.");
      assert(!frame.includes("Pause and log in"), frame);
      assert.deepEqual(requests, [{ action: "bind", profile: "a", runtime: "cursor", binding: { mode: "native" } }]);
    } else if (scenario === "add-gemini") {
      await key("n"); await until("Add credential · Fixture");
      await key("w", "o", "r", "k", "-", "g", TAB, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT, TAB); await until("(●) Gemini API");
      assert(!frame.includes("AWS Region"), frame);
      stdin.write(SECRET); await settle(60);
      await key(TAB, TAB, ENTER); await until("Runtimes: Antigravity · Key: entered, hidden");
      await key(RIGHT, ENTER); await until("Added work-g.");
      assert.deepEqual(requests, [{ action: "add", name: "work-g", secret: SECRET, provider: "gemini" }]);
      await until("work-g · enabled · 0 assigned · rev 1 · Gemini · API key");
    } else if (scenario === "project-antigravity") {
      // A Gemini key is offered to the Antigravity row only (OS-2476).
      entries["work-gemini"] = { provider: "gemini", enabled: true, revision: 1, retained: [1] };
      await key(ESC, DOWN, DOWN, "a"); await until("Assign or unassign credentials");
      await key("c"); await until("Credentials · a");
      await key(TAB, TAB, TAB, ENTER); await until("Antigravity credential");
      assert(frame.includes("work-gemini") && !frame.includes("> work-openai"), frame);
      await key(DOWN, ENTER, TAB, ENTER); await until("Saved 1 change for a.");
      assert.deepEqual(requests, [{ action: "bind", profile: "a", runtime: "antigravity", binding: { mode: "managed", name: "work-gemini" } }]);
    } else if (scenario === "shared-stale") {
      assert(frame.includes("The service predates shared-environment credentials."), frame);
    } else if (scenario === "shared") {
      // A shared account's native login is already its own, so restoring it offers a reload, not a login (OS-2248).
      await key(ESC, DOWN, DOWN, "a"); await until("Assign or unassign credentials");
      await key("c"); await until("Credentials · a");
      await key(ENTER, UP); await until("Native login (this account)");
      assert(!frame.includes("private shell"), frame);
      await key(ENTER, TAB, TAB, TAB, TAB, ENTER); await until("Saved 1 change for a.");
      assert(frame.includes("[ Reload project ]") && !frame.includes("Pause and log in"), frame);
      assert.deepEqual(requests, [{ action: "bind", profile: "a", binding: { mode: "native" } }]);
    } else if (scenario === "project-saved") {
      await key(ESC, DOWN, DOWN, "a"); await until("Assign or unassign credentials");
      await key("c"); await until("Credentials · a");
      await key(ENTER, DOWN, ENTER, TAB, TAB, TAB, TAB, ENTER); await until("Saved 1 change for a.");
      assert(frame.includes("[ Close ]") && frame.includes("[ Reload project ]") && frame.includes("stops active work in a"), frame);
      await key(ENTER); await until("pending reconnect · [u] Reload project");
      assert.equal(browser.getSnapshot().credentials, "editing", "Close keeps the editor");
      await key(TAB, TAB, ENTER, DOWN, ENTER, TAB, TAB, TAB, TAB, ENTER); await until("Saved 1 change for a.");
      await key(RIGHT, ENTER); await until("✓ Reload requested for a.");
      assert.deepEqual(reconciles, [{ profile: "a", interrupt: true }]);
      assert.deepEqual(requests, [{ action: "bind", profile: "a", binding: { mode: "managed", name: "work-old" } }, { action: "bind", profile: "a", binding: { mode: "disabled" } }]);
      assert.equal(browser.getSnapshot().credentials, "editing", "Reload keeps the editor");
    } else if (scenario === "project-reload") {
      applied.codex.a = { mode: "native" };
      await key(ESC, DOWN, DOWN, "a"); await until("Assign or unassign credentials");
      await key("c"); await until("pending reconnect · [u] Reload project");
      await key(ENTER, UP, ENTER); await until("unsaved · was work-openai");
      await key("u"); await until("! Save or discard the draft before [u] Reload project.");
      assert.equal(browser.getSnapshot().credentials, "editing");
      await key(TAB, TAB, TAB, TAB, TAB, ENTER); await until("pending reconnect · [u] Reload project");
      await key("u"); await until("Reload a?");
      await key(RIGHT, ENTER); await until("✓ Reload requested for a.");
      assert.deepEqual(reconciles, [{ profile: "a", interrupt: true }]);
    } else if (scenario === "environment-reload") {
      applied.codex.a = { mode: "native" };
      await key("f", DOWN); await until("a (Codex): pending reconnect · [u] Reload project");
      await key("u"); await until("Reload a?");
      assert(frame.includes("stops active work in a"), frame);
      await key(ENTER); await until("a (Codex): pending reconnect");
      assert.deepEqual(reconciles, [], "Close does not reload");
      await key("u"); await until("Reload a?");
      await key(RIGHT, ENTER); await until("✓ Reload requested for a.");
      assert.deepEqual(reconciles, [{ profile: "a", interrupt: true }]);
      await key(DOWN, "u"); await until("! No project using work-old has pending credential changes.");
    } else throw new Error(`Unknown scenario ${scenario}`);
  }
  assert(!leaked, "Secret never rendered");
  console.log("Credential renderer checks passed: " + scenario);
} finally {
  instance.unmount(); browser.dispose(); control.server.close();
}
