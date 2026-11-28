import { beforeEach, describe, expect, it, vi } from "vitest";

const { runOneShotCommandMock } = vi.hoisted(() => ({
  runOneShotCommandMock: vi.fn(),
}));

vi.mock("../../lib/one-shot-command.js", () => ({
  runOneShotCommand: runOneShotCommandMock,
}));

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
import { listCliProfilesCommand } from "./list.js";

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

/**
 * Shapes match `cliProfileItemValidator` (`convex/cli/profiles.ts`): every
 * `availableClis` entry is an object, and `hostname` is optional.
 */
const profiles = [
  {
    _id: "prof_online",
    name: "macbook",
    profileKey: "macbook",
    hostname: "macbook.local",
    paths: [{ id: "path_1", path: "~/src/app", label: "app", kind: "repo" }],
    createdAt: 1,
    lastConnectedAt: 2,
    isOnline: true,
    sessionStartedAt: 3,
    availableClis: [
      { type: "claude-code", version: "2.1.0", provider: "bedrock" },
      { type: "codex", version: "0.9.1" },
    ],
    appVersion: "0.46.0",
  },
  {
    _id: "prof_offline",
    name: "desktop",
    profileKey: "desktop",
    paths: [],
    createdAt: 1,
    lastConnectedAt: 2,
    isOnline: false,
    availableClis: [],
  },
];

describe("profiles list command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(listCliProfilesCommand);

    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(profiles);

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: {
          query,
          mutation: vi.fn(),
          subscribe: vi.fn(),
          close: vi.fn(),
          client: {} as never,
        },
        config: {
          convexUrl: "https://example.convex.cloud",
          apiKey: "sk_user_test",
          projectId: undefined,
        },
      });
    });
  });

  it("prints online state and available runtimes per profile", async () => {
    Reflect.set(listCliProfilesCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(listCliProfilesCommand, "_actionHandler").call(
      listCliProfilesCommand,
      []
    );

    expect(query).toHaveBeenCalledWith(api.cli.profiles.listByProject, {
      projectId: "proj_web_1",
    });

    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("macbook");
    expect(output).toContain("online");
    // Each runtime is an object, so it must be formatted rather than joined.
    expect(output).toContain("claude-code 2.1.0, codex 0.9.1");
    expect(output).not.toContain("[object Object]");
    expect(output).toContain("0.46.0");
    expect(output).toContain("path_1");
    expect(output).toContain("~/src/app");
    // A repo entry says so: it is the pathId that starts a thread in one repo of a folder.
    expect(output).toContain("(app, repo)");
    expect(output).toContain("desktop");
    expect(output).toContain("offline");
    // `hostname` is optional; the second profile omits it.
    expect(output).not.toContain("undefined");
  });
});
