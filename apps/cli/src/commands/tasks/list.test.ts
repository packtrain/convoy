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
import { listTasksCommand } from "./list.js";

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

describe("tasks list command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(listTasksCommand);

    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce([]);

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

  it("passes resolved project, archive filter, and status to listByProject", async () => {
    listTasksCommand.setOptionValue("org", "acme");
    listTasksCommand.setOptionValue("archived", true);
    listTasksCommand.setOptionValue("status", "Plan Review");
    listTasksCommand.setOptionValue("json", true);
    Reflect.set(listTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(listTasksCommand, "_actionHandler").call(listTasksCommand, []);

    expect(query).toHaveBeenNthCalledWith(1, api.projects.core.listAccessible, {});
    expect(query).toHaveBeenCalledWith(api.tasks.core.listByProject, {
      projectId: "proj_web_1",
      archiveFilter: "archived",
      status: "Plan Review",
    });
  });

  it("passes --list to listByProject", async () => {
    listTasksCommand.setOptionValue("list", "SPRINT-1");
    Reflect.set(listTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(listTasksCommand, "_actionHandler").call(listTasksCommand, []);

    expect(query).toHaveBeenCalledWith(api.tasks.core.listByProject, {
      projectId: "proj_web_1",
      archiveFilter: undefined,
      status: undefined,
      listId: "SPRINT-1",
    });
  });

  it("prints external links in text mode when --include-links is set", async () => {
    query.mockReset();
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce([
      {
        _id: "task_1",
        refId: "WEB-1",
        name: "Billing bug",
        status: "To Do",
        priority: "High",
        externalLinks: [
          {
            id: "commit-abcdef1",
            kind: "commit",
            sha: "abcdef1234",
            title: "Fix billing",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    ]);
    listTasksCommand.setOptionValue("includeLinks", true);
    listTasksCommand.setOptionValue("json", false);
    listTasksCommand.setOptionValue("output", "text");
    Reflect.set(listTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(listTasksCommand, "_actionHandler").call(listTasksCommand, []);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("[commit] abcdef1 Fix billing (commit-abcdef1)");
  });

  it("rejects scoped List refs before listing tasks", async () => {
    listTasksCommand.setOptionValue("list", "OTHER/SPRINT-1");
    Reflect.set(listTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await expect(
      Reflect.get(listTasksCommand, "_actionHandler").call(listTasksCommand, [])
    ).rejects.toThrow(/Cross-project List refs/);

    expect(query).toHaveBeenCalledTimes(1);
  });
});
