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

import { refsTasksCommand } from "./refs.js";

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

describe("tasks refs command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    refsTasksCommand.setOptionValue("json", false);
    refsTasksCommand.setOptionValue("output", "text");
    refsTasksCommand.setOptionValue("comments", undefined);

    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        results: [
          {
            ref: "WEB-1",
            error: null,
            task: {
              _id: "task_1",
              refId: "WEB-1",
              name: "Billing bug",
              status: "In Progress",
              priority: "High",
            },
          },
          {
            ref: "WEB-999",
            error: "Not found",
            task: null,
          },
        ],
      })
      .mockResolvedValueOnce([
        {
          _id: "artifact_1",
          _creationTime: 1,
          taskId: "task_1",
          name: "Plan",
          fileName: "plan.md",
          source: "user",
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 1,
          updatedAt: 2,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

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

    Reflect.set(refsTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));
  });

  it("keeps compact matches and appends artifact detail sections", async () => {
    await Reflect.get(refsTasksCommand, "_actionHandler").call(refsTasksCommand, [["WEB-1"]]);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("Matches:");
    expect(output).toContain("Artifact details:");
    expect(output).toContain("WEB-1 Billing bug");
    expect(output).toContain("Plan (artifact_1) [plan.md]");
    expect(output).not.toContain("Comments:");
    expect(output.indexOf("Matches:")).toBeLessThan(output.indexOf("Artifact details:"));
    expect(
      query.mock.calls.some(
        ([, args]) =>
          typeof args === "object" &&
          args !== null &&
          Reflect.get(args, "paginationOpts") !== undefined
      )
    ).toBe(false);
  });

  it("keeps json output on the existing rich-task shape without comments by default", async () => {
    refsTasksCommand.setOptionValue("json", true);

    await Reflect.get(refsTasksCommand, "_actionHandler").call(refsTasksCommand, [["WEB-1"]]);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("\"artifacts\"");
    expect(output).toContain("\"fileName\": \"plan.md\"");
    expect(output).not.toContain("\"comments\"");
    expect(output).not.toContain("\"commentsHasMore\"");
    expect(output).not.toContain("\"content\"");
  });

  it("includes latest comments for matched refs when requested", async () => {
    refsTasksCommand.setOptionValue("comments", "2");
    query.mockReset();
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce({
        results: [
          {
            ref: "WEB-1",
            error: null,
            task: {
              _id: "task_1",
              refId: "WEB-1",
              name: "Billing bug",
              status: "In Progress",
              priority: "High",
            },
          },
          {
            ref: "WEB-999",
            error: "Not found",
            task: null,
          },
        ],
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        page: [
          {
            _id: "comment_1",
            _creationTime: 1,
            taskId: "task_1",
            authorId: "user_1",
            content: "Latest context\nWith details",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
            isEdited: false,
            authorName: "Alex",
            authorAvatarUrl: null,
            attachments: [],
            canEdit: true,
            canDelete: true,
          },
        ],
        isDone: true,
        continueCursor: null,
      });

    await Reflect.get(refsTasksCommand, "_actionHandler").call(refsTasksCommand, [["WEB-1"]]);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(query.mock.calls).toContainEqual([
      expect.anything(),
      {
        taskId: "task_1",
        paginationOpts: {
          numItems: 2,
          cursor: null,
        },
      },
    ]);
    expect(output).toContain("Comments:");
    expect(output).toContain("WEB-1 Billing bug (showing latest 1)");
    expect(output).toContain("Latest context With details");
    expect(output).not.toContain("Latest context\nWith details");
  });
});
