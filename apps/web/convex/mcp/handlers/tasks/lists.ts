import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { ActionCtx } from "../../../_generated/server";
import { should, throwInvalidParams } from "../../lib/should";
import { DEFAULT_VIEW_MODES, BOARD_GROUP_BYS, LIST_GROUP_BYS } from "../../lib/tasks/lists/defaultView";
import { projectTaskListPage, type McpTaskListRow } from "../../lib/tasks/lists/formatters";
import { BACKLOG_SYSTEM_LIST } from "@/lib/task-lists/system-lists";
import { resolveTasksByIdentifiers } from "../../lib/tasks/resolution";
import { isTaskRecordWithId } from "../../lib/tasks/resolution";
import type { ToolHandler } from "../context";

const BACKLOG_EMITTED_CURSOR_PREFIX = "__system_backlog_emitted__:";
const BACKLOG_MCP_ROW: McpTaskListRow = {
  _id: BACKLOG_SYSTEM_LIST.ref,
  type: "system",
  name: BACKLOG_SYSTEM_LIST.name,
  ref: BACKLOG_SYSTEM_LIST.ref,
  isArchived: false,
  isDefault: false,
};

function parseBacklogCursor(cursor: string | null): {
  cursor: string | null;
  backlogEmitted: boolean;
} {
  if (!cursor?.startsWith(BACKLOG_EMITTED_CURSOR_PREFIX)) {
    return { cursor, backlogEmitted: false };
  }

  const encodedCursor = cursor.slice(BACKLOG_EMITTED_CURSOR_PREFIX.length);
  return {
    cursor: encodedCursor ? decodeURIComponent(encodedCursor) : null,
    backlogEmitted: true,
  };
}

function createBacklogEmittedCursor(cursor: string | null): string {
  return `${BACKLOG_EMITTED_CURSOR_PREFIX}${cursor ? encodeURIComponent(cursor) : ""}`;
}

export const handleListTaskLists: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const archived = should.beOptionalBoolean(args, "archived") ?? false;
  const query = should.beOptionalString(args, "query")?.trim();
  const limit = should.beOptionalInteger(args, "limit", 1, 50) ?? 20;
  const cursor = should.beNullableString(args, "cursor") ?? null;
  const parsedCursor = parseBacklogCursor(cursor);
  const shouldIncludeBacklog =
    !archived && !parsedCursor.backlogEmitted && (!query || BACKLOG_SYSTEM_LIST.name.toLowerCase().includes(query.toLowerCase()));
  const persistedLimit = shouldIncludeBacklog && limit > 1 ? limit - 1 : limit;

  const listResult = await ctx.runQuery(api.tasks.lists.list, {
    projectId,
    archived,
    ...(query ? { query } : {}),
    paginationOpts: {
      numItems: persistedLimit,
      cursor: parsedCursor.cursor,
    },
    apiKey,
  });
  const projected = projectTaskListPage(listResult);
  if (shouldIncludeBacklog) {
    if (limit === 1) {
      const persistedRowsAvailable = projected.page.length > 0 || !projected.isDone;
      return {
        ...projected,
        page: [BACKLOG_MCP_ROW],
        isDone: !persistedRowsAvailable,
        continueCursor: persistedRowsAvailable ? createBacklogEmittedCursor(parsedCursor.cursor) : projected.continueCursor,
      };
    }

    return {
      ...projected,
      page: [BACKLOG_MCP_ROW, ...projected.page],
      // Mark the cursor so later pages know Backlog was already emitted (and can
      // use the full limit). When there are no more pages, leave it untouched.
      continueCursor: projected.isDone ? projected.continueCursor : createBacklogEmittedCursor(projected.continueCursor),
    };
  }

  return projected;
};

async function resolveManagedTaskList(ctx: ActionCtx, apiKey: string, projectId: Id<"projects">, identifier: string) {
  const resolved = await ctx.runQuery(api.tasks.lists.resolve, {
    projectId,
    identifier,
    apiKey,
  });
  if (!resolved) {
    throwInvalidParams(
      `listId "${identifier}" does not match any List in the project (use list_task_lists for discovery; system Lists like BACKLOG cannot be managed)`
    );
  }
  return resolved;
}

export const handleCreateTaskList: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const name = should.beTrimmedString(args, "name");
  const ref = should.beOptionalString(args, "ref");
  const color = should.beOptionalString(args, "color");
  const defaultViewMode = should.beOptionalEnum(args, "defaultViewMode", DEFAULT_VIEW_MODES);
  const defaultListGroupBy = should.beOptionalEnum(args, "defaultListGroupBy", LIST_GROUP_BYS);
  const defaultBoardGroupBy = should.beOptionalEnum(args, "defaultBoardGroupBy", BOARD_GROUP_BYS);

  const listId = await ctx.runMutation(api.tasks.lists.create, {
    projectId,
    name,
    ...(ref !== undefined && { ref }),
    ...(color !== undefined && { color }),
    ...(defaultViewMode !== undefined && { defaultViewMode }),
    ...(defaultListGroupBy !== undefined && { defaultListGroupBy }),
    ...(defaultBoardGroupBy !== undefined && { defaultBoardGroupBy }),
    apiKey,
  });
  return { listId };
};

export const handleUpdateTaskList: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const identifier = should.beTrimmedString(args, "listId");
  const name = should.beOptionalString(args, "name");
  const ref = should.beOptionalString(args, "ref");
  const color = should.beNullableString(args, "color");
  const defaultViewMode = should.beNullableEnum(args, "defaultViewMode", DEFAULT_VIEW_MODES);
  const defaultListGroupBy = should.beOptionalEnum(args, "defaultListGroupBy", LIST_GROUP_BYS);
  const defaultBoardGroupBy = should.beOptionalEnum(args, "defaultBoardGroupBy", BOARD_GROUP_BYS);
  if (name === undefined && ref === undefined && color === undefined && defaultViewMode === undefined
    && defaultListGroupBy === undefined && defaultBoardGroupBy === undefined) {
    throwInvalidParams("Provide at least one of name, ref, color, or defaultViewMode");
  }

  const list = await resolveManagedTaskList(ctx, apiKey, projectId, identifier);

  await ctx.runMutation(api.tasks.lists.update, {
    id: list._id,
    ...(name !== undefined && { name }),
    ...(ref !== undefined && { ref }),
    ...(color !== undefined && { color }),
    ...(defaultViewMode !== undefined && { defaultViewMode }),
    ...(defaultListGroupBy !== undefined && { defaultListGroupBy }),
    ...(defaultBoardGroupBy !== undefined && { defaultBoardGroupBy }),
    apiKey,
  });
  return { listId: list._id };
};

export const handleMoveTasksToList: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const projectId = await getProjectId();
  const taskIdentifiers = should.beStringArray(args, "taskIds", 25);
  // Identifier grammar is validated by the tasks domain (resolveOptionalProjectTaskList).
  const listIdentifier = should.beTrimmedString(args, "listId");
  const lookupResults = await resolveTasksByIdentifiers(ctx, apiKey, taskIdentifiers, async () => projectId);
  const rootIds: Id<"tasks">[] = [];
  for (const item of lookupResults) {
    if (!isTaskRecordWithId(item.task)) {
      throwInvalidParams(item.error ?? `task "${item.identifier}" not found`);
    }
    rootIds.push(item.task._id);
  }

  return ctx.runMutation(api.tasks.core.move.toList, {
    rootIds,
    listId: listIdentifier,
    apiKey,
  });
};
