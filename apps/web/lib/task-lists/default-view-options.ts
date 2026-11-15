import type { ListGroupBy } from "@/lib/navigation";
import {
  BOARD_GROUP_BY_OPTIONS,
  type BoardGroupBy,
  type DefaultViewSettings,
  type ProjectViewMode,
} from "@/lib/navigation";

/** Encoding for the List create/edit dialog's "Default view" selector. */
export type DefaultViewValue = "inherit" | "list" | `list:${BoardGroupBy}` | `board:${BoardGroupBy}`;

/** The values a project can hold — everything except "inherit". */
export type ProjectDefaultViewValue = Exclude<DefaultViewValue, "inherit">;

/** The selector's List and Board groups; the group label is a header, not an option. */
export const LIST_DEFAULT_VIEW_GROUPS: { label: string; options: { value: ProjectDefaultViewValue; label: string }[] }[] = [
  {
    label: "List",
    options: [
      { value: "list", label: "No grouping" },
      ...BOARD_GROUP_BY_OPTIONS.map((option) => ({ value: `list:${option.value}` as const, label: `by ${option.label}` })),
    ],
  },
  {
    label: "Board",
    options: BOARD_GROUP_BY_OPTIONS.map((option) => ({ value: `board:${option.value}` as const, label: `by ${option.label}` })),
  },
];

/** Encodes a List's stored default-view fields; unset means "inherit". */
export function toDefaultViewValue(settings: DefaultViewSettings | null | undefined): DefaultViewValue {
  if (settings?.defaultViewMode == null) {
    return "inherit";
  }
  if (settings.defaultViewMode !== "board") {
    return settings.defaultListGroupBy && settings.defaultListGroupBy !== "none" ? `list:${settings.defaultListGroupBy}` : "list";
  }
  return `board:${settings.defaultBoardGroupBy ?? "status"}`;
}

export function defaultViewTriggerLabel(value: DefaultViewValue): string {
  if (value === "inherit") {
    return "Project default";
  }
  for (const group of LIST_DEFAULT_VIEW_GROUPS) {
    const option = group.options.find((candidate) => candidate.value === value);
    if (option && option.value !== "list") {
      return `${group.label} (${option.label})`;
    }
  }
  return "List";
}

/** Decodes a selector value into stored fields; `null` mode means inherit. */
export function parseDefaultViewValue(value: DefaultViewValue): {
  defaultViewMode: ProjectViewMode | null;
  defaultBoardGroupBy?: BoardGroupBy;
  defaultListGroupBy?: ListGroupBy;
} {
  if (value === "inherit") {
    return { defaultViewMode: null };
  }
  if (value === "list") {
    return { defaultViewMode: "list", defaultListGroupBy: "none" };
  }
  if (value.startsWith("list:")) {
    const option = BOARD_GROUP_BY_OPTIONS.find(candidate => candidate.value === value.slice(5));
    return { defaultViewMode: "list", defaultListGroupBy: option?.value ?? "none" };
  }
  const groupBy = value.slice("board:".length);
  const option = BOARD_GROUP_BY_OPTIONS.find(
    (candidate) => candidate.value === groupBy
  );
  return {
    defaultViewMode: "board",
    defaultBoardGroupBy: option?.value ?? "status",
  };
}
