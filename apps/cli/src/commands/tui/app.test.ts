import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { loaded } from "../../__tests__/loaded-machine.mjs";

// Drivers get one limit, and the test's sits above it, so a slow driver fails with its own output (OS-2278).
const DRIVER_MS = 60000;
vi.setConfig({ testTimeout: DRIVER_MS + 5000 });
const fixture = (name: string) => fileURLToPath(new URL(`./__tests__/${name}`, import.meta.url));
const tsx = (driver: string, args: string[] = [], env: Record<string, string> = {}) =>
  promisify(execFile)(process.execPath, ["--import", "tsx", fixture(driver), ...args], { timeout: DRIVER_MS, env: { ...process.env, ...env } });
const python = (script: string, args: string[] = [], env: Record<string, string> = {}) =>
  promisify(execFile)("python3", [fixture(script), ...args], { timeout: DRIVER_MS, cwd: tmpdir(), env: { ...process.env, ...env } });

it("renders and handles keys, resize and terminal restoration in the Node renderer", async () => {
  const result = await tsx("app.ts", [], { FORCE_COLOR: "1" });
  expect(result.stdout).toContain("Terminal keyboard, resize and detach checks passed");
});

it("renders the design palette and fills in truecolor terminals", async () => {
  const result = await tsx("app.ts", [], { FORCE_COLOR: "3", COLORTERM: "truecolor" });
  expect(result.stdout).toContain("Terminal keyboard, resize and detach checks passed");
});

it.each(["resize", "small-detach", "paste", "destination", "export-resize", "overwrite", "confirm-resize", "spacing"])("detail handles %s", async scenario => {
  const result = await tsx("app.ts", [scenario], { FORCE_COLOR: "1" });
  expect(result.stdout).toContain("Terminal keyboard, resize and detach checks passed");
});

it("handles contextual actions with a real socket and two independent clients", async () => {
  const result = await tsx("actions.tsx", [], { FORCE_COLOR: "1" });
  expect(result.stdout).toContain("Action confirmation, two-client state, saved logs, restart, resize and detach checks passed");
});

it.each(["menu", "busy", "duplicate", "outcome", "small", "success", "rejection"])("renders review regression %s", async scenario => {
  const result = await tsx("action-review.tsx", [scenario]);
  expect(result.stdout).toContain("Review renderer checks passed");
});

it.skipIf(process.platform !== "linux").each(["normal", "pause-shell", "nonzero", "launch-failure", "SIGTERM", "SIGHUP", "pending-SIGTERM", "pending-SIGHUP"])("hands the real PTY to a project shell: %s", async scenario => {
  const result = await python("projects.py", [scenario]);
  expect(result.stdout).toContain(`PTY project checks passed: ${scenario}`);
});

it.each(["normal", "cancel", "small", "link", "access", "remount", "mouse"])("guided onboarding renderer: %s", async scenario => {
  const result = await tsx("onboarding.tsx", [scenario]);
  expect(result.stdout.match(/Onboarding renderer checks passed/g)).toHaveLength(1);
});

it.each(["shared", "missing", "install", "failed"])("Add project's first-setup mode choice: %s", async scenario => {
  const result = await tsx("onboarding-mode.tsx", [scenario]);
  expect(result.stdout).toContain(`Onboarding mode checks passed: ${scenario}`);
});

it.skipIf(process.platform !== "linux")("records guided onboarding in a real PTY", async () => {
  const result = await python("onboarding-terminal.py");
  expect(result.stdout).toContain("PTY onboarding passed");
  expect(result.stdout).toMatch(/PTY recording: \/tmp\/convoy-onboarding-[^\s]+\.log/);
});

it.each(["sidebar-names", "target-incompatible", "creation-form", "form-visibility", "form-paging", "repository-form", "button-arrows", "project-order", "workspace-dropdown", "deployments", "popup", "input-enter", "entry-row", "entry-row-space", "entry-plus", "clone", "discovery-cancel", "discovery-unmount", "defaults", "defaults-billing", "overrides", "narrow", "recovery", "uncertain", "link-back", "pending", "ctrl-c", "safe-preflight"])("onboarding review regression: %s", async scenario => {
  const result = await tsx("onboarding-review.tsx", [scenario]);
  expect(result.stdout).toContain("Onboarding review checks passed: " + scenario);
});

it.each(["update", "cancel", "narrow", "failure", "unpublished", "transport", "create", "create-local", "retained", "probe-retry", "probe-start", "diagnostics", "installed"])("environment renderer: %s", async scenario => {
  const result = await tsx("environments.tsx", [scenario]);
  expect(result.stdout).toContain("Environment renderer checks passed: " + scenario);
});

it.skipIf(process.platform !== "linux").each(["normal", "detach"])("records environment maintenance in a real PTY: %s", async scenario => {
  const result = await python("environments-terminal.py", [scenario]);
  expect(result.stdout).toContain("PTY environments passed");
});

it.each(["sidebar", "scope", "local", "error", "project", "draft", "stopped", "progress", "network", "restricted-network", "separation", "buttons", "stop-result", "delete-confirm", "delete-success", "warnings", "warning-layout", "warning-layout-narrow", "sidebar-views", "sidebar-arrows", "sidebar-loading", "mouse", "mouse-buttons"])("TUI navigation guidelines: %s", async scenario => {
  const result = await tsx("navigation.tsx", [scenario]);
  expect(result.stdout).toContain("Navigation checks passed: " + scenario);
});

it.each(["unsupported", "shared", "shared-stale", "status-error", "assign", "leave", "rejection", "narrow", "narrow-forms", "vanish", "add", "add-anthropic", "add-rejected", "rotate", "disable-rollback", "remove", "project", "project-reload", "project-saved", "project-cursor", "add-gemini", "project-antigravity", "environment-reload", "mouse"])("runtime credentials renderer: %s", async scenario => {
  const result = await tsx("credentials.tsx", [scenario]);
  expect(result.stdout).toContain("Credential renderer checks passed: " + scenario);
});

it.skipIf(process.platform !== "linux")("records runtime credential management in a real PTY", async () => {
  const result = await python("credentials-terminal.py");
  expect(result.stdout).toContain("PTY credentials passed");
});

it.each(["batch", "failure", "status-error", "local", "loading", "highlight", "mouse"])("agent runtimes renderer: %s", async scenario => {
  const result = await tsx("runtimes.tsx", [scenario], { FORCE_COLOR: "3", COLORTERM: "truecolor" });
  expect(result.stdout).toContain("Runtime renderer checks passed: " + scenario);
});

// A loaded machine, simulated: tsx starts late, or Scheduler ticks lag behind the drivers' timers (OS-2278).
const lagging = loaded({ LOADED_TICK_MS: "100", FORCE_COLOR: "1" });

it("gives a driver that starts slower than Vitest's default its own time limit", async () => {
  const result = await tsx("runtimes.tsx", ["local"], loaded({ LOADED_START_MS: "6000" }));
  expect(result.stdout).toContain("Runtime renderer checks passed: local");
});

it.concurrent.for([
  ["app.ts", "overwrite", "Terminal keyboard, resize and detach checks passed"],
  ["actions.tsx", "", "Action confirmation, two-client state"],
  ["onboarding.tsx", "normal", "Onboarding renderer checks passed"],
  ["onboarding-review.tsx", "project-order", "Onboarding review checks passed: project-order"],
  ["environments.tsx", "probe-start", "Environment renderer checks passed: probe-start"],
  ["navigation.tsx", "restricted-network", "Navigation checks passed: restricted-network"],
  ["credentials.tsx", "project", "Credential renderer checks passed: project"],
  ["runtimes.tsx", "batch", "Runtime renderer checks passed: batch"],
])("binds each key to the latest frame when Scheduler lags: %s %s", async ([driver, scenario, passed], { expect }) => {
  const result = await tsx(driver, scenario ? [scenario] : [], lagging);
  expect(result.stdout).toContain(passed);
});

it.skipIf(process.platform !== "linux").concurrent.for([
  ["environments-terminal.py", "detach", "PTY environments passed"],
  ["onboarding-terminal.py", "", "PTY onboarding passed"],
  ["credentials-terminal.py", "", "PTY credentials passed"],
  ["projects.py", "pause-shell", "PTY project checks passed: pause-shell"],
])("binds each key to the latest frame in a real PTY when Scheduler lags: %s %s", async ([script, scenario, passed], { expect }) => {
  const result = await python(script, scenario ? [scenario] : [], lagging);
  expect(result.stdout).toContain(passed);
});
