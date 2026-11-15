import type { Command } from "commander";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import type { ConvoyClient, RequiredConfig } from "./config/index.js";
import { getGlobalProjectOption } from "./global-options.js";
import { parseId } from "./id.js";
import { resolveProjectId, type AccessibleProject } from "./project-resolution.js";

const NO_ORGANIZATION = "Could not resolve an organization. Pass --org <orgId|orgSlug>, or --project with an accessible project.";

/**
 * The organization a command targets: `--org` when given, otherwise the one
 * owning the resolved project, so the common case needs no extra flag.
 */
export async function resolveOrganizationId(
  client: ConvoyClient,
  config: RequiredConfig,
  cmd: Command,
  org: string | undefined
): Promise<Id<"organizations">> {
  if (org) {
    // Asked of the backend rather than derived from the project list: an
    // organization with no accessible projects is still a valid target.
    const organization = await client.query(api.organizations.core.getByRef, { ref: org });
    if (!organization) {
      throw new Error(`Organization "${org}" was not found or not accessible. Run 'convoy orgs list' to see available organizations.`);
    }

    return organization._id;
  }

  // The organization is borrowed from a project here, but `--org` is what the
  // caller is missing, so say that rather than letting the project-shaped
  // "No project configured" error out of `resolveProjectId`.
  const projectRef = getGlobalProjectOption(cmd);
  if (!projectRef && !config.projectId) {
    throw new Error(NO_ORGANIZATION);
  }

  const projects = await client.query(api.projects.core.listAccessible, {});
  const projectId = resolveProjectId({ projects, defaultProjectId: config.projectId, projectRef });
  const project = projects.find((candidate: AccessibleProject) => candidate._id === projectId);
  if (!project) {
    throw new Error(NO_ORGANIZATION);
  }

  return parseId<"organizations">(project.organizationId, "organizationId");
}
