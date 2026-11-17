import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  statusValidator,
  costMetadataValidator,
  taskTableColumnValidator,
  projectViewModeValidator,
  boardGroupByValidator,
  listGroupByValidator,
  boardRowGroupByValidator,
  priorityValidator,
  orgRoleValidator,
  projectRoleValidator,
  invitationStatusValidator,
  invitationRoleValidator,
  cliTypeValidator,
  cliEffortValidator,
  cliModelValidator,
  availableCliValidator,
  cliThreadStatusValidator,
  cliThreadProcessingStateValidator,
  cliThreadKindValidator,
  cliThreadAggregateStatusValidator,
  cliThreadWatchStatusValidator,
  cliMessageStatusValidator,
  cliMessageContextValidator,
  cliMessageAttachmentValidator,
  checkResultStatusValidator,
  cliMessageRoleValidator,
  cliMessageSentByValidator,
  cliRunDiffSummaryValidator,
  cliScriptRequestValidator,
  cliScriptResultValidator,
  cliNormalizedEventValidator,
  cliInteractionKindValidator,
  cliInteractionStatusValidator,
  cliThreadWorktreeValidator,
  cliThreadForkedFromValidator,
  cliThreadPullRequestValidator,
  cliThreadMetadataValidator,
  cliWorktreeOpKindValidator,
  cliWorktreeOpStatusValidator,
  cliLoginRequestStatusValidator,
  apiKeyKindValidator,
  threadSortByValidator,
  sectionHeaderStyleValidator,
  sectionColorStyleValidator,
  apiKeyStoredScopeValidator,
  cliFavoriteComboValidator,
  cliCatalogModelValidator,
  codexModelStateValidator,
} from "./lib/contracts/validators";
import { taskExternalLinkValidator } from "./lib/contracts/taskExternalLinks";
import { agentThreadWorkEntryValidator } from "./lib/contracts/agentThreadWork";
import { codexUsageCursorValidator, costModelUsageValidator } from "./lib/contracts/costUsage";
import { projectAgentAutomationValidator } from "./lib/contracts/projectAgentAutomation";
import { workflowDefinitionValidator } from "./lib/contracts/workflowDefinition";
import {
  composerContentValidator,
} from "./lib/contracts/composerContent";
import {
  laneHoldValidator,
  resolvedExecutionValidator,
  runSelectionValidator,
  workflowRunStatusValidator,
  workflowRunStepStatusValidator,
} from "./lib/contracts/workflowRuns";
import { skillScopeValidator, skillSourceValidator } from "./lib/contracts/skills";
import { pinnedSystemTaskListValidator } from "@/lib/task-lists/system-lists";
import {
  eventTypeValidator,
  changeDetailsValidator,
} from "./lib/contracts/taskActivity";
import { appEventValidator, eventSubjectValidator } from "./lib/contracts/appEvents";
import { integrationProviderValidator, integrationSetupStatusValidator } from "./lib/contracts/integrations";
import {
  attachedPullRequestValidator,
  normalizedPullRequestValidator,
  repositoryLinkStatusValidator,
  repositorySyncStatusValidator,
} from "./lib/contracts/github";
import {
  notificationTypeValidator,
  notificationChannelValidator,
  notificationSnapshotValidator,
} from "./lib/contracts/notifications";
export default defineSchema({
  // Users (synced from Clerk)
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  // Organizations
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    avatarUrl: v.optional(v.string()),
    color: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_slug", ["slug"])
    .index("by_createdBy", ["createdBy"])
    .index("by_isDeleted", ["isDeleted"]),

  // Organization Agent templates
  agents: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    normalizedName: v.string(),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    category: v.optional(v.string()),
    appearance: v.object({
      color: v.string(),
    }),
    // Bumped on every template save (OS-1759). Absent on rows written before it existed = 1.
    version: v.optional(v.number()),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_organization_and_isDeleted", ["organizationId", "isDeleted"])
    .index("by_organization_and_isDeleted_and_normalizedName", ["organizationId", "isDeleted", "normalizedName"]),

  // Organization members
  organizationMembers: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: orgRoleValidator,
    joinedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_user", ["userId"])
    .index("by_organization_and_user", ["organizationId", "userId"])
    .index("by_organization_and_role", ["organizationId", "role"]),

  // Slash Commands
  slashCommands: defineTable({
    scope: v.union(v.literal("organization"), v.literal("project")),
    organizationId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
    userId: v.optional(v.id("users")),
    // Migration-only legacy field. Runtime code uses `key` as the prompt label.
    title: v.optional(v.string()),
    key: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    content: v.string(),
    autoExpand: v.boolean(),
    // OS-1215 rollout: optional until the false-default backfill is verified.
    autoSubmit: v.optional(v.boolean()),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_scope_and_organizationId_and_isDeleted", ["scope", "organizationId", "isDeleted"])
    .index("by_scope_and_organizationId_and_isDeleted_and_key", ["scope", "organizationId", "isDeleted", "key"])
    .index("by_scope_and_projectId_and_isDeleted", ["scope", "projectId", "isDeleted"])
    .index("by_scope_and_projectId_and_isDeleted_and_key", ["scope", "projectId", "isDeleted", "key"]),

  // Skills — multi-file instruction bundles, org- or project-scoped (docs/specs/skills.md)
  skills: defineTable({
    scope: skillScopeValidator,
    organizationId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
    name: v.string(),
    normalizedName: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    // Bumped on every save, including a file write. Written at insert.
    version: v.number(),
    // Set on a project copy: which Skill it came from, at which version, and
    // whether it diverged since.
    sourceSkillId: v.optional(v.id("skills")),
    installedVersion: v.optional(v.number()),
    locallyEdited: v.optional(v.boolean()),
    source: v.optional(skillSourceValidator),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_scope_and_organizationId_and_isDeleted", ["scope", "organizationId", "isDeleted"])
    .index("by_scope_and_organizationId_and_isDeleted_and_normalizedName", [
      "scope",
      "organizationId",
      "isDeleted",
      "normalizedName",
    ])
    // Trailing normalizedName keeps category pages name-ordered like the
    // unfiltered list; it is missing from the names only because of Convex's
    // 64-character index-name cap.
    .index("by_scope_and_organizationId_and_isDeleted_and_category", [
      "scope",
      "organizationId",
      "isDeleted",
      "category",
      "normalizedName",
    ])
    .index("by_scope_and_projectId_and_isDeleted", ["scope", "projectId", "isDeleted"])
    .index("by_scope_and_projectId_and_isDeleted_and_normalizedName", ["scope", "projectId", "isDeleted", "normalizedName"])
    .index("by_scope_and_projectId_and_isDeleted_and_category", [
      "scope",
      "projectId",
      "isDeleted",
      "category",
      "normalizedName",
    ]),

  // One file inside a Skill. Addressed by `path`, never by `_id` — a whole-set
  // replace on refresh reinserts every row.
  skillFiles: defineTable({
    skillId: v.id("skills"),
    path: v.string(),
    content: v.string(),
  })
    .index("by_skillId", ["skillId"])
    .index("by_skillId_and_path", ["skillId", "path"]),

  // Organization Invitations
  organizationInvitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: invitationRoleValidator,
    token: v.string(),
    expiresAt: v.number(),
    invitedBy: v.id("users"),
    createdAt: v.number(),
    status: invitationStatusValidator,
  })
    .index("by_token", ["token"])
    .index("by_org_and_email_and_status", ["organizationId", "email", "status"])
    .index("by_org_and_status", ["organizationId", "status"]),

  // Projects
  projects: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    alias: v.string(), // Short identifier like "ABC" for Jira-style refs
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    disabledStatuses: v.optional(v.array(statusValidator)),
    hiddenTaskTableColumns: v.optional(v.array(taskTableColumnValidator)),
    // Default view for project entry links; absent means List (Table).
    defaultViewMode: v.optional(projectViewModeValidator),
    defaultBoardGroupBy: v.optional(boardGroupByValidator),
    defaultListGroupBy: v.optional(listGroupByValidator),
    defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
    // Whether task rows show the resource count indicator (OS-882).
    // Absent means shown; counts are always maintained regardless.
    showArtifactsCount: v.optional(v.boolean()),
    // Project-wide default List (the persisted "Inbox"). Optional during the
    // OS-842 widen/backfill window; OS-844 narrows it to required once
    // Backlog/Archived also become system Lists.
    defaultListId: v.optional(v.id("taskLists")),
    // Sidebar pins for system (virtual) Lists like Backlog, which have no
    // `taskLists` row to carry pin state. Persisted Lists pin via their own
    // row (`taskLists.isPinned`); persisted pins follow `taskLists.rank`.
    pinnedSystemLists: v.optional(v.array(pinnedSystemTaskListValidator)),
    isArchived: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_and_isDeleted", ["organizationId", "isDeleted"])
    .index("by_organization_and_alias", ["organizationId", "alias"])
    .index("by_defaultListId", ["defaultListId"])
    .index("by_isDeleted_and_defaultListId", ["isDeleted", "defaultListId"])
    .index("by_organization_and_alias_and_isDeleted", ["organizationId", "alias", "isDeleted"]),

  // Project members
  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: projectRoleValidator,
    addedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_project_and_user", ["projectId", "userId"]),

  // Project-local Agents
  projectAgents: defineTable({
    projectId: v.id("projects"),
    sourceAgentId: v.optional(v.id("agents")),
    name: v.string(),
    normalizedName: v.string(),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    category: v.optional(v.string()),
    appearance: v.object({
      color: v.string(),
    }),
    // Assignment automation config (OS-1094). Stores composer prompt content +
    // preferred cliType/mode, never a user-specific CLI profile/path.
    automation: v.optional(projectAgentAutomationValidator),
    // Source-template version this copy carries, and whether it was edited
    // locally since (OS-1759). Both absent = installed at version 1, clean.
    installedVersion: v.optional(v.number()),
    locallyEdited: v.optional(v.boolean()),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_project_and_isDeleted", ["projectId", "isDeleted"])
    .index("by_project_and_isDeleted_and_normalizedName", ["projectId", "isDeleted", "normalizedName"]),

  // Workflow definitions (docs/specs/workflow-data-schema.md). Holds the one
  // freely editable draft; runs pin immutable workflowVersions rows.
  workflows: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    color: v.optional(v.string()),
    draftDefinition: workflowDefinitionValidator,
    // Set true on insert and on every definition save; cleared only by the
    // version cut at run start (OS-1366). The flag is the change detector.
    dirtySinceLastVersion: v.boolean(),
    latestVersionId: v.optional(v.id("workflowVersions")),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_project_and_isDeleted", ["projectId", "isDeleted"])
    .index("by_project_and_isDeleted_and_updatedAt", ["projectId", "isDeleted", "updatedAt"]),

  // Immutable definition copies cut at run start (ADR 0006): never edited or
  // deleted, so run history stays readable after Workflow soft deletion.
  workflowVersions: defineTable({
    workflowId: v.id("workflows"),
    projectId: v.id("projects"),
    versionNumber: v.number(),
    definition: workflowDefinitionValidator,
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_workflow_and_versionNumber", ["workflowId", "versionNumber"]),

  // One Workflow execution (docs/specs/workflow-data-schema.md → Run tree).
  // Mutable Lane and Step state is normalized into the two tables below
  // because Lanes run concurrently.
  workflowRuns: defineTable({
    workflowId: v.id("workflows"),
    workflowVersionId: v.id("workflowVersions"),
    projectId: v.id("projects"),
    startedBy: v.id("users"),
    attachedTaskId: v.optional(v.id("tasks")),
    selection: runSelectionValidator,
    status: workflowRunStatusValidator,
    startedAt: v.number(),
    lastActivityAt: v.number(),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
  })
    .index("by_project_and_status_and_lastActivityAt", ["projectId", "status", "lastActivityAt"])
    // Run history is starter-scoped (threads are user-scoped), so the index is too.
    .index("by_workflow_and_startedBy_and_startedAt", ["workflowId", "startedBy", "startedAt"])
    // No reader yet — OS-1870 (retry/skip) resolves a version's live runs through it.
    .index("by_workflowVersion", ["workflowVersionId"]),

  workflowRunLanes: defineTable({
    runId: v.id("workflowRuns"),
    laneId: v.string(),
    laneType: v.union(v.literal("single"), v.literal("parallel")),
    laneOrder: v.number(),
    // A single Lane's thread, created lazily for its first executable Step.
    threadId: v.optional(v.id("cliThreads")),
    hold: v.optional(laneHoldValidator),
    // Set while the engine holds this lane's thread parked as `waiting_input`
    // on a wait step — the cli domain writes the same status for its own
    // reasons, so the park is stored, never inferred (OS-1871).
    waitParkedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  }).index("by_run_and_laneId", ["runId", "laneId"]),

  // Per-Step orchestration state. Carries no copy of the definition — readers
  // resolve prompt/script/overrides from the pinned version via
  // `definitionStepId`; `promptOverride` (the start dialog's first-prompt
  // edit) is the one run-local exception.
  workflowRunSteps: defineTable({
    runId: v.id("workflowRuns"),
    stageId: v.string(),
    laneId: v.string(),
    definitionStepId: v.string(),
    stageOrder: v.number(),
    laneOrder: v.number(),
    stepOrder: v.number(),
    promptOverride: v.optional(composerContentValidator),
    resolvedExecution: v.optional(resolvedExecutionValidator),
    status: workflowRunStepStatusValidator,
    threadId: v.optional(v.id("cliThreads")),
    userMessageId: v.optional(v.id("cliMessages")),
    assistantMessageId: v.optional(v.id("cliMessages")),
    // The starting user approved this Bash step's script (docs/specs/workflows.md
    // → Bash steps); unset while an approval-mode step waits.
    approvedAt: v.optional(v.number()),
    attemptCount: v.number(),
    errorMessage: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_run_and_stageOrder_and_laneOrder_and_stepOrder", ["runId", "stageOrder", "laneOrder", "stepOrder"])
    // No reader yet — the engine reads whole runs (bounded by the definition caps);
    // OS-1869's concurrent lane dispatch reads per lane on these two.
    .index("by_run_and_laneId_and_stageOrder_and_stepOrder", ["runId", "laneId", "stageOrder", "stepOrder"])
    .index("by_run_and_status", ["runId", "status"]),

  // Project task Lists
  taskLists: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    normalizedName: v.string(),
    ref: v.string(),
    color: v.optional(v.string()),
    searchText: v.string(),
    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    // LexoRank-compatible project-wide List order. Optional during the
    // backfill window for legacy rows.
    rank: v.optional(v.string()),
    // Sidebar pin (OS-978). Pinned Lists render for every project member.
    // Persisted pinned Lists follow List rank; system pins keep their own
    // project-embedded chronological order.
    isPinned: v.optional(v.boolean()),
    pinnedAt: v.optional(v.number()),
    pinnedBy: v.optional(v.id("users")),
    // Per-List default view override (OS-1566). Absent means "inherit the
    // project default" — distinct from an explicit "list", which stops
    // inheriting a project-level Board default. `defaultBoardGroupBy` is only
    // meaningful when `defaultViewMode` is "board".
    defaultViewMode: v.optional(projectViewModeValidator),
    defaultBoardGroupBy: v.optional(boardGroupByValidator),
    defaultListGroupBy: v.optional(listGroupByValidator),
    defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_and_normalizedName", ["projectId", "normalizedName"])
    .index("by_project_and_ref", ["projectId", "ref"])
    .index("by_project_and_isArchived_and_normalizedName", ["projectId", "isArchived", "normalizedName"])
    .index("by_project_and_isArchived_and_rank", ["projectId", "isArchived", "rank"])
    .index("by_project_and_isPinned_and_rank", ["projectId", "isPinned", "rank"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["projectId", "isArchived"],
    }),

  // Project labels (OS-1004): single-valued task classification driving the
  // label board grouping. Hard-deleted via taskLabels.remove, which resolves
  // all referencing tasks in the same mutation.
  projectLabels: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    normalizedName: v.string(), // trimmed + lowercased, for per-project uniqueness
    color: v.string(), // same palette as taskLists color
    rank: v.string(), // LexoRank; label order = board column order
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_and_rank", ["projectId", "rank"])
    .index("by_project_and_normalizedName", ["projectId", "normalizedName"]),

  // Project check catalog (docs/specs/task-checks.md). `key` never changes:
  // checklists and check results reference Checks by key.
  checkDefinitions: defineTable({
    projectId: v.id("projects"),
    key: v.string(),
    label: v.string(),
    instruction: v.string(),
    showInPullRequestList: v.optional(v.boolean()), // a status icon on PR list rows (OS-2400)
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_key", ["projectId", "key"]),

  // Named, ordered sets of catalog Check keys. A task type key appears in at
  // most one checklist per project: that checklist is the type's default.
  checklists: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    normalizedName: v.string(), // trimmed + lowercased, for per-project uniqueness
    checkKeys: v.array(v.string()),
    taskTypeKeys: v.array(v.string()),
    pullRequests: v.optional(v.boolean()), // the project's Pull request checklist; at most one (OS-2400)
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_normalizedName", ["projectId", "normalizedName"]),

  // One answer to one Check from one run (docs/specs/task-checks.md). The newest
  // result per `checkKey` is current; older ones are history. Never edited.
  checkResults: defineTable({
    projectId: v.id("projects"),
    taskId: v.optional(v.id("tasks")), // unset: owned by a thread with no task (OS-2293), or by `pullRequest`
    // Set: owned by this PR's head revision, never by a task or thread (OS-2400). `ref` is the Attached pull request's.
    pullRequest: v.optional(v.object({ ref: v.string(), headSha: v.string() })),
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"),
    checkKey: v.string(),
    label: v.string(), // snapshot; the catalog label wins while the key exists
    status: checkResultStatusValidator,
    note: v.optional(v.string()),
    value: v.optional(v.string()), // the answer, e.g. "High" or "+3" (OS-2385)
    files: v.array(cliMessageAttachmentValidator),
    artifactId: v.optional(v.id("taskArtifacts")), // any task in the project; never updated
    artifactName: v.optional(v.string()), // snapshot at report time
    threadTitle: v.string(), // snapshot at report time
    threadOwnerId: v.id("users"),
    reportedAt: v.number(),
    githubPublishError: v.optional(v.string()), // a PR result GitHub has no check run for, and why (OS-2401)
  })
    .index("by_taskId_and_reportedAt", ["taskId", "reportedAt"])
    .index("by_threadId_and_taskId_and_pullRequestRef_and_reportedAt", ["threadId", "taskId", "pullRequest.ref", "reportedAt"])
    .index("by_projectId_and_pullRequestRef_and_reportedAt", ["projectId", "pullRequest.ref", "reportedAt"])
    .index("by_projectId_and_pullRequestRef_and_checkKey_and_reportedAt", ["projectId", "pullRequest.ref", "checkKey", "reportedAt"]),

  // One row per blob a check result shows, so `lib/storageRepo` keeps it.
  checkResultFiles: defineTable({
    resultId: v.id("checkResults"),
    storageId: v.id("_storage"),
  })
    .index("by_resultId", ["resultId"])
    .index("by_storageId", ["storageId"]),

  // List-scoped task sections (OS-2137). Hard-deleted via tasks.sections.remove,
  // which clears sectionId on every referencing task in the same mutation.
  taskSections: defineTable({
    projectId: v.id("projects"),
    listKey: v.string(), // same key as tasks.listKey, so Backlog can have sections
    name: v.string(),
    color: v.optional(v.string()),
    rank: v.string(),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project_and_listKey_and_rank", ["projectId", "listKey", "rank"]),

  // Tasks
  tasks: defineTable({
    projectId: v.id("projects"),
    parentId: v.optional(v.id("tasks")), // Reference to parent task (undefined = top-level)
    taskTypeKey: v.optional(v.string()), // Key from BUILT_IN_TASK_TYPES (defaults to "task")
    clientId: v.string(), // Client-generated stable ID for React keys
    refNumber: v.number(), // Numeric part of ref ID (e.g., 5 for "ABC-5")
    name: v.string(),
    description: v.optional(v.string()),
    searchText: v.optional(v.string()),
    priority: priorityValidator,
    dueDate: v.optional(v.number()),
    status: statusValidator,
    listKey: v.optional(v.string()), // Canonical List membership key, e.g. "list:<taskListId>" or "system:backlog"
    // Split assignment model (OS-1335): assigneeId is the human owner,
    // delegatedToAgentId the agent executing the task.
    assigneeId: v.optional(v.id("users")),
    delegatedToAgentId: v.optional(v.id("projectAgents")),
    tags: v.array(v.string()),
    // Single project label (OS-1004). taskLabels.remove clears/reassigns this
    // on every referencing task (incl. deleted/archived) in the same mutation.
    labelId: v.optional(v.id("projectLabels")),
    // Root tasks only; subtasks follow their root (OS-2137).
    sectionId: v.optional(v.id("taskSections")),
    // Unset follows the task type's default checklist; null means no checks.
    // A deleted checklist reads as unset (docs/specs/task-checks.md).
    checklistId: v.optional(v.union(v.id("checklists"), v.null())),
    externalLinks: v.optional(v.array(taskExternalLinkValidator)),
    // Denormalized linked CLI thread work summary (OS-1094), keyed by the
    // thread's associatedTaskId and synced from the thread lifecycle.
    agentThreadWork: v.optional(v.array(agentThreadWorkEntryValidator)),
    // Denormalized counts of taskAttachments/taskArtifacts rows (OS-882),
    // maintained by the attachment/artifact mutations. Absent on legacy rows;
    // readers treat them as 0.
    attachmentCount: v.optional(v.number()),
    artifactCount: v.optional(v.number()),
    rank: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
    scheduledDeletionId: v.optional(v.id("_scheduled_functions")),
    isArchived: v.boolean(),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
  })
    .index("by_project_and_isDeleted", ["projectId", "isDeleted"])
    .index("by_project_and_isDeleted_and_rank", ["projectId", "isDeleted", "rank"])
    .index("by_project_and_isDeleted_and_isArchived_and_rank", ["projectId", "isDeleted", "isArchived", "rank"])
    .index("by_project_and_isDeleted_and_isArchived_and_createdAt", ["projectId", "isDeleted", "isArchived", "createdAt"])
    .index("by_project_and_isDeleted_and_isArchived_and_archivedAt", ["projectId", "isDeleted", "isArchived", "archivedAt"])
    .index("by_parent_and_isDeleted_and_rank", ["parentId", "isDeleted", "rank"])
    .index("by_project_and_isDeleted_and_isArchived_and_parentId_and_rank", ["projectId", "isDeleted", "isArchived", "parentId", "rank"])
    .index("by_project_and_isDeleted_and_isArchived_and_listKey_and_rank", ["projectId", "isDeleted", "isArchived", "listKey", "rank"])
    .index("by_project_deleted_archived_listKey_status_rank", ["projectId", "isDeleted", "isArchived", "listKey", "status", "rank"])
    .index("by_project_deleted_archived_status_archivedAt", ["projectId", "isDeleted", "isArchived", "status", "archivedAt"])
    .index("by_isDeleted_and_isArchived_and_listKey_and_status", ["isDeleted", "isArchived", "listKey", "status"])
    .index("by_project_and_isDeleted_and_isArchived_and_refNumber", ["projectId", "isDeleted", "isArchived", "refNumber"])
    // No isDeleted/isArchived here: label delete resolution must reach ALL
    // referencing tasks, including soft-deleted and archived ones.
    .index("by_project_and_labelId", ["projectId", "labelId"])
    .index("by_sectionId", ["sectionId"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["projectId", "isDeleted", "isArchived", "status", "assigneeId", "delegatedToAgentId", "listKey"],
    }),

  // Per-project task ref counter (OS-934). Isolated from the `projects` document so
  // creating a task patches this narrowly-subscribed row instead of the project doc, which
  // is in the read set of nearly every workspace query. `nextRefNumber` is the next ref to
  // hand out; bulk flows reserve a range by advancing it once (OS-935).
  taskRefCounters: defineTable({
    projectId: v.id("projects"),
    nextRefNumber: v.number(),
  }).index("by_project", ["projectId"]),

  // Task Artifacts
  taskArtifacts: defineTable({
    taskId: v.id("tasks"),
    name: v.string(),
    fileName: v.string(),
    content: v.string(),
    // Absent on legacy rows; treated as "markdown".
    contentType: v.optional(v.union(v.literal("markdown"), v.literal("html"))),
    source: v.union(v.literal("user"), v.literal("agent")),
    runId: v.optional(v.string()),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_task_and_updatedAt", ["taskId", "updatedAt"])
    .index("by_task_and_fileName", ["taskId", "fileName"]),

  // Task Attachments
  taskAttachments: defineTable({
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(), // bytes
    contentType: v.string(), // MIME type
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_storageId", ["storageId"]),

  // Transient internal event bus (OS-1123). NOT history — that's taskActivityLogs.
  // Rows are janitor-deleted after EVENT_TTL_MS; no indexes until a consumer queries.
  events: defineTable(appEventValidator),

  // Per-recipient notifications (OS-1354) — the hub every delivery channel consumes.
  // Written by the bus fan-out handler; `snapshot` is frozen render data so the inbox needs
  // no joins. Cron-deleted after NOTIFICATION_RETENTION_MS.
  //
  // ponytail: `organizationId` is optional for legacy rows only — every write path requires
  // it and the backfill has run everywhere. Narrowing it would validate every row in *every*
  // deployment on deploy, breaking stale dev/preview ones until someone runs
  // `migrations:runAll` there.
  notifications: defineTable({
    userId: v.id("users"),
    type: notificationTypeValidator,
    actorUserId: v.optional(v.id("users")),
    organizationId: v.optional(v.id("organizations")),
    projectId: v.id("projects"),
    subject: eventSubjectValidator,
    read: v.boolean(),
    readAt: v.optional(v.number()),
    snapshot: notificationSnapshotValidator,
  })
    .index("by_user_and_org", ["userId", "organizationId"])
    .index("by_user_and_org_and_read", ["userId", "organizationId", "read"])
    .index("by_user_and_type_and_subjectId_and_read", ["userId", "type", "subject.id", "read"]),

  // Sparse per-user notification preference overrides (OS-1354): only rows
  // that differ from the code-level defaults exist. `projectId` is reserved
  // for per-project overrides — v1 only reads rows with it unset.
  notificationPreferences: defineTable({
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    type: notificationTypeValidator,
    channel: notificationChannelValidator,
    enabled: v.boolean(),
  }).index("by_user", ["userId"]),

  // Task Activity Logs
  taskActivityLogs: defineTable({
    taskId: v.id("tasks"),
    userId: v.id("users"), // Who performed the action
    eventType: eventTypeValidator,
    changeDetails: v.optional(changeDetailsValidator),
    createdAt: v.number(),
  })
    .index("by_task_and_createdAt", ["taskId", "createdAt"])
    .index("by_task", ["taskId"]),

  // Task Comments
  taskComments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    content: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    isEdited: v.boolean(),
  }).index("by_task_and_createdAt", ["taskId", "createdAt"]),

  // Task Comment Attachments
  taskCommentAttachments: defineTable({
    commentId: v.id("taskComments"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
  })
    .index("by_comment", ["commentId"])
    .index("by_storageId", ["storageId"]),

  // Uploads a user finished but has not yet attached to a task or comment (OS-1901).
  // The row is the proof of ownership; it is spent when the blob is attached.
  taskAttachmentPendingUploads: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  }).index("by_storageId", ["storageId"]),

  // Artifact Comments — range-anchored comments on markdown artifact content.
  // Anchors live here, never inside the artifact markdown (ADR 0005); see
  // docs/specs/artifact-comments.md.
  artifactComments: defineTable({
    artifactId: v.id("taskArtifacts"),
    taskId: v.id("tasks"), // denormalized for permission resolution
    parentId: v.optional(v.id("artifactComments")), // absent = root; present = reply to a root (flat)
    authorId: v.id("users"),
    content: v.string(),
    // Comment anchor (roots only): the selected snippet plus surrounding
    // context, copied at creation. Offsets are search hints, not authoritative.
    anchor: v.optional(
      v.object({
        text: v.string(),
        prefix: v.string(),
        suffix: v.string(),
        startOffset: v.number(),
        endOffset: v.number(),
      })
    ),
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))), // roots only
    createdAt: v.number(),
    updatedAt: v.number(),
    isEdited: v.boolean(),
  })
    .index("by_artifact_and_createdAt", ["artifactId", "createdAt"])
    .index("by_parent_and_createdAt", ["parentId", "createdAt"]),

  // API Keys for MCP Server access
  apiKeys: defineTable({
    userId: v.id("users"), // User who owns this key
    name: v.string(), // Display name (e.g., "Claude Code")
    keyHash: v.string(), // SHA-256 hash of the full key
    keyPrefix: v.string(), // First 16 chars for display (sk_user_abc...)
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), // max 1 year from creation; undefined = never (manual keys only)
    scope: apiKeyStoredScopeValidator,
    // Auto-mint provenance/audience; undefined = manual key (see validators.ts).
    kind: v.optional(apiKeyKindValidator),
    sourceKeyId: v.optional(v.id("apiKeys")),
  })
    .index("by_keyHash", ["keyHash"]) // For validation lookups
    .index("by_user", ["userId"]) // For listing all keys
    .index("by_userId_and_kind_and_name", ["userId", "kind", "name"]) // CLI re-login replacement
    .index("by_kind_and_expiresAt", ["kind", "expiresAt"]) // Expiry sweep
    .index("by_sourceKeyId", ["sourceKeyId"]), // Worker cleanup on source deletion

  // CLI Profiles (persistent connection identity - one per user per project per profileKey)
  cliProfiles: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    profileKey: v.optional(v.string()), // TOML profile key (e.g. "os-local")
    name: v.string(), // Connection name (defaults to hostname)
    hostname: v.optional(v.string()), // Machine hostname
    paths: v.array(
      v.object({
        id: v.string(), // crypto.randomUUID(), stable reference for threads
        path: v.string(), // Absolute filesystem path
        label: v.string(), // Display name (defaults to basename)
        gitRemoteUrl: v.optional(v.string()),
        // Git worktree entries (synced from `git worktree list` by the CLI).
        // Absent kind = regular user-configured path.
        kind: v.optional(v.literal("worktree")),
        parentPathId: v.optional(v.string()), // id of the repo path this worktree belongs to
        branch: v.optional(v.string()), // checked-out branch
      })
    ),
    createdAt: v.number(),
    lastConnectedAt: v.optional(v.number()), // Updated on each connection
    // Last advertised CLI runtimes (from the most recent registration), so
    // composers can offer runtime/model options while the CLI is offline.
    // A live session's availableClis always wins over this snapshot.
    lastKnownClis: v.optional(v.array(availableCliValidator)),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_user_project_profileKey_and_isDeleted", ["userId", "projectId", "profileKey", "isDeleted"])
    .index("by_user_project_and_isDeleted_and_createdAt", ["userId", "projectId", "isDeleted", "createdAt"])
    .index("by_user_and_isDeleted_and_createdAt", ["userId", "isDeleted", "createdAt"])
    .index("by_project_and_isDeleted", ["projectId", "isDeleted"]),

  // CLI Sessions (ephemeral - active when CLI is running)
  cliSessions: defineTable({
    profileId: v.id("cliProfiles"), // References the persistent profile
    instanceId: v.string(), // UUID generated by CLI - uniquely identifies each CLI process
    apiKeyId: v.id("apiKeys"),
    // Denormalized for efficient listing by project / ownership checks.
    // Optional to keep backward compatibility with any existing sessions.
    userId: v.optional(v.id("users")),
    projectId: v.optional(v.id("projects")),
    availableClis: v.array(availableCliValidator),
    // @useconvoy/cli package version reported at register. Absent on sessions
    // from older CLIs.
    appVersion: v.optional(v.string()),
    // Whether this CLI connection streams partial (delta) events for runs it
    // serves. Chosen at `convoy connect` time (on by default since OS-1659;
    // `--buffered` opts out).
    supportsPartialStreaming: v.optional(v.boolean()),
    // Whether this CLI connection answers interactive approval requests
    // (tool approvals, questions, plan approvals).
    supportsInteractiveApprovals: v.optional(v.boolean()),
    // Whether this CLI connection can inject steer-requested user messages
    // into an in-progress run (OS-1111).
    supportsSteering: v.optional(v.boolean()),
    // Per-runtime steering capability (CLI >= 0.8.0): the cliType slugs this
    // connection can steer (codex only over the app-server transport). Absent
    // on older sessions, where `supportsSteering` meant Claude Code only.
    steeringCliTypes: v.optional(v.array(v.string())),
    startedAt: v.number(),
    lastHeartbeatAt: v.number(),
  })
    .index("by_profile", ["profileId"])
    .index("by_profile_lastHeartbeat", ["profileId", "lastHeartbeatAt"])
    .index("by_project", ["projectId"])
    .index("by_project_and_lastHeartbeatAt", ["projectId", "lastHeartbeatAt"])
    .index("by_user_and_lastHeartbeatAt", ["userId", "lastHeartbeatAt"])
    .index("by_instanceId", ["instanceId"]),

  // CLI Chats (conversations with CLIs)
  cliThreads: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    profileId: v.id("cliProfiles"),
    pathId: v.string(), // References a path entry's `id` in cliProfiles.paths
    path: v.string(), // Snapshot of the path string at chat creation (fallback display)
    cliType: cliTypeValidator,
    title: v.string(),
    status: cliThreadStatusValidator,
    processingState: cliThreadProcessingStateValidator,
    // Container threads (OS-1364, docs/specs/thread-groups.md): `kind` marks a
    // transcript-less container; children point at it via `parentThreadId` and drop out of
    // the flat list. One nesting level — a child is never a container. `aggregateStatus`,
    // `childCount` and the unread/attention aggregates are denorms kept at the repo write seam.
    kind: v.optional(cliThreadKindValidator),
    parentThreadId: v.optional(v.id("cliThreads")),
    // Workflow run binding (OS-1366): `workflowRunId` marks the run's container
    // (kind "group") and every run-created Lane thread; `workflowLaneId` names
    // the Lane a thread executes; `workflowRunStepId` is set on Parallel-Lane
    // threads only (one thread per Step). Set at creation, never changed.
    workflowRunId: v.optional(v.id("workflowRuns")),
    workflowLaneId: v.optional(v.string()),
    workflowRunStepId: v.optional(v.id("workflowRunSteps")),
    aggregateStatus: v.optional(cliThreadAggregateStatusValidator),
    childCount: v.optional(v.number()),
    // Child-derived Watch Tower bucket, independent of workflow run status.
    childWatchStatus: v.optional(cliThreadWatchStatusValidator),
    hasUnreadChildren: v.optional(v.boolean()),
    hasAttentionChildren: v.optional(v.boolean()),
    // Oldest live child's execution branch (OS-1476) — the group row's branch
    // chip. Same seam-maintained denorm family as the fields above.
    originBranch: v.optional(v.string()),
    // Oldest live child's attached task (OS-1557) — the group row's task ref
    // chip. Denorm only: a container is never a task's `agentThreadWork`
    // participant, so this must not be read as an association.
    originTaskId: v.optional(v.id("tasks")),
    // Which child the two `origin*` denorms above were read from (OS-1599).
    // Lets the write seam answer "can this child's patch move `originBranch`/
    // `originTaskId`?" from the container doc alone, instead of collecting the
    // children to find the oldest. Not a display field.
    originThreadId: v.optional(v.id("cliThreads")),
    // The thread whose agent spawned this one through MCP `create_thread` (OS-1162).
    // Deliberately independent of `parentThreadId`, which cannot express a spawn tree:
    // grandchildren flatten into one container, and spawning from a plain thread creates a
    // fresh one. Set once at creation. No index yet — OS-1299 adds one for its per-spawner cap.
    //
    // Write paths check it names a live thread of the same user, which is what keeps that cap
    // honest (the index has no `userId`). Not a resolvability guarantee: the spawner can be
    // soft-deleted later, so readers must tolerate a dangling pointer.
    spawnedByThreadId: v.optional(v.id("cliThreads")),
    // Parent run this thread was branched from (OS-1397). Set once at creation;
    // `threadId` may dangle after the parent is deleted. Spec: cli-thread-fork.md.
    forkedFrom: v.optional(cliThreadForkedFromValidator),
    // Auto-derived values (OS-1450): never written directly by a caller.
    // `cliThreadsRepo.patchThreadWithStatusProjection` recomputes the whole
    // object from the merged doc at every write that can touch a derivation
    // input.
    statusProjection: v.optional(
      v.object({
        // Watch Tower bucket (OS-1259). Inputs: status, readAt,
        // attentionAcknowledgedAt, doneAt, lastActivityAt,
        // hasPendingInteraction, queueHeldAt.
        watchTowerStatus: cliThreadWatchStatusValidator,
        // Indexed form of `isThreadDone`, for the thread list's Done section
        // (OS-1451).
        isDone: v.boolean(),
      })
    ),
    // Denormalized "a run is parked on a pending interaction request"
    // (approval/question). Maintained by cli/interactionRequests write paths;
    // makes a mid-stream AskUserQuestion surface as waiting_input.
    hasPendingInteraction: v.optional(v.boolean()),
    hasPendingUserMessages: v.boolean(),
    // Held queue (OS-1374): set by Stop when unprocessed user messages remain
    // (and by edit-last when it un-stamps the run's other messages). Held threads keep
    // `hasPendingUserMessages: true` but are excluded from CLI pickup until
    // the next send / retry clears the hold (or the queue empties by delete).
    queueHeldAt: v.optional(v.number()),
    claimedBySessionId: v.optional(v.id("cliSessions")),
    claimedAt: v.optional(v.number()),
    claimLeaseExpiresAt: v.optional(v.number()),
    activeAssistantMessageId: v.optional(v.id("cliMessages")),
    associatedTaskId: v.optional(v.id("tasks")),
    // The first PR sent or attached; never replaced (docs/specs/github-integration.md → Pull requests in threads).
    attachedPullRequest: v.optional(attachedPullRequestValidator),
    // A Pull request checks run (OS-2400): its results belong to `attachedPullRequest` at this head, set at creation.
    pullRequestChecks: v.optional(v.object({ headSha: v.string() })),
    // A task-less thread's own Checklist (OS-2293); unset means no Checks, since a thread has no type.
    checklistId: v.optional(v.id("checklists")),
    // Immutable Project agent binding (OS-1138): set only at thread creation,
    // never changed or cleared afterwards. `agentPromptSnapshot` copies the
    // agent's prompt at creation; later agent edits never affect the thread.
    projectAgentId: v.optional(v.id("projectAgents")),
    agentPromptSnapshot: v.optional(v.string()),
    streamWatchdogId: v.optional(v.id("_scheduled_functions")),
    // The thread's git state (OS-1450). Patched as a whole through
    // `cliThreadsRepo`, which merges into the stored object.
    git: v.optional(
      v.object({
        // Pending/resolved worktree creation spec. While `status` is
        // "pending", `pathId` points at the parent repo path; the CLI creates
        // the worktree on claim and repoints `pathId` via
        // `cli/worktrees.resolveCreated`.
        worktree: v.optional(cliThreadWorktreeValidator),
        previousWorkingDirectory: v.optional(v.string()),
        legacyCheckpointsUnsafe: v.optional(v.boolean()),
        // Branch actually checked out when the CLI last started executing this
        // thread (OS-1247). Overwritten on every run start; absent for
        // detached HEAD, non-Git paths, and threads that never ran.
        executionBranch: v.optional(v.string()),
        // Last-known PR snapshot for the thread's branch (OS-1370). Written by
        // `cli/threads.reportPullRequest` after each successful CLI-side forge
        // lookup at run completion; a successful lookup that finds no PR clears
        // it, while failed lookups never reach the server (last-known survives).
        pullRequest: v.optional(cliThreadPullRequestValidator),
        // Cumulative diff-stat totals across the thread's completed runs
        // (OS-1252), incremented by the complete path from each run's
        // diffSummary. Unset when no run carried a summary.
        linesAdded: v.optional(v.number()),
        linesRemoved: v.optional(v.number()),
      })
    ),
    // Last cumulative Codex exec usage snapshot, diffed per append batch to
    // de-cumulate token counts (OS-1527); see docs/specs/cost-tracking.md.
    codexUsageCursor: v.optional(codexUsageCursorValidator),
    // Denormalized thread-level state derived from the chunk stream (OS-1442) or the message
    // stream (OS-1454). Lives here because both lists are paginated: anything computed by
    // scanning what the client loaded is wrong once the source scrolls out of the window.
    // Holds the agent's plan, the last-used CLI selection, and the latest context-window
    // and usage-limit snapshots (OS-1889), each absent until produced.
    metadata: v.optional(cliThreadMetadataValidator),
    readAt: v.optional(v.number()), // When user last read this chat (null = unread)
    attentionAcknowledgedAt: v.optional(v.number()),
    // Explicit "mark as done" (OS-1382). Also the done-tab sort key.
    doneAt: v.optional(v.number()),
    // Sticky done mark (OS-2176): only an explicit not-done or a user turn
    // clears it. Unset on legacy marks, which still expire on newer activity.
    isMarkedDone: v.optional(v.boolean()),
    createdAt: v.number(),
    lastActivityAt: v.number(),
    isDeleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    // Pin-to-top in the thread list (OS-1173).
    isPinned: v.optional(v.boolean()),
    pinnedAt: v.optional(v.number()),
    // Read-only sharing with project teammates (OS-1574). Presence is the
    // flag — set on share, cleared on unshare — so a later shared-threads
    // list can order by "most recently shared".
    sharedAt: v.optional(v.number()),
  })
    .index("by_user_project", ["userId", "projectId"])
    .index("by_userId_projectId_isDeleted_kind_lastActivityAt", ["userId", "projectId", "isDeleted", "kind", "lastActivityAt"])
    .index("by_project_and_isDeleted", ["projectId", "isDeleted"])
    .index("by_project_and_isDeleted_and_lastActivityAt", ["projectId", "isDeleted", "lastActivityAt"])
    // Flat thread list (OS-1364): the sort × done index family all
    // discriminate on `parentThreadId` so container children (field set) drop
    // out; `eq(..., undefined)` matches legacy rows with the field unset.
    .index("by_user_project_deleted_parent_lastActivity", ["userId", "projectId", "isDeleted", "parentThreadId", "lastActivityAt"])
    .index("by_parentThreadId", ["parentThreadId"])
    .index("by_workflowRunId", ["workflowRunId"])
    // No reader yet — the engine resolves a lane's thread from the lane row's
    // `threadId`; kept for run-scoped thread sweeps (full cancel, OS-1871).
    .index("by_workflowRunId_and_workflowLaneId", ["workflowRunId", "workflowLaneId"])
    // Top-level Watch Tower sections. Spec: watch-tower.md.
    .index("by_user_project_deleted_parent_watchTowerStatus_lastActivity", [
      "userId", "projectId", "isDeleted", "parentThreadId", "statusProjection.watchTowerStatus", "lastActivityAt",
    ])
    .index("by_project_deleted_parent_watchTowerStatus_lastActivity", [
      "projectId", "isDeleted", "parentThreadId", "statusProjection.watchTowerStatus", "lastActivityAt",
    ])
    .index("by_user_deleted_parent_watchTowerStatus_lastActivity", [
      "userId",
      "isDeleted",
      "parentThreadId",
      "statusProjection.watchTowerStatus",
      "lastActivityAt",
    ])
    // Desktop attention feed and pre-backfill Watch Tower keep individual children.
    .index("by_user_deleted_kind_watchTowerStatus_lastActivity", [
      "userId",
      "isDeleted",
      "kind",
      "statusProjection.watchTowerStatus",
      "lastActivityAt",
    ])
    // Desktop popover (OS-1237): active threads across all projects.
    .index("by_user_processing_deleted_lastActivity", ["userId", "processingState", "isDeleted", "lastActivityAt"])
    .index("by_user_pending_deleted_lastActivity", ["userId", "hasPendingUserMessages", "isDeleted", "lastActivityAt"])
    .index("by_user_project_task_deleted_lastActivity", ["userId", "projectId", "associatedTaskId", "isDeleted", "lastActivityAt"])
    .index("by_project_attachedPullRequestRef_deleted_lastActivity", ["projectId", "attachedPullRequest.ref", "isDeleted", "lastActivityAt"])
    .index("by_profile", ["profileId"])
    .index("by_profile_pending_deleted_lastActivityAt", ["profileId", "hasPendingUserMessages", "isDeleted", "lastActivityAt"])
    .index("by_user_project_deleted_parent_createdAt", ["userId", "projectId", "isDeleted", "parentThreadId", "createdAt"])
    // Thread-list sections (OS-1451): the two above × the isDone filter.
    .index("by_user_project_deleted_isDone_parent_lastActivity", [
      "userId",
      "projectId",
      "isDeleted",
      "statusProjection.isDone",
      "parentThreadId",
      "lastActivityAt",
    ])
    .index("by_user_project_deleted_isDone_parent_createdAt", [
      "userId",
      "projectId",
      "isDeleted",
      "statusProjection.isDone",
      "parentThreadId",
      "createdAt",
    ])
    // Pinned section (OS-1173).
    .index("by_user_project_deleted_pinned_pinnedAt", ["userId", "projectId", "isDeleted", "isPinned", "pinnedAt"])
    // Shared-threads view (OS-1576): `listSharedByProject` reads it as
    // `.eq(userId).eq(projectId).eq(isDeleted, false).gt("sharedAt", 0)` —
    // unset `sharedAt` sorts before every number, so the range excludes
    // unshared rows — then `.order("desc")` for most recently shared first.
    .index("by_user_project_deleted_sharedAt", ["userId", "projectId", "isDeleted", "sharedAt"])
    .index("by_claimedBySessionId", ["claimedBySessionId"])
    .index("by_claimLeaseExpiresAt", ["claimLeaseExpiresAt"]),

  // CLI Messages (individual messages in threads)
  cliMessages: defineTable({
    threadId: v.id("cliThreads"),
    role: cliMessageRoleValidator,
    profileId: v.id("cliProfiles"),
    cliType: cliTypeValidator,
    cliMode: v.optional(v.string()),
    cliModel: v.optional(cliModelValidator),
    cliEffort: v.optional(cliEffortValidator),
    cliVersion: v.optional(v.string()),
    cliContext: v.optional(cliMessageContextValidator),
    taskId: v.optional(v.id("tasks")),
    pullRequest: v.optional(attachedPullRequestValidator),
    attachments: v.optional(v.array(cliMessageAttachmentValidator)),
    nextChunkOrder: v.optional(v.number()),
    content: v.array(
      v.object({
        type: v.string(), // "text", "tool_use", "tool_result", etc.
        data: v.string(), // Content or JSON stringified data
        timestamp: v.number(),
      })
    ),
    processedContent: v.optional(v.string()),
    // User message is a runtime slash command (e.g. "/compact"): delivered to
    // the agent raw as its own solo run, never expanded or envelope-wrapped.
    runtimeCommand: v.optional(v.boolean()),
    // Runtime command delivered ahead of the queue (OS-2339). Spec: cli-runtime-commands.md.
    queueFirst: v.optional(v.boolean()),
    // Non-human sender of a user message (OS-1162), written only by MCP
    // `send_thread_message`. Absent means a human sent it from the composer,
    // which is what absence already meant, so existing rows need no backfill.
    // Not `origin*` — that prefix means something else on `cliThreads`.
    sentBy: v.optional(cliMessageSentByValidator),
    status: cliMessageStatusValidator,
    // Claim mechanism for preventing race conditions
    claimedBySessionId: v.optional(v.id("cliSessions")),
    claimedAt: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    processedBySessionId: v.optional(v.id("cliSessions")),
    runId: v.optional(v.string()),
    // User asked to inject this queued message into the in-progress run
    // (steering). Cleared whenever the message is stamped into a run.
    steerRequestedAt: v.optional(v.number()),
    // Set when the message was consumed by steering into an active run.
    // Its content then renders inline in the assistant stream (marker chunk),
    // so the standalone bubble is hidden. Cleared on retry.
    steeredAt: v.optional(v.number()),
    // Git change summary for the run this assistant message represents
    // (OS-1142). Written by `complete`; absent for non-git working
    // directories, capture failures, and runs that changed nothing.
    diffSummary: v.optional(cliRunDiffSummaryValidator),
    // When this run's first cost event was recorded. Later usage-bearing
    // batches merge tokens without incrementing rollup `runCount`.
    costRecordedAt: v.optional(v.number()),
    codexModelState: v.optional(codexModelStateValidator),
    // The Workflow run Step this message executes (OS-1366): stamped on
    // run-dispatched user messages and their assistant replies, so the
    // orchestrator can re-point Step message links on retry.
    workflowRunStepId: v.optional(v.id("workflowRunSteps")),
    // A Bash step's script (OS-1886): the CLI runs it instead of prompting the
    // agent, as its own solo run like `runtimeCommand`. User messages only.
    scriptRequest: v.optional(cliScriptRequestValidator),
    // How that script run ended; written by `complete` on the assistant message.
    scriptResult: v.optional(cliScriptResultValidator),
    errorMessage: v.optional(v.string()), // Error details if failed
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    // No reader yet — OS-1870's retry maps a step back to its dispatched messages.
    .index("by_workflowRunStepId", ["workflowRunStepId"])
    .index("by_thread_and_createdAt", ["threadId", "createdAt"]) // For paginated listByThread
    // Run membership: un-stamping and re-delivering a stranded run both need
    // its rows without scanning thread history (OS-1672).
    .index("by_thread_and_runId_and_createdAt", ["threadId", "runId", "createdAt"])
    .index("by_thread_and_role_and_createdAt", ["threadId", "role", "createdAt"])
    .index("by_thread_and_role_and_status_and_createdAt", ["threadId", "role", "status", "createdAt"])
    .index("by_thread_and_role_and_processedAt_and_createdAt", ["threadId", "role", "processedAt", "createdAt"])
    .index("by_profile_and_status", ["profileId", "status"])
    .index("by_profile_and_status_and_createdAt", ["profileId", "status", "createdAt"]), // For FIFO listPending

  // Attachment references for CLI message uploads (used for pending upload cleanup)
  cliMessageAttachmentRefs: defineTable({
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"),
    storageId: v.id("_storage"),
    // The message's role; unset on rows older than `backfillCliMessageAttachmentRefRole` (OS-2289).
    role: v.optional(cliMessageRoleValidator),
    createdAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_messageId", ["messageId"])
    // Evidence tab: the thread's agent files, newest first (OS-2289).
    .index("by_threadId_and_role", ["threadId", "role"]),

  // Pending CLI message uploads (uploaded but not yet persisted on a message).
  cliMessagePendingUploads: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_user_and_project", ["userId", "projectId"])
    // Retention sweep: drafts keep unsent uploads (OS-2141).
    .index("by_createdAt", ["createdAt"]),

  // CLI Message stream chunks (assistant content payload stored per chunk row).
  // `threadId` and `profileId` are denormalized from `cliMessages` to support
  // selective thread-scoped reads and operational debugging without parent fetches.
  cliMessageChunks: defineTable({
    messageId: v.id("cliMessages"),
    threadId: v.id("cliThreads"),
    profileId: v.id("cliProfiles"),
    chunkOrder: v.number(),
    type: v.string(),
    data: v.string(),
    normalizedEvent: v.optional(cliNormalizedEventValidator),
    // Partial-streaming rows (deltas) that are superseded by the final whole
    // message chunks; deleted when the assistant message completes.
    // `literal(true)`, not `boolean`: the flag is set or absent, never `false`
    // — which is what lets readers address the stored range as
    // `eq("ephemeral", undefined)` (OS-1673).
    ephemeral: v.optional(v.literal(true)),
    timestamp: v.number(),
    createdAt: v.number(),
  })
    .index("by_thread_and_message_and_chunkOrder", ["threadId", "messageId", "chunkOrder"])
    .index("by_thread_and_message_and_createdAt_and_chunkOrder", ["threadId", "messageId", "createdAt", "chunkOrder"])
    .index("by_thread_and_createdAt_and_messageId_and_chunkOrder", ["threadId", "createdAt", "messageId", "chunkOrder"])
    // Batched post-completion cleanup of partial-streaming rows, and the tail
    // scans that must exclude them: `ephemeral` before `chunkOrder` keeps a
    // reader's index range disjoint from that cleanup's write set (OS-1673).
    // Ephemeral rows are `true`, stored rows leave the field unset, so readers
    // address the stored range as `eq("ephemeral", undefined)`.
    .index("by_thread_and_message_and_ephemeral_and_chunkOrder", ["threadId", "messageId", "ephemeral", "chunkOrder"]),

  // The chunk cursor of an in-flight assistant message. Off `cliMessages` so a
  // 4/s flush invalidates no envelope subscription (OS-1729); no query reads
  // this table. Created on the run's first flush, and at settle its value is
  // written back to `cliMessages.nextChunkOrder` and the row deleted.
  cliMessageStreamHeads: defineTable({
    messageId: v.id("cliMessages"),
    nextChunkOrder: v.number(),
  }).index("by_message", ["messageId"]),

  // Interactive requests from a running CLI agent to the web user (tool
  // approvals, questions, plan approvals). Provider-neutral: `kind` + opaque
  // JSON payloads so future runtimes (Codex, ...) reuse the same channel.
  cliInteractionRequests: defineTable({
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"), // assistant target for the run
    sessionId: v.id("cliSessions"),
    profileId: v.id("cliProfiles"),
    requestId: v.string(), // CLI-generated, unique per thread
    kind: cliInteractionKindValidator, // imported from lib/contracts/validators
    payloadJson: v.string(),
    status: cliInteractionStatusValidator,
    responseJson: v.optional(v.string()),
    answeredAt: v.optional(v.number()),
    cancelledReason: v.optional(v.string()),
    // Tied to the thread claim lease (not the 60s session heartbeat).
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_and_status_and_expiresAt", ["threadId", "status", "expiresAt"])
    .index("by_session_and_status", ["sessionId", "status"])
    .index("by_thread_and_requestId", ["threadId", "requestId"]),

  // Filesystem git-worktree operations the web asks a connected CLI to run
  // outside any thread (rescan refs/worktrees, remove a worktree). The web
  // enqueues + watches the row; the CLI subscribes to pending ops per profile
  // and fulfills them. Rows are ephemeral (pruned via scheduler after a TTL).
  cliWorktreeOps: defineTable({
    profileId: v.id("cliProfiles"),
    requestedBy: v.id("users"),
    kind: cliWorktreeOpKindValidator,
    pathId: v.string(), // rescan: repo path entry id; remove: worktree entry id
    path: v.string(), // resolved absolute path snapshot for the CLI
    parentPath: v.optional(v.string()), // remove: parent repo path to run git from
    filePath: v.optional(v.string()), // readFile/diffFile: repo-relative file path
    filePaths: v.optional(v.array(v.string())), // revertWorkingTree: the files the user saw
    allowLegacyCheckpoint: v.optional(v.boolean()),
    preRef: v.optional(v.string()), // diffFile: baseline checkpoint ref
    postRef: v.optional(v.string()), // readFile/diffFile: post-run checkpoint ref
    query: v.optional(v.string()), // searchFiles: composer @-mention search text
    status: cliWorktreeOpStatusValidator,
    error: v.optional(v.string()),
    resultJson: v.optional(v.string()), // rescan: `{ refs: [...] }`
    storageId: v.optional(v.id("_storage")), // downloadFile: the uploaded blob, deleted with the row
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_profile_and_status", ["profileId", "status"])
    .index("by_storageId", ["storageId"]),

  // Advertised model catalogs, off the session/profile rows those hot paths rewrite
  // (OS-1721). One row per (profile, cliType), read only where models are offered;
  // survives disconnect. See docs/specs/cli-opencode-runtime.md.
  cliRuntimeCatalogs: defineTable({
    profileId: v.id("cliProfiles"),
    // Denormalized from the profile (immutable there) so the composer reads every
    // catalog it needs in one index range, without touching a profile document.
    projectId: v.id("projects"),
    userId: v.id("users"),
    cliType: cliTypeValidator,
    models: v.array(cliCatalogModelValidator),
    reportedAt: v.number(),
  })
    .index("by_profile_and_cliType", ["profileId", "cliType"])
    .index("by_project_and_user", ["projectId", "userId"]),

  // Runtime inventory facts captured from live runs (first key: slash commands from the
  // agent's init event). Generic upsert channel: one row per (profile, cliType, key, pathId),
  // last writer wins, so composers can offer runtime capabilities while the agent is offline.
  // Small + stable inventory only; parameterized live lookups belong to a future RPC channel.
  cliRuntimeFacts: defineTable({
    profileId: v.id("cliProfiles"),
    cliType: cliTypeValidator,
    pathId: v.string(), // cliProfiles.paths entry id the run executed in
    key: v.string(), // fact kind, e.g. "slashCommands"
    payload: v.string(), // JSON payload; shape owned by the key
    reportedAt: v.number(),
  }).index("by_profile_cliType_key_pathId", ["profileId", "cliType", "key", "pathId"]),

  // Pre-aggregated agent spend from CLI thread runs (OS-1132). One row per (project, user,
  // task?, cliType, UTC day) — deliberately WITHOUT a thread dimension so project/task range
  // reads stay bounded regardless of thread count (thread summaries read `threadCostRollups`).
  // An unset taskId means the thread wasn't attached to a task, and the spend still counts
  // toward project/member totals. Its own table so high-frequency cost writes don't
  // invalidate hot-doc subscribers.
  costRollups: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    taskId: v.optional(v.id("tasks")),
    // Deprecated migration-only field. Older rows briefly stored threadId on
    // the coarse rollup; `migrations.clearLegacyCostRollupThreadIds` removes it.
    threadId: v.optional(v.id("cliThreads")),
    cliType: cliTypeValidator,
    dayStartMs: v.number(), // UTC midnight
    costUsd: v.number(),
    byModel: v.array(costModelUsageValidator),
    costMetadata: v.optional(costMetadataValidator),
    // Recorded cost events (finished agent runs/batches) folded into this row.
    runCount: v.optional(v.number()),
    updatedAt: v.number(),
  })
    // Upsert identity.
    .index("by_project_user_task_cliType_day", ["projectId", "userId", "taskId", "cliType", "dayStartMs"])
    .index("by_project_and_day", ["projectId", "dayStartMs"])
    .index("by_task_and_day", ["taskId", "dayStartMs"]),

  // Thread-grain companion to `costRollups` (same events, second write):
  // one row per (thread, UTC day), read only by the thread cost summary so
  // its scan is bounded by the thread's active days.
  threadCostRollups: defineTable({
    threadId: v.id("cliThreads"),
    dayStartMs: v.number(), // UTC midnight
    costUsd: v.number(),
    byModel: v.array(costModelUsageValidator),
    costMetadata: v.optional(costMetadataValidator),
    runCount: v.number(),
    updatedAt: v.number(),
  }).index("by_thread_and_day", ["threadId", "dayStartMs"]),

  // Browser-approve login requests for the CLI (OS-1137). Short-lived: a scheduled janitor
  // deletes each row shortly after its TTL, covering abandoned, denied, expired and completed
  // alike. The plaintext key is never stored — `poll` mints it, returns it, and deletes the row.
  cliLoginRequests: defineTable({
    challengeId: v.string(), // public random id carried by the approve link
    userCode: v.string(), // short human code (e.g. "WDJB-MJHT") for /device
    verifierHash: v.string(), // SHA-256 hex of the CLI-held verifier
    status: cliLoginRequestStatusValidator,
    hostname: v.optional(v.string()), // shown on the approve page
    approvedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_challengeId", ["challengeId"])
    .index("by_userCode", ["userCode"]),

  // Per-user failed /device code lookups (fail-closed brute-force guard on
  // the short userCode; one row per user, window resets after the TTL).
  cliLoginDeviceAttempts: defineTable({
    userId: v.id("users"),
    windowStartedAt: v.number(),
    failedCount: v.number(),
  }).index("by_user", ["userId"]),

  // Dynamically registered OAuth clients (RFC 7591) for the MCP OAuth flow
  // (OS-1192). Public clients only (PKCE, no secret). Rows are inert without
  // a user approval.
  oauthClients: defineTable({
    clientId: v.string(),
    clientName: v.optional(v.string()),
    redirectUris: v.array(v.string()),
    // Set when a user approves an authorization for this client; clients
    // never approved are janitor-deleted after a TTL (registration is
    // unauthenticated, so unused rows must not accumulate).
    lastApprovedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_clientId", ["clientId"])
    // Dedup lookup so repeated registrations reuse the existing client.
    .index("by_clientName", ["clientName"]),

  // One-time OAuth authorization codes minted at consent (OS-1192). Same
  // janitor pattern as cliLoginRequests; the access token (an sk_user_ API
  // key) is minted at /oauth/token exchange and never stored.
  oauthAuthRequests: defineTable({
    code: v.string(), // 256-bit random, single-use
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(), // PKCE S256 challenge (SHA-256 of verifier, base64url)
    approvedByUserId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_code", ["code"]),

  // User Preferences (one row per user, all UI preferences)
  userPreferences: defineTable({
    userId: v.id("users"),
    threadSortBy: v.optional(threadSortByValidator),
    threadCompactLayout: v.optional(v.boolean()),
    // The PR browser pane's row density, off (full cards) by default.
    pullRequestCompactLayout: v.optional(v.boolean()),
    // Split the thread list into Active/Done sections (OS-1394), on by default
    // since OS-1561 made the collapsed Done section the put-away place. `upsert`
    // persists this explicitly, so the default only reaches rows that never
    // stored it.
    threadGroupDone: v.optional(v.boolean()),
    // Deprecated (OS-1382): auto mark-read is always on now that done is an
    // explicit action. Kept optional so existing rows keep validating.
    threadAutoMarkRead: v.optional(v.boolean()),
    // Favorite CLI+model+effort combos pinned in the CLI selector (OS-1208)
    cliFavoriteCombos: v.optional(v.array(cliFavoriteComboValidator)),
    sectionHeaderStyle: v.optional(sectionHeaderStyleValidator),
    sectionColorStyle: v.optional(sectionColorStyleValidator),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Per-user per-project preferences (one row per user+project)
  userProjectPreferences: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    // OS-1131: assignment automation starts the thread without the composer
    // dialog. Personal consent — the thread runs as the assigning user.
    agentAutoStart: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index("by_user_and_project", ["userId", "projectId"]),
  // GitHub integration (docs/specs/github-integration.md). A project's
  // authorized link to one code-host repository; generation fences jobs.
  integrationRepositoryLinks: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    repositoryId: v.id("integrationRepositories"),
    provider: integrationProviderValidator,
    github: v.object({ installationId: v.number(), accountLogin: v.string() }),
    status: repositoryLinkStatusValidator,
    generation: v.number(),
    connectedBy: v.id("users"),
    connectedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
    deleteAfter: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_projectId_and_status_and_disconnectedAt", ["projectId", "status", "disconnectedAt"])
    .index("by_repositoryId_and_status", ["repositoryId", "status"])
    .index("by_provider_and_githubInstallationId", ["provider", "github.installationId"])
    .index("by_organizationId_and_status", ["organizationId", "status"]),

  // Provider repository metadata, shared by the links of one organization.
  integrationRepositories: defineTable({
    organizationId: v.id("organizations"),
    provider: integrationProviderValidator,
    host: v.string(),
    providerRepositoryId: v.number(),
    owner: v.string(),
    name: v.string(),
    isPrivate: v.boolean(),
    htmlUrl: v.string(),
    syncStatus: repositorySyncStatusValidator,
    importPage: v.optional(v.number()),
    importedCount: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    leaseClaimedAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    error: v.optional(v.string()),
    // Stored PRs per list tab, kept by every sync commit.
    openCount: v.optional(v.number()),
    closedCount: v.optional(v.number()),
    // While a backfill counts existing rows: the counts cover rows numbered up to this.
    countedThroughNumber: v.optional(v.number()),
    // Reconciliation: the running pass's start, and the start of the last finished one.
    reconcileStartedAt: v.optional(v.number()),
    reconciledAt: v.optional(v.number()),
    // Closed history: the next GitHub page, and every closed PR updated at or after `coveredThrough` is stored.
    history: v.optional(v.object({ nextPage: v.number(), coveredThrough: v.number(), complete: v.boolean() })),
    // The page a history job is importing; identifies its chain like importPage.
    historyRequest: v.optional(v.object({ page: v.number(), requestedAt: v.number() })),
  })
    .index("by_organizationId_and_provider_and_host_and_providerRepositoryId", [
      "organizationId",
      "provider",
      "host",
      "providerRepositoryId",
    ])
    .index("by_provider_and_host_and_providerRepositoryId", ["provider", "host", "providerRepositoryId"]),

  integrationPullRequests: defineTable({
    repositoryId: v.id("integrationRepositories"),
    ...normalizedPullRequestValidator.fields,
    syncedAt: v.number(),
  })
    .index("by_repositoryId_and_number", ["repositoryId", "number"])
    .index("by_repositoryId_and_state_and_providerUpdatedAt", ["repositoryId", "state", "providerUpdatedAt"])
    .index("by_repositoryId_and_state_and_providerCreatedAt", ["repositoryId", "state", "providerCreatedAt"])
    .index("by_repositoryId_and_stackId", ["repositoryId", "stack.id"]),

  // A 10-minute connect flow bound to one user and project. The encrypted
  // user token lets repository selection recheck GitHub admin permission.
  integrationSetups: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    provider: integrationProviderValidator,
    stateHash: v.string(),
    expiresAt: v.number(),
    status: integrationSetupStatusValidator,
    github: v.object({ encryptedToken: v.optional(v.string()) }),
  })
    .index("by_provider_and_stateHash", ["provider", "stateHash"])
    .index("by_provider_and_userId_and_projectId", ["provider", "userId", "projectId"]),
});
