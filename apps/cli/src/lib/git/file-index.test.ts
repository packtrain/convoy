import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./exec.js";
import { clearWorkspaceFileIndexCache, searchWorkspaceFiles } from "./file-index.js";

describe("searchWorkspaceFiles", () => {
  let dir: string;

  beforeEach(async () => {
    clearWorkspaceFileIndexCache();
    dir = await mkdtemp(join(tmpdir(), "convoy-file-index-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedFiles(paths: string[]): Promise<void> {
    for (const path of paths) {
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash !== -1) {
        await mkdir(join(dir, path.slice(0, lastSlash)), { recursive: true });
      }
      await writeFile(join(dir, path), "x\n");
    }
  }

  it("indexes tracked and untracked-not-ignored files in a git repo", async () => {
    await runGit(dir, ["init", "--initial-branch=main"]);
    await seedFiles(["src/app.ts", "untracked.txt", "ignored.log"]);
    await writeFile(join(dir, ".gitignore"), "*.log\n");
    await runGit(dir, ["add", "src/app.ts"]);

    const files = await searchWorkspaceFiles(dir, "");
    expect(files).toContain("src/app.ts");
    expect(files).toContain("untracked.txt");
    expect(files).not.toContain("ignored.log");
  });

  it("falls back to a filesystem walk outside git repos, skipping excluded dirs", async () => {
    await seedFiles(["src/app.ts", "node_modules/pkg/index.js", ".git/config"]);

    const files = await searchWorkspaceFiles(dir, "");
    expect(files).toEqual(["src/app.ts"]);
  });

  it("ranks basename matches first (t3code scoring)", async () => {
    await seedFiles([
      "src/abutton.ts",
      "src/button/index.ts",
      "button/config.ts",
      "src/components/button.tsx",
    ]);

    // basename prefix < path prefix < /segment < generic substring.
    expect(await searchWorkspaceFiles(dir, "button")).toEqual([
      "src/components/button.tsx",
      "button/config.ts",
      "src/button/index.ts",
      "src/abutton.ts",
    ]);
  });

  it("normalizes the query (leading @, ./, case) and caps results", async () => {
    await seedFiles(["src/App.ts", "src/app-config.ts", "readme.md"]);

    expect(await searchWorkspaceFiles(dir, "@./APP")).toEqual([
      "src/App.ts",
      "src/app-config.ts",
    ]);
    expect(await searchWorkspaceFiles(dir, "app", 1)).toHaveLength(1);
  });
});
