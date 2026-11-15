import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { ActionCtx } from "../../../_generated/server";
import { normalizeLabelName } from "../../../tasks/lib/taskLabelsRepo";
import { should, throwInvalidParams } from "../../lib/should";
import type { ToolHandler } from "../context";

type McpProjectLabel = {
  _id: Id<"projectLabels">;
  name: string;
  color: string;
};

async function listProjectLabels(
  ctx: ActionCtx,
  apiKey: string,
  projectId: Id<"projects">
): Promise<McpProjectLabel[]> {
  const labels = await ctx.runQuery(api.tasks.labels.list, {
    projectId,
    apiKey,
  });
  return labels.map((label) => ({
    _id: label._id,
    name: label.name,
    color: label.color,
  }));
}

/**
 * Resolve a label ID or exact (case/whitespace-insensitive) name to a label ID.
 * Null/undefined inputs are passed through so callers can preserve omission vs. clear semantics.
 */
export function resolveProjectLabelId(
  ctx: ActionCtx,
  apiKey: string,
  projectId: Id<"projects">,
  identifier: string,
  key: string
): Promise<Id<"projectLabels">>;
export function resolveProjectLabelId(
  ctx: ActionCtx,
  apiKey: string,
  projectId: Id<"projects">,
  identifier: string | undefined,
  key: string
): Promise<Id<"projectLabels"> | undefined>;
export function resolveProjectLabelId(
  ctx: ActionCtx,
  apiKey: string,
  projectId: Id<"projects">,
  identifier: string | null | undefined,
  key: string
): Promise<Id<"projectLabels"> | null | undefined>;
export async function resolveProjectLabelId(
  ctx: ActionCtx,
  apiKey: string,
  projectId: Id<"projects">,
  identifier: string | null | undefined,
  key: string
): Promise<Id<"projectLabels"> | null | undefined> {
  if (identifier === null || identifier === undefined) {
    return identifier;
  }

  const labels = await listProjectLabels(ctx, apiKey, projectId);
  const byId = labels.find((label) => label._id === identifier);
  if (byId) {
    return byId._id;
  }
  const normalized = normalizeLabelName(identifier);
  const byName = labels.find(
    (label) => normalizeLabelName(label.name) === normalized
  );
  if (byName) {
    return byName._id;
  }
  throwInvalidParams(
    `${key} "${identifier}" does not match any label in the project (use list_task_labels for discovery)`
  );
}

export const handleListTaskLabels: ToolHandler = async ({
  ctx,
  apiKey,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  return { labels: await listProjectLabels(ctx, apiKey, projectId) };
};

export const handleCreateTaskLabel: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const name = should.beTrimmedString(args, "name");
  const color = should.beOptionalString(args, "color");

  const labelId = await ctx.runMutation(api.tasks.labels.create, {
    projectId,
    name,
    ...(color !== undefined && { color }),
    apiKey,
  });
  return { labelId };
};

export const handleUpdateTaskLabel: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const identifier = should.beTrimmedString(args, "labelId");
  const labelId = await resolveProjectLabelId(
    ctx,
    apiKey,
    projectId,
    identifier,
    "labelId"
  );
  const name = should.beOptionalString(args, "name");
  const color = should.beOptionalString(args, "color");

  await ctx.runMutation(api.tasks.labels.update, {
    labelId,
    ...(name !== undefined && { name }),
    ...(color !== undefined && { color }),
    apiKey,
  });
  return { labelId };
};

export const handleDeleteTaskLabel: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
}) => {
  const projectId = await getProjectId();
  const identifier = should.beTrimmedString(args, "labelId");
  const labelId = await resolveProjectLabelId(
    ctx,
    apiKey,
    projectId,
    identifier,
    "labelId"
  );
  const resolution =
    should.beOptionalEnum(args, "resolution", [
      "clear",
      "reassign",
      "archiveTasks",
    ] as const) ?? "clear";
  const reassignToIdentifier = should.beOptionalString(args, "reassignTo");
  const reassignToLabelId = await resolveProjectLabelId(
    ctx,
    apiKey,
    projectId,
    reassignToIdentifier,
    "reassignTo"
  );

  return ctx.runMutation(api.tasks.labels.remove, {
    labelId,
    resolution,
    ...(reassignToLabelId !== undefined && { reassignToLabelId }),
    apiKey,
  });
};
