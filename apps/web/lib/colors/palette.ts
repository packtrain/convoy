/**
 * Default palette - colors selectable for project identity.
 */
export const DEFAULT_COLOR_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
] as const;

/**
 * Extended palette - includes more shades and colors for picker surfaces that
 * explicitly opt into a larger selection.
 */
export const EXTENDED_COLOR_PALETTE = [
  // Light row
  "#fca5a5", // light red
  "#fdba74", // light orange
  "#fde047", // light yellow
  "#86efac", // light green
  "#5eead4", // light teal
  "#93c5fd", // light blue
  "#c4b5fd", // light purple
  "#f9a8d4", // light pink
  // Base row
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  // Dark row
  "#b91c1c", // dark red
  "#c2410c", // dark orange
  "#a16207", // dark yellow
  "#15803d", // dark green
  "#0f766e", // dark teal
  "#1d4ed8", // dark blue
  "#6d28d9", // dark purple
  "#be185d", // dark pink
] as const;

export const PROJECT_COLOR_PALETTE = DEFAULT_COLOR_PALETTE;
export const TASK_LIST_COLOR_PALETTE = EXTENDED_COLOR_PALETTE;
export const AGENT_COLOR_PALETTE = EXTENDED_COLOR_PALETTE;
