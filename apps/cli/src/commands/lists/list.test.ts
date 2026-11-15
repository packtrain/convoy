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
import { listTaskListsCommand } from "./list.js";

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

describe("lists list command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(listTaskListsCommand);

    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        page: [
          {
            _id: "list_1",
            _creationTime: 1,
            projectId: "proj_web_1",
            name: "Sprint 1",
            ref: "SPRINT-1",
            isArchived: true,
            createdBy: "user_1",
            updatedBy: "user_1",
            createdAt: 1,
            updatedAt: 1,
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

  it("passes project, filters, and pagination to taskLists.list", async () => {
    listTaskListsCommand.setOptionValue("org", "acme");
    listTaskListsCommand.setOptionValue("archived", true);
    listTaskListsCommand.setOptionValue("query", "sprint");
    listTaskListsCommand.setOptionValue("limit", "5");
    listTaskListsCommand.setOptionValue("cursor", "cursor_1");
    Reflect.set(listTaskListsCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(listTaskListsCommand, "_actionHandler").call(
      listTaskListsCommand,
      []
    );

    expect(query).toHaveBeenNthCalledWith(1, api.projects.core.listAccessible, {});
    expect(query).toHaveBeenCalledWith(api.tasks.lists.list, {
      projectId: "proj_web_1",
      archived: true,
      query: "sprint",
      paginationOpts: {
        numItems: 5,
        cursor: "cursor_1",
      },
    });
  });

  it("prints List fields and next-page command in text mode", async () => {
    Reflect.set(listTaskListsCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(listTaskListsCommand, "_actionHandler").call(
      listTaskListsCommand,
      []
    );

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("SPRINT-1");
    expect(output).toContain("Sprint 1");
    expect(output).toContain("list_1");
    expect(output).toContain("archived");
    expect(output).toContain("convoy lists list");
    expect(output).toContain("--cursor 'cursor_next'");
  });

  it("preserves the paginated payload in json mode", async () => {
    listTaskListsCommand.setOptionValue("json", true);
    Reflect.set(listTaskListsCommand, "optsWithGlobals", () => ({ project: "WEB" }));

    await Reflect.get(listTaskListsCommand, "_actionHandler").call(
      listTaskListsCommand,
      []
    );

    const output = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(JSON.parse(String(output))).toMatchObject({
      page: [{ _id: "list_1", ref: "SPRINT-1", name: "Sprint 1", isArchived: true }],
      isDone: false,
      continueCursor: "cursor_next",
    });
  });
});
