import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { loaded } from "../../../__tests__/loaded-machine.mjs";

// The test's limit sits above the driver's, so a slow driver fails with its own output (OS-2278).
const DRIVER_MS = 60000;
vi.setConfig({ testTimeout: DRIVER_MS + 5000 });
const fixture = (name: string) => fileURLToPath(new URL(`../__tests__/${name}`, import.meta.url));
const renderer = (scenario: string, env: Record<string, string> = {}) =>
  promisify(execFile)(process.execPath, ["--import", "tsx", fixture("runtime-access.tsx"), scenario], { timeout: DRIVER_MS, env: { ...process.env, ...env } });
const terminal = (scenario: string) => promisify(execFile)("python3", [fixture("access-terminal.py"), scenario], { timeout: DRIVER_MS });

it.each(["layout", "account-error", "account", "delayed", "lost", "retained", "reload-native", "narrow", "loading", "skip", "save", "partial", "old", "unknown", "login", "shared"])("runtime access renderer: %s", async scenario => {
  const result = await renderer(scenario);
  expect(result.stdout).toContain("Runtime access passed");
});

it.skipIf(process.platform !== "linux").each(["success", "failure", "actions", "actions-save"])("runtime login survives production terminal handoff: %s", async scenario => {
  const result = await terminal(scenario);
  expect(result.stdout).toContain(`PTY access passed: ${scenario}`);
});

// Scheduler ticks lag behind the drivers' timers, as on a loaded machine (OS-2278).
it("binds each key to the latest frame when Scheduler lags", async () => {
  const result = await renderer("save", loaded({ LOADED_TICK_MS: "100" }));
  expect(result.stdout).toContain("Runtime access passed");
});
