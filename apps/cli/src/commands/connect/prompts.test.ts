import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("bare convoy with nobody to answer", () => {
  const homes: string[] = [];
  afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

  const runBare = async (env: Record<string, string>) => {
    const home = mkdtempSync(join(tmpdir(), "cv-bare-")); homes.push(home);
    const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("../../../bin/convoy.ts", import.meta.url))],
      { env: { ...process.env, HOME: home, CI: "1", ...env } });
    // stdin stays open and unanswered, like an agent's shell.
    let stderr = ""; child.stderr.on("data", data => { stderr += data; }); child.stdout.resume();
    try {
      await vi.waitFor(() => expect(child.exitCode, stderr).not.toBeNull(), { timeout: 8000 });
    } finally { if (child.exitCode === null) child.kill("SIGKILL"); }
    return { code: child.exitCode, stderr };
  };

  it("prints help and exits 1 when stdin is not a TTY", async () => {
    const { code, stderr } = await runBare({});
    expect(code).toBe(1);
    expect(stderr).toContain("Usage: convoy");
    expect(stderr).toContain("convoy connect");
  }, 15000);
});
