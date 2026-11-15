export const TASK_TYPE_ICON_KEYS = [
  "SquareCheckBig",
  "Bug",
  "Sparkles",
  "Layers3",
  "Search",
  "Wrench",
  "Lightbulb",
  "Dot",
] as const;

export type TaskTypeIconKey = (typeof TASK_TYPE_ICON_KEYS)[number];

export type TaskTypeSummary = {
  key: string;
  name: string;
  icon: TaskTypeIconKey;
  color: string;
  isSystem: boolean;
};

export type TaskTypeDefinition = TaskTypeSummary & {
  order: number;
};

export const CUSTOM_TASK_TYPE_ICON: TaskTypeIconKey = "Dot";
export const DEFAULT_TASK_TYPE_KEY = "task";
export const TASK_TYPE_COLOR_FALLBACK = "#64748b";
export const TASK_TYPE_KEY_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const BUILT_IN_TASK_TYPES: readonly TaskTypeDefinition[] = [
  {
    key: "task",
    name: "Task",
    icon: "SquareCheckBig",
    color: "#64748b",
    order: 0,
    isSystem: true,
  },
  {
    key: "bug",
    name: "Bug",
    icon: "Bug",
    color: "#ef4444",
    order: 1,
    isSystem: true,
  },
  {
    key: "feature",
    name: "Feature",
    icon: "Sparkles",
    color: "#22c55e",
    order: 2,
    isSystem: true,
  },
  {
    key: "epic",
    name: "Epic",
    icon: "Layers3",
    color: "#8b5cf6",
    order: 3,
    isSystem: true,
  },
  {
    key: "investigation",
    name: "Investigation",
    icon: "Search",
    color: "#f59e0b",
    order: 4,
    isSystem: true,
  },
  {
    key: "chore",
    name: "Chore",
    icon: "Wrench",
    color: "#06b6d4",
    order: 5,
    isSystem: true,
  },
  {
    key: "idea",
    name: "Idea",
    icon: "Lightbulb",
    color: "#eab308",
    order: 6,
    isSystem: true,
  },
];

export type BuiltInTaskTypeKey =
  | "task"
  | "bug"
  | "feature"
  | "epic"
  | "investigation"
  | "chore"
  | "idea";

export function normalizeTaskTypeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidTaskTypeKey(value: string): boolean {
  return TASK_TYPE_KEY_REGEX.test(value);
}

export function isTaskTypeIconKey(value: string): value is TaskTypeIconKey {
  return (TASK_TYPE_ICON_KEYS as readonly string[]).includes(value);
}

export function normalizeTaskTypeIcon(value: string): TaskTypeIconKey {
  return isTaskTypeIconKey(value) ? value : CUSTOM_TASK_TYPE_ICON;
}

/**
 * Normalizes a raw task type key input to a valid key.
 * Handles null/undefined → default, and normalizes non-null strings.
 */
export function resolveTaskTypeKey(raw?: string | null): string {
  if (!raw) return DEFAULT_TASK_TYPE_KEY;
  return normalizeTaskTypeKey(raw);
}

export function getBuiltInTaskTypeKeys(): string[] {
  return BUILT_IN_TASK_TYPES.map((t) => t.key);
}

export function getBuiltInTaskTypeByKey(key: string): TaskTypeDefinition | null {
  return BUILT_IN_TASK_TYPES.find((taskType) => taskType.key === key) ?? null;
}

export function resolveTaskTypeSummary(key?: string | null): TaskTypeSummary {
  const builtIn = getBuiltInTaskTypeByKey(key ?? DEFAULT_TASK_TYPE_KEY);
  if (builtIn) {
    return {
      key: builtIn.key,
      name: builtIn.name,
      icon: builtIn.icon,
      color: builtIn.color,
      isSystem: builtIn.isSystem,
    };
  }

  // Unknown key — return default
  return resolveTaskTypeSummary(DEFAULT_TASK_TYPE_KEY);
}

export function getDefaultTaskTypeSummary(): TaskTypeSummary {
  return resolveTaskTypeSummary(DEFAULT_TASK_TYPE_KEY);
}
