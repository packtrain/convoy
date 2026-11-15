import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { resolveSetupProject, validateProjectSelection } from "./resolution.js";
import type { ConvoyClient } from "../../lib/config/convex-client.js";
vi.mock("./prompts.js", () => ({ promptProjectSelect: vi.fn().mockResolvedValue("__create__") }));
vi.mock("@inquirer/prompts", () => ({ input: vi.fn(), select: vi.fn() }));
const options = { create: true, org: "acme", projectName: "First", projectAlias: "first" };
const query = vi.fn();
const mutation = vi.fn();
const client = { query, mutation } as unknown as ConvoyClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mutation.mockResolvedValue("project-new");
  query.mockImplementation(async (ref) => {
    switch (getFunctionName(ref)) {
      case "projects/core:listAccessible":
        return [];
      case "apiKeys/core:currentScope":
        return { kind: "unscoped" };
      case "organizations/core:listForUser":
        return [{ _id: "org", name: "Acme", slug: "acme" }];
    }
  });
});
describe("pick or create", () => {
  it("creates in an organization with no projects and reports recovery identity", async () => {
    expect(await resolveSetupProject(client, options, false)).toMatchObject({ _id: "project-new", alias: "FIRST", organizationId: "org" });
    expect(mutation).toHaveBeenCalledWith(expect.anything(), { organizationId: "org", name: "First", alias: "FIRST" });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("--project project-new instead of --create"));
  });
  it("does not replay uncertain creation", async () => {
    mutation.mockRejectedValue(new Error("connection lost"));
    await expect(resolveSetupProject(client, options, false)).rejects.toThrow("Check Convoy for FIRST");
    expect(mutation).toHaveBeenCalledOnce();
  });
  it("does not silently reuse an alias conflict", async () => {
    await expect(
      resolveSetupProject(client, options, false, [
        { _id: "existing", alias: "FIRST", name: "Existing", organizationId: "org", organizationName: "Acme" },
      ])
    ).rejects.toThrow("--project");
    expect(mutation).not.toHaveBeenCalled();
  });
  it.each([
    { create: true, project: "existing" },
    { create: true },
    { projectName: "oops" },
    { ...options, projectAlias: "TOO-LONG" },
    { ...options, projectName: " " },
  ])("rejects incomplete or conflicting inputs before remote work: %j", async (invalid) => {
    await expect(resolveSetupProject(client, invalid, false)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });
  it("rejects project-scoped creation keys", async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce({ kind: "organization", organizationId: "org", projectIds: ["existing"] });
    await expect(resolveSetupProject(client, options, false)).rejects.toThrow("organization-wide");
    expect(mutation).not.toHaveBeenCalled();
  });
  it("offers creation in the interactive project selector", async () => {
    const { promptProjectSelect } = await import("./prompts.js");
    expect(() => validateProjectSelection({}, true)).not.toThrow();
    const { select, input } = await import("@inquirer/prompts");
    vi.mocked(select).mockResolvedValue("org");
    vi.mocked(input).mockResolvedValueOnce("First").mockResolvedValueOnce("FIRST");
    await resolveSetupProject(client, {}, true);
    expect(promptProjectSelect).toHaveBeenCalledWith([], true);
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ message: "Organization:", loop: false }));
  });
});

it("defaults the project name to the profile key and suggests an editable alias", async () => {
  const { input } = await import("@inquirer/prompts");
  vi.mocked(input).mockImplementation(async (prompt) => prompt.default ?? "FALL");
  const result = await resolveSetupProject(client, { create: true, org: "acme", profileKey: "my-project" }, true);
  expect(input).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: "Project name:", default: "my-project" }));
  expect(input).toHaveBeenNthCalledWith(2, expect.objectContaining({ default: "MP" }));
  expect(result).toMatchObject({ name: "my-project", alias: "MP" });
});

it("uses the setup display name and derives the alias from the user's edited project name", async () => {
  const { input } = await import("@inquirer/prompts");
  vi.mocked(input).mockResolvedValueOnce("Different Project").mockResolvedValueOnce("ALT");
  expect(
    await resolveSetupProject(client, { create: true, org: "acme", profileName: "Display Name", profileKey: "key" }, true)
  ).toMatchObject({ name: "Different Project", alias: "ALT" });
  expect(input).toHaveBeenNthCalledWith(1, expect.objectContaining({ default: "Display Name" }));
  expect(input).toHaveBeenNthCalledWith(2, expect.objectContaining({ default: "DP" }));
});

it.each(["A", "123", "🎉", "one two three four five six"])("suggests a valid alias for %s", async (name) => {
  const { input } = await import("@inquirer/prompts");
  vi.mocked(input).mockImplementation(async (prompt) => prompt.default ?? "");
  const result = await resolveSetupProject(client, { create: true, org: "acme", projectName: name }, true);
  expect(result.alias).toMatch(/^[A-Z][A-Z0-9]{1,4}$/);
});
