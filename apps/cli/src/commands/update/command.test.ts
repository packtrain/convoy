import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));

vi.mock("node:child_process", () => ({ spawnSync: mockSpawnSync }));

import { runUpdate } from "./command.js";

afterEach(() => {
  vi.restoreAllMocks();
  mockSpawnSync.mockReset();
});

describe("runUpdate", () => {
  it("runs the documented global npm install and returns npm's exit code", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockSpawnSync.mockReturnValue({ status: 0 });

    expect(runUpdate()).toBe(0);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@useconvoy/cli@latest"],
      expect.objectContaining({ stdio: "inherit" })
    );
  });

  it("propagates a failing npm exit code", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockSpawnSync.mockReturnValue({ status: 243 });

    expect(runUpdate()).toBe(243);
  });

  it("fails with a message when npm cannot be launched", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSpawnSync.mockReturnValue({ status: null, error: new Error("ENOENT") });

    expect(runUpdate()).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("ENOENT");
  });
});
