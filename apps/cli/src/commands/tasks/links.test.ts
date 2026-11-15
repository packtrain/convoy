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
import { deleteTaskLinkCommand, upsertTaskLinkCommand } from "./links.js";

function makeClientContext(mutation: ReturnType<typeof vi.fn>) {
  return {
    client: {
      query: vi.fn(),
      mutation,
      subscribe: vi.fn(),
      close: vi.fn(),
      client: {} as never,
    },
    config: {
      convexUrl: "https://example.convex.cloud",
      apiKey: "sk_user_test",
      projectId: "proj_default",
    },
  };
}

describe("tasks links upsert command", () => {
  const mutation = vi.fn();

  function resetCommandOptions(): void {
    upsertTaskLinkCommand.setOptionValue("json", true);
    upsertTaskLinkCommand.setOptionValue("output", undefined);
    upsertTaskLinkCommand.setOptionValue("id", undefined);
    upsertTaskLinkCommand.setOptionValue("kind", undefined);
    upsertTaskLinkCommand.setOptionValue("sha", undefined);
    upsertTaskLinkCommand.setOptionValue("name", undefined);
    upsertTaskLinkCommand.setOptionValue("linkUrl", undefined);
    upsertTaskLinkCommand.setOptionValue("title", undefined);
    upsertTaskLinkCommand.setOptionValue("identifier", undefined);
    upsertTaskLinkCommand.setOptionValue("repo", undefined);
    upsertTaskLinkCommand.setOptionValue("branch", undefined);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions();

    mutation.mockResolvedValue({
      taskId: "task_1",
      externalLinks: [
        {
          id: "github-pr-acme-app-12",
          kind: "pull_request",
          url: "https://github.com/acme/app/pull/12",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run(makeClientContext(mutation));
    });
  });

  it("upserts a pull_request link", async () => {
    upsertTaskLinkCommand.setOptionValue("id", "github-pr-acme-app-12");
    upsertTaskLinkCommand.setOptionValue("kind", "pull_request");
    upsertTaskLinkCommand.setOptionValue("linkUrl", "https://github.com/acme/app/pull/12");
    upsertTaskLinkCommand.setOptionValue("title", "Add links");

    await Reflect.get(upsertTaskLinkCommand, "_actionHandler").call(
      upsertTaskLinkCommand,
      ["task_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.core.updateExternalLink, {
      taskId: "task_1",
      op: "upsert",
      id: "github-pr-acme-app-12",
      link: {
        kind: "pull_request",
        url: "https://github.com/acme/app/pull/12",
        title: "Add links",
      },
    });
  });

  it("upserts a commit link with sha", async () => {
    upsertTaskLinkCommand.setOptionValue("id", "commit-abcdef1");
    upsertTaskLinkCommand.setOptionValue("kind", "commit");
    upsertTaskLinkCommand.setOptionValue("sha", "abcdef1234");
    upsertTaskLinkCommand.setOptionValue("branch", "feature/links");

    await Reflect.get(upsertTaskLinkCommand, "_actionHandler").call(
      upsertTaskLinkCommand,
      ["task_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.core.updateExternalLink, {
      taskId: "task_1",
      op: "upsert",
      id: "commit-abcdef1",
      link: {
        kind: "commit",
        sha: "abcdef1234",
        branch: "feature/links",
      },
    });
  });

  it("rejects an unknown kind", async () => {
    upsertTaskLinkCommand.setOptionValue("id", "issue-1");
    upsertTaskLinkCommand.setOptionValue("kind", "issue");

    await expect(
      Reflect.get(upsertTaskLinkCommand, "_actionHandler").call(
        upsertTaskLinkCommand,
        ["task_1"]
      )
    ).rejects.toThrow("--kind is required and must be one of");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("requires --sha for commit kind", async () => {
    upsertTaskLinkCommand.setOptionValue("id", "commit-1");
    upsertTaskLinkCommand.setOptionValue("kind", "commit");

    await expect(
      Reflect.get(upsertTaskLinkCommand, "_actionHandler").call(
        upsertTaskLinkCommand,
        ["task_1"]
      )
    ).rejects.toThrow("--sha is required for --kind commit");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("requires --link-url for url kind", async () => {
    upsertTaskLinkCommand.setOptionValue("id", "url-1");
    upsertTaskLinkCommand.setOptionValue("kind", "url");

    await expect(
      Reflect.get(upsertTaskLinkCommand, "_actionHandler").call(
        upsertTaskLinkCommand,
        ["task_1"]
      )
    ).rejects.toThrow("--link-url is required for --kind url");
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe("tasks links delete command", () => {
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    mutation.mockResolvedValue({ taskId: "task_1", externalLinks: [] });

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run(makeClientContext(mutation));
    });
  });

  it("deletes a link by id", async () => {
    deleteTaskLinkCommand.setOptionValue("json", true);
    deleteTaskLinkCommand.setOptionValue("id", "github-pr-acme-app-12");

    await Reflect.get(deleteTaskLinkCommand, "_actionHandler").call(
      deleteTaskLinkCommand,
      ["task_1"]
    );

    expect(mutation).toHaveBeenCalledWith(api.tasks.core.updateExternalLink, {
      taskId: "task_1",
      op: "delete",
      id: "github-pr-acme-app-12",
    });
  });
});
