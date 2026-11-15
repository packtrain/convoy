// Cross-surface resource drag payload. The task-details Resources section
// writes it on drag start so task rows can accept the drag and move the
// artifact or attachment (OS-1711). Mirrors task-drag.ts.
export const RESOURCE_DRAG_MIME = "application/x-convoy-resource";
const RESOURCE_DRAG_PROJECT_MIME_PREFIX = "application/x-convoy-resource-project-";

const RESOURCE_KINDS = ["artifact", "attachment"] as const;

export type ResourceDragKind = (typeof RESOURCE_KINDS)[number];

export interface ResourceDragPayload {
  kind: ResourceDragKind;
  projectId: string;
  // `taskArtifacts` or `taskAttachments` id, per `kind`.
  resourceId: string;
  // Owning task, so a drop on it can be ignored as a no-op.
  taskId: string;
  name: string;
}

// DataTransfer values are unreadable during dragover, so the project scope is
// also encoded into the type name for target gating. One marker for both kinds:
// task rows accept them identically. Browsers lowercase custom types; Convex
// ids are already lowercase, normalize defensively.
function resourceDragProjectMime(projectId: string): string {
  return `${RESOURCE_DRAG_PROJECT_MIME_PREFIX}${projectId.toLowerCase()}`;
}

export function setResourceDragPayload(
  dataTransfer: DataTransfer,
  payload: ResourceDragPayload
): void {
  dataTransfer.setData(RESOURCE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData(resourceDragProjectMime(payload.projectId), "");
}

export function dragHasResourceForProject(
  dataTransfer: DataTransfer,
  projectId: string
): boolean {
  return dataTransfer.types.includes(resourceDragProjectMime(projectId));
}

/**
 * Any project's resource drag. Drop targets gate on the project-scoped marker
 * above; this only says "this drag is a resource", so a rejected one can be
 * shown as rejected instead of falling through to a reorder affordance.
 */
export function dragHasResource(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(RESOURCE_DRAG_MIME);
}

function isResourceKind(value: unknown): value is ResourceDragKind {
  return RESOURCE_KINDS.includes(value as ResourceDragKind);
}

export function readResourceDragPayload(
  dataTransfer: DataTransfer
): ResourceDragPayload | null {
  const raw = dataTransfer.getData(RESOURCE_DRAG_MIME);
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { kind, projectId, resourceId, taskId, name } = parsed as Record<
    string,
    unknown
  >;
  if (!isResourceKind(kind)) {
    return null;
  }
  // One check per field so each narrows — no casts on untrusted input.
  if (typeof projectId !== "string" || projectId.length === 0) {
    return null;
  }
  if (typeof resourceId !== "string" || resourceId.length === 0) {
    return null;
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    return null;
  }

  return {
    kind,
    projectId,
    resourceId,
    taskId,
    // A missing name only costs the toast its label.
    name: typeof name === "string" && name.length > 0 ? name : kind,
  };
}
