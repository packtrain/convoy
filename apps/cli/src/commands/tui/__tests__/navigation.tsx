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
let frame = "", executed = 0;
stdout.on("data", chunk => { if (plain(chunk.toString()).trim()) frame = chunk.toString(); });
const browser = new Browser([...(scenario === "delete-success" ? [{ id: "local", name: "Local", transport: "unix", endpoint: "local", open: async () => { throw new Error("offline"); } }] : []), { id: "test", name: "Test target", transport: "docker", endpoint: "test-container", open: async () => { throw new Error("offline"); },
  ...(scenario === "local" ? {} : { maintenance: { status: async () => ({}), release: async () => ({ installed: "0.100.0", proposed: "0.103.1" }), execute: async () => { executed++; return scenario === "delete-success" ? { deleted: true } : {}; } } }),
}], scenario === "delete-success" ? 1 : 0);
const instance = render(<App browser={browser} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false });
async function key(value: string) { stdin.write(value); await settle(80); }
// Body rows below the two-row header, split into the 30-column sidebar and the panel.
const sidebar = () => frame.split("\n").slice(2).map(line => plain(line).slice(0, 30));
// Row text without the project status dot.
const label = (line: string) => line.replace(/\s*●\s*$/, "").trim();
const panel = () => frame.split("\n").slice(2).map(line => plain(line).slice(30)).join("\n");
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
    assert(plain(frame).includes("> [u] Update CLI"), "Cancel must restore focus to Update CLI");
  } else if (scenario === "local") {
    await key("a");
    assert(plain(frame).includes("not managed"), plain(frame));
    assert(!plain(frame).includes("Update CLI"), plain(frame));
    assert(!plain(frame).includes("Stop environment"), plain(frame));
  } else if (scenario === "error") {
    browser.start(); await settle(80);
    assert(panel().includes("offline"), panel());
    assert(panel().includes("Retry connection"), panel());
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
      assert(panel().includes("Project notices"), panel());
      assert(panel().includes("Needs sign-in: Claude Code, Cursor, OpenCode"), panel());
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
    assert(panel().includes("a · failed") && panel().includes("codex is not installed for this project."), panel());
    assert(!panel().includes("b: online ·"), panel());
    for (const name of ["a", "b"]) {
      const line = sidebar().find(value => value.trim().startsWith(`${name} `))!;
      assert.equal(line.indexOf("●"), 27, `Project ${name} shows its status dot one column inside the right edge: ${line}`);
      assert(!line.includes("!"), line);
    }
    browser.select({ connection: 0, profile: "a", details: false }); await settle(80);
    assert(panel().includes("a · failed") && panel().includes("codex is not installed"), panel());
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
    const header = () => sidebar().map(line => line.trim()).find(line => line.includes("Test target"));
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
  } else if (scenario === "project") {
    browser.select({ connection: 0, profile: "one", details: false }); await settle(80); await key("a");
    assert(plain(frame).includes("Pause project"), plain(frame));
    assert(!plain(frame).includes("Stop shared service"), plain(frame));
    assert(!plain(frame).includes("Update CLI"), plain(frame));
  }
  if (process.env.TUI_CAPTURE) writeFileSync(process.env.TUI_CAPTURE, stripVTControlCharacters(frame));
  console.log("Navigation checks passed: " + scenario);
} finally { instance.unmount(); browser.dispose(); stdin.destroy(); stdout.destroy(); }
