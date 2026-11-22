import type { DynamicToolUIPart, UIMessage } from "ai";
import type { ToolName as ConvoyToolName } from "@/convex/mcp/tools";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import { isRecord } from "@/lib/type-guards";

export type McpToolName = {
  server: string;
  tool: string;
};

export type McpToolPayload = {
  toolCallId: string;
  state: DynamicToolUIPart["state"];
  server: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

// Claude Code emits MCP calls as `mcp__<server>__<tool>`.
const CLAUDE_MCP_TOOL_NAME_PATTERN = /^mcp__(.+?)__(.+)$/;
// The Codex runtime synthesizes `<server>.<tool>`.
const CODEX_MCP_TOOL_NAME_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)$/;

const CONVOY_SERVER_PATTERN = /convoy/i;

// The server prefix is user-configured, so `convoy` / `convoy-dev` are
// conventions, not guarantees. Keyed record (not a plain array) so TypeScript
// errors when this drifts from the catalog in convex/mcp/tools.ts.
const CONVOY_TOOL_NAMES = {
  list_projects: true,
  list_task_types: true,
  list_task_lists: true,
  create_task_list: true,
  update_task_list: true,
  list_task_labels: true,
  create_task_label: true,
  update_task_label: true,
  delete_task_label: true,
  list_checks: true,
  get_checks: true,
  create_check: true,
  update_check: true,
  delete_check: true,
  list_checklists: true,
  create_checklist: true,
  update_checklist: true,
  delete_checklist: true,
  list_project_agents: true,
  create_project_agent: true,
  update_project_agent: true,
  list_prompts: true,
  create_prompt: true,
  update_prompt: true,
  list_skills: true,
  get_skill: true,
  create_skill: true,
  update_skill: true,
  delete_skill: true,
  install_skill: true,
  load_skill: true,
  read_skill_file: true,
  list_tasks: true,
  list_closed_tasks: true,
  search_tasks: true,
  get_task: true,
  get_tasks: true,
  create_task: true,
  create_task_comment: true,
  update_task: true,
  update_task_link: true,
  move_task: true,
  move_tasks_to_list: true,
  delete_task: true,
  list_task_artifacts: true,
  get_task_artifact: true,
  create_task_artifact: true,
  update_task_artifact: true,
  replace_in_task_artifact: true,
  move_task_artifact: true,
  delete_task_artifact: true,
  list_artifact_comments: true,
  create_artifact_comment: true,
  reply_to_artifact_comment: true,
  set_artifact_comment_status: true,
  list_cli_profiles: true,
  get_thread: true,
  list_threads: true,
  list_thread_messages: true,
  create_thread: true,
  send_thread_message: true,
  mark_thread_done: true,
  attach_task_to_thread: true,
  attach_pull_request_to_thread: true,
  submit_pull_request_guide: true,
  read_pull_request_guide: true,
} satisfies Record<ConvoyToolName, true>;

export const CONVOY_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(CONVOY_TOOL_NAMES)
);

/**
 * OpenCode ids MCP tools as `<server>_<tool>`, which only the catalog can
 * split — no catalog name is a suffix of another, so the match is unambiguous.
 */
function parseUnderscoreMcpToolName(toolName: string): McpToolName | null {
  for (const tool of CONVOY_MCP_TOOL_NAMES) {
    if (toolName.endsWith(`_${tool}`)) {
      return { server: toolName.slice(0, -(tool.length + 1)), tool };
    }
  }
  return null;
}

export function parseMcpToolName(toolName: string): McpToolName | null {
  const claudeMatch = CLAUDE_MCP_TOOL_NAME_PATTERN.exec(toolName);
  if (claudeMatch) {
    return { server: claudeMatch[1], tool: claudeMatch[2] };
  }

  const codexMatch = CODEX_MCP_TOOL_NAME_PATTERN.exec(toolName);
  if (codexMatch) {
    return { server: codexMatch[1], tool: codexMatch[2] };
  }

  return parseUnderscoreMcpToolName(toolName);
}

/**
 * Tier-1 Convoy detection: the tool name alone is never sufficient because
 * other trackers can expose identically named tools (e.g. `jira.get_task`).
 * Requires BOTH a server name containing "convoy" AND a catalog tool match.
 */
export function isConvoyMcpTool(name: McpToolName): boolean {
  return (
    CONVOY_SERVER_PATTERN.test(name.server) &&
    CONVOY_MCP_TOOL_NAMES.has(name.tool)
  );
}

/** `get_task` → `Get task` */
export function formatMcpToolTitle(tool: string): string {
  const words = tool.replace(/[_-]+/g, " ").trim();
  if (!words) return tool;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Unwraps an MCP tool result to the JSON payload the server produced.
 * Runtimes wrap results differently: Claude Code stores the raw content-block
 * array (`[{ type: "text", text: "<json>" }]`), the Codex paths store the
 * whole item or `item.result` (`{ content: [...] }`), and either may arrive
 * as a JSON string. Returns the input unchanged when no wrapper is detected.
 */
export function extractMcpToolResult(output: unknown, depth = 0): unknown {
  if (depth > 4) return output;

  if (typeof output === "string") {
    const parsed = parseJsonSafe(output);
    if (parsed === undefined || typeof parsed === "string") return output;
    return extractMcpToolResult(parsed, depth + 1);
  }

  if (Array.isArray(output)) {
    const texts = output
      .filter(
        (block): block is { type: "text"; text: string } =>
          isRecord(block) &&
          block.type === "text" &&
          typeof block.text === "string"
      )
      .map((block) => block.text);
    if (texts.length === 0) return output;
    const joined = texts.join("\n");
    const parsed = parseJsonSafe(joined);
    return parsed === undefined ? joined : parsed;
  }

  if (isRecord(output)) {
    if (Array.isArray(output.content)) {
      return extractMcpToolResult(output.content, depth + 1);
    }
    if ("result" in output && output.result !== undefined) {
      return extractMcpToolResult(output.result, depth + 1);
    }
    return output;
  }

  return output;
}

export function parseMcpToolPart(
  part: UIMessage["parts"][number]
): McpToolPayload | null {
  if (!isDynamicToolUIPart(part)) {
    return null;
  }

  const name = parseMcpToolName(part.toolName);
  if (!name) {
    return null;
  }

  const errorText =
    "errorText" in part && typeof part.errorText === "string"
      ? part.errorText
      : undefined;

  return {
    toolCallId: part.toolCallId,
    state: part.state,
    server: name.server,
    tool: name.tool,
    ...("input" in part ? { input: part.input } : {}),
    ...("output" in part ? { output: part.output } : {}),
    ...(errorText ? { errorText } : {}),
  };
}
