import { describe, expect, test } from "vitest";
import {
  appRoute,
  href,
  isOrganizationSettingsSection,
  isProjectSettingsSection,
  ORGANIZATION_SETTINGS_SECTION_LABELS,
  ORGANIZATION_SETTINGS_SECTIONS,
  isNewThreadComposerTarget,
  parseWorktreeChangesTarget,
} from "@/lib/navigation";

describe("appRoute", () => {
  test("builds a task page route from the ref alone", () => {
    expect(href(appRoute.task("acme", "WEB-7"))).toBe("/o/acme/WEB?task=WEB-7");
  });

  test("builds the project pull request routes", () => {
    expect(href(appRoute.projectPullRequests("acme", "WEB"))).toBe("/o/acme/WEB/pull-requests");
    expect(href(appRoute.projectPullRequest("acme", "WEB", "repo_1", 42))).toBe(
      "/o/acme/WEB/pull-requests?repo=repo_1&pr=42"
    );
    expect(href(appRoute.projectPullRequest("acme", "WEB", "repo_1", 42, "diff"))).toBe(
      "/o/acme/WEB/pull-requests?repo=repo_1&pr=42&tab=diff"
    );
    expect(href(appRoute.projectGithubIntegration("acme", "WEB"))).toBe("/o/acme/WEB/settings/integrations/github");
    expect(href(appRoute.projectGithubIntegration("acme", "WEB", "setup_1"))).toBe(
      "/o/acme/WEB/settings/integrations/github?setup=setup_1"
    );
  });

  test("builds organization settings routes", () => {
    expect(href(appRoute.organizationSettings("acme", "general"))).toBe(
      "/o/acme/settings/general"
    );
    expect(href(appRoute.organizationSettings("acme", "members"))).toBe(
      "/o/acme/settings/members"
    );
    expect(href(appRoute.organizationSettings("acme", "prompts"))).toBe(
      "/o/acme/settings/prompts"
    );
    expect(href(appRoute.organizationPrompts("acme"))).toBe(
      "/o/acme/settings/prompts"
    );
    expect(href(appRoute.organizationPromptNew("acme"))).toBe(
      "/o/acme/settings/prompts/new"
    );
    expect(href(appRoute.organizationSkills("acme"))).toBe(
      "/o/acme/settings/skills"
    );
    expect(href(appRoute.organizationSkillNew("acme"))).toBe(
      "/o/acme/settings/skills/new"
    );
    expect(href(appRoute.organizationSkillDetail("acme", "skill_1"))).toBe(
      "/o/acme/settings/skills/skill_1"
    );
    expect(href(appRoute.organizationPromptDetail("acme", "cmd_1"))).toBe(
      "/o/acme/settings/prompts/cmd_1"
    );
    expect(href(appRoute.organizationProjects("acme"))).toBe(
      "/o/acme/settings/projects"
    );
    expect(href(appRoute.organizationProjectDetail("acme", "p_1"))).toBe(
      "/o/acme/settings/projects/p_1"
    );
    expect(href(appRoute.organizationAgents("acme"))).toBe(
      "/o/acme/settings/agents"
    );
    expect(href(appRoute.organizationAgentNew("acme"))).toBe(
      "/o/acme/settings/agents/new"
    );
    expect(href(appRoute.organizationAgentDetail("acme", "agent_1"))).toBe(
      "/o/acme/settings/agents/agent_1"
    );
  });

  test("builds the worktree changes view route", () => {
    expect(
      href(
        appRoute.projectThreadsWithPreselection("acme", "app", {
          profileId: "profile_1",
          pathId: "path_1",
          view: "changes",
        })
      )
    ).toBe("/o/acme/app/threads?profileId=profile_1&pathId=path_1&view=changes");
  });

  test("parses the worktree changes target from the threads search", () => {
    expect(parseWorktreeChangesTarget("?view=changes&profileId=profile_1&pathId=path_1")).toEqual({
      profileId: "profile_1",
      pathId: "path_1",
      view: "changes",
      commit: null,
      repo: null,
    });
    expect(parseWorktreeChangesTarget("?profileId=profile_1&pathId=path_1")).toBeNull();
    expect(parseWorktreeChangesTarget("?view=changes&profileId=profile_1")).toBeNull();
    expect(parseWorktreeChangesTarget("")).toBeNull();
  });

  test("a multi-repo folder's page carries the repo it shows", () => {
    const route = href(
      appRoute.projectThreadsWithPreselection("acme", "app", { profileId: "profile_1", pathId: "folder", repo: "repo_1", view: "history" })
    );
    expect(route).toBe("/o/acme/app/threads?profileId=profile_1&pathId=folder&repo=repo_1&view=history");
    expect(parseWorktreeChangesTarget(route.split("?")[1])?.repo).toBe("repo_1");
  });

  test("the History tab and its open commit live in the URL (OS-2534 UX review)", () => {
    const search = href(
      appRoute.projectThreadsWithPreselection("acme", "app", {
        profileId: "profile_1",
        pathId: "path_1",
        view: "history",
        commit: "a".repeat(40),
      })
    ).split("?")[1];
    expect(search).toBe(`profileId=profile_1&pathId=path_1&view=history&commit=${"a".repeat(40)}`);
    expect(parseWorktreeChangesTarget(`?${search}`)).toEqual({
      profileId: "profile_1",
      pathId: "path_1",
      view: "history",
      commit: "a".repeat(40),
      repo: null,
    });
    expect(isNewThreadComposerTarget(`?${search}`)).toBe(false);
  });

  test("treats ?new=1 and an agent preselection as the new-thread composer, not the changes view", () => {
    expect(isNewThreadComposerTarget("?new=1")).toBe(true);
    expect(isNewThreadComposerTarget("?profileId=profile_1&pathId=path_1")).toBe(true);
    expect(isNewThreadComposerTarget("?view=changes&profileId=profile_1&pathId=path_1")).toBe(false);
    expect(isNewThreadComposerTarget("")).toBe(false);
  });

  test("builds project workflow routes", () => {
    expect(href(appRoute.projectSettings("acme", "app", "workflows"))).toBe(
      "/o/acme/app/settings/workflows"
    );
    expect(href(appRoute.projectWorkflowNew("acme", "app"))).toBe(
      "/o/acme/app/settings/workflows/new"
    );
    expect(href(appRoute.projectWorkflowDetail("acme", "app", "wf_1"))).toBe(
      "/o/acme/app/settings/workflows/wf_1"
    );
  });

  test("exposes canonical organization settings sections", () => {
    expect(ORGANIZATION_SETTINGS_SECTIONS).toEqual([
      "general",
      "members",
      "projects",
      "prompts",
      "agents",
      "skills",
    ]);
    expect(ORGANIZATION_SETTINGS_SECTION_LABELS.general).toBe("General");
    expect(ORGANIZATION_SETTINGS_SECTION_LABELS.members).toBe("Members");
    expect(ORGANIZATION_SETTINGS_SECTION_LABELS.projects).toBe("Projects");
    expect(ORGANIZATION_SETTINGS_SECTION_LABELS.prompts).toBe("Prompts");
    expect(ORGANIZATION_SETTINGS_SECTION_LABELS.agents).toBe("Agents");
    expect(ORGANIZATION_SETTINGS_SECTION_LABELS.skills).toBe("Skills");
    expect(isOrganizationSettingsSection("general")).toBe(true);
    expect(isOrganizationSettingsSection("members")).toBe(true);
    expect(isOrganizationSettingsSection("projects")).toBe(true);
    expect(isOrganizationSettingsSection("prompts")).toBe(true);
    expect(isOrganizationSettingsSection("agents")).toBe(true);
    expect(isOrganizationSettingsSection("skills")).toBe(true);
    expect(isOrganizationSettingsSection("billing")).toBe(false);
  });

  test("rejects the removed project Notifications section", () => {
    expect(isProjectSettingsSection("notifications")).toBe(false);
  });
});
