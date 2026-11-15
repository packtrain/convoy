import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectCursorAgent,
  parseCursorVersion,
  resetTrustFlagProbeForTests,
  supportsTrustFlag,
} from "./detect.js";
import { CURSOR_EXECUTABLE_ENV } from "./runner.js";

describe("parseCursorVersion", () => {
  it("accepts cursor's bare date-version line", () => {
    expect(parseCursorVersion("2025.09.18-7ae6800\n")).toBe(
      "2025.09.18-7ae6800",
    );
  });

  it("falls back to unknown for unexpected output", () => {
    expect(parseCursorVersion("cursor-agent v1")).toBe("unknown");
    expect(parseCursorVersion("")).toBe("unknown");
  });
});

describe("cursor-agent probes (fake executable)", () => {
  let tmpDir: string;
  let previousExecutable: string | undefined;

  function writeFakeCursorAgent(script: string): void {
    const file = join(tmpDir, "cursor-agent");
    writeFileSync(file, `#!/usr/bin/env node\n${script}`);
    chmodSync(file, 0o755);
    process.env[CURSOR_EXECUTABLE_ENV] = file;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cursor-detect-test-"));
    previousExecutable = process.env[CURSOR_EXECUTABLE_ENV];
    resetTrustFlagProbeForTests();
  });

  afterEach(() => {
    if (previousExecutable === undefined) {
      delete process.env[CURSOR_EXECUTABLE_ENV];
    } else {
      process.env[CURSOR_EXECUTABLE_ENV] = previousExecutable;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    resetTrustFlagProbeForTests();
  });

  it("detects the installed version", async () => {
    writeFakeCursorAgent(`console.log("2026.01.10-abc1234");`);
    expect(await detectCursorAgent()).toEqual({
      type: "cursor",
      version: "2026.01.10-abc1234",
    });
  });

  it("reports trust-flag support from --help output", async () => {
    writeFakeCursorAgent(`
if (process.argv.includes("--help")) {
  console.log("Options:\\n  --trust  Trust the working directory");
}
`);
    expect(await supportsTrustFlag()).toBe(true);

    resetTrustFlagProbeForTests();
    writeFakeCursorAgent(`console.log("Options:\\n  -f, --force");`);
    expect(await supportsTrustFlag()).toBe(false);
  });
});
