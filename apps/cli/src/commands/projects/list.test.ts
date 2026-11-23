import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

const { runOneShotCommandMock } = vi.hoisted(() => ({
  runOneShotCommandMock: vi.fn(),
}));

vi.mock("../../lib/one-shot-command.js", () => ({
  runOneShotCommand: runOneShotCommandMock,
}));

vi.mock("../../cli.js", () => ({
  addGlobalOptions: <T>(cmd: T) => cmd,
}));

import { resetCommandOptions } from "../test-helpers.js";
import { listProjectsCommand } from "./list.js";

const project = (alias: string, isArchived: boolean) => ({
  _id: `proj_${alias}`,
  name: alias,
  alias,
  isArchived,
  organizationId: "org_acme",
  organizationName: "Acme",
  organizationSlug: "acme",
  role: { name: "member", permissions: [] },
});

async function listAliases(args: string[]) {
  await listProjectsCommand.parseAsync(["node", "list", "--json", ...args]);
  const json = vi.mocked(console.log).mock.calls.at(-1)?.[0] as string;
  return (JSON.parse(json) as { alias: string }[]).map((row) => row.alias);
}

describe("projects list", () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(listProjectsCommand as Command);
    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({ client: { query }, config: {} });
    });
    query.mockResolvedValue([project("WEB", false), project("OLD", true)]);
  });

  it("leaves archived projects out by default", async () => {
    expect(await listAliases([])).toEqual(["WEB"]);
  });

  it("lists only archived projects with --archived", async () => {
    expect(await listAliases(["--archived"])).toEqual(["OLD"]);
  });
});
