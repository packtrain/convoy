import { NEW_THREAD_QUERY_PARAM } from "../threads/constants";
import { routeTarget, type RouteTarget } from "./target";

export const DOCS_BASE_URL = "https://docs.convoy.build";

export const externalRoutes = {
  docsCliSetupAndConnect: `${DOCS_BASE_URL}/docs/cli/setup-and-connect`,
  docsChecks: `${DOCS_BASE_URL}/docs/using/checks`,
} as const;

export interface ProjectThreadAgentContextParams {
  profileId?: string | null;
  pathId?: string | null;
}

export interface ProjectThreadPreselectionParams
  extends ProjectThreadAgentContextParams {
  task?: string | null;
  attachedTask?: string | null;
  /** `owner/name#number`: the new-thread composer starts with this PR attached (OS-2193). */
  attachedPr?: string | null;
  /** Opens the worktree page for the path instead of the composer: its Changes (OS-2036) or History (OS-2534) tab. */
  view?: WorktreeView | null;
  /** History tab: the open commit's full hash. */
  commit?: string | null;
}

export type WorktreeView = "changes" | "history";

export interface WorktreeChangesTarget {
  profileId: string;
  pathId: string;
  view: WorktreeView;
  commit: string | null;
}

/** `?view=changes|history&profileId&pathId[&commit]` on the threads page (OS-2036); null for every other search. */
export function parseWorktreeChangesTarget(search: string): WorktreeChangesTarget | null {
  const query = new URLSearchParams(search);
  const profileId = query.get("profileId");
  const pathId = query.get("pathId");
  const view = query.get("view");
  if ((view !== "changes" && view !== "history") || !profileId || !pathId) {
    return null;
  }
  return { profileId, pathId, view, commit: view === "history" ? query.get("commit") : null };
}

/** `?new=1`, or an agent preselection that is not the changes view: on mobile both open the composer full-screen. */
export function isNewThreadComposerTarget(search: string): boolean {
  const query = new URLSearchParams(search);
  return query.has(NEW_THREAD_QUERY_PARAM) || (query.has("profileId") && !parseWorktreeChangesTarget(search));
}

export const ORGANIZATION_SETTINGS_SECTIONS = [
  "general",
  "members",
  "projects",
  "prompts",
  "agents",
  "skills",
] as const;

export type OrganizationSettingsSection =
  (typeof ORGANIZATION_SETTINGS_SECTIONS)[number];

export const ORGANIZATION_SETTINGS_SECTION_LABELS = {
  general: "General",
  members: "Members",
  projects: "Projects",
  prompts: "Prompts",
  agents: "Agents",
  skills: "Skills",
} satisfies Record<OrganizationSettingsSection, string>;

/** Shown under the page title by the settings shell. */
export const ORGANIZATION_SETTINGS_SECTION_DESCRIPTIONS = {
  general: "Basic organization information and settings.",
  members: "Manage who has access to this organization.",
  projects: "Create and manage the projects in this organization.",
  prompts: "Reusable slash-command prompts available in every project.",
  agents: "Agent templates you can copy into any project in this organization.",
  skills: "Skill templates to install into projects. Agents only see installed skills.",
} satisfies Record<OrganizationSettingsSection, string>;

const ORGANIZATION_SETTINGS_SECTION_SET = new Set<string>(
  ORGANIZATION_SETTINGS_SECTIONS
);

export function isOrganizationSettingsSection(
  value: string | undefined
): value is OrganizationSettingsSection {
  return value !== undefined && ORGANIZATION_SETTINGS_SECTION_SET.has(value);
}

// Canonical list of project settings section slugs. The catalog (icons, labels, dev-mode gating)
// lives in the project settings config, but the slug list and route guard live here so routing
// has no dependency on component modules. Gated sections are still valid routes; availability is
// client-side (see resolveAvailableSectionId).
export const PROJECT_SETTINGS_SECTIONS = [
  "general",
  "members",
  "agents",
  "prompts",
  "skills",
  "workflows",
  "lists",
  "labels",
  "checks",
  "worktrees",
  "customization",
  "templates",
  "recurring",
  "automations",
  "pull-requests",
  "integrations",
  "import-export",
  "usage",
  "danger",
] as const;

export type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number];

const PROJECT_SETTINGS_SECTION_SET = new Set<string>(PROJECT_SETTINGS_SECTIONS);

export function isProjectSettingsSection(
  value: string | undefined
): value is ProjectSettingsSection {
  return value !== undefined && PROJECT_SETTINGS_SECTION_SET.has(value);
}

/** The PR reader's tabs; the first is the default and stays out of the URL. */
export const PULL_REQUEST_TABS = ["overview", "guide", "commits", "diff"] as const;

export type PullRequestTab = (typeof PULL_REQUEST_TABS)[number];

function withQuery(
  pathname: string,
  params: Record<string, string | null | undefined>
): RouteTarget {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  return routeTarget(pathname, { query });
}

export const appRoute = {
  home: () => routeTarget("/"),
  organizations: () => routeTarget("/o/"),
  organization: (organizationSlug: string) => routeTarget(`/o/${organizationSlug}/`),
  organizationSettings: (
    organizationSlug: string,
    section: OrganizationSettingsSection
  ) => routeTarget(`/o/${organizationSlug}/settings/${section}`),
  organizationPrompts: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/settings/prompts`),
  organizationPromptNew: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/settings/prompts/new`),
  organizationPromptDetail: (organizationSlug: string, slashCommandId: string) =>
    routeTarget(`/o/${organizationSlug}/settings/prompts/${slashCommandId}`),
  organizationProjects: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/settings/projects`),
  organizationProjectDetail: (organizationSlug: string, projectId: string) =>
    routeTarget(`/o/${organizationSlug}/settings/projects/${projectId}`),
  organizationAgents: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/settings/agents`),
  organizationAgentNew: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/settings/agents/new`),
  organizationAgentDetail: (organizationSlug: string, agentId: string) =>
    routeTarget(`/o/${organizationSlug}/settings/agents/${agentId}`),
  organizationSkills: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/settings/skills`),
  organizationSkillNew: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/settings/skills/new`),
  organizationSkillDetail: (organizationSlug: string, skillId: string) =>
    routeTarget(`/o/${organizationSlug}/settings/skills/${skillId}`),
  watchTower: (organizationSlug: string) =>
    routeTarget(`/o/${organizationSlug}/watch-tower`),
  project: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}`),
  projectTask: (organizationSlug: string, projectAlias: string, taskRef: string) =>
    withQuery(`/o/${organizationSlug}/${projectAlias}`, { task: taskRef }),
  /** Task page for a `<project alias>-<number>` ref; the alias comes from the ref. */
  task: (organizationSlug: string, taskRef: string) =>
    withQuery(`/o/${organizationSlug}/${taskRef.slice(0, taskRef.lastIndexOf("-"))}`, { task: taskRef }),
  projectBoard: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/kanban`),
  projectSettings: (
    organizationSlug: string,
    projectAlias: string,
    section: ProjectSettingsSection
  ) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/${section}`),
  projectAgentNew: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/agents/new`),
  projectAgentDetail: (
    organizationSlug: string,
    projectAlias: string,
    projectAgentId: string
  ) =>
    routeTarget(
      `/o/${organizationSlug}/${projectAlias}/settings/agents/${projectAgentId}`
    ),
  projectPromptNew: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/prompts/new`),
  projectPromptDetail: (organizationSlug: string, projectAlias: string, slashCommandId: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/prompts/${slashCommandId}`),
  projectSkillNew: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/skills/new`),
  projectSkillDetail: (organizationSlug: string, projectAlias: string, skillId: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/skills/${skillId}`),
  projectWorkflowNew: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/workflows/new`),
  projectWorkflowDetail: (organizationSlug: string, projectAlias: string, workflowId: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/settings/workflows/${workflowId}`),
  /** The GitHub page under Integrations; `setupId` reopens an in-progress connection (docs/specs/github-integration.md). */
  projectGithubIntegration: (organizationSlug: string, projectAlias: string, setupId?: string) =>
    withQuery(`/o/${organizationSlug}/${projectAlias}/settings/integrations/github`, { setup: setupId }),
  projectPullRequests: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/pull-requests`),
  /** `tab` reopens a reader tab (docs/specs/github-integration.md). */
  projectPullRequest: (
    organizationSlug: string,
    projectAlias: string,
    repositoryId: string,
    number: number,
    tab?: PullRequestTab
  ) =>
    withQuery(`/o/${organizationSlug}/${projectAlias}/pull-requests`, {
      repo: repositoryId,
      pr: String(number),
      tab: tab === "overview" ? undefined : tab,
    }),
  projectUsage: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/usage`),
  projectWatchTower: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/watch-tower`),
  projectThreads: (organizationSlug: string, projectAlias: string) =>
    routeTarget(`/o/${organizationSlug}/${projectAlias}/threads`),
  projectThreadsWithPreselection: (
    organizationSlug: string,
    projectAlias: string,
    params: ProjectThreadPreselectionParams
  ) =>
    withQuery(`/o/${organizationSlug}/${projectAlias}/threads`, {
      profileId: params.profileId,
      pathId: params.pathId,
      task: params.task,
      attachedTask: params.attachedTask,
      attachedPr: params.attachedPr,
      view: params.view,
      commit: params.commit,
    }),
  projectThreadDetail: (
    organizationSlug: string,
    projectAlias: string,
    threadId: string
  ) => routeTarget(`/o/${organizationSlug}/${projectAlias}/threads/${threadId}`),
  projectArtifact: (
    organizationSlug: string,
    projectAlias: string,
    artifactId: string
  ) => routeTarget(`/o/${organizationSlug}/${projectAlias}/artifacts/${artifactId}`),
  authSignIn: (redirectUrl?: string | null) =>
    withQuery("/auth/sign-in", { redirect_url: redirectUrl }),
  authSignUp: (redirectUrl?: string | null) =>
    withQuery("/auth/sign-up", { redirect_url: redirectUrl }),
  authVerifyEmail: () => routeTarget("/auth/verify-email"),
  authForgotPassword: (redirectUrl?: string | null) =>
    withQuery("/auth/forgot-password", { redirect_url: redirectUrl }),
  authResetPassword: () => routeTarget("/auth/reset-password"),
  authInvite: (token: string) => routeTarget(`/auth/invite/${token}`),
  playground: () => routeTarget("/playground"),
} as const;
