// Shared values stay independent of React and Convex runtime modules.
export const BOARD_GROUP_BY_OPTIONS = [
  { value: "status", label: "Status", icon: "CircleDot", directory: null },
  { value: "assignee", label: "Assignee", icon: "AtSign", directory: "assignees" },
  { value: "owner", label: "Owner", icon: "UserPlus", directory: "assignees" },
  { value: "priority", label: "Priority", icon: "Flag", directory: null },
  { value: "type", label: "Type", icon: "Shapes", directory: null },
  { value: "label", label: "Label", icon: "Tag", directory: "labels" },
  { value: "section", label: "Section", icon: "Rows3", directory: "sections" },
] as const;
export const BOARD_GROUP_BY_VALUES = BOARD_GROUP_BY_OPTIONS.map(option => option.value);
