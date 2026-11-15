import { ConvexError } from "convex/values";
import { api } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { JsonRpc, type JsonRpcResponse } from "./jsonrpc";
import { InvalidParamsError } from "./lib/should";
import { ALL_TASK_STATUSES } from "../../lib/tasks/status-policy";
import { getBuiltInTaskTypeKeys } from "../../lib/tasks/task-types";
import { parseScopedAliasParam, resolveDefaultProjectStatusContext } from "./lib/projects/resolution";
import { getTaskUrlBase } from "./lib/tasks/url";
import { appRoute } from "../../lib/navigation/routes";
import { href } from "../../lib/navigation/target";
import {
  isConvexIdError,
  type McpRequest,
} from "./lib/protocol/guards";
import { parseToolCallParams } from "./lib/protocol/parsers";
import { getToolDefinitions } from "./tools";
import { callTool } from "./handlers";

/** Link format Convoy renders as task previews (docs/specs/cli-thread-message-links.md). */
function taskLinkInstructions(defaultProjectParam: string): string {
  const scoped = parseScopedAliasParam(defaultProjectParam);
  if (!scoped) return "";
  const ref = `${scoped.alias.toUpperCase()}-123`;
  const taskUrl = `${getTaskUrlBase()}${href(appRoute.projectTask(scoped.orgSlug, scoped.alias, ref))}`;
  return ` When a reply mentions a task, link it as [Task title](${taskUrl} "type=bug; status=In Progress"), with the task's type key and status from your latest tool result. Link an artifact as [Artifact name](${taskUrl}&artifact=ARTIFACT_ID "type=md"), using md for markdown artifacts and html for HTML ones. Convoy shows a link on its own line as a preview block, a list of such links as a table, and a link inside a sentence as a compact chip.`;
}

/**
 * Dispatch a validated MCP JSON-RPC request to its handler.
 * Returns null for notifications (which don't get responses).
 */
export async function dispatch(
  ctx: ActionCtx,
  apiKey: string,
  request: McpRequest,
  defaultProjectParam: string | undefined
): Promise<JsonRpcResponse | null> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize": {
        const projectStatusContext = await resolveDefaultProjectStatusContext(
          ctx,
          defaultProjectParam,
          apiKey
        );
        return JsonRpc.ok(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "convoy",
            version: "1.0.0",
          },
          instructions: defaultProjectParam
            ? `This MCP server is pre-configured with a default project (via ?project= URL parameter). Tools like list_task_types, list_task_lists, list_tasks, create_task, search_tasks, etc. do not require a projectId argument — it is resolved automatically. Do not call list_projects unless the user explicitly asks about other projects. Available task type keys for this project: ${getBuiltInTaskTypeKeys().join(", ")}.${taskLinkInstructions(defaultProjectParam)}`
            : `This MCP server is not scoped to a specific project. You must provide a projectId argument to tools that require it. Use list_projects first to discover available projects.`,
          ...(projectStatusContext
            ? {
                projectContext: {
                  projectId: projectStatusContext.projectId,
                  allowedTaskStatuses: projectStatusContext.allowedTaskStatuses,
                  disabledTaskStatuses: projectStatusContext.disabledTaskStatuses,
                  taskTypeKeys: getBuiltInTaskTypeKeys(),
                },
              }
            : {}),
        });
      }

      case "notifications/initialized":
        // Client acknowledges initialization — notifications don't get responses
        return null;

      case "tools/list": {
        const projectStatusContext = await resolveDefaultProjectStatusContext(
          ctx,
          defaultProjectParam,
          apiKey
        );
        // Skills are discovered through `load_skill`'s description, so the tool
        // schema carries the project's Skill names (docs/specs/skills.md#v1--mcp).
        // Left off entirely without a project, which reads differently from a
        // project holding none.
        const projectSkills = projectStatusContext
          ? await ctx.runQuery(api.skills.core.listByProject, {
              projectId: projectStatusContext.projectId,
              apiKey,
            })
          : undefined;
        return JsonRpc.ok(id, {
          tools: getToolDefinitions({
            createUpdateStatuses:
              projectStatusContext?.allowedTaskStatuses ?? ALL_TASK_STATUSES,
            ...(projectSkills && { projectSkills }),
          }),
        });
      }

      case "tools/call": {
        const parsed = parseToolCallParams(params);
        if (parsed.ok === false) {
          return JsonRpc.invalidParams(id, parsed.message);
        }

        try {
          const toolResult = await callTool(ctx, apiKey, parsed.value, defaultProjectParam);
          return JsonRpc.ok(id, toolResult);
        } catch (error) {
          if (error instanceof InvalidParamsError) {
            return JsonRpc.invalidParams(id, error.message);
          }
          // Convex throws when an invalid document ID is passed to a query/mutation.
          // Surface these as invalidParams rather than opaque internal errors.
          if (error instanceof Error && isConvexIdError(error.message)) {
            return JsonRpc.invalidParams(id, error.message);
          }
          throw error;
        }
      }

      default:
        return JsonRpc.methodNotFound(id, method);
    }
  } catch (error) {
    if (error instanceof InvalidParamsError) {
      return JsonRpc.invalidParams(id, error.message);
    }
    // ConvexError carries the domain's user-facing message in `data`; the raw `message` is the
    // "[Request ID ...] Server Error" blob.
    // TODO: invalid_params is an approximation — domain errors aren't always parameter errors.
    // Revisit with a proper domain-error → JSON-RPC mapping.
    if (error instanceof ConvexError) {
      return JsonRpc.invalidParams(id, typeof error.data === "string" ? error.data : error.message);
    }
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return JsonRpc.internalError(id, message);
  }
}
