import { afterEach, describe, expect, it, vi } from "vitest";

const { offerUpdate, checkForNewerVersion, run } = vi.hoisted(() => ({ offerUpdate: vi.fn(), checkForNewerVersion: vi.fn(), run: vi.fn() }));
vi.mock("../update/prompts.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../update/prompts.js")>()), offerUpdate }));
vi.mock("../../lib/version.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/version.js")>()), checkForNewerVersion }));
vi.mock("./render.js", () => ({ run }));
vi.mock("./resolution.js", () => ({ connections: () => ({ targets: [], selected: undefined, warnings: [] }) }));

import { tuiCommand } from "./command.js";

it("rejects redirected output without terminal control sequences or opening a service", async () => {
  const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const previous = process.exitCode;
  try {
    await tuiCommand.parseAsync([], { from: "user" });
    expect(process.exitCode).toBe(1);
    const output = write.mock.calls.map(call => call[0]).join("");
    expect(output).toContain("requires interactive stdin and stdout");
    expect(output).not.toContain("\u001b");
  } finally { write.mockRestore(); process.exitCode = previous; }
});

describe("update prompt", () => {
  const original = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY, setRawMode: process.stdin.setRawMode };
  const terminal = () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "setRawMode", { value: () => process.stdin, configurable: true });
    vi.stubEnv("CI", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    checkForNewerVersion.mockResolvedValue("999.0.0");
  };
  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: original.stdin, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: original.stdout, configurable: true });
    Object.defineProperty(process.stdin, "setRawMode", { value: original.setRawMode, configurable: true });
    vi.unstubAllEnvs(); vi.restoreAllMocks(); offerUpdate.mockReset(); run.mockReset();
  });

  it("exits before rendering once the update installs", async () => {
    terminal();
    offerUpdate.mockResolvedValue(true);
    await tuiCommand.parseAsync([], { from: "user" });
    expect(offerUpdate).toHaveBeenCalledWith("999.0.0");
    expect(run).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("Updated. Run convoy tui again.");
  });

  it("renders after a skip", async () => {
    terminal();
    offerUpdate.mockResolvedValue(false);
    await tuiCommand.parseAsync([], { from: "user" });
    expect(run).toHaveBeenCalledOnce();
  });
});
