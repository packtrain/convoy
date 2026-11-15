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
import { searchTasksCommand } from "./search.js";

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

describe("tasks search command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(searchTasksCommand);

    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        page: [
          {
            _id: "task_1",
            parentId: null,
            refId: "WEB-1",
            name: "Billing bug",
            status: "In Progress",
            priority: "High",
            assignee: { type: "user", userId: "user_9", name: "Alex", avatarUrl: null },
            delegatedToAgent: null,
            createdByName: "Sam",
            isArchived: false,
            parent: null,
          },
        ],
        isDone: false,
        continueCursor: "cursor_next",
      });

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

  it("passes resolved search args and pagination to searchByProject", async () => {
    searchTasksCommand.setOptionValue("org", "acme");
    searchTasksCommand.setOptionValue("archiveMode", "archived");
    searchTasksCommand.setOptionValue("status", "Plan Review");
    searchTasksCommand.setOptionValue("assigneeId", "user_123");
    searchTasksCommand.setOptionValue("list", "SPRINT-1");
    searchTasksCommand.setOptionValue("limit", "5");
    searchTasksCommand.setOptionValue("cursor", "cursor_1");
    searchTasksCommand.setOptionValue("json", true);
    Reflect.set(searchTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(searchTasksCommand, "_actionHandler").call(
      searchTasksCommand,
      ["billing bug"]
    );

    expect(query).toHaveBeenNthCalledWith(1, api.projects.core.listAccessible, {});
    expect(query).toHaveBeenCalledWith(api.tasks.core.search.byProject, {
      projectId: "proj_web_1",
      query: "billing bug",
      archiveMode: "archived",
      listId: "SPRINT-1",
      paginationOpts: {
        numItems: 5,
        cursor: "cursor_1",
      },
      filters: {
        status: "Plan Review",
        assigneeId: "user_123",
      },
    });
  });

  it("maps --unassigned to assigneeId null and prints a next-page hint in text mode", async () => {
    searchTasksCommand.setOptionValue("unassigned", true);
    searchTasksCommand.setOptionValue("list", "SPRINT-1");
    searchTasksCommand.setOptionValue("limit", "5");
    Reflect.set(searchTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(searchTasksCommand, "_actionHandler").call(
      searchTasksCommand,
      ["billing bug"]
    );

    expect(query).toHaveBeenCalledWith(api.tasks.core.search.byProject, {
      projectId: "proj_web_1",
      query: "billing bug",
      archiveMode: "active",
      listId: "SPRINT-1",
      paginationOpts: {
        numItems: 5,
        cursor: null,
      },
      filters: {
        assigneeId: null,
      },
    });

    const calls = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(calls).toContain("Next cursor: cursor_next");
    expect(calls).toContain("convoy tasks search");
    expect(calls).toContain("--project 'proj_web_1'");
    expect(calls).toContain("--unassigned");
    expect(calls).toContain("--list 'SPRINT-1'");
    expect(calls).toContain("--limit '5'");
    expect(calls).toContain("--cursor 'cursor_next'");
  });

  it("passes raw List IDs unchanged", async () => {
    searchTasksCommand.setOptionValue("list", "nx7b79ahee74yeq64gtx2wxbr1879rnv");
    Reflect.set(searchTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(searchTasksCommand, "_actionHandler").call(
      searchTasksCommand,
      ["billing bug"]
    );

    expect(query).toHaveBeenCalledWith(
      api.tasks.core.search.byProject,
      expect.objectContaining({
        listId: "nx7b79ahee74yeq64gtx2wxbr1879rnv",
      })
    );
  });

  it("rejects scoped List refs before searching tasks", async () => {
    searchTasksCommand.setOptionValue("list", "OTHER/SPRINT-1");
    Reflect.set(searchTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await expect(
      Reflect.get(searchTasksCommand, "_actionHandler").call(searchTasksCommand, [
        "billing bug",
      ])
    ).rejects.toThrow(/Cross-project List refs/);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects conflicting assignee filters", async () => {
    searchTasksCommand.setOptionValue("assigneeId", "user_123");
    searchTasksCommand.setOptionValue("unassigned", true);
    Reflect.set(searchTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await expect(
      Reflect.get(searchTasksCommand, "_actionHandler").call(searchTasksCommand, [
        "billing bug",
      ])
    ).rejects.toThrow(/Cannot use --assignee-id and --unassigned together/);
  });
});
