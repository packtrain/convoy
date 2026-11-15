import type { ActionCtx } from "../../_generated/server";
import { createOrganizationIdGetter } from "../lib/organizations/resolution";
import { createProjectIdGetter } from "../lib/projects/resolution";
import type { ToolCallParams } from "../lib/protocol/parsers";
import { isRecord } from "@/lib/type-guards";
import type { ToolName } from "../tools";
import type { ToolHandler, ToolHandlerContext, ToolResult } from "./context";
import { handleListCliProfiles } from "./cliProfiles";
import { handleListProjects } from "./projects";
import {
  handleAttachTaskToThread,
  handleAttachPullRequestToThread,
  handleCreateThread,
  handleGetThread,
  handleMarkThreadDone,
  handleListThreadMessages,
  handleListThreads,
  handleSendThreadMessage,
} from "./threads";
import {
  handleCreateProjectAgent,
  handleListProjectAgents,
  handleUpdateProjectAgent,
} from "./projectAgents";
import { handleCreatePrompt, handleListPrompts, handleUpdatePrompt } from "./prompts";
import {
  handleCreateSkill,
  handleDeleteSkill,
  handleGetSkill,
  handleInstallSkill,
  handleListSkills,
  handleLoadSkill,
  handleReadSkillFile,
  handleUpdateSkill,
} from "./skills";
import {
  handleListTasks,
  handleSearchTasks,
  handleGetTask,
  handleGetTasks,
  handleCreateTask,
  handleUpdateTask,
  handleUpdateTaskLink,
  handleMoveTask,
  handleDeleteTask,
  handleListTaskTypes,
} from "./tasks/core";
import {
  handleListTaskLists,
  handleCreateTaskList,
  handleUpdateTaskList,
  handleMoveTasksToList,
} from "./tasks/lists";
import {
  handleListTaskLabels,
  handleCreateTaskLabel,
  handleUpdateTaskLabel,
  handleDeleteTaskLabel,
} from "./tasks/labels";
import {
  handleCreateCheck,
  handleCreateChecklist,
  handleDeleteCheck,
  handleDeleteChecklist,
  handleListChecklists,
  handleListChecks,
  handleGetChecks,
  handleUpdateCheck,
  handleUpdateChecklist,
} from "./checks";
import { handleCreateTaskComment } from "./tasks/comments";
import {
  handleListTaskArtifacts,
  handleGetTaskArtifact,
  handleCreateTaskArtifact,
  handleUpdateTaskArtifact,
  handleReplaceInTaskArtifact,
  handleMoveTaskArtifact,
  handleDeleteTaskArtifact,
} from "./tasks/artifacts";
import {
  handleListArtifactComments,
  handleCreateArtifactComment,
  handleReplyToArtifactComment,
  handleSetArtifactCommentStatus,
} from "./tasks/artifactComments";

const HANDLERS: Record<ToolName, ToolHandler> = {
  list_projects: handleListProjects,
  list_tasks: handleListTasks,
  list_task_types: handleListTaskTypes,
  list_task_lists: handleListTaskLists,
  create_task_list: handleCreateTaskList,
  update_task_list: handleUpdateTaskList,
  list_task_labels: handleListTaskLabels,
  create_task_label: handleCreateTaskLabel,
  update_task_label: handleUpdateTaskLabel,
  delete_task_label: handleDeleteTaskLabel,
  list_checks: handleListChecks,
  get_checks: handleGetChecks,
  create_check: handleCreateCheck,
  update_check: handleUpdateCheck,
  delete_check: handleDeleteCheck,
  list_checklists: handleListChecklists,
  create_checklist: handleCreateChecklist,
  update_checklist: handleUpdateChecklist,
  delete_checklist: handleDeleteChecklist,
  list_project_agents: handleListProjectAgents,
  create_project_agent: handleCreateProjectAgent,
  update_project_agent: handleUpdateProjectAgent,
  list_prompts: handleListPrompts,
  create_prompt: handleCreatePrompt,
  update_prompt: handleUpdatePrompt,
  list_skills: handleListSkills,
  get_skill: handleGetSkill,
  create_skill: handleCreateSkill,
  update_skill: handleUpdateSkill,
  delete_skill: handleDeleteSkill,
  install_skill: handleInstallSkill,
  load_skill: handleLoadSkill,
  read_skill_file: handleReadSkillFile,
  search_tasks: handleSearchTasks,
  get_task: handleGetTask,
  get_tasks: handleGetTasks,
  create_task: handleCreateTask,
  create_task_comment: handleCreateTaskComment,
  update_task: handleUpdateTask,
  update_task_link: handleUpdateTaskLink,
  move_task: handleMoveTask,
  move_tasks_to_list: handleMoveTasksToList,
  delete_task: handleDeleteTask,
  list_task_artifacts: handleListTaskArtifacts,
  get_task_artifact: handleGetTaskArtifact,
  create_task_artifact: handleCreateTaskArtifact,
  update_task_artifact: handleUpdateTaskArtifact,
  replace_in_task_artifact: handleReplaceInTaskArtifact,
  move_task_artifact: handleMoveTaskArtifact,
  delete_task_artifact: handleDeleteTaskArtifact,
  list_artifact_comments: handleListArtifactComments,
  create_artifact_comment: handleCreateArtifactComment,
  reply_to_artifact_comment: handleReplyToArtifactComment,
  set_artifact_comment_status: handleSetArtifactCommentStatus,
  list_cli_profiles: handleListCliProfiles,
  get_thread: handleGetThread,
  list_threads: handleListThreads,
  list_thread_messages: handleListThreadMessages,
  create_thread: handleCreateThread,
  send_thread_message: handleSendThreadMessage,
  mark_thread_done: handleMarkThreadDone,
  attach_task_to_thread: handleAttachTaskToThread,
  attach_pull_request_to_thread: handleAttachPullRequestToThread,
};

function isToolResult(result: unknown): result is ToolResult {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return false;
  }
  if (
    result.isError !== undefined &&
    typeof result.isError !== "boolean"
  ) {
    return false;
  }
  return result.content.every(
    (item) =>
      isRecord(item) &&
      typeof item.type === "string" &&
      typeof item.text === "string"
  );
}

export async function callTool(
  ctx: ActionCtx,
  apiKey: string,
  params: ToolCallParams,
  defaultProjectParam: string | undefined
): Promise<ToolResult> {
  const args = params.arguments ?? {};
  const getProjectId = createProjectIdGetter(ctx, args, defaultProjectParam, apiKey);
  const toolCtx: ToolHandlerContext = {
    ctx,
    apiKey,
    args,
    defaultProjectParam,
    getProjectId,
    getOrganizationId: createOrganizationIdGetter(ctx, args, getProjectId, apiKey),
  };

  const handler = HANDLERS[params.name as ToolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${params.name}`);
  }

  const result = await handler(toolCtx);

  if (isToolResult(result)) {
    return result;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
