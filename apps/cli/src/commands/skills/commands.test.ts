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
import { listSkillsCommand } from "./list.js";
import { showSkillCommand } from "./show.js";
import { createSkillCommand } from "./create.js";
import { installSkillCommand } from "./install.js";
import { updateSkillCommand } from "./update.js";
import { removeSkillCommand } from "./remove.js";

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

const skills = [
  {
    _id: "skill_pdf",
    scope: "organization",
    name: "pdf-tools",
    normalizedName: "pdf-tools",
    description: "Fill and read PDFs",
    category: "Docs",
    version: 3,
  },
];

function invoke(command: Command, args: unknown[] = [], globals: Record<string, unknown> = { project: "WEB" }) {
  Reflect.set(command, "optsWithGlobals", () => globals);
  return Reflect.get(command, "_actionHandler").call(command, args);
}

describe("skills commands", () => {
  const query = vi.fn();
  const mutation = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const command of [
      listSkillsCommand,
      showSkillCommand,
      createSkillCommand,
      installSkillCommand,
      updateSkillCommand,
      removeSkillCommand,
    ]) {
      resetCommandOptions(command);
    }

    runOneShotCommandMock.mockImplementation(async (_cmd, run) => {
      await run({
        client: {
          query,
          mutation,
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

  it("lists the resolved project's skills by default", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(skills);

    await invoke(listSkillsCommand);

    expect(query).toHaveBeenCalledWith(api.skills.core.listByProject, {
      projectId: "proj_web_1",
    });
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("/pdf-tools");
    expect(output).toContain("v3");
  });

  it("lists skills in the organization named by --org at organization scope", async () => {
    query.mockResolvedValueOnce({ _id: "org_other", slug: "other" }).mockResolvedValueOnce([]);
    listSkillsCommand.setOptionValue("scope", "organization");
    listSkillsCommand.setOptionValue("org", "other");

    await invoke(listSkillsCommand);

    expect(query).toHaveBeenCalledWith(api.skills.core.listByOrganization, {
      organizationId: "org_other",
    });
  });

  it("names --org when neither an organization nor a project can be resolved", async () => {
    listSkillsCommand.setOptionValue("scope", "organization");

    await expect(invoke(listSkillsCommand, [], {})).rejects.toThrow("Pass --org <orgId|orgSlug>");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an unknown organization", async () => {
    query.mockResolvedValueOnce(null);
    listSkillsCommand.setOptionValue("scope", "organization");
    listSkillsCommand.setOptionValue("org", "nope");

    await expect(invoke(listSkillsCommand)).rejects.toThrow('Organization "nope" was not found');
  });

  it("rejects an invalid scope", async () => {
    listSkillsCommand.setOptionValue("scope", "personal");

    await expect(invoke(listSkillsCommand)).rejects.toThrow("Scope must be one of: project, organization");
  });

  it("shows a skill with its SKILL.md and file paths", async () => {
    query.mockResolvedValueOnce({
      ...skills[0],
      updatedAt: 0,
      skillMd: "# PDF tools",
      files: [{ path: "references/fields.md", content: "# Fields" }],
    });

    await invoke(showSkillCommand, ["skill_pdf"]);

    expect(query).toHaveBeenCalledWith(api.skills.core.get, { skillId: "skill_pdf" });
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("# PDF tools");
    expect(output).toContain("references/fields.md");
  });

  it("fails when the skill is not accessible", async () => {
    query.mockResolvedValueOnce(null);

    await expect(invoke(showSkillCommand, ["skill_pdf"])).rejects.toThrow("Skill not found");
  });

  it("creates a skill in the resolved project by default", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("skill_new");
    createSkillCommand.setOptionValue("name", "pdf-tools");
    createSkillCommand.setOptionValue("content", "# PDF tools");
    createSkillCommand.setOptionValue("category", "Docs");

    await invoke(createSkillCommand);

    expect(mutation).toHaveBeenCalledWith(api.skills.core.createInProject, {
      projectId: "proj_web_1",
      name: "pdf-tools",
      content: "# PDF tools",
      category: "Docs",
    });
  });

  it("creates an organization skill at organization scope", async () => {
    query.mockResolvedValueOnce(accessibleProjects);
    mutation.mockResolvedValueOnce("skill_new");
    createSkillCommand.setOptionValue("scope", "organization");
    createSkillCommand.setOptionValue("name", "pdf-tools");
    createSkillCommand.setOptionValue("content", "# PDF tools");

    await invoke(createSkillCommand);

    expect(mutation).toHaveBeenCalledWith(api.skills.core.createInOrganization, {
      organizationId: "org_acme",
      name: "pdf-tools",
      content: "# PDF tools",
    });
  });

  it("requires content on create", async () => {
    createSkillCommand.setOptionValue("name", "pdf-tools");

    await expect(invoke(createSkillCommand)).rejects.toThrow("Pass --content or --content-file.");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("updates a skill and clears the category", async () => {
    mutation.mockResolvedValueOnce(null);
    updateSkillCommand.setOptionValue("name", "pdf-forms");
    updateSkillCommand.setOptionValue("clearCategory", true);

    await invoke(updateSkillCommand, ["skill_pdf"]);

    expect(mutation).toHaveBeenCalledWith(api.skills.core.update, {
      skillId: "skill_pdf",
      name: "pdf-forms",
      category: null,
    });
  });

  it("rejects --content together with --content-file", async () => {
    updateSkillCommand.setOptionValue("content", "# PDF tools");
    updateSkillCommand.setOptionValue("contentFile", "./SKILL.md");

    await expect(invoke(updateSkillCommand, ["skill_pdf"])).rejects.toThrow("Cannot use --content and --content-file together");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects an update with no fields", async () => {
    await expect(invoke(updateSkillCommand, ["skill_pdf"])).rejects.toThrow("No updates provided");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("installs an organization skill into the resolved project", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(skills);
    mutation.mockResolvedValueOnce("skill_copy");

    // A Skill is named, not identified, on the way in — the same vocabulary an
    // agent uses, in the `/name` form every surface renders (docs/specs/skills.md#cli).
    await invoke(installSkillCommand, ["/PDF-Tools "]);

    expect(query).toHaveBeenCalledWith(api.skills.core.listByOrganization, { organizationId: "org_acme" });
    expect(mutation).toHaveBeenCalledWith(api.skills.core.copyFromSkill, {
      projectId: "proj_web_1",
      skillId: "skill_pdf",
    });
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("/pdf-tools");
  });

  it("takes --org to disambiguate a project alias shared by two organizations", async () => {
    const duplicateAlias = [
      accessibleProjects[0],
      { ...accessibleProjects[0], _id: "proj_web_2", organizationId: "org_other", organizationSlug: "other", organizationName: "Other" },
    ];
    query.mockResolvedValueOnce(duplicateAlias).mockResolvedValueOnce(skills);
    mutation.mockResolvedValueOnce("skill_copy");
    installSkillCommand.setOptionValue("org", "other");

    await invoke(installSkillCommand, ["pdf-tools"]);

    expect(query).toHaveBeenCalledWith(api.skills.core.listByOrganization, { organizationId: "org_other" });
    expect(mutation).toHaveBeenCalledWith(api.skills.core.copyFromSkill, {
      projectId: "proj_web_2",
      skillId: "skill_pdf",
    });
  });

  it("names the organization list when no template matches", async () => {
    query.mockResolvedValueOnce(accessibleProjects).mockResolvedValueOnce(skills);

    await expect(invoke(installSkillCommand, ["missing"])).rejects.toThrow('Organization skill "missing" was not found');
    expect(mutation).not.toHaveBeenCalled();
  });

  it("removes a skill", async () => {
    mutation.mockResolvedValueOnce(null);

    await invoke(removeSkillCommand, ["skill_pdf"]);

    expect(mutation).toHaveBeenCalledWith(api.skills.core.deleteSkill, { skillId: "skill_pdf" });
  });
});
