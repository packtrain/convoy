export const Status = {
  TODO: "To Do",
  TRIAGE: "Triage",
  PLANNING: "Planning",
  PLAN_REVIEW: "Plan Review",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  BLOCKED: "Blocked",
  DONE: "Done",
  CANCELED: "Canceled",
} as const;

export type Status = (typeof Status)[keyof typeof Status];
