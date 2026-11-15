import { api } from "../../../_generated/api";
import { should } from "../../lib/should";
import { resolveTaskIdOrRef } from "../../lib/tasks/resolution";
import type { ToolHandler } from "../context";

export const handleCreateTaskComment: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => {
  const taskIdentifier = should.beString(args, "taskId");
  const taskId = await resolveTaskIdOrRef(ctx, apiKey, taskIdentifier, "taskId", getProjectId);
  const content = should.beTrimmedString(args, "content");

  return ctx.runMutation(api.tasks.comments.create, {
    taskId,
    content,
    apiKey,
  });
};
