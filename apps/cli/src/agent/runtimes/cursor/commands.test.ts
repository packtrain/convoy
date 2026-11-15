import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

import { discoverCursorCommands } from "./commands.js";

describe("discoverCursorCommands", () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cursor-commands-project-"));
    homeDir = mkdtempSync(join(tmpdir(), "cursor-commands-home-"));
    homedirMock.mockReturnValue(homeDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  function writeCommand(baseDir: string, name: string): void {
    const dir = join(baseDir, ".cursor", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), `# ${name}`);
  }

  it("merges project and global commands with project winning dedup", async () => {
    writeCommand(projectDir, "plan");
    writeCommand(projectDir, "review");
    writeCommand(homeDir, "plan");
    writeCommand(homeDir, "global-only");

    expect(await discoverCursorCommands(projectDir)).toEqual([
      "plan",
      "review",
      "global-only",
    ]);
  });

  it("ignores non-markdown files", async () => {
    const dir = join(projectDir, ".cursor", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.md"), "# plan");
    writeFileSync(join(dir, "notes.txt"), "not a command");

    expect(await discoverCursorCommands(projectDir)).toEqual(["plan"]);
  });

  it("fails soft when directories are missing", async () => {
    expect(await discoverCursorCommands(projectDir)).toEqual([]);
  });
});
