export const MCP_API_KEY_PLACEHOLDER = "<YOUR_API_KEY>";

export const CODEX_APPROVAL_TOOLS = [
  "list_projects",
  "list_task_types",
  "list_task_lists",
  "create_task_list",
  "update_task_list",
  "list_task_labels",
  "create_task_label",
  "update_task_label",
  "delete_task_label",
  "list_checks",
  "get_checks",
  "create_check",
  "update_check",
  "delete_check",
  "list_checklists",
  "create_checklist",
  "update_checklist",
  "delete_checklist",
  "list_project_agents",
  "create_project_agent",
  "update_project_agent",
  "list_prompts",
  "create_prompt",
  "update_prompt",
  "list_skills",
  "get_skill",
  "create_skill",
  "update_skill",
  "delete_skill",
  "install_skill",
  "load_skill",
  "read_skill_file",
  "list_tasks",
  "search_tasks",
  "get_task",
  "get_tasks",
  "create_task",
  "create_task_comment",
  "update_task",
  "update_task_link",
  "move_task",
  "move_tasks_to_list",
  "delete_task",
  "list_task_artifacts",
  "get_task_artifact",
  "create_task_artifact",
  "update_task_artifact",
  "replace_in_task_artifact",
  "move_task_artifact",
  "delete_task_artifact",
  "list_artifact_comments",
  "create_artifact_comment",
  "reply_to_artifact_comment",
  "set_artifact_comment_status",
  "list_cli_profiles",
  "get_thread",
  "list_threads",
  "list_thread_messages",
  "create_thread",
  "send_thread_message",
  "mark_thread_done",
  "attach_task_to_thread",
  "attach_pull_request_to_thread",
] as const;

interface BuildProjectScopedMcpUrlOptions {
  organizationSlug?: string;
  projectAlias?: string;
  convexUrl?: string;
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function toConvexSiteUrl(convexUrl: string) {
  const url = trimTrailingSlash(convexUrl);
  if (url.includes(".convex.cloud")) {
    return url.replace(".convex.cloud", ".convex.site");
  }
  // Self-hosted Convex serves HTTP routes on port 3211 next to the
  // client API on port 3210.
  return url.replace(/:3210$/, ":3211");
}

export function buildMcpUrl(convexUrl?: string) {
  const baseUrl = convexUrl ?? "{convex backend url}";
  return `${toConvexSiteUrl(baseUrl)}/api/mcp`;
}

export function buildProjectScopedMcpUrl({
  organizationSlug,
  projectAlias,
  convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL,
}: BuildProjectScopedMcpUrlOptions = {}) {
  const mcpUrl = buildMcpUrl(convexUrl);
  if (!organizationSlug || !projectAlias) {
    return mcpUrl;
  }

  const project = `${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectAlias)}`;
  return `${mcpUrl}?project=${project}`;
}

export function buildMcpJsonConfig(mcpUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        convoy: {
          type: "http",
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${MCP_API_KEY_PLACEHOLDER}`,
          },
        },
      },
    },
    null,
    2
  );
}

export function buildCodexRequiredConfig(mcpUrl: string) {
  return `[mcp_servers.convoy]
url = "${mcpUrl}"

[mcp_servers.convoy.http_headers]
Authorization = "Bearer ${MCP_API_KEY_PLACEHOLDER}"`;
}

export function buildCodexApprovalConfig() {
  return CODEX_APPROVAL_TOOLS.map(
    (tool) => `[mcp_servers.convoy.tools.${tool}]
approval_mode = "approve"`
  ).join("\n\n");
}

export function buildCodexFullConfig(mcpUrl: string) {
  return `${buildCodexRequiredConfig(mcpUrl)}

${buildCodexApprovalConfig()}`;
}

export function buildOpencodeMcpConfig(mcpUrl: string) {
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        convoy: {
          type: "remote",
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${MCP_API_KEY_PLACEHOLDER}`,
          },
          oauth: false,
        },
      },
    },
    null,
    2
  );
}

export function buildGenericMcpConfig(mcpUrl: string) {
  return `URL: ${mcpUrl}
Authorization: Bearer ${MCP_API_KEY_PLACEHOLDER}`;
}
