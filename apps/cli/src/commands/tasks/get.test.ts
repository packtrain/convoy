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

import { getTaskCommand } from "./get.js";

describe("tasks get command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    getTaskCommand.setOptionValue("comments", undefined);

    query
      .mockResolvedValueOnce({
        _id: "task_1",
        refId: "WEB-1",
        name: "Billing bug",
        status: "In Progress",
        priority: "High",
        assignee: { type: "user", userId: "user_9", name: "Alex", avatarUrl: null },
        delegatedToAgent: null,
        dueDate: null,
        tags: ["bug"],
        externalLinks: [
          {
            id: "github-pr-acme-app-12",
            kind: "pull_request",
            url: "https://github.com/acme/app/pull/12",
            title: "Add links",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        // Denormalized on the task, so `tasks get` already receives it (OS-636).
        agentThreadWork: [
          {
            threadId: "thread_mine",
            threadTitle: "Fix the billing race",
            userId: "user_9",
            userName: "Alex",
            cliType: "claude-code",
            status: "streaming",
            source: "manual_attachment",
            createdAt: 10,
            updatedAt: 30,
          },
          {
            threadId: "thread_theirs",
            threadTitle: "Investigate invoices",
            userId: "user_4",
            userName: "Sam",
            cliType: "codex",
            status: "completed",
            source: "assignment_automation",
            agentName: "Billing agent",
            createdAt: 5,
            updatedAt: 20,
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
          runId: "run_1",
          createdBy: "user_1",
          updatedBy: "user_1",
          createdAt: 1,
          updatedAt: 2,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          _id: "task_2",
          refId: "WEB-2",
          name: "Subtask",
          status: "To Do",
        },
      ]);

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
          projectId: "proj_default",
        },
      });
    });
  });

  /**
   * The threads are already on the task payload, so this is the whole feature: no
   * extra query, and it shows every user's runs — not just the caller's (OS-636).
   */
  it("resolves task refs before fetching the rich task", async () => {
    query.mockReset();
    query.mockResolvedValueOnce([])
      .mockResolvedValueOnce({ results: [{ task: { _id: "task_1" } }] })
      .mockResolvedValueOnce(null);
    await Reflect.get(getTaskCommand, "_actionHandler").call(getTaskCommand, ["WEB-1"]).catch(() => {});
    expect(query.mock.calls[0]?.[1]).toEqual({});
    expect(query.mock.calls[1]?.[1]).toEqual({ refs: ["WEB-1"], projectId: "proj_default" });
    expect(query.mock.calls[2]?.[1]).toEqual({ id: "task_1" });
  });

  it("prints agent thread work with a count and one row per run", async () => {
    getTaskCommand.setOptionValue("json", false);
    getTaskCommand.setOptionValue("output", "text");

    await Reflect.get(getTaskCommand, "_actionHandler").call(getTaskCommand, ["task_1"]);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("  Runs: 2");
    expect(output).toContain("Runs:");
    // Thread id included: it is what `get_thread` / `threads send` take next.
    expect(output).toContain("[streaming] Fix the billing race (thread_mine) claude-code Alex");
    // A teammate's run, and its bound agent name.
    expect(output).toContain("[completed] Investigate invoices (thread_theirs) codex Sam via Billing agent");
    // Newest activity first, like every other thread surface.
    expect(output.indexOf("thread_mine")).toBeLessThan(output.indexOf("thread_theirs"));
  });

  it("appends artifact summaries after the summary block in text mode", async () => {
    getTaskCommand.setOptionValue("json", false);
    getTaskCommand.setOptionValue("output", "text");

    await Reflect.get(getTaskCommand, "_actionHandler").call(getTaskCommand, ["task_1"]);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("  Links: 1");
    expect(output).toContain("Links:");
    expect(output).toContain(
      "[pull_request] Add links (github-pr-acme-app-12) https://github.com/acme/app/pull/12"
    );
    expect(output).toContain("Artifacts:");
    expect(output).toContain("Plan (artifact_1) [plan.md] runId=run_1");
    expect(output).not.toContain("Comments:");
    expect(output.indexOf("Subtasks:")).toBeLessThan(output.lastIndexOf("\nArtifacts:"));
    expect(
      query.mock.calls.some(
        ([, args]) =>
          typeof args === "object" &&
          args !== null &&
          Reflect.get(args, "paginationOpts") !== undefined
      )
    ).toBe(false);
  });

  it("keeps json output as artifact summaries without comments or content by default", async () => {
    getTaskCommand.setOptionValue("json", true);

    await Reflect.get(getTaskCommand, "_actionHandler").call(getTaskCommand, ["task_1"]);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(output).toContain("\"artifacts\"");
    expect(output).toContain("\"fileName\": \"plan.md\"");
    expect(output).not.toContain("\"comments\"");
    expect(output).not.toContain("\"commentsHasMore\"");
    expect(output).not.toContain("\"content\"");
  });

  it("includes latest comments when requested", async () => {
    getTaskCommand.setOptionValue("json", false);
    getTaskCommand.setOptionValue("output", "text");
    getTaskCommand.setOptionValue("comments", "3");
    query.mockReset();
    query
      .mockResolvedValueOnce({
        _id: "task_1",
        refId: "WEB-1",
        name: "Billing bug",
        status: "In Progress",
        priority: "High",
        assignee: { type: "user", userId: "user_9", name: "Alex", avatarUrl: null },
        delegatedToAgent: null,
        dueDate: null,
        tags: [],
        externalLinks: [],
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          _id: "task_2",
          refId: "WEB-2",
          name: "Subtask",
          status: "To Do",
        },
      ])
      .mockResolvedValueOnce({
        page: [
          {
            _id: "comment_1",
            _creationTime: 1,
            taskId: "task_1",
            authorId: "user_1",
            content: "First fix note\nSecond line",
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
        isDone: false,
        continueCursor: "next",
      });

    await Reflect.get(getTaskCommand, "_actionHandler").call(getTaskCommand, ["task_1"]);

    const output = vi.mocked(console.log).mock.calls.flatMap((call) => call).join("\n");
    expect(query.mock.calls).toContainEqual([
      expect.anything(),
      {
        taskId: "task_1",
        paginationOpts: {
          numItems: 3,
          cursor: null,
        },
      },
    ]);
    expect(output).toContain("  Comments: 1+");
    expect(output).toContain("Comments (showing latest 1; more available):");
    expect(output).toContain("Alex");
    expect(output).toContain("First fix note Second line");
    expect(output).not.toContain("First fix note\nSecond line");
  });

  it("rejects invalid comments limits", async () => {
    getTaskCommand.setOptionValue("comments", "51");

    await expect(
      Reflect.get(getTaskCommand, "_actionHandler").call(getTaskCommand, ["task_1"])
    ).rejects.toThrow('Invalid comments limit "51". Use an integer from 1 to 50.');
  });
});
