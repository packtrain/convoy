import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

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
import { listThreadsCommand } from "./list.js";
import { getThreadCommand } from "./get.js";
import { listThreadMessagesCommand } from "./messages.js";

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

const containerRow = {
  threadId: "thr_group",
  title: "Billing review",
  isDone: false,
  createdAt: 1,
  lastActivityAt: 5,
  kind: "group",
  childCount: 2,
  aggregateStatus: "running",
};

const threadRow = {
  threadId: "thr_1",
  title: "Fix billing",
  isDone: false,
  createdAt: 1,
  lastActivityAt: 4,
  status: "streaming",
  profileId: "prof_1",
  pathId: "path_1",
  path: "~/src/app",
  cliType: "claude",
  profileName: "macbook",
  targetOnline: true,
};

function invoke(cmd: Command, args: unknown[] = []): Promise<void> {
  Reflect.set(cmd, "optsWithGlobals", () => ({ project: "WEB" }));
  return Reflect.get(cmd, "_actionHandler").call(cmd, args);
}

describe("threads commands", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(listThreadsCommand);
    resetCommandOptions(getThreadCommand);
    resetCommandOptions(listThreadMessagesCommand);

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

  describe("threads list", () => {
    it("lists the project's threads, showing a group as one row with its child count", async () => {
      query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce({
        page: [containerRow, threadRow],
        isDone: false,
        continueCursor: "cursor_next",
      });

      await invoke(listThreadsCommand, [undefined]);

      expect(query).toHaveBeenCalledWith(api.cli.threads.summaries.listSummaries, {
        projectId: "proj_web_1",
        includeDone: false,
        paginationOpts: { numItems: 20, cursor: null },
      });

      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).toContain("thr_group");
      expect(output).toContain("Billing review");
      expect(output).toContain("2 children");
      expect(output).toContain("running");
      expect(output).toContain("thr_1");
      expect(output).toContain("streaming");
      expect(output).toContain("macbook");
      expect(output).toContain("convoy threads list");
      expect(output).toContain("--cursor 'cursor_next'");
    });

    it("drills into a group without resolving a project", async () => {
      query.mockResolvedValueOnce([threadRow]);

      await invoke(listThreadsCommand, ["thr_group"]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(api.cli.threads.summaries.listGroupSummaries, {
        parentThreadId: "thr_group",
        includeDone: false,
      });

      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).toContain("thr_1");
      expect(output).not.toContain("Next page");
    });

    it("passes --include-done and pagination through to the flat list", async () => {
      query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce({
        page: [],
        isDone: true,
        continueCursor: "",
      });
      listThreadsCommand.setOptionValue("includeDone", true);
      listThreadsCommand.setOptionValue("limit", "5");
      listThreadsCommand.setOptionValue("cursor", "cursor_1");

      await invoke(listThreadsCommand, [undefined]);

      expect(query).toHaveBeenCalledWith(api.cli.threads.summaries.listSummaries, {
        projectId: "proj_web_1",
        includeDone: true,
        paginationOpts: { numItems: 5, cursor: "cursor_1" },
      });
    });

    it("lists background threads with --background and keeps the flag in the next-page command (OS-2513)", async () => {
      query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce({
        page: [threadRow],
        isDone: false,
        continueCursor: "cursor_next",
      });
      listThreadsCommand.setOptionValue("background", true);

      await invoke(listThreadsCommand, [undefined]);

      expect(query).toHaveBeenCalledWith(api.cli.threads.summaries.listSummaries, {
        projectId: "proj_web_1",
        includeDone: false,
        background: true,
        paginationOpts: { numItems: 20, cursor: null },
      });
      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).toContain("--background --cursor 'cursor_next'");
    });

    it("wraps the drill-down in the same page envelope in json mode", async () => {
      query.mockResolvedValueOnce([threadRow]);
      listThreadsCommand.setOptionValue("json", true);

      await invoke(listThreadsCommand, ["thr_group"]);

      const output = vi.mocked(console.log).mock.calls.at(-1)?.[0];
      expect(JSON.parse(String(output))).toEqual({
        page: [threadRow],
        isDone: true,
        continueCursor: "",
      });
    });
  });

  describe("threads get", () => {
    it("prints the runtime target for an ordinary thread", async () => {
      query.mockResolvedValueOnce(threadRow);

      await invoke(getThreadCommand, ["thr_1"]);

      expect(query).toHaveBeenCalledWith(api.cli.threads.summaries.getSummary, {
        threadId: "thr_1",
      });

      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).toContain("Fix billing");
      expect(output).toContain("streaming");
      expect(output).toContain("claude");
      expect(output).toContain("macbook");
      expect(output).toContain("~/src/app");
      expect(output).toContain("online");
    });

    it("prints container metadata instead of a target for a group", async () => {
      query.mockResolvedValueOnce(containerRow);

      await invoke(getThreadCommand, ["thr_group"]);

      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).toContain("Billing review");
      expect(output).toContain("group");
      expect(output).toContain("Children: 2");
      expect(output).toContain("running");
      // A container has no runtime target, and reporting "Unknown" would read as one.
      expect(output).not.toContain("Profile:");
      expect(output).not.toContain("Path:");
    });

    it("fails when the thread is not readable", async () => {
      query.mockResolvedValueOnce(null);

      await expect(invoke(getThreadCommand, ["thr_missing"])).rejects.toThrow(
        "Thread not found"
      );
    });
  });

  describe("threads messages", () => {
    const messages = [
      {
        messageId: "msg_1",
        role: "user",
        status: "completed",
        createdAt: 1,
        text: "Fix the invoice rounding",
      },
      {
        messageId: "msg_2",
        role: "assistant",
        status: "completed",
        createdAt: 2,
        text: "Fixed in billing.ts",
        truncated: true,
      },
    ];

    it("respects --limit and prints the window newest-last", async () => {
      query.mockResolvedValueOnce(messages);
      listThreadMessagesCommand.setOptionValue("limit", "5");

      await invoke(listThreadMessagesCommand, ["thr_1"]);

      expect(query).toHaveBeenCalledWith(api.cli.messages.listRecentSummaries, {
        threadId: "thr_1",
        limit: 5,
      });

      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      // The query returns conversation order; printing must not reverse it.
      expect(output.indexOf("Fix the invoice rounding")).toBeLessThan(
        output.indexOf("Fixed in billing.ts")
      );
      expect(output).toContain("user");
      expect(output).toContain("assistant");
      expect(output).toContain("truncated");
    });

    it("omits limit when not given, leaving the query's default", async () => {
      query.mockResolvedValueOnce([]);

      await invoke(listThreadMessagesCommand, ["thr_1"]);

      expect(query).toHaveBeenCalledWith(api.cli.messages.listRecentSummaries, {
        threadId: "thr_1",
      });
    });

    it("rejects a limit above the ceiling instead of silently reading fewer", async () => {
      listThreadMessagesCommand.setOptionValue("limit", "50");

      await expect(invoke(listThreadMessagesCommand, ["thr_1"])).rejects.toThrow(
        "1 to 20"
      );
      expect(query).not.toHaveBeenCalled();
    });
  });
});
