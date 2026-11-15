// Priority values as const object
export const Priority = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  NONE: "None",
} as const;

// Derive type from const object
export type Priority = (typeof Priority)[keyof typeof Priority];
