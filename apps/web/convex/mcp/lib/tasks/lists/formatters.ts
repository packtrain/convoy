import type { PaginationResult } from "convex/server";
import type { Id } from "../../../../_generated/dataModel";
import { BACKLOG_SYSTEM_LIST, isBacklogListRef } from "@/lib/task-lists/system-lists";
// Type-only import: domain lib logic stays private, but its types are part of
// the callable contract. (Deriving via FunctionReturnType<typeof api...> is
// not an option inside a convex module — the generated api type includes this
// module, making the alias circular.)
import type { TaskListPublic } from "../../../../tasks/lib/lists/validators";
import { is } from "@/lib/type-guards";

export type McpTaskListSummary = {
  id: Id<"taskLists"> | typeof BACKLOG_SYSTEM_LIST.ref;
  ref: string;
  name: string;
  isDefault: boolean;
  type: "list" | "system";
};

export function projectTaskListSummary(value: unknown): McpTaskListSummary | null | undefined {
  if (value === null) {
    return null;
  }
  // A task whose persisted List row was deleted keeps a "removed" marker; MCP
  // surfaces it as no List membership.
  if (is.record(value) && value.type === "removed") {
    return null;
  }
  if (!is.record(value) || !is.string(value.ref) || !is.string(value.name)) {
    return undefined;
  }
  const type = value.type === "system" ? "system" : "list";
  if (type === "system" && isBacklogListRef(value.ref)) {
    return {
      id: BACKLOG_SYSTEM_LIST.ref,
      ref: BACKLOG_SYSTEM_LIST.ref,
      name: BACKLOG_SYSTEM_LIST.name,
      isDefault: false,
      type,
    };
  }
  if (!is.string(value.id)) {
    return undefined;
  }
  return {
    id: value.id as Id<"taskLists">,
    ref: value.ref,
    name: value.name,
    isDefault: is.boolean(value.isDefault) ? value.isDefault : false,
    type,
  };
}

export type McpTaskListRow = {
  _id: Id<"taskLists"> | typeof BACKLOG_SYSTEM_LIST.ref;
  type: "list" | "system";
  name: string;
  ref: string;
  isArchived: boolean;
  isDefault: boolean;
  // Absent = the List inherits the project default view (OS-1566).
  defaultViewMode?: TaskListPublic["defaultViewMode"];
  defaultListGroupBy?: TaskListPublic["defaultListGroupBy"];
  defaultBoardGroupBy?: TaskListPublic["defaultBoardGroupBy"];
  defaultBoardRowGroupBy?: TaskListPublic["defaultBoardRowGroupBy"];
};

export type McpTaskListPage = Omit<PaginationResult<TaskListPublic>, "page"> & {
  page: McpTaskListRow[];
};

export function projectTaskListPage(result: PaginationResult<TaskListPublic>): McpTaskListPage {
  return {
    ...result,
    page: result.page.map((item) => ({
      _id: item._id,
      type: "list",
      name: item.name,
      ref: item.ref,
      isArchived: item.isArchived,
      isDefault: item.isDefault ?? false,
      ...(item.defaultViewMode === undefined ? {} : { defaultViewMode: item.defaultViewMode }),
      ...(item.defaultListGroupBy === undefined ? {} : { defaultListGroupBy: item.defaultListGroupBy }),
      ...(item.defaultBoardGroupBy === undefined ? {} : { defaultBoardGroupBy: item.defaultBoardGroupBy }),
      ...(item.defaultBoardRowGroupBy === undefined ? {} : { defaultBoardRowGroupBy: item.defaultBoardRowGroupBy }),
    })),
  };
}
