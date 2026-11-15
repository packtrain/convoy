import { api } from "../convex/_generated/api.js";
import type { FunctionReturnType } from "convex/server";
import type { Command } from "commander";
import type { Id } from "../convex/_generated/dataModel.js";
import type { ConvoyClient, RequiredConfig } from "./config/index.js";
import { getGlobalProjectOption } from "./global-options.js";
import { parseId } from "./id.js";

type AccessibleProjects = FunctionReturnType<typeof api.projects.core.listAccessible>;
export type AccessibleProject = AccessibleProjects[number];

type AccessibleOrganizations = FunctionReturnType<typeof api.organizations.core.listForUser>;
export type AccessibleOrganization = AccessibleOrganizations[number];

export interface ResolveProjectIdArgs {
  projects: AccessibleProjects;
  defaultProjectId?: string;
  projectRef?: string;
  orgRef?: string;
}

export interface OrganizationSummary {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  projectCount: number;
}

export function filterProjectsByOrgRef(
  projects: AccessibleProjects,
  orgRef: string
): AccessibleProjects {
  const normalized = orgRef.trim().toLowerCase();
  return projects.filter(
    (project: AccessibleProject) =>
      project.organizationId === orgRef ||
      project.organizationSlug.toLowerCase() === normalized
  );
}

function selectProjectCandidates(
  projects: AccessibleProjects,
  projectRef: string
): AccessibleProjects {
  const idMatches = projects.filter(
    (project: AccessibleProject) => project._id === projectRef
  );
  if (idMatches.length > 0) {
    return idMatches;
  }

  const normalizedAlias = projectRef.trim().toUpperCase();
  return projects.filter(
    (project: AccessibleProject) => project.alias.toUpperCase() === normalizedAlias
  );
}

export function resolveProjectId(args: ResolveProjectIdArgs): string {
  const { projects, defaultProjectId, projectRef, orgRef } = args;

  if (orgRef && !projectRef) {
    throw new Error("--org requires --project");
  }

  if (!projectRef) {
    if (defaultProjectId) {
      return defaultProjectId;
    }

    throw new Error(
      "No project configured. Pass --project or run 'convoy setup' with a project."
    );
  }

  let matches = selectProjectCandidates(projects, projectRef);

  if (orgRef) {
    matches = filterProjectsByOrgRef(matches, orgRef);
  }

  if (matches.length === 0) {
    if (orgRef) {
      throw new Error(
        `Project "${projectRef}" was not found for organization "${orgRef}".`
      );
    }

    throw new Error(`Project "${projectRef}" was not found or not accessible.`);
  }

  if (matches.length > 1) {
    const organizations = matches
      .map(
        (project: AccessibleProject) => `${project.organizationSlug}/${project.alias}`
      )
      .join(", ");
    throw new Error(
      `Project "${projectRef}" is ambiguous across organizations (${organizations}). Pass --org <orgId|orgSlug>.`
    );
  }

  return matches[0]._id;
}

export interface ResolvedProjectContext {
  projects: AccessibleProjects;
  projectId: Id<"projects">;
}

/** Resolves `--project`/`--org` against an already-fetched project list. */
export function resolveProjectIdFromCommand(
  projects: AccessibleProjects,
  config: RequiredConfig,
  cmd: Command,
  orgRef?: string
): Id<"projects"> {
  return parseId<"projects">(
    resolveProjectId({
      projects,
      defaultProjectId: config.projectId,
      projectRef: getGlobalProjectOption(cmd),
      orgRef,
    }),
    "projectId"
  );
}

/**
 * The one-shot project preamble: list accessible projects, resolve the ref, brand
 * the ID. `projects` comes back for callers that also resolve task refs.
 */
export async function resolveProjectFromCommand(
  client: ConvoyClient,
  config: RequiredConfig,
  cmd: Command,
  orgRef?: string
): Promise<ResolvedProjectContext> {
  const projects = await client.query(api.projects.core.listAccessible, {});
  return {
    projects,
    projectId: resolveProjectIdFromCommand(projects, config, cmd, orgRef),
  };
}

/**
 * Memberships are the source of truth for which organizations exist; projects
 * only supply the counts. Deriving the list from projects instead would hide
 * an organization the caller belongs to but whose projects it cannot reach.
 */
export function summarizeOrganizations(
  organizations: AccessibleOrganizations,
  projects: AccessibleProjects
): OrganizationSummary[] {
  const projectCounts = new Map<string, number>();
  for (const project of projects) {
    projectCounts.set(
      project.organizationId,
      (projectCounts.get(project.organizationId) ?? 0) + 1
    );
  }

  const rows: OrganizationSummary[] = organizations.map((org: AccessibleOrganization) => ({
    organizationId: org._id,
    organizationSlug: org.slug,
    organizationName: org.name,
    projectCount: projectCounts.get(org._id) ?? 0,
  }));

  return rows.sort((a, b) => a.organizationName.localeCompare(b.organizationName));
}
