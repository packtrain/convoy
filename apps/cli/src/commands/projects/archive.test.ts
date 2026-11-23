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

import { api } from "../../convex/_generated/api.js";
import { resetCommandOptions } from "../test-helpers.js";
import { archiveProjectCommand, unarchiveProjectCommand } from "./archive.js";

const accessibleProjects = [
  {
    _id: "proj_web",
    name: "Web",
    alias: "WEB",
    organizationId: "org_acme",
    organizationName: "Acme",
    organizationSlug: "acme",
    role: { name: "project-admin", permissions: ["*"] },
  },
];

function invoke(command: Command, args: unknown[]) {
  Reflect.set(command, "optsWithGlobals", () => ({}));
  return Reflect.get(command, "_actionHandler").call(command, args);
}

describe("projects archive/unarchive", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    resetCommandOptions(archiveProjectCommand);
    resetCommandOptions(unarchiveProjectCommand);
    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({ client: { query, mutation }, config: {} });
    });
    query.mockResolvedValue(accessibleProjects);
    mutation.mockResolvedValue(null);
  });

  it("archives the project named by alias", async () => {
    await invoke(archiveProjectCommand, ["web"]);

    expect(mutation).toHaveBeenCalledWith(api.projects.core.setArchived, { id: "proj_web", isArchived: true });
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("Archived WEB");
  });

  it("unarchives the project named by ID", async () => {
    await invoke(unarchiveProjectCommand, ["proj_web"]);

    expect(mutation).toHaveBeenCalledWith(api.projects.core.setArchived, { id: "proj_web", isArchived: false });
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("Unarchived WEB");
  });

  it("passes an unlisted project ID to the server, for org admins without membership", async () => {
    query.mockResolvedValue([]);

    await invoke(archiveProjectCommand, ["k17unlistedprojectid"]);

    expect(mutation).toHaveBeenCalledWith(api.projects.core.setArchived, { id: "k17unlistedprojectid", isArchived: true });
  });

  it("fails on an unknown project without calling the mutation", async () => {
    await expect(invoke(archiveProjectCommand, ["NOPE"])).rejects.toThrow('Project "NOPE" was not found');
    expect(mutation).not.toHaveBeenCalled();
  });
});
