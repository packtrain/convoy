import type { Command } from "commander";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient, RequiredConfig } from "../../lib/config/index.js";
import type { AccessibleProject } from "../../lib/project-resolution.js";
import { resolveProjectIdFromCommand } from "../../lib/project-resolution.js";
import { parseId } from "../../lib/id.js";
import { getProjectAliasFromTaskRef, isTaskRef, parseScopedTaskRef } from "./parsers.js";

interface ResolveTaskIdOrRefArgs {
  value: string;
  label: string;
  projectId?: Id<"projects">;
  projects?: AccessibleProject[];
}

export async function resolveTaskIdOrRef(client: ConvoyClient, args: ResolveTaskIdOrRefArgs): Promise<Id<"tasks">> {
  const scopedRef = parseScopedTaskRef(args.value);
  if (scopedRef) {
    const projectAlias = getProjectAliasFromTaskRef(scopedRef.ref);
    const project = args.projects?.find(
      (candidate) =>
        candidate.organizationSlug.toLowerCase() === scopedRef.orgSlug.toLowerCase() && candidate.alias.toUpperCase() === projectAlias
    );
    if (!project) {
      throw new Error(`Project "${projectAlias}" was not found for organization "${scopedRef.orgSlug}".`);
    }

    const result = await client.query(api.tasks.core.getByRefs, {
      refs: [scopedRef.ref],
      projectId: project._id,
    });
    const match = result.results[0];
    if (!match?.task) {
      throw new Error(`${args.label} ref "${scopedRef.ref}" was not found.`);
    }

    return match.task._id;
  }

  if (!isTaskRef(args.value)) {
    return parseId(args.value, args.label);
  }

  if (!args.projectId) {
    throw new Error(`${args.label} ref "${args.value}" requires a project. Pass --project or configure a default project.`);
  }

  const result = await client.query(api.tasks.core.getByRefs, {
    refs: [args.value],
    projectId: args.projectId,
  });
  const match = result.results[0];
  if (!match?.task) {
    throw new Error(`${args.label} ref "${args.value}" was not found.`);
  }

  return match.task._id;
}

interface ResolveTaskForCommandArgs {
  client: ConvoyClient;
  config: RequiredConfig;
  cmd: Command;
  taskIdOrRef: string;
  org?: string;
}

export async function resolveTaskIdForCommand({ client, config, cmd, taskIdOrRef, org }: ResolveTaskForCommandArgs): Promise<Id<"tasks">> {
  const needsProjectContext = isTaskRef(taskIdOrRef) || parseScopedTaskRef(taskIdOrRef) !== undefined;
  if (!needsProjectContext) {
    return resolveTaskIdOrRef(client, {
      value: taskIdOrRef,
      label: "taskId",
    });
  }

  const projects = await client.query(api.projects.core.listAccessible, {});
  const scopedRef = parseScopedTaskRef(taskIdOrRef);
  const projectId = scopedRef === undefined ? resolveProjectIdFromCommand(projects, config, cmd, org) : undefined;

  return resolveTaskIdOrRef(client, {
    value: taskIdOrRef,
    label: "taskId",
    projectId,
    projects,
  });
}
