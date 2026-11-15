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
import { listTaskTypesCommand } from "./list.js";

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

const taskTypes = [
  {
    key: "task",
    name: "Task",
    icon: "SquareCheckBig",
    color: "#64748b",
    isSystem: true,
  },
  {
    key: "bug",
    name: "Bug",
    icon: "Bug",
    color: "#ef4444",
    isSystem: true,
  },
];

describe("task-types list command", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(listTaskTypesCommand);
    Reflect.set(listTaskTypesCommand, "optsWithGlobals", () => ({
      project: "WEB",
    }));

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

  it("resolves the project and prints the canonical catalog", async () => {
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce(taskTypes);

    await Reflect.get(listTaskTypesCommand, "_actionHandler").call(
      listTaskTypesCommand,
      []
    );

    expect(query).toHaveBeenNthCalledWith(
      1,
      api.projects.core.listAccessible,
      {}
    );
    expect(query).toHaveBeenNthCalledWith(2, api.tasks.core.listTypes, {
      projectId: "proj_web_1",
    });
    const output = vi
      .mocked(console.log)
      .mock.calls.flatMap((call) => call)
      .join("\n");
    expect(output).toContain("task");
    expect(output).toContain("Bug");
  });

  it("emits strict JSON", async () => {
    query
      .mockResolvedValueOnce(accessibleProjects)
      .mockResolvedValueOnce(taskTypes);
    listTaskTypesCommand.setOptionValue("json", true);

    await Reflect.get(listTaskTypesCommand, "_actionHandler").call(
      listTaskTypesCommand,
      []
    );

    const output = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(JSON.parse(String(output))).toEqual(taskTypes);
  });
});
