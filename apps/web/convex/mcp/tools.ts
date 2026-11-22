import { Priority } from "../../lib/tasks/priority";
import {
  AGENT_COLOR_PALETTE,
  EXTENDED_COLOR_PALETTE,
  TASK_LIST_COLOR_PALETTE,
} from "@/lib/colors/palette";
import { getSupportedCliTypes } from "../lib/contracts/validators";
import { MAX_GROUP_CHILDREN } from "@/lib/threads/constants";
import {
  BOARD_GROUP_BYS,
  LIST_GROUP_BYS,
  DEFAULT_VIEW_MODES,
} from "./lib/tasks/lists/defaultView";
import type { Status as TaskStatus } from "../../lib/tasks/status";
import { ALL_TASK_STATUSES, CLOSED_TASK_STATUSES } from "../../lib/tasks/status-policy";
import { DEFAULT_CLOSED_TASKS_LIMIT, MAX_CLOSED_TASKS_LIMIT } from "../lib/constants";
import { getBuiltInTaskTypeKeys } from "../../lib/tasks/task-types";

export type ToolName =
  | "list_projects"
  | "list_task_types"
  | "list_task_lists"
  | "create_task_list"
  | "update_task_list"
  | "list_task_labels"
  | "create_task_label"
  | "update_task_label"
  | "delete_task_label"
  | "list_checks"
  | "get_checks"
  | "create_check"
  | "update_check"
  | "delete_check"
  | "list_checklists"
  | "create_checklist"
  | "update_checklist"
  | "delete_checklist"
  | "list_project_agents"
  | "create_project_agent"
  | "update_project_agent"
  | "list_prompts"
  | "create_prompt"
  | "update_prompt"
  | "list_skills"
  | "get_skill"
  | "create_skill"
  | "update_skill"
  | "delete_skill"
  | "install_skill"
  | "load_skill"
  | "read_skill_file"
  | "list_tasks"
  | "list_closed_tasks"
  | "search_tasks"
  | "get_task"
  | "get_tasks"
  | "create_task"
  | "create_task_comment"
  | "update_task"
  | "update_task_link"
  | "move_task"
  | "move_tasks_to_list"
  | "delete_task"
  | "list_task_artifacts"
  | "get_task_artifact"
  | "create_task_artifact"
  | "update_task_artifact"
  | "replace_in_task_artifact"
  | "move_task_artifact"
  | "delete_task_artifact"
  | "list_artifact_comments"
  | "create_artifact_comment"
  | "reply_to_artifact_comment"
  | "set_artifact_comment_status"
  | "list_cli_profiles"
  | "get_thread"
  | "list_threads"
  | "list_thread_messages"
  | "create_thread"
  | "send_thread_message"
  | "mark_thread_done"
  | "attach_task_to_thread"
  | "attach_pull_request_to_thread"
  | "submit_pull_request_guide"
  | "read_pull_request_guide";

interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolDefinitionOptions {
  createUpdateStatuses?: TaskStatus[];
  /** The connection project's Skills, enumerated into `load_skill`'s description. */
  projectSkills?: { name: string; description?: string }[];
}

export function getToolDefinitions(
  options: ToolDefinitionOptions = {}
): ToolDefinition[] {
  const createUpdateStatuses = options.createUpdateStatuses ?? ALL_TASK_STATUSES;
  const builtInKeys = getBuiltInTaskTypeKeys();
  const taskTypeKeySchema = {
    type: "string",
    enum: builtInKeys,
    description: "Stable task type key (defaults to 'task')",
  };
  const listIdSchema = {
    type: "string",
    description:
      "Project List identifier: raw List ID, bare project-scoped List ref (e.g. 'SPRINT-1'), or system List ref 'BACKLOG'. Scoped refs with '/' are not accepted.",
  };
  const labelIdSchema = {
    type: "string",
    description:
      "Project label identifier: raw label ID or exact label name (case-insensitive). " +
      "Use list_task_labels for discovery.",
  };
  const checkIdSchema = {
    type: "string",
    description: "Check identifier: raw check ID or check key. Use list_checks for discovery.",
  };
  const checklistIdSchema = {
    type: "string",
    description:
      "Checklist identifier: raw Checklist ID or exact Checklist name (case-insensitive). " +
      "Use list_checklists for discovery.",
  };
  const checkKeysSchema = {
    type: "array",
    items: { type: "string" },
    description: "Ordered check keys from the project's catalog. Replaces the whole list.",
  };
  const taskTypeKeysSchema = {
    type: "array",
    items: { type: "string", enum: builtInKeys },
    description:
      "Task types that default to this Checklist. Replaces the whole list; a type is taken off any other Checklist that had it.",
  };
  // Split assignment model (OS-1335): assigneeId is the human owner,
  // delegatedToAgentId the agent executing the task. The legacy typed
  // `assignee` object param is rejected by the parsers.
  const assigneeIdSchema = {
    type: ["string", "null"],
    description: 'User ID of the human owner, "me" for yourself, or null to unassign.',
  };
  const delegatedToAgentIdSchema = {
    type: ["string", "null"],
    description:
      "Project agent ID executing the task, or null to clear delegation. " +
      "Delegating a task with no owner auto-sets the caller as owner (pass assigneeId: null to keep it ownerless).",
  };
  const projectIdProperty = {
    type: "string",
    description:
      "Project ID. Optional if configured via ?project= URL parameter.",
  };
  const promptScopeProperties = {
    scope: {
      type: "string",
      enum: ["project", "organization"],
      description: "Prompt scope (default: project).",
    },
    projectId: projectIdProperty,
    organization: {
      type: "string",
      description:
        "Organization slug or ID. Organization scope only; defaults to the organization owning the resolved project.",
    },
  };
  // Listing and creating name a scope, defaulting to the project because MCP
  // connections are per project; the skillId tools follow the stored Skill's own
  // scope (docs/specs/skills.md#headless-access-mcp-and-cli).
  const skillScopeProperties = {
    scope: {
      type: "string",
      enum: ["project", "organization"],
      description: "Skill scope (default: project).",
    },
    projectId: projectIdProperty,
    organization: {
      type: "string",
      description:
        "Organization slug or ID. Organization scope only; defaults to the organization owning the resolved project.",
    },
  };
  const skillIdProperty = { type: "string", description: "Skill ID" };
  const skillNameProperty = {
    type: "string",
    description: "Skill name, as listed in load_skill's description.",
  };
  // Discovery rides the tool schema rather than the agent prompt: it survives
  // resume on every runtime (docs/specs/skills.md#v1--mcp). Sorted, so an
  // unchanged project produces an unchanged schema.
  //
  // A description is agent-written prose that stays in every agent's context for a
  // whole session, so it is flattened to one line here: a newline would forge a
  // second catalog entry that outlives the message that wrote it. The clamp holds
  // the budgeted ~60 tokens per Skill; the catalog itself is uncapped, so a project
  // with hundreds of Skills pays for all of them on every `tools/list`.
  const CATALOG_DESCRIPTION_LENGTH = 120;
  const projectSkillCatalog = (options.projectSkills ?? [])
    .map((skill) => {
      const description = skill.description?.replace(/\s+/g, " ").trim().slice(0, CATALOG_DESCRIPTION_LENGTH);

      return `- ${skill.name}${description ? `: ${description}` : ""}`;
    })
    .sort();
  // An unscoped connection has no project to enumerate, which is not the same as a
  // project holding no Skills: the agent can still name one with `projectId`.
  const skillCatalogNote =
    options.projectSkills === undefined
      ? "This connection is not scoped to a project, so no Skills are listed here: pass projectId, or discover Skills with list_skills."
      : projectSkillCatalog.length > 0
        ? `Skills available in this project:\n${projectSkillCatalog.join("\n")}`
        : "This project has no Skills.";
  const skillFilePathProperty = {
    type: "string",
    description:
      "Relative POSIX path inside the Skill, e.g. 'references/fields.md'. No leading slash, no '..' segments.",
  };
  const skillSourceProperty = {
    type: "object",
    description:
      "Where this Skill was copied from, if it came from a Git repository. Recorded so a later check can tell whether upstream has moved on. " +
      "Every field is optional — record what you know; a source with nothing in it is not stored.",
    properties: {
      repoUrl: { type: "string", description: "Repository URL, e.g. 'https://github.com/owner/repo'" },
      commitSha: {
        type: "string",
        description:
          "The commit the copy is of — this is the version. 7 to 64 hex characters when given; a branch name is rejected, pass it as ref.",
      },
      ref: { type: "string", description: "Branch or tag the copy came from" },
      subpath: { type: "string", description: "Directory inside the repository holding the Skill" },
    },
  };
  // Caps restated rather than imported: convex/skills/lib is private to its
  // domain, and docs/specs/skills.md#caps is the authority.
  const skillCapsNote =
    "A Skill holds at most 50 files, 256 KB per file and 1 MB in total; a write that breaks a cap changes nothing.";
  // One flat item shape rather than a `oneOf` per op: clients round-trip
  // discriminated unions unevenly, so `op` selects the fields that apply and the
  // handler enforces the union.
  const skillEditsProperty = {
    type: "array",
    minItems: 1,
    description:
      "File edits applied in order to the Skill's files. Each edit sees the previous edits' results, and the batch is committed as one save.",
    items: {
      type: "object",
      properties: {
        op: {
          type: "string",
          enum: ["write", "replace", "move", "delete"],
          description:
            "write: create `path`, or overwrite it if it exists. replace: swap an exact string inside `path`. move: rename `path` to `newPath`. delete: remove `path`. " +
            "SKILL.md can be written and replaced in, but never moved or deleted.",
        },
        path: skillFilePathProperty,
        content: {
          type: "string",
          description: "write only: the file's whole new content. May be empty.",
        },
        oldString: {
          type: "string",
          description:
            "replace only: exact existing string to replace. Whitespace, newlines, and casing must match.",
        },
        newString: {
          type: "string",
          description: "replace only: the replacement. Empty deletes the matched text.",
        },
        replaceAll: {
          type: "boolean",
          description:
            "replace only: replace every occurrence. Defaults to false, which requires exactly one match.",
        },
        newPath: {
          type: "string",
          description: "move only: new relative POSIX path, unique within the Skill",
        },
      },
      required: ["op", "path"],
    },
  };
  const agentAppearanceSchema = {
    type: "object",
    properties: {
      color: {
        type: "string",
        enum: [...AGENT_COLOR_PALETTE],
        description: "Supported Project-agent avatar color.",
      },
    },
    required: ["color"],
    additionalProperties: false,
  };

  const agentAutomationProperties = {
    enabled: {
      type: "boolean",
      description: "Whether assigning a task to this agent offers to start a thread.",
    },
    prompt: {
      type: "string",
      description: "Plain-text automation prompt used to prefill the thread composer.",
    },
    cliType: {
      type: "string",
      enum: [...getSupportedCliTypes()],
      description: "Preferred CLI runtime preselected in the composer.",
    },
    cliModel: {
      type: "string",
      description: "Preferred model preselected in the composer.",
    },
    cliEffort: {
      type: "string",
      description: "Preferred reasoning-effort level preselected in the composer.",
    },
    mode: {
      type: "string",
      description: "Preferred CLI mode preselected in the composer (e.g. plan).",
    },
    workspace: {
      type: "string",
      enum: ["local", "worktree"],
      description: "Preferred workspace: work in the selected checkout (local) or start a new worktree.",
    },
  };

  return [
    {
      name: "list_projects",
      description: "List all projects you have access to",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_task_types",
      description: "List available task types",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_task_lists",
      description: "List project Lists for discovery",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description:
              "The project ID to list Lists from. Optional if configured via ?project= URL parameter.",
          },
          archived: {
            type: "boolean",
            description: "Return archived Lists instead of active Lists (default: false)",
          },
          query: {
            type: "string",
            description: "Optional List name/ref search query",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Page size from 1 to 50 (default: 20)",
          },
          cursor: {
            type: ["string", "null"],
            description: "Pagination cursor (default: null)",
          },
        },
      },
    },
    {
      name: "create_task_list",
      description:
        "Create a project List. Requires List management permissions. Max 20 active Lists per project.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          name: {
            type: "string",
            description: "List name (unique per project, max 80 chars)",
          },
          ref: {
            type: "string",
            description:
              "Optional List ref (uppercase, e.g. 'SPRINT-1'). Derived from the name when omitted. 'BACKLOG' and 'ARCHIVED' are reserved.",
          },
          color: {
            type: "string",
            enum: [...TASK_LIST_COLOR_PALETTE],
            description: "Optional List color from the supported palette",
          },
          defaultViewMode: {
            type: "string",
            enum: [...DEFAULT_VIEW_MODES],
            description:
              "Optional per-List default view. Omit to inherit the project default view.",
          },
          defaultListGroupBy: {
            type: "string",
            enum: [...LIST_GROUP_BYS],
            description: "List grouping. Requires defaultViewMode: list in the same call. Defaults to none.",
          },
          defaultBoardGroupBy: {
            type: "string",
            enum: [...BOARD_GROUP_BYS],
            description:
              "Board grouping. Requires defaultViewMode: board in the same call. Defaults to status.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "update_task_list",
      description:
        "Rename, re-ref, recolor, or set the default view of a project List. Requires List management permissions. Archive/unarchive, delete, and default-List changes are not available via MCP.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          listId: {
            type: "string",
            description:
              "Project List identifier: raw List ID or bare project-scoped List ref (e.g. 'SPRINT-1'). System Lists like 'BACKLOG' cannot be updated.",
          },
          name: {
            type: "string",
            description: "New List name",
          },
          ref: {
            type: "string",
            description: "New List ref (uppercase)",
          },
          color: {
            type: ["string", "null"],
            enum: [...TASK_LIST_COLOR_PALETTE, null],
            description:
              "New List color from the supported palette; null clears the color",
          },
          defaultViewMode: {
            type: ["string", "null"],
            enum: [...DEFAULT_VIEW_MODES, null],
            description:
              "Per-List default view; null clears the override so the List inherits the project default view",
          },
          defaultListGroupBy: {
            type: "string",
            enum: [...LIST_GROUP_BYS],
            description: "List grouping. Requires defaultViewMode: list in the same call. Defaults to none.",
          },
          defaultBoardGroupBy: {
            type: "string",
            enum: [...BOARD_GROUP_BYS],
            description:
              "Board grouping. Requires defaultViewMode: board in the same call. Defaults to status.",
          },
        },
        required: ["listId"],
      },
    },
    {
      name: "list_task_labels",
      description:
        "List project labels (id, name, color) in board-column order. A task has at most one label.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
        },
      },
    },
    {
      name: "create_task_label",
      description:
        "Create a project label. Requires project admin permissions. Max 20 labels per project.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          name: {
            type: "string",
            description: "Label name (unique per project, max 50 chars)",
          },
          color: {
            type: "string",
            enum: [...EXTENDED_COLOR_PALETTE],
            description: "Label color from the supported palette (default: blue #3b82f6)",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "update_task_label",
      description:
        "Rename or recolor a project label. Tasks keep the label (they reference it by id). Requires project admin permissions.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          labelId: labelIdSchema,
          name: {
            type: "string",
            description: "New label name",
          },
          color: {
            type: "string",
            enum: [...EXTENDED_COLOR_PALETTE],
            description: "New label color from the supported palette",
          },
        },
        required: ["labelId"],
      },
    },
    {
      name: "delete_task_label",
      description:
        "Delete a project label, resolving every task that references it. Requires project admin permissions.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          labelId: labelIdSchema,
          resolution: {
            type: "string",
            enum: ["clear", "reassign", "archiveTasks"],
            description:
              "How to resolve referencing tasks: clear removes the label (default), " +
              "reassign moves them to reassignTo, archiveTasks clears the label and archives active tasks.",
          },
          reassignTo: {
            type: "string",
            description:
              "Target label ID or name, required when resolution is 'reassign'.",
          },
        },
        required: ["labelId"],
      },
    },
    {
      name: "list_checks",
      description:
        "List the project's check catalog (id, key, label, instruction). A Check is a claim an agent proves with evidence.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
        },
      },
    },
    {
      name: "get_checks",
      description:
        "Get the Checks that apply to a task, or to a thread (its task's, or its own when it has no task): the Checklist in effect and each Check's key, " +
        "label, instruction, and current status (pending until reported) with its note, value, and artifactId. Pass exactly one of taskId or " +
        "threadId. Report a result with `convoy threads attach --check <key>`; list_checks is the project catalog instead.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          taskId: { type: "string", description: "Task ID or ref (e.g. 'ABC-5')" },
          threadId: { type: "string", description: "CLI thread ID; its attached task's Checks, or the thread's own with no task" },
        },
      },
    },
    {
      name: "create_check",
      description:
        "Add a Check to the project's catalog. Requires project admin permissions. Max 50 checks per project.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          key: {
            type: "string",
            description:
              "Stable key, unique per project and immutable (lowercase a-z, 0-9, - and _; max 40 chars), e.g. 'tests'",
          },
          label: {
            type: "string",
            description: "Claim shown to people, e.g. 'All tests pass' (max 100 chars)",
          },
          instruction: {
            type: "string",
            description: "Prompt telling the agent how to prove the claim (max 2000 chars, default empty)",
          },
        },
        required: ["key", "label"],
      },
    },
    {
      name: "update_check",
      description:
        "Change a Check's label or instruction. The key cannot change. Requires project admin permissions.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          checkId: checkIdSchema,
          label: { type: "string", description: "New label" },
          instruction: { type: "string", description: "New instruction (empty string clears it)" },
        },
        required: ["checkId"],
      },
    },
    {
      name: "delete_check",
      description:
        "Delete a Check from the catalog and from every Checklist. Requires project admin permissions.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          checkId: checkIdSchema,
        },
        required: ["checkId"],
      },
    },
    {
      name: "list_checklists",
      description:
        "List the project's Checklists (id, name, ordered checkKeys, taskTypeKeys they are the default for).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
        },
      },
    },
    {
      name: "create_checklist",
      description:
        "Create a Checklist from catalog Checks. Requires project admin permissions. Max 20 Checklists per project.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          name: { type: "string", description: "Checklist name (unique per project, max 50 chars)" },
          checkKeys: { ...checkKeysSchema, description: "Ordered check keys from the project's catalog (default: none)" },
          taskTypeKeys: {
            ...taskTypeKeysSchema,
            description:
              "Task types that default to this Checklist (default: none); a type is taken off any other Checklist that had it.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "update_checklist",
      description:
        "Rename a Checklist or replace its checks or task type defaults. Requires project admin permissions.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          checklistId: checklistIdSchema,
          name: { type: "string", description: "New Checklist name" },
          checkKeys: checkKeysSchema,
          taskTypeKeys: taskTypeKeysSchema,
        },
        required: ["checklistId"],
      },
    },
    {
      name: "delete_checklist",
      description:
        "Delete a Checklist. Tasks that picked it fall back to their task type's default. Requires project admin permissions.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          checklistId: checklistIdSchema,
        },
        required: ["checklistId"],
      },
    },
    {
      name: "list_project_agents",
      description: "List active Project agents available for task assignment",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
        },
      },
    },
    {
      name: "create_project_agent",
      description: "Create a Project agent for task assignment",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          name: {
            type: "string",
            description: "Project-agent name",
          },
          description: {
            type: "string",
            description: "Optional short description",
          },
          prompt: {
            type: "string",
            description: "Optional working prompt",
          },
          category: {
            type: "string",
            description: "Optional category label",
          },
          appearance: agentAppearanceSchema,
          automation: {
            type: "object",
            description:
              "Optional assignment-automation config. Note: automation only triggers for assignments made in the Convoy web UI; assigning via MCP/CLI never starts a thread.",
            properties: agentAutomationProperties,
            required: ["enabled"],
            additionalProperties: false,
          },
        },
        required: ["name", "appearance"],
      },
    },
    {
      name: "update_project_agent",
      description: "Edit a Project agent",
      inputSchema: {
        type: "object",
        properties: {
          projectAgentId: {
            type: "string",
            description: "Project agent ID",
          },
          name: {
            type: "string",
            description: "New Project-agent name",
          },
          description: {
            type: ["string", "null"],
            description: "New short description, or null to clear",
          },
          prompt: {
            type: ["string", "null"],
            description: "New working prompt, or null to clear",
          },
          category: {
            type: ["string", "null"],
            description: "New category label, or null to clear",
          },
          appearance: agentAppearanceSchema,
          automation: {
            type: ["object", "null"],
            description:
              "New assignment-automation config, or null to clear. Note: automation only triggers for assignments made in the Convoy web UI; assigning via MCP/CLI never starts a thread.",
            properties: agentAutomationProperties,
            required: ["enabled"],
            additionalProperties: false,
          },
        },
        required: ["projectAgentId"],
      },
    },
    {
      name: "list_prompts",
      description: "List active prompts (slash commands) for a project or an organization",
      inputSchema: {
        type: "object",
        properties: promptScopeProperties,
      },
    },
    {
      name: "create_prompt",
      description: "Create a prompt (slash command) in a project or an organization",
      inputSchema: {
        type: "object",
        properties: {
          ...promptScopeProperties,
          key: {
            type: "string",
            description:
              "Prompt key without the leading slash, 2-40 characters of lowercase letters, numbers, hyphens, and colons. Unique per scope owner.",
          },
          content: {
            type: "string",
            description: "Prompt content inserted into the composer",
          },
          description: {
            type: "string",
            description: "Optional short description",
          },
          category: {
            type: "string",
            description: "Optional category label",
          },
          autoExpand: {
            type: "boolean",
            description: "Whether the prompt expands into the composer on selection (default: false)",
          },
          autoSubmit: {
            type: "boolean",
            description: "Whether selecting the prompt submits the message (default: false)",
          },
        },
        required: ["key", "content"],
      },
    },
    {
      name: "update_prompt",
      description: "Edit a prompt (slash command). Scope is taken from the stored prompt.",
      inputSchema: {
        type: "object",
        properties: {
          promptId: {
            type: "string",
            description: "Prompt ID",
          },
          key: {
            type: "string",
            description: "New prompt key without the leading slash",
          },
          content: {
            type: "string",
            description: "New prompt content",
          },
          description: {
            type: ["string", "null"],
            description: "New short description, or null to clear",
          },
          category: {
            type: ["string", "null"],
            description: "New category label, or null to clear",
          },
          autoExpand: {
            type: "boolean",
            description: "New auto-expand setting",
          },
          autoSubmit: {
            type: "boolean",
            description: "New auto-submit setting",
          },
        },
        required: ["promptId"],
      },
    },
    {
      name: "list_skills",
      description:
        "List a project's or an organization's Skills (name, description, category, version, and the git source it was copied from). " +
        "File content is not included — use get_skill.",
      inputSchema: {
        type: "object",
        properties: skillScopeProperties,
      },
    },
    {
      name: "get_skill",
      description:
        "Get one Skill with its whole bundle: SKILL.md plus every other file's path and content",
      inputSchema: {
        type: "object",
        properties: { skillId: skillIdProperty },
        required: ["skillId"],
      },
    },
    {
      name: "create_skill",
      description:
        "Create a Skill in a project or an organization. Add its other files with update_skill's edits.",
      inputSchema: {
        type: "object",
        properties: {
          ...skillScopeProperties,
          name: {
            type: "string",
            description:
              "Skill name, 2-64 characters of lowercase letters, numbers, and hyphens, optionally with one 'namespace:' prefix. Unique per scope owner.",
          },
          content: {
            type: "string",
            description:
              "SKILL.md content, stored verbatim. Frontmatter in the body is never parsed and never feeds name or description.",
          },
          description: {
            type: "string",
            description: "Optional short description, shown when the Skill is offered to an agent",
          },
          category: {
            type: "string",
            description: "Optional category label",
          },
          source: skillSourceProperty,
        },
        required: ["name", "content"],
      },
    },
    {
      name: "update_skill",
      description:
        "Edit a Skill: its columns, its whole SKILL.md, and/or its files through `edits`. Only provided fields change, and the body never rewrites name or description. " +
        "The whole call is one save, so the version moves at most once and a rejected edit changes nothing. " +
        skillCapsNote,
      inputSchema: {
        type: "object",
        properties: {
          skillId: skillIdProperty,
          name: {
            type: "string",
            description: "New Skill name",
          },
          content: {
            type: "string",
            description: "New SKILL.md content, stored verbatim. Use an edit to change part of it instead of resending the body.",
          },
          description: {
            type: ["string", "null"],
            description: "New short description, or null to clear",
          },
          category: {
            type: ["string", "null"],
            description: "New category label, or null to clear",
          },
          source: {
            ...skillSourceProperty,
            type: ["object", "null"],
            description: `${skillSourceProperty.description} Pass the new commit after copying an upstream update, or null to clear.`,
          },
          edits: skillEditsProperty,
        },
        required: ["skillId"],
      },
    },
    {
      name: "delete_skill",
      description: "Delete a Skill",
      inputSchema: {
        type: "object",
        properties: { skillId: skillIdProperty },
        required: ["skillId"],
      },
    },
    {
      name: "install_skill",
      description:
        "Install an organization Skill into a project. The install copies it: the project copy is independent, so editing it never changes the template. " +
        "Take skillId from list_skills with scope 'organization'; a Skill is only loadable once installed.",
      inputSchema: {
        type: "object",
        properties: { skillId: skillIdProperty, projectId: projectIdProperty },
        required: ["skillId"],
      },
    },
    {
      name: "load_skill",
      description:
        "Load one of a project's Skills by name: its SKILL.md, plus the paths of its other files to read with read_skill_file. " +
        "Returns null when the project has no Skill by that name. " +
        skillCatalogNote,
      inputSchema: {
        type: "object",
        properties: { name: skillNameProperty, projectId: projectIdProperty },
        required: ["name"],
      },
    },
    {
      name: "read_skill_file",
      description:
        "Read one file inside one of this project's Skills. Paths come from load_skill; null means the Skill or the path does not exist.",
      inputSchema: {
        type: "object",
        properties: { name: skillNameProperty, path: skillFilePathProperty, projectId: projectIdProperty },
        required: ["name", "path"],
      },
    },
    {
      name: "list_tasks",
      description: "List tasks in a project",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description:
              "The project ID to list tasks from. Optional if configured via ?project= URL parameter.",
          },
          includeArchived: {
            type: "boolean",
            description: "Include archived tasks (default: false)",
          },
          status: {
            type: "string",
            enum: ALL_TASK_STATUSES,
            description:
              "Optional real workflow status to include (e.g. 'Done'). " +
              "When omitted, no status filter is applied (all statuses for the selected archive mode).",
          },
          listId: listIdSchema,
          includeLinks: {
            type: "boolean",
            description:
              "Include each task's externalLinks array (commits, branches, PRs, URLs) in the summaries (default: false)",
          },
        },
      },
    },
    {
      name: "list_closed_tasks",
      description:
        "List recently closed tasks, newest closed first, e.g. to summarize what shipped. " +
        "Covers every List, archived tasks, and subtasks. Tasks closed before closedAt tracking started are not returned.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description:
              "The project ID to list tasks from. Optional if configured via ?project= URL parameter.",
          },
          status: {
            type: "string",
            enum: CLOSED_TASK_STATUSES,
            description: "Closed status to list (default: Done)",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_CLOSED_TASKS_LIMIT,
            description: `Maximum tasks to return, from 1 to ${MAX_CLOSED_TASKS_LIMIT} (default: ${DEFAULT_CLOSED_TASKS_LIMIT})`,
          },
          since: {
            type: "string",
            description: "Inclusive ISO-8601 lower bound on closedAt, e.g. '2026-11-01' (UTC midnight)",
          },
          until: {
            type: "string",
            description: "Exclusive ISO-8601 upper bound on closedAt",
          },
        },
      },
    },
    {
      name: "search_tasks",
      description: "Search tasks in a project with pagination and optional filters",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description:
              "The project ID to search tasks in. Optional if configured via ?project= URL parameter.",
          },
          query: {
            type: "string",
            description: "Search query text",
          },
          archiveMode: {
            type: "string",
            enum: ["active", "archived"],
            description: "Search active or archived tasks (default: active)",
          },
          filters: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ALL_TASK_STATUSES,
                description: "Filter by task status (optional)",
              },
              assigneeId: {
                ...assigneeIdSchema,
                description: 'Filter by human owner user ID. Use "me" for your own tasks, null for tasks with no owner.',
              },
              delegatedToAgentId: {
                ...delegatedToAgentIdSchema,
                description: "Filter by delegated project agent ID. Use null for non-delegated tasks.",
              },
            },
            description: "Optional status, owner, and delegation filters",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Page size from 1 to 50 (default: 20)",
          },
          cursor: {
            type: ["string", "null"],
            description: "Pagination cursor (default: null)",
          },
          listId: listIdSchema,
        },
        required: ["query"],
      },
    },
    {
      name: "get_task",
      description:
        "Get a specific task by ID or ref, including external links (commits, branches, PRs, URLs), artifact summaries, attached file metadata (with download URLs), latest comments (up to 50), and direct subtask summaries (each with subtaskCount for deeper nesting), and, when the project has Checklists, the Checklist in effect (`checklist`, null for no checks) with its `checks` and each Check's current `status` (passed, warning, failed, not_performed, or pending)",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "get_tasks",
      description:
        "Look up one or more tasks by task IDs or refs (e.g. 'k123...', 'ABC-5'). " +
        "Returns results in the same order as the input identifiers. " +
        "Checks active tasks first, then falls back to archived. " +
        "Each matched task includes external links (commits, branches, PRs, URLs), artifact summaries, attached file metadata (with download URLs), latest comments (up to 50), and direct subtask summaries (each with subtaskCount for deeper nesting).",
      inputSchema: {
        type: "object",
        properties: {
          identifiers: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of task IDs or refs to look up (e.g. ['k123...', 'ABC-5']). Maximum 25.",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
        },
        required: ["identifiers"],
      },
    },
    {
      name: "create_task",
      description: "Create a new task in a project",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description:
              "The project ID to create the task in. Optional if configured via ?project= URL parameter.",
          },
          name: {
            type: "string",
            description: "The task name/title",
          },
          description: {
            type: "string",
            description:
              "Task description as markdown/plain text or serialized ProseMirror JSON doc (optional). " +
              "Markdown/plain text is normalized to ProseMirror JSON.",
          },
          taskTypeKey: taskTypeKeySchema,
          parentId: {
            type: "string",
            description:
              "Parent task ID or ref to create as subtask (optional).",
          },
          listId: listIdSchema,
          priority: {
            type: "string",
            enum: Object.values(Priority),
            description: "Task priority (default: None)",
          },
          status: {
            type: "string",
            enum: createUpdateStatuses,
            description: "Task status (default: To Do).",
          },
          dueDate: {
            type: "number",
            description: "Due date as Unix timestamp (optional)",
          },
          assigneeId: assigneeIdSchema,
          delegatedToAgentId: delegatedToAgentIdSchema,
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for the task (optional, default: [])",
          },
          label: {
            ...labelIdSchema,
            description: `${labelIdSchema.description} Optional.`,
          },
        },
        required: ["name"],
      },
    },
    {
      name: "create_task_comment",
      description: "Create a new markdown comment on a task",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
          content: {
            type: "string",
            description:
              "Comment markdown content (must be non-empty after trimming)",
          },
        },
        required: ["taskId", "content"],
      },
    },
    {
      name: "update_task",
      description: "Update an existing task. Pass null to clear optional fields.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
          name: {
            type: "string",
            description: "New task name",
          },
          description: {
            type: ["string", "null"],
            description:
              "New description as markdown/plain text or serialized ProseMirror JSON doc (null to clear). " +
              "Markdown/plain text is normalized to ProseMirror JSON.",
          },
          taskTypeKey: {
            type: ["string", "null"],
            enum: [...builtInKeys, null],
            description: "New task type key (pass null to reset to the default 'task' type)",
          },
          priority: {
            type: "string",
            enum: Object.values(Priority),
            description: "New priority",
          },
          status: {
            type: "string",
            enum: createUpdateStatuses,
            description: "New status",
          },
          dueDate: {
            type: ["number", "null"],
            description: "New due date as Unix timestamp (null to clear)",
          },
          assigneeId: assigneeIdSchema,
          delegatedToAgentId: delegatedToAgentIdSchema,
          tags: {
            type: "array",
            items: { type: "string" },
            description: "New tags",
          },
          label: {
            type: ["string", "null"],
            description: `${labelIdSchema.description} Pass null to clear the task's label.`,
          },
          checklist: {
            type: ["string", "null"],
            description:
              `${checklistIdSchema.description} Pass null for no checks. ` +
              "Picking the task type's default Checklist makes the task follow later default changes.",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "update_task_link",
      description:
        "Upsert or delete a single external link on a task (commit, branch, pull request, or generic URL). " +
        "Link IDs are caller-generated and unique within the task; use deterministic IDs " +
        "(e.g. 'github-pr-owner-repo-123', 'commit-<sha>') so repeated upserts update instead of duplicating. " +
        "Upsert replaces the whole link with the provided payload (createdAt is preserved). Delete is idempotent. " +
        "Returns the task's full updated externalLinks array.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
          op: {
            type: "string",
            enum: ["upsert", "delete"],
            description: "Operation to apply to the link with the given id",
          },
          id: {
            type: "string",
            description:
              "Stable link ID (1-160 chars of letters, numbers, dots, underscores, colons, hyphens)",
          },
          link: {
            type: "object",
            description:
              "Link payload, required for upsert. Required fields per kind: " +
              "commit → sha (7-64 hex chars); branch → name; pull_request → url; url → url. " +
              "Optional fields: title, repo, branch, identifier, url (http(s) only).",
            properties: {
              kind: {
                type: "string",
                enum: ["commit", "branch", "pull_request", "url"],
                description: "Link kind",
              },
              sha: { type: "string", description: "Commit sha (commit kind)" },
              name: { type: "string", description: "Branch name (branch kind)" },
              url: {
                type: "string",
                description: "http(s) URL (required for pull_request/url kinds)",
              },
              title: { type: "string", description: "Display title" },
              identifier: {
                type: "string",
                description: "Provider identifier, e.g. '#123' (pull_request kind)",
              },
              repo: { type: "string", description: "Repository, e.g. 'owner/repo'" },
              branch: {
                type: "string",
                description: "Related branch name (commit/pull_request kinds)",
              },
            },
            required: ["kind"],
          },
        },
        required: ["taskId", "op", "id"],
      },
    },
    {
      name: "move_task",
      description:
        "Move a task to a new parent or to top-level. Accepts task IDs or refs (e.g. 'ABC-5').",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          parentId: {
            type: ["string", "null"],
            description:
              "Target parent task ID/ref, or null to move the task to top-level.",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
        },
        required: ["taskId", "parentId"],
      },
    },
    {
      name: "move_tasks_to_list",
      description:
        "Move one or more existing tasks into an active project List. Accepts task IDs or refs and a List ID or ref.",
      inputSchema: {
        type: "object",
        properties: {
          taskIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Task IDs or refs to move. Maximum 25. Parent/child overlap is rejected by the backend.",
          },
          listId: listIdSchema,
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
        },
        required: ["taskIds", "listId"],
      },
    },
    {
      name: "delete_task",
      description:
        "Delete (soft-delete) a task. Deleted tasks are permanently removed after 30 days.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
          cascadeMode: {
            type: "string",
            enum: ["delete_all", "keep_children"],
            description:
              "How to handle subtasks: delete_all (default) or keep_children (move to parent)",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "list_task_artifacts",
      description: "List document artifacts (markdown or html) associated with a task",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "get_task_artifact",
      description:
        "Get a specific task artifact by ID, optionally with its comment threads",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description: "The artifact ID to retrieve",
          },
          includeComments: {
            type: "boolean",
            description:
              "Include the artifact's comment threads (roots with flat replies). Default: false.",
          },
          commentsStatus: {
            type: "string",
            enum: ["open", "resolved"],
            description:
              "With includeComments, only return threads whose root has this status. Default: all.",
          },
        },
        required: ["artifactId"],
      },
    },
    {
      name: "create_task_artifact",
      description: "Create a document artifact (markdown or html) for a task",
      inputSchema: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description:
              "Task ID or ref (e.g. 'ABC-5').",
          },
          projectId: {
            type: "string",
            description:
              "Project ID. Optional if configured via ?project= URL parameter.",
          },
          name: {
            type: "string",
            description: "Artifact title/name",
          },
          content: {
            type: "string",
            description: "Artifact content (default: empty string)",
          },
          contentType: {
            type: "string",
            enum: ["markdown", "html"],
            description:
              "Content type of the artifact (default: markdown). Immutable after creation. html artifacts are rendered read-only in the UI.",
          },
          runId: {
            type: "string",
            description: "Optional run identifier for provenance",
          },
        },
        required: ["taskId", "name"],
      },
    },
    {
      name: "update_task_artifact",
      description:
        "Update an artifact's name/content metadata. Only provided fields are changed.",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description: "The artifact ID to update",
          },
          name: {
            type: "string",
            description: "New artifact title/name",
          },
          content: {
            type: "string",
            description: "New artifact content (the artifact's content type cannot be changed)",
          },
          runId: {
            type: ["string", "null"],
            description:
              "Optional run identifier for provenance. Pass null to clear an existing runId.",
          },
        },
        required: ["artifactId"],
      },
    },
    {
      name: "replace_in_task_artifact",
      description:
        "Replace an exact string in a task artifact's content.",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description: "The artifact ID to update",
          },
          oldString: {
            type: "string",
            description:
              "Exact existing string to replace. Whitespace, newlines, and casing must match.",
          },
          newString: {
            type: "string",
            description: "Replacement string",
          },
          replaceAll: {
            type: "boolean",
            description:
              "Replace every occurrence. Defaults to false, which requires exactly one match.",
          },
        },
        required: ["artifactId", "oldString", "newString"],
      },
    },
    {
      name: "move_task_artifact",
      description:
        "Move a task artifact to another task in the same project (the artifact leaves the source task, with its comments)",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description: "The artifact ID to move",
          },
          taskId: {
            type: "string",
            description: 'Target task ID or ref (e.g. "ABC-5"); must be in the same project',
          },
          projectId: projectIdProperty,
        },
        required: ["artifactId", "taskId"],
      },
    },
    {
      name: "delete_task_artifact",
      description: "Delete a task artifact",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description: "The artifact ID to delete",
          },
        },
        required: ["artifactId"],
      },
    },
    {
      name: "list_artifact_comments",
      description:
        "List an artifact's comment threads: root comments (each anchored to a text snippet, with open/resolved status) and their flat replies",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description: "The artifact ID to list comments for",
          },
          status: {
            type: "string",
            enum: ["open", "resolved"],
            description:
              "Only return threads whose root has this status. Default: all.",
          },
        },
        required: ["artifactId"],
      },
    },
    {
      name: "create_artifact_comment",
      description:
        "Create a comment anchored to a text snippet in a markdown artifact. anchorText must appear verbatim in the artifact's content.",
      inputSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description: "The artifact ID to comment on",
          },
          content: {
            type: "string",
            description: "Comment body (markdown)",
          },
          anchorText: {
            type: "string",
            description:
              "Exact snippet from the artifact content the comment is attached to. Whitespace, newlines, and casing must match.",
          },
          occurrence: {
            type: "number",
            description:
              "Which match of anchorText to anchor to when it appears multiple times (1-based, default 1)",
          },
        },
        required: ["artifactId", "content", "anchorText"],
      },
    },
    {
      name: "reply_to_artifact_comment",
      description: "Reply to a root artifact comment (replies are flat — replies to replies are not allowed)",
      inputSchema: {
        type: "object",
        properties: {
          commentId: {
            type: "string",
            description: "The root comment ID to reply to",
          },
          content: {
            type: "string",
            description: "Reply body (markdown)",
          },
        },
        required: ["commentId", "content"],
      },
    },
    {
      name: "set_artifact_comment_status",
      description:
        "Resolve or un-resolve root artifact comments. Atomic: the whole batch fails if any id is missing or not a root comment.",
      inputSchema: {
        type: "object",
        properties: {
          commentIds: {
            type: "array",
            items: { type: "string" },
            description: "Root comment IDs to update (1-100)",
          },
          status: {
            type: "string",
            enum: ["open", "resolved"],
            description: "New status for all listed comments",
          },
        },
        required: ["commentIds", "status"],
      },
    },
    {
      name: "list_cli_profiles",
      description:
        "List the caller's CLI profiles (connected machines) in a project, with online state, " +
        "available CLI runtimes, and the checkouts each one exposes. Use it to pick a spawn target: " +
        "a profileId, one of its pathIds, and a cliType from availableClis.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
        },
      },
    },
    {
      name: "get_thread",
      description:
        "Get one CLI thread by ID: title, status, queue state, and the target it runs on " +
        "(profileId, pathId, path, cliType, targetOnline). Call it on your own thread ID to find " +
        "your spawn target; a thread in a group also returns parentThreadId. " +
        "A thread group or workflow run returns container metadata instead (kind, childCount, " +
        "aggregateStatus, originThreadId), has no target, and cannot be messaged — pass its ID to " +
        "list_threads for the members.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "CLI thread ID. Also accepts a thread group / workflow run container ID.",
          },
        },
        required: ["threadId"],
      },
    },
    {
      name: "list_threads",
      description:
        "List CLI threads in a project, most recent activity first. Each row has the same fields as " +
        "get_thread. A thread group or workflow run appears as one row (kind, childCount, " +
        "aggregateStatus) rather than as its members; pass that row's threadId back in to list the " +
        "members. Done threads are excluded unless includeDone is set.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: projectIdProperty,
          threadId: {
            type: "string",
            description:
              "Thread group / workflow run container ID: list that group's members instead of the " +
              "project's threads. Omit for the project's threads. When set, projectId is not needed.",
          },
          includeDone: {
            type: "boolean",
            description: "Include threads marked done (default: false)",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description:
              "Page size from 1 to 50 (default: 20). Ignored when threadId is set: a group returns " +
              "all of its members (at most 100) in one page.",
          },
          cursor: {
            type: ["string", "null"],
            description: "Pagination cursor (default: null). Not used when threadId is set.",
          },
        },
      },
    },
    {
      name: "list_thread_messages",
      description:
        "Read the most recent messages in a CLI thread, oldest first: role, status, createdAt, " +
        "text, and errorMessage when the run failed. " +
        "text holds the agent's text output only — no tool calls, tool output, reasoning, or " +
        "attachments — so a message that only ran tools has empty text. Messages are capped at " +
        "~4000 characters, and truncated: true means part of one was not read. There is no " +
        "pagination: limit is the whole window, so older turns are unreachable. " +
        "A thread group or workflow run has no transcript and returns an error — pass its ID to " +
        "list_threads and read a member. A thread you cannot read returns an empty list; use " +
        "get_thread to check whether an ID is valid.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "CLI thread ID. Not a thread group / workflow run container ID.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "How many of the most recent messages to return, 1 to 20 (default: 10).",
          },
        },
        required: ["threadId"],
      },
    },
    {
      name: "create_thread",
      description:
        "Start a CLI thread with an initial message, returned as get_thread would. " +
        "Pass sourceThreadId — your own thread ID, given to you at the start of your session (in " +
        "CONVOY_THREAD_ID on most runtimes) — to delegate to a second agent on your machine: " +
        "profileId, pathId, and cliType are inherited from it. " +
        "Without it all three are required, from list_cli_profiles. " +
        "Spawning groups the two threads, turning the source's sidebar row into a thread group. " +
        "sourceThreadId also takes a thread group ID or workflow container ID. Threads added " +
        "to a workflow container run independently of its steps. " +
        "Canceling the workflow leaves these threads running. If a workflow container has no " +
        "live threads, provide profileId, pathId, and cliType explicitly. " +
        `A group holds ${MAX_GROUP_CHILDREN} threads including deleted ones, ` +
        "so a full group may show fewer and retrying will not help. A group cannot span projects, " +
        "so the target profile must be in the source thread's project. " +
        "The thread starts pending and does not run in your process — check targetOnline (offline " +
        "means queued until that CLI connects) and read its reply later with list_thread_messages. " +
        "No attachments: put the content in content, or a path the target machine can read. " +
        "Each thread is a real agent run costing real money, so spawn only what you were asked to. " +
        "If you are yourself a spawned thread, report your result back instead of spawning again — " +
        "and never spawn merely because your prompt mentions delegation.",
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The initial user message, i.e. the prompt the new thread's agent receives.",
          },
          sourceThreadId: {
            type: "string",
            description:
              "Spawn beside this thread, inheriting its profileId / pathId / cliType. Accepts a " +
              "thread group container ID (a member is chosen for you). Omit to create a standalone " +
              "thread, which requires profileId, pathId, and cliType.",
          },
          profileId: {
            type: "string",
            description:
              "Target machine, from list_cli_profiles. Required without sourceThreadId. To spawn " +
              "onto a different machine than sourceThreadId's, send pathId as well — a pathId only " +
              "identifies a checkout on its own profile.",
          },
          pathId: {
            type: "string",
            description:
              "Checkout on that profile, from the profile's paths. Required without sourceThreadId, " +
              "and whenever profileId names a different machine.",
          },
          cliType: {
            type: "string",
            enum: [...getSupportedCliTypes()],
            description:
              "CLI runtime to run, from the profile's availableClis. Required without sourceThreadId; " +
              "with one, send it alone to change just the runtime.",
          },
          title: {
            type: "string",
            description: "Thread title. Defaults to a title derived from content.",
          },
          taskId: {
            type: "string",
            description: "Task ID or ref (e.g. ABC-5) to attach the thread to.",
          },
          projectId: {
            ...projectIdProperty,
            description:
              "Only needed to resolve a bare taskId ref on a connection with no default project. " +
              "Must match the target profile's project; the thread's own project comes from it.",
          },
          cliModel: {
            type: "string",
            description: "Model for the runtime to use. Defaults to the runtime's own default.",
          },
          cliEffort: {
            type: "string",
            description: "Reasoning-effort level, for runtimes that support one.",
          },
          cliMode: {
            type: "string",
            description: "CLI mode to start in, e.g. plan.",
          },
          runtimeCommand: {
            type: "boolean",
            description:
              "Open the thread by running one of the target agent's own slash commands instead of " +
              "sending content as a prompt: content must be the whole command (\"/security-review\", " +
              "\"/review the login flow\"). Only claude-code and codex targets accept this — other " +
              "runtimes are rejected because they bootstrap through the first message — and codex " +
              "executes \"/compact\", \"/usage\" and \"/goal\". Usage reads account quota without a model turn. " +
              "Convoy prompts from list_prompts are not these: pass their content as ordinary content.",
          },
          projectAgentId: {
            type: "string",
            description:
              "Project agent to run the thread as, from list_project_agents. Must belong to the " +
              "target profile's project. Its prompt is snapshotted at creation and the binding " +
              "cannot be changed later. Never inherited from sourceThreadId — pass it explicitly.",
          },
          worktree: {
            type: "object",
            description:
              "Run the thread in a fresh git worktree instead of the checkout itself. The parent " +
              "is the effective pathId, so parentPathId must equal it (inherited or explicit), " +
              "and that path cannot itself be a worktree — spawning from a thread already in one " +
              "means sending the parent repo's pathId. The CLI creates the worktree when it " +
              "claims the thread.",
            properties: {
              parentPathId: {
                type: "string",
                description: "Repository path to branch from; must equal the thread's pathId.",
              },
              branch: {
                type: "string",
                description: "New branch name, e.g. feat/fix-login. Validated as a git refname.",
              },
              baseRef: {
                type: "string",
                description: "Branch or ref to start from. Defaults to the repo's current HEAD.",
              },
              startFromOrigin: {
                type: "boolean",
                description: "Start from the remote's copy of baseRef rather than the local one.",
              },
            },
            required: ["parentPathId", "branch"],
            additionalProperties: false,
          },
        },
        required: ["content"],
      },
    },
    {
      name: "send_thread_message",
      description:
        "Queue a user message in ANOTHER CLI thread — how a spawned agent reports back to " +
        "the thread that spawned it. Never for replying in your own thread: your text output " +
        "is the reply, and a message to your own thread is rejected. " +
        "Pass sourceThreadId — your own thread ID, given to you at " +
        "the start of your session (in CONVOY_THREAD_ID on most runtimes) — so the message is " +
        "attributed to you rather than to a person. " +
        "This does not resume a paused agent: the message is queued and the target CLI starts a " +
        "new run that keeps its prior context. So the reply is not immediate and you will not " +
        "see it. If you need one, tell the target to send_thread_message back to your thread, " +
        "then end your turn: the reply wakes you as a new run. Never sleep, loop, or poll " +
        "list_thread_messages waiting for it. " +
        "An idle target becomes pending; a busy one keeps its current status and picks the " +
        "message up on its next turn, so hasPendingUserMessages, not status, is the receipt " +
        "that a send landed. An offline target queues until that CLI connects. " +
        "Only your own threads in this project are valid, as source and as target, and thread " +
        "groups and workflow runs can neither send nor receive — pass a group ID to list_threads " +
        "and message a member. " +
        "Set runtimeCommand to run one of the target agent's own slash commands (/compact) " +
        "against its session instead of sending text.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Thread to post into. Not a thread group / workflow run container ID.",
          },
          content: {
            type: "string",
            description: "The message text, delivered as a user message.",
          },
          sourceThreadId: {
            type: "string",
            description:
              "Your own thread ID, so the message is shown as sent by an agent. Must be a live " +
              "thread of yours in the same project as threadId. Omit only if you do not have " +
              "one — the message then reads as sent by a person.",
          },
          runtimeCommand: {
            type: "boolean",
            description:
              "Set true to have the target's CLI interpret the content as its own slash command " +
              "instead of reading it as text. content must then be the whole message, starting " +
              "with '/' ('/compact'). Reliable for '/compact' on claude-code, codex and " +
              "opencode targets. Anything else depends on the runtime: claude-code and cursor " +
              "run their own custom commands and skills, opencode fails the run on a name it " +
              "does not know, and codex executes only '/compact', '/usage' and '/goal'. Usage reads account quota without a model turn. " +
              "'/goal <objective>' keeps the agent working until the objective holds; '/goal pause', '/goal resume' and " +
              "'/goal clear' control it. Codex reads any other command " +
              "as ordinary text, so it may answer as if it had run it.",
          },
          steer: {
            type: "boolean",
            description:
              "Set true to inject the message into the target's in-progress run instead of " +
              "waiting for its next turn. Best-effort: it applies only while the target is " +
              "actively streaming on a runtime that supports steering (claude-code, or codex " +
              "over the app-server transport); otherwise the message just queues for the next " +
              "run, with no error and no receipt either way — never claim the running turn saw " +
              "it. Cannot be combined with runtimeCommand.",
          },
        },
        required: ["threadId", "content"],
      },
    },
    {
      name: "mark_thread_done",
      description:
        "Mark an owned thread as done and read, acknowledging current attention, or pass done: false to mark it not done. " +
        "For a group or workflow run, its children follow. Works on a running thread, including your own. " +
        "The mark stays until it is cleared explicitly or a new message is sent to the thread.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Thread ID to mark" },
          done: { type: "boolean", description: "false marks the thread not done (default true)" },
        },
        required: ["threadId"],
      },
    },
    {
      name: "attach_task_to_thread",
      description:
        "Attach a task to an owned thread that was started without one, e.g. your own thread after you " +
        "created its task. The thread then shows on the task (Runs column, timeline, sidebar). " +
        "Returns the thread as get_thread would. Re-attaching the same task is a no-op; a thread already " +
        "attached to another task, or a group / workflow run container, is rejected.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "CLI thread ID. Not a thread group / workflow run container ID." },
          taskId: { type: "string", description: "Task ID or ref (e.g. ABC-5) in the thread's project." },
        },
        required: ["threadId", "taskId"],
      },
    },
    {
      name: "attach_pull_request_to_thread",
      description:
        "Attach a GitHub pull request to an owned thread that has none, e.g. the PR your thread opened or is reviewing. " +
        "The thread then shows on the PR. Returns the thread as get_thread would. Re-attaching the same PR is a no-op; " +
        "a thread already attached to another PR, or a group / workflow run container, is rejected.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "CLI thread ID. Not a thread group / workflow run container ID." },
          pullRequest: { type: "string", description: "github.com PR URL, or owner/repo#number." },
        },
        required: ["threadId", "pullRequest"],
      },
    },
    {
      name: "submit_pull_request_guide",
      description:
        "Submit the pull request Guide your thread was started to write, as `convoy threads submit-guide` does. " +
        "Send headSha and steps, shaped as the Guide prompt shows, or failure with why the guide could not be written. " +
        "Convoy checks the steps against the pull request's changed files and returns { status: \"rejected\", errors } " +
        "with every problem at once: fix them and submit again. Accepted returns { status: \"accepted\", guideId }.",
      inputSchema: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Thread ID of the Guide run (CONVOY_THREAD_ID on most runtimes)." },
          headSha: { type: "string", description: "The commit the guide describes, from the Guide prompt." },
          steps: { type: "array", items: { type: "object" }, description: "The guide's steps, in reading order." },
          failure: { type: "string", description: "Instead of headSha and steps: why the guide could not be written. Fails the Guide." },
        },
        required: ["threadId"],
      },
    },
    {
      name: "read_pull_request_guide",
      description:
        "Read the Guides of a pull request in a repository connected to the project: the newest 20 with their status " +
        "(writing, ready, failed), and outdated: true once the pull request has commits the guide does not cover. " +
        "Also returns one Guide with its steps: guideId's, else the newest ready one (null when there is none).",
      inputSchema: {
        type: "object",
        properties: {
          pullRequest: { type: "string", description: "github.com PR URL, or owner/repo#number." },
          guideId: { type: "string", description: "Guide whose steps to return, from guides[]._id. Default: the newest ready Guide." },
          projectId: projectIdProperty,
        },
        required: ["pullRequest"],
      },
    },
  ];
}
