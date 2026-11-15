import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { FunctionReturnType } from "convex/server";
import type { ConvoyClient } from "../../lib/config/index.js";
import type { TaskCommentSummary } from "./formatters.js";

type TaskCore = NonNullable<FunctionReturnType<typeof api.tasks.core.getById>>;
export type TaskResources = Awaited<ReturnType<typeof fetchTaskResources>>;
export type RichTask = TaskCore & TaskResources;

interface FetchTaskResourcesOptions {
  commentLimit?: number;
}

export async function fetchTaskResources(
  client: ConvoyClient,
  taskId: Id<"tasks">,
  options: FetchTaskResourcesOptions = {}
): Promise<{
  artifacts: FunctionReturnType<typeof api.tasks.artifacts.listTaskArtifactsByTask>;
  files: FunctionReturnType<typeof api.tasks.attachments.listTaskAttachmentsByTask>;
  subtasks: FunctionReturnType<typeof api.tasks.core.listByParent>;
  comments?: TaskCommentSummary[];
  commentsHasMore?: boolean;
}> {
  const commentLimit = options.commentLimit;
  const [artifacts, files, subtasks, commentsPage] = await Promise.all([
    client.query(api.tasks.artifacts.listTaskArtifactsByTask, {
      taskId,
    }),
    client.query(api.tasks.attachments.listTaskAttachmentsByTask, {
      taskId,
    }),
    client.query(api.tasks.core.listByParent, {
      parentId: taskId,
    }),
    commentLimit === undefined
      ? Promise.resolve(undefined)
      : client.query(api.tasks.comments.listByTask, {
          taskId,
          paginationOpts: {
            numItems: commentLimit,
            cursor: null,
          },
        }),
  ]);

  return {
    artifacts,
    files,
    subtasks,
    ...(commentLimit !== undefined && commentsPage !== undefined
      ? {
          comments: commentsPage.page,
          commentsHasMore: !commentsPage.isDone,
        }
      : {}),
  };
}

export async function fetchRichTask(
  client: ConvoyClient,
  taskId: Id<"tasks">,
  options: FetchTaskResourcesOptions = {}
): Promise<RichTask | null> {
  const task = await client.query(api.tasks.core.getById, { id: taskId });
  if (!task) {
    return null;
  }

  const resources = await fetchTaskResources(client, task._id, options);
  return {
    ...task,
    ...resources,
  };
}
