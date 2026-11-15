import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalEnvironment, saveLocalEnvironment } from "./paths.js";
import { RUNTIME_PROBE, applyEnvironmentMode, chooseEnvironmentMode, environmentMode, modeChoiceOpen, recordEnvironmentMode, type ModeSetup, offeredVersion, parseRuntimeVersions, publishedVersion, runtimeState } from "./resolution.js";
import { CURSOR_BUILD } from "../project/formatters.js";
import { TESTED_OPENCODE_PACKAGE } from "../../agent/runtimes/opencode/server.js";

it("pins a verified exact release instead of latest", async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ name: "@useconvoy/cli", version: "0.103.0" })));
  await expect(publishedVersion("0.103.0", "0.100.0", request)).resolves.toBe("0.103.0");
  expect(request.mock.calls[0]).toEqual(["https://registry.npmjs.org/@useconvoy/cli/0.103.0", expect.objectContaining({ signal: expect.any(AbortSignal) })]);
});
it("does not downgrade a newer installed target or offer an unpublished release", async () => {
  const request = vi.fn(async () => new Response("", { status: 404 }));
  await expect(publishedVersion("0.103.0", "0.104.0", request)).rejects.toThrow("no downgrade");
  expect(request).not.toHaveBeenCalled();
  await expect(publishedVersion("0.103.0", "0.100.0", request)).rejects.toThrow("not published");
});
it("explains network failures without offering installation", async () => {
  await expect(publishedVersion("0.103.0", undefined, async () => { throw new Error("offline"); })).rejects.toThrow("network and retry");
  await expect(publishedVersion("0.103.0", undefined, async () => new Response("", { status: 503 }))).rejects.toThrow("registry availability");
});
it("refuses a prerelease host rather than downgrading a stable target", async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ name: "@useconvoy/cli", version: "0.103.0-dev" })));
  await expect(publishedVersion("0.103.0-dev", "0.103.0", request)).rejects.toThrow("stable");
  expect(request).not.toHaveBeenCalled();
});

describe("agent runtimes", () => {
  it("reads each runtime's version from its --version line", () => {
    expect(parseRuntimeVersions("claude\t2.1.3 (Claude Code)\ncodex\tcodex-cli 0.156.1\nopencode\t\ncursor-agent\t?\n"))
      .toEqual({ "claude-code": "2.1.3", codex: "0.156.1", cursor: "unknown" });
  });
  it("offers updates, never downgrades, and compares Cursor's dated builds", () => {
    expect(runtimeState("2.1.3", "2.1.9")).toBe("update");
    expect(runtimeState("0.156.1", "0.156.1")).toBe("current");
    expect(runtimeState("0.160.0", "0.156.1")).toBe("newer");
    expect(runtimeState(undefined, "1.19.5")).toBe("missing");
    expect(runtimeState("unknown", "1.19.5")).toBe("update");
    expect(runtimeState("2.1.3", undefined)).toBe("unknown");
    expect(runtimeState("2026.10.01-aaaaaaa", CURSOR_BUILD)).toBe("update");
    expect(runtimeState("2026.11.20-bbbbbbb", CURSOR_BUILD)).toBe("newer");
    expect(runtimeState(CURSOR_BUILD, CURSOR_BUILD)).toBe("current");
  });
  it("offers npm latest for Claude Code and Codex and the tested builds for OpenCode and Cursor", async () => {
    const request = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ version: String(url).includes("claude-code") ? "2.1.9" : "0.160.0" })));
    await expect(offeredVersion("claude-code", request)).resolves.toBe("2.1.9");
    await expect(offeredVersion("codex", request)).resolves.toBe("0.160.0");
    await expect(offeredVersion("opencode", request)).resolves.toBe(TESTED_OPENCODE_PACKAGE.split("@")[1]);
    await expect(offeredVersion("cursor", request)).resolves.toBe(CURSOR_BUILD);
    expect(request.mock.calls.map(call => call[0])).toEqual(["https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest", "https://registry.npmjs.org/@openai%2Fcodex/latest"]);
  });
  it("explains a failed npm lookup and rejects an unsafe version", async () => {
    await expect(offeredVersion("codex", async () => { throw new Error("offline"); })).rejects.toThrow("Cannot reach npm");
    await expect(offeredVersion("codex", async () => new Response(JSON.stringify({ version: "1.0.0; rm -rf /" })))).rejects.toThrow();
  });
});

it("reads versions with a private HOME, since the node user cannot write the image's ~/.config", () => {
  const bin = mkdtempSync(join(tmpdir(), "convoy-probe-")), home = mkdtempSync(join(tmpdir(), "convoy-home-"));
  try {
    writeFileSync(join(bin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n", { mode: 0o755 });
    writeFileSync(join(bin, "opencode"), "#!/bin/sh\nmkdir -p \"$XDG_CONFIG_HOME/opencode\" \"$HOME/.config/opencode\" || exit 1\necho 1.19.5\n", { mode: 0o755 });
    chmodSync(home, 0o500);
    const output = execFileSync("sh", ["-c", RUNTIME_PROBE], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home }, encoding: "utf8" });
    expect(parseRuntimeVersions(output)).toEqual({ opencode: "1.19.5" });
  } finally { chmodSync(home, 0o700); rmSync(bin, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

describe("environmentMode", () => {
  const home = () => mkdtempSync(join(tmpdir(), "convoy-mode-"));
  it("uses the record, else isolated with the launcher registry, else shared", () => {
    const dir = home();
    try {
      expect(environmentMode(dir, () => false)).toBe("shared");
      expect(environmentMode(dir, () => true)).toBe("isolated");
      saveLocalEnvironment(dir, { schema: 1, mode: "shared" });
      expect(environmentMode(dir, () => true)).toBe("shared");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("records the inferred mode once", () => {
    const dir = home();
    try {
      expect(recordEnvironmentMode(dir, () => true)).toBe("isolated");
      expect(readLocalEnvironment(dir)).toEqual({ schema: 1, mode: "isolated" });
      expect(recordEnvironmentMode(dir, () => false)).toBe("isolated");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("chooseEnvironmentMode", () => {
  const passed = [{ name: "bubblewrap installed" }];
  const setup = (home: string, overrides: Partial<ModeSetup> = {}): ModeSetup => ({
    home, platform: "linux", launcher: () => false, registered: () => false,
    ask: vi.fn(async () => "shared" as const), checks: vi.fn(async () => passed), install: vi.fn(() => ({ ok: true, output: "Project launcher installed." })), log: vi.fn(),
    ...overrides,
  });
  const withHome = async (test: (home: string) => Promise<void>) => {
    const home = mkdtempSync(join(tmpdir(), "convoy-choose-"));
    try { await test(home); } finally { rmSync(home, { recursive: true, force: true }); }
  };

  it("offers the choice only on Linux with no record, launcher or registered project", () => withHome(async home => {
    expect(modeChoiceOpen(setup(home))).toBe(true);
    expect(modeChoiceOpen(setup(home, { platform: "darwin" }))).toBe(false);
    expect(modeChoiceOpen(setup(home, { launcher: () => true }))).toBe(false);
    expect(modeChoiceOpen(setup(home, { registered: () => true }))).toBe(false);
    saveLocalEnvironment(home, { schema: 1, mode: "shared" });
    expect(modeChoiceOpen(setup(home))).toBe(false);
  }));

  it("asks interactively and saves shared without installing", () => withHome(async home => {
    const fake = setup(home);
    await expect(chooseEnvironmentMode(undefined, true, fake)).resolves.toBe("shared");
    expect(fake.ask).toHaveBeenCalled(); expect(fake.install).not.toHaveBeenCalled();
    expect(readLocalEnvironment(home)).toEqual({ schema: 1, mode: "shared" });
  }));

  it("installs, then saves isolated", () => withHome(async home => {
    const fake = setup(home, { ask: vi.fn(async () => "isolated" as const) });
    await expect(chooseEnvironmentMode(undefined, true, fake)).resolves.toBe("isolated");
    expect(fake.log).toHaveBeenCalledWith(expect.stringContaining("✓ bubblewrap installed"));
    expect(fake.install).toHaveBeenCalled();
    expect(readLocalEnvironment(home)).toEqual({ schema: 1, mode: "isolated" });
  }));

  it("holds the mode claim from before the sudo prompt until the mode is saved", () => withHome(async home => {
    const claim = join(home, ".convoy/environment.claim");
    const held: boolean[] = [];
    const fake = setup(home, { install: vi.fn(() => { held.push(existsSync(claim)); return { ok: true, output: "" }; }) });
    await expect(chooseEnvironmentMode("isolated", false, fake)).resolves.toBe("isolated");
    const failed = mkdtempSync(join(tmpdir(), "convoy-choose-"));
    try { await expect(chooseEnvironmentMode("isolated", false, setup(failed, { install: () => { held.push(existsSync(join(failed, ".convoy/environment.claim"))); return { ok: false, output: "" }; } }))).rejects.toThrow("stays shared"); }
    finally { expect(existsSync(join(failed, ".convoy/environment.claim"))).toBe(false); rmSync(failed, { recursive: true, force: true }); }
    expect(held).toEqual([true, true]); expect(existsSync(claim)).toBe(false);
  }));

  it("reports missing prerequisites and installs nothing", () => withHome(async home => {
    const fake = setup(home, { checks: vi.fn(async () => [{ name: "bubblewrap installed", fix: "Install it: sudo apt-get install bubblewrap" }]) });
    await expect(chooseEnvironmentMode("isolated", false, fake)).rejects.toThrow("then run the same command again. Help for each item: https://docs.convoy.build/docs/cli/troubleshooting#isolated-mode-prerequisites");
    expect(fake.log).toHaveBeenCalledWith(expect.stringContaining("✗ bubblewrap installed: Install it"));
    expect(fake.install).not.toHaveBeenCalled(); expect(readLocalEnvironment(home)).toBeUndefined();
  }));

  it("writes no record when the install fails or is cancelled", () => withHome(async home => {
    const fake = setup(home, { install: vi.fn(() => ({ ok: false, output: "sudo: a password is required" })) });
    await expect(chooseEnvironmentMode("isolated", false, fake)).rejects.toThrow("stays shared");
    expect(fake.log).toHaveBeenCalledWith("sudo: a password is required");
    expect(readLocalEnvironment(home)).toBeUndefined();
    expect(modeChoiceOpen(fake)).toBe(true);
  }));

  it("refuses a pending choice once another command fixed the mode", () => withHome(async home => {
    const fake = setup(home, { ask: vi.fn(async () => { saveLocalEnvironment(home, { schema: 1, mode: "shared" }); return "isolated" as const; }) });
    await expect(chooseEnvironmentMode(undefined, true, fake)).rejects.toThrow("already shared");
    expect(fake.install).not.toHaveBeenCalled(); expect(readLocalEnvironment(home)).toEqual({ schema: 1, mode: "shared" });
    await expect(applyEnvironmentMode("isolated", fake)).rejects.toThrow("already shared");
  }));

  it("saves isolated when the installer failed after writing the launcher registry, its last write", () => withHome(async home => {
    let registry = false;
    const fake = setup(home, { launcher: () => registry, install: vi.fn(() => { registry = true; return { ok: false, output: "Sandbox check could not run." }; }) });
    await expect(chooseEnvironmentMode("isolated", false, fake)).resolves.toBe("isolated");
    expect(fake.log).toHaveBeenCalledWith(expect.stringContaining("launcher is installed"));
    expect(readLocalEnvironment(home)).toEqual({ schema: 1, mode: "isolated" });
  }));

  it("takes --mode without asking, and defaults to shared without a terminal", () => withHome(async home => {
    const fake = setup(home);
    await expect(chooseEnvironmentMode("isolated", true, fake)).resolves.toBe("isolated");
    expect(fake.ask).not.toHaveBeenCalled();
    const other = mkdtempSync(join(tmpdir(), "convoy-choose-"));
    try {
      const quiet = setup(other);
      await expect(chooseEnvironmentMode(undefined, false, quiet)).resolves.toBe("shared");
      expect(quiet.ask).not.toHaveBeenCalled(); expect(readLocalEnvironment(other)).toEqual({ schema: 1, mode: "shared" });
    } finally { rmSync(other, { recursive: true, force: true }); }
  }));

  it("never asks on macOS and refuses a mode that differs from the fixed one", () => withHome(async home => {
    const mac = setup(home, { platform: "darwin" });
    await expect(chooseEnvironmentMode(undefined, true, mac)).resolves.toBe("shared");
    expect(mac.ask).not.toHaveBeenCalled();
    await expect(chooseEnvironmentMode("isolated", true, mac)).rejects.toThrow("Isolated mode needs Linux");
    await expect(chooseEnvironmentMode("isolated", true, setup(home))).rejects.toThrow("already shared");
    expect(mac.install).not.toHaveBeenCalled();
  }));
});
