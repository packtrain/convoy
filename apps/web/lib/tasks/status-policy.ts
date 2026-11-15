import { Status, type Status as TaskStatus } from "./status";

export type ProjectStatusConfig = {
  disabledStatuses?: readonly TaskStatus[] | null;
};

export const ALL_TASK_STATUSES: TaskStatus[] = Object.values(Status);

export const REQUIRED_PROJECT_STATUSES: TaskStatus[] = [
  Status.TODO,
  Status.DONE,
];

export const CLOSED_TASK_STATUSES: TaskStatus[] = [
  Status.DONE,
  Status.CANCELED,
];

const TASK_STATUS_SET: ReadonlySet<string> = new Set(ALL_TASK_STATUSES);

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUS_SET.has(value);
}

export function isClosedStatus(status: TaskStatus): boolean {
  return CLOSED_TASK_STATUSES.includes(status);
}

export function isProjectStatusRequired(status: TaskStatus): boolean {
  return REQUIRED_PROJECT_STATUSES.includes(status);
}

export function getDisabledTaskStatuses(
  project?: ProjectStatusConfig | null
): TaskStatus[] {
  const disabledSet = new Set(
    (project?.disabledStatuses ?? []).filter(
      (status): status is TaskStatus =>
        ALL_TASK_STATUSES.includes(status) && !isProjectStatusRequired(status)
    )
  );

  return ALL_TASK_STATUSES.filter((status) => disabledSet.has(status));
}

export function getAllowedTaskStatuses(
  project?: ProjectStatusConfig | null
): TaskStatus[] {
  const disabledSet = new Set(getDisabledTaskStatuses(project));
  return ALL_TASK_STATUSES.filter((status) => !disabledSet.has(status));
}

export function getInvalidRequiredDisabledStatuses(
  disabledStatuses: readonly TaskStatus[]
): TaskStatus[] {
  return disabledStatuses.filter((status) => isProjectStatusRequired(status));
}

export function isAllowedProjectTaskStatus(
  project: ProjectStatusConfig | null | undefined,
  status: TaskStatus
): boolean {
  return getAllowedTaskStatuses(project).includes(status);
}
