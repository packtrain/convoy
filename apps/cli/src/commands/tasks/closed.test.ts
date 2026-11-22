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
import { closedTasksCommand } from "./closed.js";

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

const closedTask = {
  _id: "task_1",
  refId: "WEB-7",
  name: "Ship it",
  status: "Done",
  priority: "High",
  closedAt: Date.UTC(2026, 10, 3, 15),
};

describe("tasks closed command", () => {
  const query = vi.fn();
  const log = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(log);
    resetCommandOptions(closedTasksCommand);
    Reflect.set(closedTasksCommand, "optsWithGlobals", () => ({ project: "WEB" }));
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce([closedTask]);

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: { query, mutation: vi.fn(), subscribe: vi.fn(), close: vi.fn(), client: {} as never },
        config: { convexUrl: "https://example.convex.cloud", apiKey: "sk_user_test", projectId: undefined },
      });
    });
  });

  const run = () => Reflect.get(closedTasksCommand, "_actionHandler").call(closedTasksCommand, []);

  it("passes status, limit and parsed ISO bounds to listClosed", async () => {
    closedTasksCommand.setOptionValue("status", "Canceled");
    closedTasksCommand.setOptionValue("limit", "5");
    closedTasksCommand.setOptionValue("since", "2026-11-01");
    closedTasksCommand.setOptionValue("until", "2026-12-01T00:00:00Z");
    closedTasksCommand.setOptionValue("json", true);

    await run();

    expect(query).toHaveBeenCalledWith(api.tasks.core.listClosed, {
      projectId: "proj_web_1",
      status: "Canceled",
      limit: 5,
      since: Date.UTC(2026, 10, 1),
      until: Date.UTC(2026, 11, 1),
    });
  });

  it("prints the UTC closed date before each summary line", async () => {
    await run();

    expect(query).toHaveBeenCalledWith(api.tasks.core.listClosed, { projectId: "proj_web_1" });
    expect(log.mock.calls.flat().join("\n")).toContain("2026-11-03  WEB-7");
  });

  it("rejects an unparseable --since before querying tasks", async () => {
    closedTasksCommand.setOptionValue("since", "last week");

    await expect(run()).rejects.toThrow(/--since/);
    expect(query).not.toHaveBeenCalledWith(api.tasks.core.listClosed, expect.anything());
  });
});
