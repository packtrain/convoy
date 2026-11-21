import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { serviceServer } from "../../service/server.js";
import { ServiceClient } from "../../service/client.js";
import type { ServiceRequest, WorkerState } from "../../service/validators.js";
import { Browser } from "../workflow.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function fixture(shell = vi.fn(async () => {})) {
  const directory = mkdtempSync(join(tmpdir(), "cv-project-actions-"));
  const socket = join(directory, "s");
  const projects: WorkerState[] = ["a", "b"].map(profile => ({ profile, identity: profile, status: "online", attempts: 1, activeRuns: 1 }));
  const requests: ServiceRequest[] = [];
  const hooks: { beforeStatus?: () => Promise<void>; afterPause?: () => void } = {};
  const snapshot = () => ({ pid: 1, stopping: false, profiles: projects });
  const control = serviceServer(snapshot, async request => {
    requests.push(request);
    if (request.op === "status") { await hooks.beforeStatus?.(); return snapshot(); }
    if (request.op === "inspect") return { result: { nodeVersion: "v22", profiles: [] } };
    if (request.op === "reconcile") {
      const project = projects.find(p => p.profile === request.profile)!;
      project.paused = Boolean(request.pause); project.status = request.pause ? "stopped" : "online";
      if (request.pause) hooks.afterPause?.();
      control.publish({ phase: "released" }, request.profile);
      return { applied: true };
    }
    if (request.op === "project.remove") {
      projects.splice(projects.findIndex(p => p.profile === request.profile), 1);
      control.publish({ phase: "released" }, request.profile);
      return { registered: false, applied: true };
    }
    return { result: { page: [{ threadId: "thread", title: "test", lastActivityAt: 1 }], isDone: true, continueCursor: "" } };
  }, () => {});
  await new Promise<void>(resolve => control.server.listen(socket, resolve));
  cleanups.push(async () => { control.dispose(); await new Promise<void>(resolve => control.server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  const connection = { id: "fixture", name: "Fixture", endpoint: socket, transport: "unix", shell, open: (signal: AbortSignal) => ServiceClient.open(socket, signal) };
  const handoff = vi.fn(async (operation: (signal: AbortSignal) => Promise<void>) => operation(new AbortController().signal));
  const browser = new Browser([connection], 0, handoff);
  cleanups.push(() => browser.dispose()); browser.start();
  await vi.waitFor(() => expect(browser.getSnapshot().observations[0].health).toBe("connected"));
  browser.select({ connection: 0, details: false, profile: "a" });
  await vi.waitFor(() => expect(browser.getSnapshot().rows).toHaveLength(1));
  browser.showActions(true);
  return { browser, projects, requests, control, shell, handoff, connection, hooks };
}
async function settle(browser: Browser) { await vi.waitFor(() => expect(browser.getSnapshot().action?.busy).toBe(false)); }

it("confirms targeted pause, shell and reload while leaving another project unchanged", async () => {
  const f = await fixture(); const b = f.browser;
  expect(b.unavailable("shell")).toBeUndefined();
  b.beginAction("pause");
  b.select({ connection: 0, details: false, profile: "b" }); b.showActions(false);
  expect(b.getSnapshot().scope.profile).toBe("a"); expect(b.getSnapshot().actions).toBe(true);
  b.dismissAction(); expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
  b.beginAction("pause"); b.confirmAction(); await settle(b);
  expect(f.requests.find(r => r.op === "reconcile")).toMatchObject({ profile: "a", pause: true, interrupt: true });
  b.beginAction("shell"); expect(f.shell).not.toHaveBeenCalled(); b.confirmAction(); await settle(b);
  expect(f.handoff).toHaveBeenCalledTimes(1); expect(f.shell).toHaveBeenCalledWith("a", "a", expect.any(AbortSignal), undefined);
  expect(b.getSnapshot().action?.message).toContain("Reload project");
  b.beginAction("reload"); b.confirmAction(); await settle(b);
  expect(f.projects[0].paused).toBe(false); expect(f.projects[1]).toMatchObject({ profile: "b", status: "online", activeRuns: 1 });
});

it("offers pause and shell together, cancels without work, then verifies pause before launch", async () => {
  const f = await fixture();
  f.browser.beginAction("shell");
  expect(f.browser.getSnapshot().action).toMatchObject({ pending: true, pauseBeforeShell: true });
  f.browser.dismissAction();
  expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
  expect(f.shell).not.toHaveBeenCalled();
  f.requests.length = 0;
  f.browser.beginAction("shell"); f.browser.confirmAction(); await settle(f.browser);
  expect(f.requests.map(r => r.op)).toEqual(["status", "reconcile", "status", "status"]);
  expect(f.shell).toHaveBeenCalledWith("a", "a", expect.any(AbortSignal), undefined);
  expect(f.projects[1].paused).toBeUndefined();
});

it("pauses, runs only the runtime login, then reloads and reports the project online", async () => {
  const f = await fixture();
  f.browser.beginAction("login-codex");
  expect(f.browser.getSnapshot().action).toMatchObject({ pending: true, pauseBeforeShell: true });
  f.browser.confirmAction(); await settle(f.browser);
  expect(f.shell).toHaveBeenCalledWith("a", "a", expect.any(AbortSignal), "codex");
  expect(f.requests.filter(r => r.op === "reconcile")).toMatchObject([{ profile: "a", pause: true, interrupt: true }, { profile: "a", interrupt: true }]);
  expect(f.projects[0].paused).toBe(false);
  expect(f.browser.getSnapshot().action?.message).toBe("Logged in to Codex. a is online.");
});

it("keeps polling a login reload through a runtime notice", async () => {
  const f = await fixture();
  let polls = 0;
  f.hooks.beforeStatus = async () => {
    if (!f.requests.some(r => r.op === "reconcile" && !r.pause)) return;
    Object.assign(f.projects[0], polls++ ? { status: "online" } : { status: "connecting", warning: "Claude Code is not logged in for this project." });
  };
  f.browser.beginAction("login-codex"); f.browser.confirmAction();
  await vi.waitFor(() => expect(f.browser.getSnapshot().action?.busy).toBe(false), { timeout: 3000 });
  expect(f.browser.getSnapshot().action?.message).toBe("Logged in to Codex. a is online.");
});

it("logs in on a shared target without pausing or reloading, then offers Reload (OS-2248)", async () => {
  const f = await fixture();
  Object.assign(f.connection, { mode: "shared" });
  f.requests.length = 0;
  f.browser.beginAction("login-codex"); await settle(f.browser);
  expect(f.shell).toHaveBeenCalledWith("a", "a", expect.any(AbortSignal), "codex");
  expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
  expect(f.projects[0]).toMatchObject({ status: "online", activeRuns: 1 });
  expect(f.browser.getSnapshot().action?.message).toBe("Logged in to Codex. The login applies to every project in this environment. Running agents were not restarted; if this project does not pick it up, use [u] Reload project.");
});

it("logs in to Antigravity on a shared target with agy's own sign-in (OS-2474)", async () => {
  const f = await fixture();
  Object.assign(f.connection, { mode: "shared" });
  f.browser.beginAction("login-antigravity"); await settle(f.browser);
  expect(f.shell).toHaveBeenCalledWith("a", "a", expect.any(AbortSignal), "antigravity");
  expect(f.browser.getSnapshot().action?.message).toMatch(/^Logged in to Antigravity\. The login applies to every project/);
});

it("offers the Antigravity login on isolated targets that detected agy (OS-2475)", async () => {
  const f = await fixture();
  f.projects[0].runtimes = ["codex"];
  f.browser.beginAction("status"); await settle(f.browser);
  expect(f.browser.unavailable("login-antigravity")).toBe("Antigravity was not detected on this target when a last started. Install it root-owned, for example under /usr/local/bin, then [u] Reload project.");
  f.projects[0].runtimes = ["codex", "antigravity"];
  f.browser.beginAction("status"); await settle(f.browser);
  expect(f.browser.unavailable("login-antigravity")).toBeUndefined();
});

it("opens a shared project's shell without pausing it (OS-2248)", async () => {
  const f = await fixture();
  Object.assign(f.connection, { mode: "shared" });
  f.browser.beginAction("shell"); await settle(f.browser);
  expect(f.shell).toHaveBeenCalledWith("a", "a", expect.any(AbortSignal), undefined);
  expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
  expect(f.browser.getSnapshot().action?.message).toBe("Shell exited. Logins made there apply to every project in this environment.");
});

it("checks the selected project on its target without a confirmation or service request", async () => {
  const f = await fixture();
  expect(f.browser.unavailable("check")).toMatch(/^Project check needs/);
  const check = vi.fn(async (profile: string) => ({ profile, checks: [
    { id: "sandbox", status: "pass" as const, label: "Sandbox boundary" },
    { id: "codex-login", status: "fail" as const, label: "Codex logged in", fix: "Run project login a --runtime codex." }] }));
  Object.assign(f.connection, { check });
  f.requests.length = 0;
  f.browser.beginAction("check"); await settle(f.browser);
  expect(check).toHaveBeenCalledWith("a");
  expect(f.requests).toEqual([]);
  expect(f.browser.getSnapshot().action?.message).toBe("Project a\n✓ Sandbox boundary\n✗ Codex logged in. Run project login a --runtime codex.");
});

it("offers only the logins of runtimes the worker reported", async () => {
  const f = await fixture();
  f.projects[0].runtimes = ["codex"];
  f.browser.beginAction("status"); await settle(f.browser);
  expect(f.browser.unavailable("login-claude-code")).toMatch(/^Claude Code was not detected on this target/);
  expect(f.browser.unavailable("login-codex")).toBeUndefined();
});

it.each(["resumed", "replaced", "rejected"])("does not enter shell when pause is %s", async outcome => {
  const f = await fixture();
  f.hooks.afterPause = () => {
    if (outcome === "resumed") f.projects[0].paused = false;
    if (outcome === "replaced") f.projects[0].identity = "replacement";
    if (outcome === "rejected") throw new Error("Pause rejected");
  };
  f.browser.beginAction("shell");
  expect(f.browser.getSnapshot().action?.pending).toBe(true);
  f.browser.confirmAction(); await settle(f.browser);
  expect(f.requests.some(r => r.op === "reconcile")).toBe(true);
  expect(f.shell).not.toHaveBeenCalled();
  expect(f.browser.getSnapshot().action?.message).toMatch(/paused|registration changed|Service operation failed/);
});

it("does not open a shell or retry when the pause reply is lost", async () => {
  const f = await fixture();
  f.hooks.afterPause = () => f.control.dispose();
  f.browser.beginAction("shell"); f.browser.confirmAction(); await settle(f.browser);
  expect(f.browser.getSnapshot().action?.message).toContain("Outcome unknown");
  expect(f.requests.filter(r => r.op === "reconcile")).toHaveLength(1);
  expect(f.shell).not.toHaveBeenCalled();
});

it("requires new pause consent when an already-paused project resumes", async () => {
  const f = await fixture();
  f.browser.beginAction("pause"); f.browser.confirmAction(); await settle(f.browser);
  f.requests.length = 0;
  f.browser.beginAction("shell");
  expect(f.browser.getSnapshot().action?.pauseBeforeShell).toBe(false);
  f.projects[0].paused = false;
  f.browser.confirmAction(); await settle(f.browser);
  expect(f.browser.getSnapshot().action?.message).toContain("Confirm pause");
  expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
  expect(f.shell).not.toHaveBeenCalled();
});

it("invalidates removed-target history and sidebar only after explicit confirmation", async () => {
  const f = await fixture(); const b = f.browser;
  b.beginAction("remove"); b.dismissAction(); expect(f.projects).toHaveLength(2);
  b.beginAction("remove"); b.confirmAction(); await settle(b);
  expect(b.getSnapshot().observations[0].profiles.map(p => p.profile)).toEqual(["b"]);
  expect(b.getSnapshot()).toMatchObject({ scope: { connection: 0, details: true }, rows: [], actions: true });
  expect(b.getSnapshot().scope.profile).toBeUndefined(); expect(b.getSnapshot().history).toBeUndefined();
  expect(b.getSnapshot().action?.message).toContain("Private files retained");
});

it("rejects a concurrently replaced registration before sending a mutation", async () => {
  const f = await fixture(); f.browser.beginAction("remove"); f.projects[0].identity = "replacement";
  f.browser.confirmAction(); await settle(f.browser);
  expect(f.browser.getSnapshot().action?.message).toContain("registration changed");
  expect(f.requests.some(r => r.op === "project.remove")).toBe(false);
});

it("rejects project confirmations across a service reconnect", async () => {
  const f = await fixture(); f.browser.beginAction("pause"); f.control.dispose();
  await vi.waitFor(() => expect(f.browser.getSnapshot().observations[0].health).toBe("reconnecting"));
  f.browser.retryNow(); await vi.waitFor(() => expect(f.browser.getSnapshot().observations[0].health).toBe("connected"));
  f.browser.confirmAction();
  expect(f.browser.getSnapshot().action?.message).toContain("Service changed");
  expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
});

it("keeps context and reload guidance after a failed shell", async () => {
  const f = await fixture(vi.fn(async () => { throw new Error("Project shell exited with status 7."); }));
  f.browser.beginAction("pause"); f.browser.confirmAction(); await settle(f.browser);
  f.browser.beginAction("shell"); f.browser.confirmAction(); await settle(f.browser);
  expect(f.browser.getSnapshot()).toMatchObject({ scope: { profile: "a" }, actions: true });
  expect(f.browser.getSnapshot().action?.message).toContain("status 7");
  expect(f.browser.getSnapshot().action?.message).toContain("Reload project");
});

it("does not mutate after detach while checking project status", async () => {
  const f = await fixture();
  let release!: () => void;
  f.hooks.beforeStatus = () => new Promise(resolve => { release = resolve; });
  f.browser.beginAction("pause"); f.browser.confirmAction();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  f.browser.dispose(); release();
  await vi.waitFor(() => expect(f.browser.getSnapshot().action).toBeUndefined());
  expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
});

it("reports a failed preflight as no action sent", async () => {
  const f = await fixture();
  f.hooks.beforeStatus = async () => { f.control.dispose(); };
  f.browser.beginAction("pause"); f.browser.confirmAction(); await settle(f.browser);
  expect(f.browser.getSnapshot().action?.message).toContain("No project action was sent");
  expect(f.browser.getSnapshot().action?.message).not.toMatch(/outcome.*unknown/i);
  expect(f.requests.some(r => r.op === "reconcile")).toBe(false);
});

it.each([false, true])("keeps shell outcome known and refreshes the current client after reconnect, failed=%s", async failed => {
  let finish!: () => void;
  const f = await fixture(vi.fn(() => new Promise<void>((resolve, reject) => { finish = () => failed ? reject(new Error("Project shell exited with status 7.")) : resolve(); })));
  f.browser.beginAction("pause"); f.browser.confirmAction(); await settle(f.browser);
  f.browser.beginAction("shell"); f.browser.confirmAction();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  f.control.dispose();
  await vi.waitFor(() => expect(f.browser.getSnapshot().observations[0].health).toBe("reconnecting"));
  f.browser.retryNow();
  await vi.waitFor(() => expect(f.browser.getSnapshot().observations[0].health).toBe("connected"));
  finish(); await settle(f.browser);
  const message = f.browser.getSnapshot().action?.message;
  expect(message).not.toContain("Outcome unknown");
  expect(message).not.toContain("Status refresh failed");
  expect(message).toContain(failed ? "Terminal restored" : "Shell exited");
});

it("targets newly registered project login without leaving onboarding", async () => {
  const f = await fixture();
  f.browser.openOnboarding();
  f.projects[1].runtimes = ["codex", "claude-code"];
  expect(await f.browser.prepareOnboardingAccess("b")).toMatchObject({ profile: "b", runtimes: ["codex", "claude-code"] });
  expect(f.browser.getSnapshot().onboarding).toBe(true);
  f.browser.beginAction("login-codex");
  f.browser.confirmAction(); await settle(f.browser);
  expect(f.shell).toHaveBeenCalledWith("b", "b", expect.any(AbortSignal), "codex");
  expect(f.browser.getSnapshot().onboarding).toBe(true);
  expect(f.projects[0].paused).toBeUndefined();
});
