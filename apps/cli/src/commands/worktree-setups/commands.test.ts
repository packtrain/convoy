import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runOneShotCommandMock, getGitRemoteUrlMock, readFileSyncMock } = vi.hoisted(() => ({
  runOneShotCommandMock: vi.fn(),
  getGitRemoteUrlMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("../../lib/one-shot-command.js", () => ({ runOneShotCommand: runOneShotCommandMock }));
vi.mock("../../lib/git/repo.js", () => ({ getGitRemoteUrl: getGitRemoteUrlMock }));
vi.mock("node:fs", () => ({ readFileSync: readFileSyncMock }));

vi.mock("../../cli.js", () => ({
  addGlobalOptions: <T extends { option: (...args: string[]) => T }>(cmd: T) =>
    cmd
      .option("--profile <name>", "Profile key (for profile lookup)")
      .option("--url <url>", "Convex backend URL (overrides config)")
      .option("--api-key <key>", "API key (overrides config)")
      .option("--project <id>", "Project ID (overrides config)"),
}));

import { api } from "../../convex/_generated/api.js";
import { resetCommandOptions } from "../test-helpers.js";
import { deleteWorktreeSetupCommand } from "./delete.js";
import { getWorktreeSetupCommand } from "./get.js";
import { listWorktreeSetupsCommand } from "./list.js";
import { setWorktreeSetupCommand } from "./set.js";

const accessibleProjects = [
  {
    _id: "proj_web_1",
    name: "Web",
    alias: "WEB",
    organizationId: "org_acme",
    organizationName: "Acme",
    organizationSlug: "acme",
    role: { name: "org-owner", permissions: ["*"] },
  },
];

const SCRIPT = 'cp "$CONVOY_PARENT_PATH/.mcp.json" .\npnpm i';
const rows = [
  { repoKey: "acme/api", setup: null },
  {
    repoKey: "packtrain/convoy",
    setup: { _id: "setup_1", script: SCRIPT, revision: 2, updatedByName: "Ada", updatedAt: Date.UTC(2026, 10, 25), approval: "never" },
  },
];

function invoke(command: Command, args: unknown[] = []): Promise<void> {
  Reflect.set(command, "optsWithGlobals", () => ({ project: "WEB" }));
  // Commander passes positionals, then options, then the command.
  return Reflect.get(command, "_actionHandler").call(command, args);
}

function output(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
}

describe("worktree-setups commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [listWorktreeSetupsCommand, getWorktreeSetupCommand, setWorktreeSetupCommand, deleteWorktreeSetupCommand]) {
      resetCommandOptions(command);
    }
    getGitRemoteUrlMock.mockResolvedValue("git@github-personal:PackTrain/convoy.git");
    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: { query, mutation, subscribe: vi.fn(), close: vi.fn(), client: {} as never },
        config: { convexUrl: "https://example.convex.cloud", apiKey: "sk_user_test", projectId: undefined },
      });
    });
  });

  it("lists setups with revision, editor, date and the caller's approval", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(rows);

    await invoke(listWorktreeSetupsCommand);

    expect(query).toHaveBeenNthCalledWith(2, api.cli.worktreeSetups.list, { projectId: "proj_web_1" });
    expect(output()).toContain("acme/api");
    expect(output()).toMatch(/packtrain\/convoy.*r2 Ada 2026-11-25.*needs your approval/);
  });

  it("get prints only the script of the origin's repo", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(rows);

    await invoke(getWorktreeSetupCommand, [undefined]);

    expect(vi.mocked(console.log).mock.calls).toEqual([[SCRIPT]]);
  });

  it("get fails for a repo without a script", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(rows);

    await expect(invoke(getWorktreeSetupCommand, ["Acme/API"])).rejects.toThrow("No worktree setup script for acme/api.");
    expect(getGitRemoteUrlMock).not.toHaveBeenCalled();
  });

  it("set reads --file, saves under the origin's key, and points at the web for approval", async () => {
    readFileSyncMock.mockReturnValue(`${SCRIPT}\n`);
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce({ setupId: "setup_1", revision: 3, changed: true, settingsUrl: "https://app/o/acme/WEB/settings/worktrees" });
    setWorktreeSetupCommand.setOptionValue("file", "setup.sh");

    await invoke(setWorktreeSetupCommand, [undefined]);

    expect(readFileSyncMock).toHaveBeenCalledWith("setup.sh", "utf-8");
    expect(mutation).toHaveBeenCalledWith(api.cli.worktreeSetups.save, { projectId: "proj_web_1", repoKey: "packtrain/convoy", script: `${SCRIPT}\n` });
    expect(output()).toContain("packtrain/convoy (revision 3)");
    expect(output()).toContain("https://app/o/acme/WEB/settings/worktrees");
    expect(output()).toContain("Approve it in the web before it runs. New worktrees for this repo fail for everyone until they approve it.");
  });

  it.each([
    ["neither", {}, "Pass --script or --file."],
    ["both", { file: "setup.sh", script: "make" }, "Cannot use --script and --file together"],
  ])("set refuses %s of --file and --script", async (_label, values, message) => {
    for (const [key, value] of Object.entries(values)) setWorktreeSetupCommand.setOptionValue(key, value);

    await expect(invoke(setWorktreeSetupCommand, ["packtrain/convoy"])).rejects.toThrow(message);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("set names the file it could not read", async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    setWorktreeSetupCommand.setOptionValue("file", "setup.sh");

    await expect(invoke(setWorktreeSetupCommand, ["packtrain/convoy"])).rejects.toThrow('Could not read script file "setup.sh": ENOENT');
  });

  it("set says so when the text did not change, without asking for approval", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce({ setupId: "setup_1", revision: 3, changed: false, settingsUrl: "https://app/s" });
    setWorktreeSetupCommand.setOptionValue("script", SCRIPT);

    await invoke(setWorktreeSetupCommand, ["packtrain/convoy"]);

    expect(output()).toContain("No change to the worktree setup for packtrain/convoy (revision 3)");
    expect(output()).not.toContain("Approve");
  });

  it("get accepts a remote URL as [repo]", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(rows);

    await invoke(getWorktreeSetupCommand, ["https://github.com/PackTrain/convoy.git"]);

    expect(vi.mocked(console.log).mock.calls).toEqual([[SCRIPT]]);
  });

  it("rejects a [repo] that is not owner/repo before calling the server", async () => {
    await expect(invoke(deleteWorktreeSetupCommand, ["convoy"])).rejects.toThrow("convoy is not owner/repo. Pass [repo] as owner/repo.");
    expect(query).not.toHaveBeenCalled();
  });

  it("delete removes by repo key with JSON output", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce(null);
    deleteWorktreeSetupCommand.setOptionValue("json", true);

    await invoke(deleteWorktreeSetupCommand, ["packtrain/convoy"]);

    expect(mutation).toHaveBeenCalledWith(api.cli.worktreeSetups.remove, { projectId: "proj_web_1", repoKey: "packtrain/convoy" });
    expect(JSON.parse(output())).toEqual({ repoKey: "packtrain/convoy", deleted: true });
  });

  it.each([
    [null, "has no origin remote. Pass [repo] as owner/repo."],
    ["/home/me/convoy.git", "The origin remote /home/me/convoy.git has no owner/repo. Pass [repo] as owner/repo."],
  ])("names the [repo] argument when the origin %s gives no key", async (remote, message) => {
    getGitRemoteUrlMock.mockResolvedValue(remote);

    await expect(invoke(deleteWorktreeSetupCommand, [undefined])).rejects.toThrow(message);
    expect(mutation).not.toHaveBeenCalled();
  });
});
