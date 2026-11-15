import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ shell: vi.fn(), check: vi.fn(), setup: vi.fn() }));
vi.mock("../environment/setup-entrypoint.js", () => { mocks.setup(); return {}; });
vi.mock("./workflow.js", () => ({ addProject: vi.fn(), listProjects: vi.fn(), removeProject: vi.fn(), checkProject: mocks.check, openProjectShell: mocks.shell }));
vi.mock("../../cli.js", () => ({ addGlobalOptions: (value: unknown) => value }));
vi.mock("../environment/index.js", () => ({ targetEnvironment: () => undefined, targetCommands: {} }));
import { projectCommand } from "./command.js";

it("opens the shell through the workflow, which checks the confirmed identity", async () => {
  const command = projectCommand.exitOverride().configureOutput({ writeErr: () => {} });
  await command.parseAsync(["shell", "a", "--expected-identity", "confirmed", "--login", "codex"], { from: "user" });
  expect(mocks.shell).toHaveBeenCalledWith("a", "confirmed", undefined, "codex");
});

it("prints a checklist and fails on a failed check, but JSON always exits 0", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const command = projectCommand.exitOverride().configureOutput({ writeErr: () => {} });
  mocks.check.mockResolvedValue({ profile: "a", checks: [{ id: "sandbox", status: "pass", label: "Sandbox boundary" },
    { id: "codex-login", status: "fail", label: "Codex logged in", fix: "Run project login a --runtime codex." }] });
  try {
    await command.parseAsync(["check", "a"], { from: "user" });
    expect(log.mock.calls.map(([line]) => line)).toEqual(["Project a", "✓ Sandbox boundary", "✗ Codex logged in. Run project login a --runtime codex."]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0; log.mockClear();
    await command.parseAsync(["check", "a", "--json"], { from: "user" });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ profile: "a" });
    expect(process.exitCode).toBe(0);
  } finally { log.mockRestore(); process.exitCode = 0; }
});

it("runs guided setup from stdin through a hidden command", async () => {
  await projectCommand.exitOverride().parseAsync(["setup"], { from: "user" });
  expect(mocks.setup).toHaveBeenCalledOnce();
  expect(projectCommand.helpInformation()).not.toContain("setup");
});
