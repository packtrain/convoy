import { writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { App } from "../app.js";
import { Browser } from "../workflow.js";
import { plain } from "../formatters.js";
import { settle } from "./test-helpers.js";
import type { EnvironmentForm } from "../../environment/validators.js";
const scenario = process.argv[2];
const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 38, isTTY: true });
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let frame = "", output = "", executed = 0, started = 0;
stdout.on("data", chunk => { output += chunk.toString(); if (plain(chunk.toString()).trim()) frame = chunk.toString(); });
const browser = new Browser([...(scenario === "delete-success" ? [{ id: "local", name: "Local", transport: "unix", endpoint: "local", open: async () => { throw new Error("offline"); } }] : []), { id: "test", name: "Test target", transport: "docker", endpoint: "test-container", open: async () => { throw new Error("offline"); },
  ...(scenario === "mouse-buttons" ? { start: async () => { started++; } } : {}),
  ...(scenario === "local" ? {} : { maintenance: { status: async () => ({}), release: async () => ({ installed: "0.100.0", proposed: "0.103.1" }), execute: async () => { executed++; return scenario === "delete-success" ? { deleted: true } : {}; } } }),
}], scenario === "delete-success" ? 1 : 0);
const instance = render(<App browser={browser} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
async function key(value: string) { stdin.write(value); await settle(80); }
// Body rows below the header, split into the sidebar (22 columns below 100, else 30) and the panel.
const sidebarWidth = () => stdout.columns < 100 ? 22 : 30;
const sidebar = () => frame.split("\n").slice(2).map(line => plain(line).slice(0, sidebarWidth()));
// Row text without the selection marker, status dot or key.
const label = (line: string) => line.replace(/^›/, " ").replace(/\s+[●○!ac+]\s*$/, "").trim();
const panel = () => frame.split("\n").slice(2).map(line => plain(line).slice(sidebarWidth())).join("\n");
try {
  await settle(80);
  if (scenario === "delete-success") {
    await key("a"); await key("D"); await key("\t"); await key("\r");
    assert.equal(executed, 1);
    assert.deepEqual(browser.targets.map(target => target.id), ["local"]);
    assert(plain(frame).includes("Environment Test target deleted."), plain(frame));
    assert(stripVTControlCharacters(frame).includes("╭"), "Deletion result stays in a popup");
    assert(!plain(frame).includes("[ Back ]"), "Do not offer retry after successful deletion");
    await key("\r");
    assert.equal(browser.getSnapshot().environment, undefined);
  } else if (scenario === "delete-confirm") {
    browser.getSnapshot().observations[0].environmentStatus = { state: "not-created" };
    await key("a"); await key("D");
    assert(plain(frame).includes("cannot be undone"), plain(frame));
    assert(plain(frame).includes("project files, credentials"), plain(frame));
    assert.equal(executed, 0);
    await key("\r");
    assert.equal(executed, 0);
    assert.equal(browser.getSnapshot().environment, undefined);
  } else if (scenario === "stop-result") {
    await key("a"); await key("z"); await key("\t"); await key("\r");
    assert(plain(frame).includes("Environment Test target is stopped."), plain(frame));
    assert(stripVTControlCharacters(frame).includes("╭"), "Stop result stays in a popup");
  } else if (scenario === "network" || scenario === "restricted-network" || scenario === "buttons") {
    browser.prepareEnvironment = async form => {
      assert.equal(form.networkMode, scenario === "restricted-network" ? "strict" : "open");
      assert.equal(form.deployment, scenario === "restricted-network" ? "demo" : "");
      return { ...form, version: "0.104.0", install: true };
    };
    await key("E"); await key("research");
    if (scenario === "buttons") {
      assert(stripVTControlCharacters(frame).split("\n").some(line => line.includes("[ Cancel ]") && line.includes("[ Review ]")), "Buttons must share a row");
    } else if (scenario === "restricted-network") {
      for (let i = 0; i < 3; i++) await key("\t");
      await key("\u001b[C"); await key("\t"); await key("demo");
      await key("\t"); await key("example.com");
      await key("\t"); await key("\u001b[C"); await key("\r");
      assert(plain(frame).includes("Internet access: Restricted"), plain(frame));
      assert(plain(frame).includes("Extra domains: example.com"), plain(frame));
      await key("\u001b");
      assert(plain(frame).includes("[ demo ]"), plain(frame));
      assert(!plain(frame).includes("Working."), "Returning to the form must clear preparation progress");
    } else {
      assert(plain(frame).includes("Internet access"), plain(frame));
      assert(plain(frame).includes("Unrestricted"), plain(frame));
      assert(!plain(frame).includes("deployment slug"), "Hide restricted settings for unrestricted access");
      for (let i = 0; i < 3; i++) await key("\t");
      await key("\u001b[C");
      assert(plain(frame).includes("Allowed Convex deployment slug"), plain(frame));
      await key("\t"); await key("https://invalid-draft"); await key("\u001b[A");
      await key("\u001b[D");
      assert(!plain(frame).includes("deployment slug"), plain(frame));
      await key("\t"); await key("\u001b[C"); await key("\r");
      assert(plain(frame).includes("Internet access: Unrestricted"), plain(frame));
      // The review's first button returns to the form, so it is named Back, not Cancel.
      assert(plain(frame).includes("[ Back ]") && !plain(frame).includes("[ Cancel ]"), plain(frame));
      await key("\r"); assert(plain(frame).includes("Internet access"), plain(frame)); assert.equal(browser.getSnapshot().environment, "create");
    }
  } else if (scenario === "separation") {
    let prepared: EnvironmentForm | undefined;
    browser.prepareEnvironment = async form => { prepared = form; return { ...form, version: "0.104.0", install: true }; };
    await key("E"); await key("mine");
    assert(plain(frame).includes("Project separation"), plain(frame));
    assert(plain(frame).includes("(●) Shared  ( ) Isolated"), plain(frame));
    assert(plain(frame).includes("one account and home folder for every project"), plain(frame));
    await key("\t"); await key("\t"); await key("~/code, ~/work");
    for (let i = 0; i < 3; i++) await key("\t");
    await key("\r");
    assert.equal(prepared?.mode, "shared"); assert.deepEqual(prepared?.mounts, ["~/code", "~/work"]);
    assert(plain(frame).includes("Projects: shared account"), plain(frame));
    assert(plain(frame).includes("Mount folders: ~/code, ~/work"), plain(frame));
    await key("\u001b");
    for (let i = 0; i < 4; i++) await key("\u001b[A");
    await key("\u001b[C");
    assert(plain(frame).includes("( ) Shared  (●) Isolated"), plain(frame));
    assert(plain(frame).includes("a separate Linux account, sandbox and home per project"), plain(frame));
    assert(!plain(frame).includes("Mount folders"), "Isolated hides the mount field");
    for (let i = 0; i < 3; i++) await key("\t");
    await key("\r");
    assert.equal(prepared?.mode, "isolated"); assert.deepEqual(prepared?.mounts, []);
    assert(plain(frame).includes("Projects: isolated accounts"), plain(frame));
    assert(!plain(frame).includes("Mount folders"), plain(frame));
  } else if (scenario === "sidebar") {
    assert(plain(frame).includes("ENVIRONMENTS"), plain(frame));
    assert(sidebar().some(line => line.includes("+ Add environment")), plain(frame));
    await key("\u001b[A"); await key("\r");
    assert(plain(frame).includes("Environment name"), plain(frame));
    assert(sidebar().some(line => line.includes("Test target")), "Setup must retain the sidebar");
    assert(!plain(frame).includes("╭"), "Multi-field setup must not be a popup");
  } else if (scenario === "progress") {
    browser.prepareEnvironment = async form => ({ ...form, version: "0.103.2", install: true });
    browser.createEnvironment = async () => { await new Promise<void>(() => {}); };
    await key("E"); await key("new-env");
    for (let i = 0; i < 5; i++) await key("\t");
    await key("\r"); await key("\t"); await key("\r");
    assert(panel().includes("Target: new-env"), "Provisioning progress must name the new target: " + panel());
  } else if (scenario === "draft") {
    await key("E"); await key("keep-me"); await key("\u001b");
    assert(plain(frame).includes("Discard"), plain(frame));
    await key("\r");
    assert(plain(frame).includes("keep-me"), "Cancel discard preserves the draft");
  } else if (scenario === "stopped") {
    browser.getSnapshot().observations[0].environmentStatus = { state: "stopped", serviceRunning: false };
    await key("a"); await key("u");
    assert.equal(browser.getSnapshot().environment, undefined, "Do not offer update against a known stopped container");
    assert(plain(frame).includes("Start environment"), plain(frame));
  } else if (scenario === "scope") {
    await key("a");
    assert(!plain(frame).includes("Pause project"), plain(frame));
    assert(!plain(frame).includes("Cancel selected run"), plain(frame));
    assert(plain(frame).includes("Update CLI"), plain(frame));
    assert(!plain(frame).includes("lifecycle / update"), plain(frame));
    await key("u");
    assert(plain(frame).includes("Install @useconvoy/cli"), plain(frame));
    assert(!plain(frame).includes("╭"), "Update review belongs in the panel");
    assert.equal(executed, 0);
    await key("\u001b");
    assert.equal(browser.getSnapshot().environment, undefined);
    assert(plain(frame).includes("› [u] Update CLI"), "Cancel must restore focus to Update CLI");
  } else if (scenario === "local") {
    await key("a");
    assert(plain(frame).includes("not managed"), plain(frame));
    assert(!plain(frame).includes("Update CLI"), plain(frame));
    assert(!plain(frame).includes("Stop environment"), plain(frame));
  } else if (scenario === "error") {
    browser.start(); await settle(80);
    assert(panel().includes("offline"), panel());
    assert(panel().includes("Retry connection"), panel());
    // The connection banner is set off from the panel below it, and its hints only show where they work.
    const rows = panel().split("\n"), at = rows.findIndex(line => line.includes("Cannot attach"));
    assert(at > 0 && rows[at + 1].trim() === "", panel());
    browser.getSnapshot().observations[0].environmentError = "Service disconnected.";
    await key("c"); stdout.emit("resize"); await settle(80);
    assert(panel().includes("Service disconnected.") && !panel().includes("[s] Retry check"), panel());
    assert(!plain(frame).includes("0 observed active"), "An unobserved environment must not imply zero activity");
  } else if (scenario.startsWith("warning-layout")) {
    const warning = "Claude Code is not logged in for this project. Run project login a --runtime claude-code. Cursor is not logged in for this project. Run project login a --runtime cursor. OpenCode is not logged in for this project. Run project login a --runtime opencode.";
    browser.getSnapshot().observations[0].profiles = [
      { profile: "a", status: "online", attempts: 1, warning },
      { profile: "b", status: "failed", attempts: 1, warning: "Long failure. " + "More diagnostic text. ".repeat(12) + "RECOVERY_END" },
      { profile: "c", status: "blocked", attempts: 1, warning: "THIRD_PROJECT_RECOVERY" },
    ];
    if (scenario.endsWith("narrow")) { stdout.columns = 80; stdout.rows = 24; stdout.emit("resize"); await settle(80); }
    for (const view of (scenario.endsWith("narrow") ? ["environment"] : ["runs", "project-actions", "environment", "environment-actions", "credentials"])) {
      const project = view === "runs" || view === "project-actions";
      browser.select({ connection: 0, details: !project, ...(project ? { profile: "a" } : {}) });
      browser.showActions(view.endsWith("actions"));
      if (view === "credentials") browser.showCredentials(true);
      await settle(80);
      // One line: the first project's summary, then a count that never truncates.
      assert(panel().includes(scenario.endsWith("narrow") ? "! a: Needs sign-in: Claude" : "! a: Needs sign-in: Claude Code, Cursor, OpenCode"), panel());
      assert(panel().includes(project ? "OpenCode · [w] all notices" : "· +2 more · [w] all notices"), panel());
      assert(!panel().includes("Run project login"), panel());
      await key("w");
      assert(plain(frame).includes("Warning details"), plain(frame));
      let seen = panel();
      for (let i = 0; i < (scenario.endsWith("narrow") ? 8 : 4); i++) { await key("\u001b[6~"); seen += panel(); }
      seen = seen.replace(/\s/g, "");
      assert(seen.includes("--runtimeopencode"), seen);
      if (!project) { assert(seen.includes("RECOVERY_END"), seen); assert(seen.includes("THIRD_PROJECT_RECOVERY"), seen); }
      await key("\u001b");
      assert(!plain(frame).includes("Warning details"), plain(frame));
      assert.equal(browser.getSnapshot().scope.profile, project ? "a" : undefined);
    }
  } else if (scenario === "warnings") {
    browser.getSnapshot().observations[0].profiles = [
      { profile: "a", status: "failed", attempts: 4, warning: "codex is not installed for this project." },
      { profile: "b", status: "online", attempts: 1 },
    ];
    browser.select({ connection: 0, details: true }); await settle(80);
    assert(panel().includes("! a: codex is not installed for this project."), panel());
    assert(!panel().includes("b: online ·"), panel());
    for (const name of ["a", "b"]) {
      const line = sidebar().find(value => value.trim().startsWith(`${name} `))!;
      // Projects of an unconnected environment show a muted, hollow dot.
      assert.equal(line.indexOf("○"), 27, `Project ${name} shows its status dot one column inside the right edge: ${line}`);
    }
    browser.select({ connection: 0, profile: "a", details: false }); await settle(80);
    assert(panel().includes("! a: codex is not installed"), panel());
    browser.select({ connection: 0, profile: "b", details: false }); await settle(80);
    assert(!panel().includes("codex is not installed"), panel());
  } else if (scenario === "sidebar-views") {
    Object.assign(browser.getSnapshot().observations[0], { health: "connected", profiles: [
      { profile: "a", status: "online", attempts: 1, activeRuns: 2 }, { profile: "b", status: "online", attempts: 1, activeRuns: 0 }] });
    browser.select({ connection: 0, details: true }); await settle(80);
    const rows = sidebar().map(label).filter(Boolean);
    const spinner = /^[⠖⠲⢲⢰⣰⣠⣄⣆⡆⡖] a$/; // Lowered frames, in the column before the name.
    const children = rows.slice(rows.findIndex(line => line.startsWith("▾ Test target"))).slice(1, 6);
    const column = (text: string) => sidebar().find(line => label(line) === text)!.search(/\S/);
    assert.equal(column(children[3]), column("Actions") - 2, "The spinner sits two columns before the name");
    assert.equal(column("b"), column("Actions"));
    assert.deepEqual(children.map(line => line.replace(spinner, "a <spinner>")), ["Actions", "Credentials", "+ Add project", "a <spinner>", "b"], sidebar().join("\n"));
    const first = children[3]; await settle(80); await settle(80);
    assert.notEqual(sidebar().map(label).find(line => spinner.test(line)), first, "The busy spinner animates");
    assert(!plain(frame).includes("All projects") && !panel().includes("[d] Details") && !panel().includes("[c] Credentials"), plain(frame));
    await key("\u001b[B");
    assert.equal(browser.getSnapshot().actions, true); assert(panel().includes("Update CLI"), panel());
    await key("\u001b[B");
    assert.equal(browser.getSnapshot().credentials, "view"); assert(panel().includes("Runtime credentials are unavailable"), panel());
    await key("\u001b[B"); await key("\u001b[B");
    assert.equal(browser.getSnapshot().scope.profile, "a"); assert(!browser.getSnapshot().actions, "Project rows open Runs");
    await key("\u001b[A"); await key("\u001b[A"); await key("\u001b[A");
    assert.equal(browser.getSnapshot().actions, true);
    await key("\r"); await key("\u001b");
    assert.equal(browser.getSnapshot().actions, true, "Esc returns to the sidebar and keeps Actions");
    await key("\u001b[A");
    assert(browser.getSnapshot().scope.details && !browser.getSnapshot().actions && !browser.getSnapshot().credentials, "The environment row shows Details");
  } else if (scenario === "sidebar-arrows") {
    const header = () => sidebar().map(label).find(line => line.includes("Test target"));
    browser.select({ connection: 0, details: true }); await settle(80);
    assert(header()?.startsWith("▾"), sidebar().join("\n"));
    await key("\u001b[D");
    assert(header()?.startsWith("▸"), "Left collapses an expanded environment: " + sidebar().join("\n"));
    await key("\u001b[C");
    assert(header()?.startsWith("▾"), "Right expands a collapsed environment: " + sidebar().join("\n"));
    await key("\u001b[B");
    assert.equal(browser.getSnapshot().actions, true);
    await key("\u001b[D");
    assert(browser.getSnapshot().scope.details && !browser.getSnapshot().actions, "Left on a child selects its environment");
    assert(header()?.startsWith("▾"), "Moving to the parent does not collapse it");
  } else if (scenario === "sidebar-loading") {
    const rows = () => sidebar().map(label).filter(Boolean);
    const loading = /^[⠖⠲⢲⢰⣰⣠⣄⣆⡆⡖] Loading projects…$/;
    browser.getSnapshot().observations[0].health = "connecting";
    browser.select({ connection: 0, details: true }); await settle(80);
    assert.equal(rows()[rows().indexOf("+ Add project") + 1]?.replace(loading, "<loading>"), "<loading>", sidebar().join("\n"));
    await key("\u001b[B"); await key("\u001b[B"); await key("\u001b[B"); await key("\u001b[B");
    assert(browser.getSnapshot().scope.addProject, "The loading row is not selectable");
    browser.getSnapshot().observations[0].health = "reconnecting";
    browser.select({ connection: 0, details: true }); await settle(80);
    assert(!rows().some(line => loading.test(line)), "A failed attach shows no loading row");
    Object.assign(browser.getSnapshot().observations[0], { health: "connected", snapshot: { v: 1, id: "s", ok: true }, profiles: [{ profile: "a", status: "online", attempts: 1, activeRuns: 0 }] });
    browser.select({ connection: 0, details: true }); await settle(80);
    assert(!rows().some(line => loading.test(line)) && rows().includes("a"), sidebar().join("\n"));
  } else if (scenario === "mouse") {
    Object.assign(browser.getSnapshot().observations[0], { health: "connected", profiles: [
      { profile: "a", status: "online", attempts: 1, activeRuns: 0 }, { profile: "b", status: "online", attempts: 1, activeRuns: 0 }] });
    browser.select({ connection: 0, details: true }); await settle(80);
    assert(output.includes("\u001b[?1002h\u001b[?1006h"), "Mouse tracking turns on with the TUI");
    // SGR cells are 1-based; the sidebar starts on the frame's third line.
    const at = (x: number, y: number, code = 0) => key(`\u001b[<${code};${x + 1};${y + 1}M\u001b[<${code};${x + 1};${y + 1}m`);
    const row = (match: (line: string) => boolean) => { const y = sidebar().findIndex(line => match(label(line))); assert(y >= 0, sidebar().join("\n")); return y + 2; };
    await at(5, row(line => line === "b"));
    assert.equal(browser.getSnapshot().scope.profile, "b");
    assert(!plain(frame).includes("[<"), "Mouse reports never reach key handlers");
    const actionsTab = frame.split("\n").findIndex(line => plain(line).includes("[a] Actions"));
    await at(plain(frame.split("\n")[actionsTab]).indexOf("[a] Actions") + 1, actionsTab);
    assert.equal(browser.getSnapshot().actions, true, "Clicking the Actions tab opens it");
    await at(5, row(line => line === "Credentials"));
    assert.equal(browser.getSnapshot().credentials, "view");
    await at(5, row(line => line.startsWith("▾ Test target")));
    assert(browser.getSnapshot().scope.details && !browser.getSnapshot().credentials, "Clicking the environment row selects it");
    assert(!sidebar().some(line => label(line) === "Credentials"), "Clicking the environment row collapses it: " + sidebar().join("\n"));
    stdout.rows = 12; stdout.emit("resize"); await settle(80); // Fewer rows than detail lines.
    const firstDetail = () => { const lines = panel().split("\n"); return lines[lines.findIndex(line => line.includes("[s] Inspect status")) + 2]; };
    const wheel = (code: number, times = 1) => key(`\u001b[<${code};51;7M`.repeat(times));
    const before = firstDetail();
    await wheel(65);
    assert.notEqual(firstDetail(), before, "The wheel scrolls the detail lines");
    await wheel(64);
    assert.equal(firstDetail(), before, "The wheel scrolls back up");
    // Reports that share a chunk all count, so one tick up from two down is not the top.
    await wheel(65, 2); await wheel(64);
    assert.notEqual(firstDetail(), before, "A burst of wheel reports scrolls every tick");
    await wheel(64, 3);
    assert(plain(frame).includes("[m] select text"), plain(frame));
    await key("m");
    assert(output.endsWith("\u001b[?1002l\u001b[?1006l"), "m turns mouse tracking off");
    assert(plain(frame).includes("[m] mouse"), plain(frame));
    await key("m");
    assert(output.includes("\u001b[?1002h\u001b[?1006h", output.lastIndexOf("\u001b[?1002l")), "m turns it back on");
    browser.getSnapshot().observations[0].profiles = ["a", "b", "c"].map(profile => ({ profile, status: "failed" as const, attempts: 4, warning: `${profile} is broken.` }));
    stdout.rows = 20; stdout.emit("resize"); browser.select({ connection: 0, details: true }); await settle(80); await key("w");
    const warningList = panel();
    await wheel(65, 2); await wheel(64);
    assert(panel().includes(" · failed") && panel() !== warningList, "The wheel scrolls the warnings list by every tick: " + panel());
    assert(plain(frame).includes("[m] select text"), "The warnings footer shows the mouse toggle: " + plain(frame));
    output = ""; await key("m");
    assert(output.includes("\u001b[?1002l\u001b[?1006l"), "m turns tracking off in the warnings list, to copy its text");
    await key("m"); await key("\u001b");
    const page = Array.from({ length: 10 }, (_, order) => ({ order, eventJson: `{"event":"LOG_${order}"}`, bytes: 20, length: 20, truncated: false, fidelity: "stored" }));
    browser.readLogs = async () => ({ v: 1, id: "raw", ok: true, result: { raw: true, run: { status: "completed" }, page, cursor: 9, latest: 9, hasMore: false } });
    output = "";
    browser.logs({ profile: "a", thread: { id: "t", title: "Thread" }, run: { messageId: "m1", runId: "r1", status: "completed" } } as unknown as Parameters<typeof browser.logs>[0]); await settle(80);
    assert(!output.includes("\u001b[?1002l"), "The log view keeps tracking on for the wheel");
    const lastLog = () => Math.max(...[...plain(frame).matchAll(/LOG_(\d+)/g)].map(match => Number(match[1])));
    assert.equal(lastLog(), 9, "The log view follows the end: " + plain(frame));
    await wheel(64, 2); await wheel(65);
    assert.equal(lastLog(), 8, "The wheel scrolls the log by every tick: " + plain(frame));
    assert(plain(frame).includes("Paused"), "Scrolling pauses following");
    assert(plain(frame).includes("[m] select text"), plain(frame));
    output = ""; await key("m");
    assert(output.includes("\u001b[?1002l\u001b[?1006l") && plain(frame).includes("[m] mouse"), "m turns tracking off in the log view: " + plain(frame));
    await key("m"); output = ""; await key("e"); await key("m");
    assert(!output.includes("\u001b[?1002l") && plain(frame).includes(".jsonlm"), "The export path takes m as text: " + plain(frame));
    await key("\u001b"); browser.logs(); await settle(80);
  } else if (scenario === "mouse-buttons") {
    // Fewer rows lift the confirmation's buttons over the Actions menu's [z] Stop environment row.
    stdout.rows = 22; stdout.emit("resize"); await settle(80);
    const lines = () => stripVTControlCharacters(frame).split("\n");
    const click = async (text: string, line?: number) => {
      const y = line ?? lines().findIndex(value => value.includes(text));
      assert(y >= 0, `${text} is on screen:\n${lines().join("\n")}`);
      const x = lines()[y].indexOf(text) + 1;
      await key(`\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`);
      return y;
    };
    await key("a");
    const menu = lines();
    await click("[b] Start shared service");
    assert.equal(browser.getSnapshot().action?.kind, "start", "Clicking a menu row runs its control");
    assert(browser.getSnapshot().action?.pending, "Start waits for confirmation");
    const y = lines().findIndex(line => line.includes("[ Start shared service ]"));
    assert(menu[y]?.includes("[z] Stop environment"), "The confirm button covers a menu row:\n" + lines().join("\n"));
    await click("[ Start shared service ]", y); await settle(80);
    assert.equal(started, 1, "Clicking the dialog button confirms");
    assert.equal(browser.getSnapshot().environment, undefined, "The menu row under the dialog ignores the click");
    await click("[ Back ]");
    assert.equal(browser.getSnapshot().action, undefined, "Back on the result closes it");
    await key("\u001b");
    browser.getSnapshot().observations[0].profiles = [{ profile: "a", status: "online", attempts: 1, activeRuns: 0 }];
    browser.select({ connection: 0, profile: "a", details: false }); await settle(80); await click("[r] Runs");
    const thread = (threadId: string, title: string) => ({ profile: "a", thread: { threadId, title, lastActivityAt: 1 } });
    (browser as unknown as { set(patch: object): void }).set({ rows: [thread("t1", "First thread"), thread("t2", "Second thread")] }); await settle(80);
    await click("Second thread");
    assert.equal(browser.getSnapshot().history, undefined, "The first click on a run row only selects it");
    assert(lines().some(line => line.includes("› Second thread")), "The clicked row is selected:\n" + lines().join("\n"));
    await click("Second thread");
    assert.equal(browser.getSnapshot().history?.thread.threadId, "t2", "Clicking the selected row opens its history");
    const run = { threadId: "t2", messageId: "m1", runId: "r1", status: "streaming", createdAt: 1, updatedAt: 1 };
    (browser as unknown as { set(patch: object): void }).set({ rows: [{ ...thread("t2", "Second thread"), run }] }); await settle(80);
    await click("[c] Cancel selected run");
    assert.equal(browser.getSnapshot().action?.kind, "cancel", "Clicking [c] starts cancel, as the key does");
    await key("\u001b"); await key("\u001b");
    browser.getSnapshot().observations[0].profiles = [{ profile: "a", status: "failed", attempts: 4, warning: "a is broken." }];
    browser.select({ connection: 0, details: true }); await settle(80);
    await click("[w] all notices");
    assert(lines().some(line => line.includes("Warning details")), "Clicking [w] all notices opens the warnings:\n" + lines().join("\n"));
    await key("\u001b");
    let inspected = 0;
    browser.inspectEnvironment = async () => { inspected++; };
    browser.getSnapshot().observations[0].environmentError = "Service disconnected.";
    stdout.emit("resize"); await settle(80);
    await click("[s] Retry check");
    assert.equal(inspected, 1, "Clicking the [s] Retry check line inspects the environment");
    browser.getSnapshot().observations[0].environmentError = undefined;
    // The form needs 17 panel rows.
    stdout.rows = 24; stdout.emit("resize"); await settle(80);
    await key("E"); await click("[ Review ]");
    assert(lines().some(line => line.includes("Use a lowercase environment name")), "Clicking Review validates the form:\n" + lines().join("\n"));
    await click("[ Cancel ]");
    assert.equal(browser.getSnapshot().environment, undefined, "Clicking Cancel closes an empty form");
    await key("E"); await click("[ Review ]"); await click("Environment name"); await key("dev");
    await click("Internet access"); await click("Environment name"); await key("1");
    assert(lines().some(line => line.includes("> [ dev1  ]")), "A click focuses the field and keeps its text:\n" + lines().join("\n"));
    await click("( ) Isolated");
    assert(lines().some(line => line.includes("> ( ) Shared  (●) Isolated")) && !lines().some(line => line.includes("Mount folders")), "Clicking a radio option focuses and picks it:\n" + lines().join("\n"));
    await click("[ Cancel ]"); await click("[ Discard ]");
    assert.equal(browser.getSnapshot().environment, undefined, "Cancel and Discard close a filled form");
    // A sidebar click leaves an open form: a filled one asks first, an empty one goes straight there.
    const sidebarRow = (text: string) => lines().findIndex(line => label(line.slice(0, sidebarWidth())) === text);
    await key("E"); await key("dev"); await click("Actions", sidebarRow("Actions"));
    assert(lines().some(line => line.includes("Discard environment draft?")), lines().join("\n"));
    await click("[ Discard ]");
    assert.equal(browser.getSnapshot().environment, undefined); assert.equal(browser.getSnapshot().actions, true, lines().join("\n"));
    await key("E"); await click("Credentials", sidebarRow("Credentials"));
    assert.equal(browser.getSnapshot().environment, undefined); assert.equal(browser.getSnapshot().credentials, "view", lines().join("\n"));
    await key("+"); assert.equal(browser.getSnapshot().onboarding, true);
    await click("Actions", sidebarRow("Actions"));
    assert.equal(browser.getSnapshot().onboarding, false); assert.equal(browser.getSnapshot().actions, true, lines().join("\n"));
  } else if (scenario === "project") {
    browser.select({ connection: 0, profile: "one", details: false }); await settle(80); await key("a");
    assert(plain(frame).includes("Pause project"), plain(frame));
    assert(!plain(frame).includes("Stop shared service"), plain(frame));
    assert(!plain(frame).includes("Update CLI"), plain(frame));
  }
  if (process.env.TUI_CAPTURE) writeFileSync(process.env.TUI_CAPTURE, stripVTControlCharacters(frame));
  console.log("Navigation checks passed: " + scenario);
} finally { instance.unmount(); browser.dispose(); stdin.destroy(); stdout.destroy(); }
