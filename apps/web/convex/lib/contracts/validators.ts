import { BOARD_GROUP_BY_VALUES } from "../../../lib/navigation/constants";
/**
 * Shared validators for Convex schema and mutations.
 * Import these validators to ensure consistency across schema.ts and task modules.
 */
import { isRecord } from "../../../lib/type-guards";
import { v, type Infer } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { Status } from "../../../lib/tasks/status";
import { Priority } from "../../../lib/tasks/priority";
import { isCatalogCliType, type CatalogCliRuntimeSlug, type CliRuntimeSlug as RuntimeCliType } from "../../cli/lib/runtimes/contracts";
import { availableCliValidator, availableGenericCliValidator, cliTypeValidator } from "../../cli/lib/runtimes/validators";
import { cliCatalogModelValidator, type CliCatalogModel } from "../../cli/lib/runtimes/shared/validators";
// Type-only: the validator itself stays in the cli domain, since importing it as a
// value here would close a cycle through the runtime registry.
import type { CliRuntimeCatalog } from "../../cli/lib/validators";
import type { CliRuntimeAvailableCli as RuntimeAvailableCli } from "../../cli/lib/runtimes/registry";
import { OrgRole, ProjectRole, InvitationStatus, InvitationRole } from "../../../lib/authz/roles";

export const statusValidator = v.union(
  v.literal(Status.TODO),
  v.literal(Status.TRIAGE),
  v.literal(Status.PLANNING),
  v.literal(Status.PLAN_REVIEW),
  v.literal(Status.IN_PROGRESS),
  v.literal(Status.IN_REVIEW),
  v.literal(Status.BLOCKED),
  v.literal(Status.DONE),
  v.literal(Status.CANCELED)
);

export const priorityValidator = v.union(
  v.literal(Priority.CRITICAL),
  v.literal(Priority.HIGH),
  v.literal(Priority.MEDIUM),
  v.literal(Priority.LOW),
  v.literal(Priority.NONE)
);

export const taskTableColumnValidator = v.union(
  v.literal("priority"),
  v.literal("dueDate"),
  v.literal("tags"),
  v.literal("label"),
  v.literal("assignee")
);

// Project default view: which task view entry links into the project target.
export const projectViewModeValidator = v.union(v.literal("list"), v.literal("board"));
export type ProjectViewMode = Infer<typeof projectViewModeValidator>;

export const boardGroupByValidator = v.union(...BOARD_GROUP_BY_VALUES.map(value => v.literal(value)));
export type BoardGroupBy = Infer<typeof boardGroupByValidator>;
export const listGroupByValidator = v.union(v.literal("none"), ...boardGroupByValidator.members);
export type ListGroupBy = Infer<typeof listGroupByValidator>;
/** Board rows offer the same values as the list: None or any column dimension. */
export const boardRowGroupByValidator = listGroupByValidator;
export type BoardRowGroupBy = ListGroupBy;

export const orgRoleValidator = v.union(v.literal(OrgRole.OWNER), v.literal(OrgRole.ADMIN), v.literal(OrgRole.MEMBER));

export const projectRoleValidator = v.union(
  v.literal(ProjectRole.PROJECT_ADMIN),
  v.literal(ProjectRole.MEMBER),
  v.literal(ProjectRole.VIEWER)
);

export const apiKeyStoredScopeValidator = v.optional(
  v.object({
    kind: v.literal("organization"),
    organizationId: v.id("organizations"),
    projectIds: v.array(v.id("projects")),
  })
);

export const apiKeyScopeInputValidator = v.union(
  v.null(),
  v.object({
    organizationId: v.id("organizations"),
    projectIds: v.array(v.id("projects")),
  })
);

export const apiKeyPrincipalScopeValidator = v.union(
  v.object({ kind: v.literal("unscoped") }),
  v.object({
    kind: v.literal("organization"),
    organizationId: v.id("organizations"),
    projectIds: v.array(v.id("projects")),
  })
);

export const apiKeyScopeReturnValidator = v.union(
  v.object({ kind: v.literal("unscoped") }),
  v.object({
    kind: v.literal("organization"),
    organizationId: v.id("organizations"),
    organizationName: v.string(),
    projectIds: v.array(v.id("projects")),
    projects: v.array(
      v.object({
        _id: v.id("projects"),
        name: v.string(),
        alias: v.string(),
      })
    ),
    unavailableProjectCount: v.number(),
  })
);

export const invitationStatusValidator = v.union(
  v.literal(InvitationStatus.PENDING),
  v.literal(InvitationStatus.ACCEPTED),
  v.literal(InvitationStatus.EXPIRED),
  v.literal(InvitationStatus.REVOKED)
);

export const invitationRoleValidator = v.union(v.literal(InvitationRole.ADMIN), v.literal(InvitationRole.MEMBER));

// API Key list item (excludes sensitive keyHash)
// CLI Types - supported coding CLIs
export { cliTypeValidator };
export { DEFAULT_FALLBACK_CLI_TYPE } from "../../cli/lib/runtimes/contracts";
export { getSupportedCliTypes, isCliType, isSupportedCliEffort, isSupportedCliModel } from "../../cli/lib/runtimes/registry";
export type CliType = RuntimeCliType;

export const cliModelValidator = v.string();
export type CliModel = Infer<typeof cliModelValidator>;

// Reasoning-effort slot; provider-agnostic at the schema boundary,
// runtime-specific validation lives in the runtime subsystem.
export const cliEffortValidator = v.string();
export type CliEffort = Infer<typeof cliEffortValidator>;

export { availableGenericCliValidator, availableCliValidator };

// The stored catalog row's model shape. Not `opencodeAdvertisedModelValidator`, whose
// `providerID`/`modelID` optionals exist only for hot-row documents written before OS-1721.
export { cliCatalogModelValidator };
export type AvailableCli = RuntimeAvailableCli;

/**
 * A runtime a profile advertises, minus the catalog's display labels (an opencode
 * catalog is tens of KB — OS-1721). Lives here rather than in `cli/lib` because
 * the MCP domain shapes profiles with it too.
 *
 * At most one of `cliModels` and `modelCount` is present — a runtime advertising
 * no catalog carries neither.
 */
export const cliRuntimeSummaryValidator = v.object({
  type: v.string(),
  version: v.string(),
  provider: v.optional(v.string()),
  /** Catalog size, for surfaces that only report that a catalog exists. */
  modelCount: v.optional(v.number()),
  cliModels: v.optional(
    v.array(
      v.object({
        model: v.string(),
        /** The model's `cliEffort` values; OpenCode and Antigravity efforts are per-model variants. */
        efforts: v.optional(v.array(v.string())),
      })
    )
  ),
});
export type CliRuntimeSummary = Infer<typeof cliRuntimeSummaryValidator>;

/** The `cliModel`/`cliEffort` values an advertised catalog offers: OpenCode and Antigravity slugs, Claude slots. */
function toCliModelValues(cli: AvailableCli): CliRuntimeSummary["cliModels"] {
  if (!("models" in cli) || !cli.models) {
    return undefined;
  }
  return cli.models.map((model) => ({
    model: "slug" in model ? model.slug : model.slot,
    efforts: "variants" in model ? model.variants : undefined,
  }));
}

/**
 * Project advertised runtimes down to the summary. `withCliModels` keeps the
 * accepted model + effort values (agents pick a target from them); without it only
 * the catalog's size survives.
 */
export function toRuntimeSummaries(
  availableClis: readonly AvailableCli[],
  options?: { withCliModels?: boolean }
): CliRuntimeSummary[] {
  return availableClis.map((cli) => {
    const cliModels = options?.withCliModels === true ? toCliModelValues(cli) : undefined;
    return {
      type: cli.type,
      version: cli.version,
      provider: "provider" in cli ? cli.provider : undefined,
      modelCount: cliModels === undefined && "models" in cli && cli.models ? cli.models.length : undefined,
      cliModels,
    };
  });
}

/**
 * What a registration claims about one runtime's catalog. Absent `models` means
 * *unknown* (the CLI's inventory failed), never "none" — see
 * `docs/specs/cli-opencode-runtime.md`.
 */
export type CliAdvertisedCatalog = {
  cliType: CliType;
  models?: CliCatalogModel[];
};

type CatalogAvailableCli = Extract<AvailableCli, { type: CatalogCliRuntimeSlug }>;

function isCatalogCli(cli: AvailableCli): cli is CatalogAvailableCli {
  return isCatalogCliType(cli.type);
}

/**
 * Split a registration's advertised runtimes into what the session/profile rows
 * keep and what the catalog table takes (OS-1721). Claude's `models` and
 * OpenCode's `defaultModel` are dropped: nothing reads them.
 */
export function splitAdvertisedCatalogs(
  clis: readonly AvailableCli[],
): { runtimes: AvailableCli[]; catalogs: CliAdvertisedCatalog[] } {
  const runtimes: AvailableCli[] = [];
  const catalogs: CliAdvertisedCatalog[] = [];

  for (const cli of clis) {
    if (isCatalogCli(cli)) {
      runtimes.push(cli.type === "antigravity" && cli.provider
        ? { type: cli.type, version: cli.version, provider: cli.provider }
        : { type: cli.type, version: cli.version });
      catalogs.push(cli.models ? { cliType: cli.type, models: cli.models } : { cliType: cli.type });
      continue;
    }
    if (cli.type === "claude-code") {
      runtimes.push({
        type: cli.type,
        version: cli.version,
        provider: cli.provider,
      });
      continue;
    }
    runtimes.push(cli);
  }

  return { runtimes, catalogs };
}

/**
 * Put one profile's stored catalogs back on the runtimes that advertised them, in
 * the shape every model/effort helper consumes. Scoped here because callers batch
 * profiles into one query; no catalog reads as unadvertised, which the resolvers
 * treat leniently.
 */
export function hydrateAvailableClis(
  runtimes: readonly AvailableCli[],
  catalogs: readonly CliRuntimeCatalog[],
  profileId: Id<"cliProfiles">,
): AvailableCli[] {
  return runtimes.map((cli) => {
    if (!isCatalogCli(cli)) {
      return cli;
    }
    const catalog = catalogs.find((entry) => entry.profileId === profileId && entry.cliType === cli.type);
    return catalog ? { ...cli, models: catalog.models } : cli;
  });
}

// Favorite CLI+model+effort combos pinned at the top of the CLI selector
// (OS-1208). Stored on userPreferences; model/effort validity against the
// runtime registry is enforced client-side on read, like last-used recents.
export const cliFavoriteComboValidator = v.object({
  cliType: cliTypeValidator,
  cliModel: cliModelValidator,
  cliEffort: v.optional(cliEffortValidator),
});
export type CliFavoriteCombo = Infer<typeof cliFavoriteComboValidator>;
export const MAX_CLI_FAVORITE_COMBOS = 20;

// CLI Thread status
export const cliThreadStatusValidator = v.union(
  v.literal("waiting_input"), // Waiting for user to approve or reply
  v.literal("pending"), // Message sent, waiting for CLI to pick up
  v.literal("streaming"), // CLI is processing/streaming response
  v.literal("failed"), // Last message failed
  v.literal("completed") // Chat ended (future use)
);

// Denormalized Watch Tower bucket (OS-1259), derived from status + read/attention
// state at the cliThreadsRepo write seams. Never write it directly — always via
// deriveThreadWatchStatus (convex/cli/lib/watchStatus.ts).
export const cliThreadWatchStatusValidator = v.union(
  v.literal("running"), // streaming or pending, or settled while its watched PR's checks run
  v.literal("waiting_input"), // waiting_input with unacknowledged attention
  v.literal("failed"), // failed with unacknowledged attention
  v.literal("needs_review"), // finished (or attention acknowledged) and unread
  v.literal("done") // finished and read
);
export type CliThreadWatchStatus = Infer<typeof cliThreadWatchStatusValidator>;

// Internal chat processing state for claim-based queue processing
export const cliThreadProcessingStateValidator = v.union(v.literal("idle"), v.literal("claimed"), v.literal("streaming"));

// Container threads (OS-1364): a thread with `kind` set is a container with no
// transcript of its own; absent kind = plain chat thread. A Workflow run's
// container is a "group" with `workflowRunId` set (OS-1366).
// See docs/specs/thread-groups.md.
export const cliThreadKindValidator = v.literal("group");
export type CliThreadKind = Infer<typeof cliThreadKindValidator>;

// Denormalized container status derived from its children at the
// cliThreadsRepo write seam: any child failed (unacknowledged) → failed;
// else any waiting_input → needs_attention; else any streaming/pending →
// running; else idle.
export const cliThreadAggregateStatusValidator = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("needs_attention"),
  v.literal("failed")
);
export type CliThreadAggregateStatus = Infer<typeof cliThreadAggregateStatusValidator>;

export const cliMessageRoleValidator = v.union(v.literal("user"), v.literal("assistant"));
export type CliMessageRole = Infer<typeof cliMessageRoleValidator>;

// CLI Message status
export const cliMessageStatusValidator = v.union(
  v.literal("pending"), // Legacy retry/backward-compat status
  v.literal("claimed"), // Legacy status for pre chat-level claim records
  v.literal("streaming"), // CLI is streaming response
  v.literal("completed"), // Done successfully
  v.literal("failed") // Failed with error
);

// Per-run accounting evidence; configured model slots remain separate.
export const codexModelStateValidator = v.object({
  model: v.optional(v.string()),
  source: v.union(v.literal("configured"), v.literal("startup"), v.literal("runtime"), v.literal("unknown")),
  turnId: v.optional(v.string()),
  pendingChange: v.optional(v.boolean()),
});
export type CodexModelState = Infer<typeof codexModelStateValidator>;

// Provider-agnostic continuation metadata for CLI messages
export const cliMessageContextValidator = v.object({
  continuationId: v.optional(v.string()),
  /** The Codex turn this reply is; a branch forks through it (OS-2073, cli-thread-fork.md). */
  turnId: v.optional(v.string()),
  interruptedContextIncluded: v.optional(v.boolean()),
});

// Per-file entry of a completed run's git change summary (OS-1142).
// Renames surface as delete+add (the CLI diffs with --no-renames).
export const cliRunDiffFileValidator = v.object({
  // Relative to `repo` when set, else to the working directory.
  path: v.string(),
  // Multi-repo folder: the repo's relative path (docs/specs/cli-thread-run-diffs.md#multi-repo-folders).
  repo: v.optional(v.string()),
  kind: v.union(v.literal("added"), v.literal("modified"), v.literal("deleted")),
  additions: v.number(),
  deletions: v.number(),
  // Line counts are 0 for binary files (git numstat reports "-").
  binary: v.optional(v.boolean()),
});

// A changed repo of a multi-repo folder. `path` matches the repo entry's `label` (its relative path);
// `pathId` is that entry, resolved by `cli.messages.complete`.
export const cliRunDiffRepoValidator = v.object({
  path: v.string(),
  pathId: v.optional(v.string()),
});

// The envelope's repo row: the repo's own file count and totals from the stored files.
export const cliRunDiffRepoPreviewValidator = v.object({
  path: v.string(),
  pathId: v.optional(v.string()),
  fileCount: v.number(),
  additions: v.number(),
  deletions: v.number(),
});

// Git change summary for the run an assistant message represents. The
// pre/post refs point at hidden checkpoint refs in the CLI-side repo
// (refs/convoy/checkpoints/...); file contents are never stored here.
export const cliRunDiffSummaryValidator = v.object({
  preRef: v.string(),
  postRef: v.string(),
  files: v.array(cliRunDiffFileValidator),
  truncated: v.optional(v.boolean()),
  repos: v.optional(v.array(cliRunDiffRepoValidator)),
});

/**
 * Envelope-sized slice of a run's change summary (OS-1600). The subscribed envelope
 * query re-sends every message on each write in the thread, so it ships only what the
 * collapsed Changes card renders. The full `files` list comes from
 * `cli.messages.getRunDiffSummary` on demand.
 */
export const cliRunDiffSummaryPreviewValidator = v.object({
  preRef: v.string(),
  postRef: v.string(),
  /** Leading `files` slice — enough for the collapsed card. */
  files: v.array(cliRunDiffFileValidator),
  /** Total file count of the stored summary (not of `files`). */
  fileCount: v.number(),
  /** Roll-up totals across all files, not just the previewed slice. */
  additions: v.number(),
  deletions: v.number(),
  truncated: v.optional(v.boolean()),
  repos: v.optional(v.array(cliRunDiffRepoPreviewValidator)),
});

export type CliRunDiffFile = Infer<typeof cliRunDiffFileValidator>;
export type CliRunDiffRepo = Infer<typeof cliRunDiffRepoValidator>;
export type CliRunDiffRepoPreview = Infer<typeof cliRunDiffRepoPreviewValidator>;
export type CliRunDiffSummary = Infer<typeof cliRunDiffSummaryValidator>;
export type CliRunDiffSummaryPreview = Infer<typeof cliRunDiffSummaryPreviewValidator>;

// A Workflow Bash step's request on a user message (OS-1886): the CLI claims
// the message like any run but executes the script instead of prompting the
// agent (docs/specs/workflows.md → Step types → Bash script).
export const cliScriptRequestValidator = v.object({
  script: v.string(),
  timeoutMs: v.number(),
});

// How a script run ended, on its assistant message. `outputTail` is the last
// `SCRIPT_OUTPUT_TAIL_MAX_CHARS` of combined stdout/stderr — the run engine's
// report to the agent; the transcript chunks hold the full output.
export const cliScriptResultValidator = v.object({
  exitCode: v.number(),
  timedOut: v.boolean(),
  outputTail: v.string(),
});

export const SCRIPT_OUTPUT_TAIL_MAX_CHARS = 8_000;

export type CliScriptRequest = Infer<typeof cliScriptRequestValidator>;
export type CliScriptResult = Infer<typeof cliScriptResultValidator>;

// Last-known pull request whose head branch is the thread's branch (OS-1370). Captured
// CLI-side via the user's forge CLI at run completion and stored as a snapshot, so the badge
// survives worktree removal and the CLI going offline. `draft` is folded into the state union
// at capture time. `bitbucket` is a schema slot only — capture awaits a forge-credentials
// decision (docs/specs/cli-thread-pr-badge.md).
export const cliThreadPullRequestValidator = v.object({
  provider: v.union(
    v.literal("github"),
    v.literal("gitlab"),
    v.literal("azure-devops"),
    v.literal("bitbucket")
  ),
  number: v.number(),
  title: v.string(),
  url: v.string(),
  state: v.union(v.literal("open"), v.literal("draft"), v.literal("merged"), v.literal("closed")),
  headBranch: v.string(),
  baseBranch: v.string(),
  capturedAt: v.number(),
});

export type CliThreadPullRequest = Infer<typeof cliThreadPullRequestValidator>;

/** A repo of a multi-repo folder by relative path, and its branch (docs/specs/cli-multi-repo-projects.md#branch-and-pull-requests). */
export const cliThreadRepoBranchValidator = v.object({ repo: v.string(), branch: v.optional(v.string()) });
export type CliThreadRepoBranch = Infer<typeof cliThreadRepoBranchValidator>;

/** A repo's Branch pull request in a multi-repo folder: the snapshot plus the repo's relative path. */
export const cliThreadRepoPullRequestValidator = v.object({ repo: v.string(), ...cliThreadPullRequestValidator.fields });
export type CliThreadRepoPullRequest = Infer<typeof cliThreadRepoPullRequestValidator>;

/** An image's pixel size, measured at upload so the thread can reserve its box before it loads. */
export const imageDimensionsValidator = v.object({ width: v.number(), height: v.number() });
export type ImageDimensions = Infer<typeof imageDimensionsValidator>;

/** `inline` renders an html reply attachment expanded in the thread (OS-2220); absent is a file card. */
export const attachmentDisplayValidator = v.literal("inline");
export type AttachmentDisplay = Infer<typeof attachmentDisplayValidator>;

/** `caption` (OS-2587): the agent's note on what to look at, shown under the file in the lightbox. */
export const cliMessageAttachmentInputValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  dimensions: v.optional(imageDimensionsValidator),
  display: v.optional(attachmentDisplayValidator),
  caption: v.optional(v.string()),
});
export type CliMessageAttachmentInput = Infer<typeof cliMessageAttachmentInputValidator>;

export const cliMessageAttachmentValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  uploadedAt: v.number(),
  dimensions: v.optional(imageDimensionsValidator),
  display: v.optional(attachmentDisplayValidator),
  caption: v.optional(v.string()),
});
export type CliMessageAttachment = Infer<typeof cliMessageAttachmentValidator>;

/** A Check result's status (docs/specs/task-checks.md → Statuses). */
export const CHECK_RESULT_STATUSES = ["passed", "warning", "failed", "not_performed"] as const;
export const checkResultStatusValidator = v.union(...CHECK_RESULT_STATUSES.map((status) => v.literal(status)));
export type CheckResultStatus = Infer<typeof checkResultStatusValidator>;

/** What `convoy threads attach --check` reports alongside its files. */
export const checkReportInputValidator = v.object({
  key: v.string(),
  status: checkResultStatusValidator,
  note: v.optional(v.string()),
  label: v.optional(v.string()),
  value: v.optional(v.string()),
  /** Raw, so a malformed ID gets the "not found" error rather than a validator error. */
  artifactId: v.optional(v.string()),
});
export type CheckReportInput = Infer<typeof checkReportInputValidator>;

export const cliMessageAttachmentSummaryValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  uploadedAt: v.number(),
  dimensions: v.optional(imageDimensionsValidator),
  display: v.optional(attachmentDisplayValidator),
  caption: v.optional(v.string()),
  url: v.union(v.string(), v.null()),
});
export type CliMessageAttachmentSummary = Infer<typeof cliMessageAttachmentSummaryValidator>;

/**
 * Attachment metadata without the signed `url` (OS-1600). Resolving a storage
 * URL is per-read I/O for data that only changes when the message is created,
 * so the subscribed envelope query ships metadata only; the render path
 * resolves URLs lazily through `cli.messages.getMessageAttachmentUrls`.
 */
export const cliMessageAttachmentMetadataValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  fileSize: v.number(),
  contentType: v.string(),
  uploadedAt: v.number(),
  dimensions: v.optional(imageDimensionsValidator),
  display: v.optional(attachmentDisplayValidator),
  caption: v.optional(v.string()),
});
export type CliMessageAttachmentMetadata = Infer<typeof cliMessageAttachmentMetadataValidator>;

/**
 * Who sent a user message, when it was not a human (OS-1162): another thread's agent
 * through MCP `send_thread_message`, or a Pull request watch (docs/specs/pull-request-watch.md).
 * Absence means a human sent it.
 *
 * Not named `origin*`: on `cliThreads` that prefix already means "the container's
 * oldest live child".
 */
export const cliMessageThreadSenderValidator = v.object({
  kind: v.literal("thread"),
  threadId: v.id("cliThreads"),
});
export const cliMessageSentByValidator = v.union(cliMessageThreadSenderValidator, v.object({ kind: v.literal("pullRequestWatch") }));
export type CliMessageSentBy = Infer<typeof cliMessageSentByValidator>;

// Normalized event for CLI message chunks (provider-agnostic semantic event)
export const cliPlanStepStatusValidator = v.union(
  v.literal("pending"),
  v.literal("in-progress"),
  v.literal("completed")
);

/**
 * One step of a thread's plan. `id` is the runtime's own step identity
 * (Claude task tools); snapshot-only runtimes (TodoWrite, Codex) omit it and
 * are matched positionally by wholesale replacement.
 */
export const cliPlanStepValidator = v.object({
  id: v.optional(v.string()),
  text: v.string(),
  status: cliPlanStepStatusValidator,
});
export type CliPlanStep = Infer<typeof cliPlanStepValidator>;

/**
 * The thread's last-used runtime selection (OS-1454), stamped from every user message.
 * Purely a composer preselection hint — the pills must render on the first frame, and
 * deriving them from the message list means waiting on a full-thread collect.
 *
 * Never an execution input: a run resolves model/effort from the messages in its own
 * batch, the only source that can be right when the pills change mid-queue.
 */
export const cliThreadLastUsedCliValidator = v.object({
  lastUsedModel: v.optional(cliModelValidator),
  lastUsedEffort: v.optional(cliEffortValidator),
  lastUsedMode: v.optional(v.string()),
});
export type CliThreadLastUsedCli = Infer<typeof cliThreadLastUsedCliValidator>;

/**
 * Denormalized thread-level state that would otherwise require scanning the
 * message or chunk history (which pagination makes unreliable). One bag so
 * future computed fields land here instead of growing the thread's top level.
 */
// Latest `context-window` / `usage-limit` snapshot per thread (OS-1889), folded
// from the chunk stream like the plan. Severity is derived on read.
export const cliThreadContextWindowValidator = v.object({
  usedTokens: v.number(),
  maxTokens: v.number(),
});
export type CliThreadContextWindow = Infer<typeof cliThreadContextWindowValidator>;
export const cliThreadUsageLimitValidator = v.object({
  window: v.string(),
  reportedAt: v.optional(v.number()),
  utilization: v.optional(v.number()),
  resetsAt: v.optional(v.number()),
  isUsingOverage: v.optional(v.boolean()),
});
export type CliThreadUsageLimit = Infer<typeof cliThreadUsageLimitValidator>;

// Claude reports active/complete; Codex adds its native stop states (OS-2277).
const cliGoalStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("blocked"),
  v.literal("usageLimited"),
  v.literal("budgetLimited"),
  v.literal("complete")
);

// The thread's current runtime goal (`/goal`), folded from `goal` events (OS-2276).
// `complete` is kept until the next set or clear. Spec: docs/specs/cli-thread-goal.md.
export const cliThreadGoalValidator = v.object({
  objective: v.string(),
  status: cliGoalStatusValidator,
  iterations: v.number(),
  lastReason: v.optional(v.string()),
  tokensUsed: v.optional(v.number()),
  tokenBudget: v.optional(v.number()),
});
export type CliThreadGoal = Infer<typeof cliThreadGoalValidator>;

export const cliBackgroundTaskValidator = v.object({
  id: v.string(),
  type: v.string(),
  description: v.string(),
});
export type CliBackgroundTask = Infer<typeof cliBackgroundTaskValidator>;

export const cliBackgroundTasksValidator = v.object({
  sessionId: v.optional(v.string()),
  tasks: v.array(cliBackgroundTaskValidator),
  totalCount: v.number(),
});
export type CliBackgroundTasks = Infer<typeof cliBackgroundTasksValidator>;

export const cliThreadBackgroundTasksValidator = v.object({
  ...cliBackgroundTasksValidator.fields,
  messageId: v.id("cliMessages"),
});
export type CliThreadBackgroundTasks = Infer<typeof cliThreadBackgroundTasksValidator>;

export const PLAN_APPROVAL_FALLBACK_MESSAGE = "Implement the approved plan.";

export const cliProposedPlanSourceValidator = v.object({
  messageId: v.id("cliMessages"),
  itemId: v.string(),
  turnId: v.string(),
});
export type CliProposedPlanSource = Infer<typeof cliProposedPlanSourceValidator>;

export function toCliProposedPlanSource(source: CliProposedPlanSource): CliProposedPlanSource {
  return { messageId: source.messageId, itemId: source.itemId, turnId: source.turnId };
}

export const cliThreadProposedPlanValidator = v.object({
  ...cliProposedPlanSourceValidator.fields,
  chunkId: v.id("cliMessageChunks"),
  ready: v.boolean(),
});
export type CliThreadProposedPlan = Infer<typeof cliThreadProposedPlanValidator>;

export const cliStopConfirmationValidator = v.object({
  runId: v.string(),
  messageId: v.id("cliMessages"),
  sessionId: v.optional(v.id("cliSessions")),
  requestedAt: v.number(),
  status: v.union(v.literal("stopping"), v.literal("unconfirmed"), v.literal("stopped")),
  acknowledgedAt: v.optional(v.number()),
  jobs: v.optional(cliThreadBackgroundTasksValidator),
});
export type CliStopConfirmation = Infer<typeof cliStopConfirmationValidator>;

export const cliThreadMetadataValidator = v.object({
  stopConfirmation: v.optional(cliStopConfirmationValidator),
  backgroundTasks: v.optional(cliThreadBackgroundTasksValidator),
  proposedPlan: v.optional(cliThreadProposedPlanValidator),
  plan: v.optional(v.object({ steps: v.array(cliPlanStepValidator) })),
  cli: v.optional(cliThreadLastUsedCliValidator),
  contextWindow: v.optional(cliThreadContextWindowValidator),
  // One entry per rate-limit window; bounded by the provider's window count.
  usageLimits: v.optional(v.array(cliThreadUsageLimitValidator)),
  goal: v.optional(cliThreadGoalValidator),
});
export type CliThreadMetadata = Infer<typeof cliThreadMetadataValidator>;

export const cliNarrativeSourceValidator = v.object({
  threadId: v.optional(v.string()),
  turnId: v.optional(v.string()),
  itemId: v.optional(v.string()),
  parentThreadId: v.optional(v.string()),
  parentToolUseId: v.optional(v.string()),
  scope: v.optional(v.union(v.literal("root"), v.literal("child"), v.literal("unknown"))),
});
export type CliNarrativeSource = Infer<typeof cliNarrativeSourceValidator>;

export function isForeignNarrativeSource(
  source: CliNarrativeSource | undefined,
  rootThreadId?: string
): boolean {
  if (source?.parentToolUseId || source?.scope === "child" || source?.scope === "unknown")
    return true;
  if (!source?.threadId) return false;
  return rootThreadId ? source.threadId !== rootThreadId : source.scope !== "root";
}

export const cliAccountUsageValidator = v.object({
  account: v.string(),
  refreshedAt: v.number(),
  provider: v.optional(v.literal("claude-code")),
  source: v.optional(v.union(v.literal("reported"), v.literal("last-reported"), v.literal("unavailable"))),
  detail: v.optional(v.string()),
  extraUsage: v.optional(v.object({
    enabled: v.boolean(),
    usedPercent: v.optional(v.number()),
    monthlyLimit: v.optional(v.number()),
    usedCredits: v.optional(v.number()),
    currency: v.optional(v.string()),
  })),
  buckets: v.array(v.object({
    id: v.string(),
    name: v.optional(v.string()),
    windows: v.array(v.object({
      name: v.string(),
      label: v.optional(v.string()),
      reportedAt: v.optional(v.number()),
      isUsingOverage: v.optional(v.boolean()),
      usedPercent: v.optional(v.number()),
      durationMinutes: v.optional(v.number()),
      resetsAt: v.optional(v.number()),
    })),
  })),
});
export type CliAccountUsage = Infer<typeof cliAccountUsageValidator>;

/** Validate bridge snapshots without inventing values absent from the provider. */
export function toCliAccountUsage(value: unknown): CliAccountUsage | null {
  if (!isRecord(value) || typeof value.account !== "string" || !value.account.trim() ||
    typeof value.refreshedAt !== "number" || !Number.isFinite(value.refreshedAt) ||
    value.refreshedAt < 0 || value.refreshedAt > 8.64e15 || !Array.isArray(value.buckets)) return null;
  if ((value.provider !== undefined && value.provider !== "claude-code") ||
    (value.source !== undefined && value.source !== "reported" && value.source !== "last-reported" && value.source !== "unavailable") ||
    (value.detail !== undefined && typeof value.detail !== "string")) return null;
  const buckets: CliAccountUsage["buckets"] = [];
  for (const bucket of value.buckets) {
    if (!isRecord(bucket) || typeof bucket.id !== "string" || !Array.isArray(bucket.windows) ||
      (bucket.name !== undefined && typeof bucket.name !== "string")) return null;
    const windows: CliAccountUsage["buckets"][number]["windows"] = [];
    for (const window of bucket.windows) {
      if (!isRecord(window) || typeof window.name !== "string" || !window.name ||
        (window.label !== undefined && typeof window.label !== "string") ||
        (window.isUsingOverage !== undefined && typeof window.isUsingOverage !== "boolean")) return null;
      const parsed: CliAccountUsage["buckets"][number]["windows"][number] = { name: window.name };
      if (typeof window.label === "string") parsed.label = window.label;
      if (typeof window.isUsingOverage === "boolean") parsed.isUsingOverage = window.isUsingOverage;
      for (const key of ["usedPercent", "durationMinutes", "resetsAt", "reportedAt"] as const) {
        const number = window[key];
        if (number === undefined) continue;
        if (typeof number !== "number" || !Number.isFinite(number) || number < 0 ||
          (key === "usedPercent" && number > 100) ||
          (key === "durationMinutes" && number === 0) ||
          (key === "resetsAt" && number > 8.64e12) ||
          (key === "reportedAt" && number > 8.64e15)) return null;
        parsed[key] = number;
      }
      windows.push(parsed);
    }
    buckets.push({ id: bucket.id, ...(bucket.name !== undefined ? { name: bucket.name } : {}), windows });
  }
  const report: CliAccountUsage = { account: value.account, refreshedAt: value.refreshedAt, buckets };
  if (value.provider === "claude-code") report.provider = value.provider;
  if (value.source === "reported" || value.source === "last-reported" || value.source === "unavailable") report.source = value.source;
  if (typeof value.detail === "string") report.detail = value.detail;
  if (value.extraUsage !== undefined) {
    const extra = value.extraUsage;
    if (!isRecord(extra) || typeof extra.enabled !== "boolean" ||
      (extra.currency !== undefined && typeof extra.currency !== "string")) return null;
    report.extraUsage = { enabled: extra.enabled };
    for (const key of ["usedPercent", "monthlyLimit", "usedCredits"] as const) {
      const number = extra[key];
      if (number === undefined) continue;
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || (key === "usedPercent" && number > 100)) return null;
      report.extraUsage[key] = number;
    }
    if (typeof extra.currency === "string") report.extraUsage.currency = extra.currency;
  }
  return report;
}

export const cliNormalizedEventValidator = v.union(
  v.object({ kind: v.literal("account-usage"), usage: cliAccountUsageValidator }),
  v.object({
    kind: v.literal("proposed-plan"),
    phase: v.union(v.literal("delta"), v.literal("completed")),
    itemId: v.string(),
    turnId: v.string(),
    text: v.string(),
  }),
  v.object({
    kind: v.literal("sleep"),
    phase: v.union(v.literal("started"), v.literal("completed")),
    itemId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  }),
  v.object({ kind: v.literal("text"), text: v.string(), source: v.optional(cliNarrativeSourceValidator) }),
  v.object({ kind: v.literal("reasoning"), text: v.string(), source: v.optional(cliNarrativeSourceValidator) }),
  // Partial-streaming deltas (ephemeral; superseded by the final whole
  // text/reasoning events once the provider emits the complete message).
  v.object({ kind: v.literal("text-delta"), text: v.string(), source: v.optional(cliNarrativeSourceValidator) }),
  v.object({ kind: v.literal("reasoning-delta"), text: v.string(), source: v.optional(cliNarrativeSourceValidator) }),
  v.object({
    kind: v.literal("context-window"),
    usedTokens: v.number(),
    // Absent on Claude's per-API-call events; the client carries the last
    // known max forward (OS-1900).
    maxTokens: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("context-compaction"),
    message: v.string(),
    // Compaction is running (codex emits started/completed item pairs); the
    // completed event replaces the pending part in place.
    inProgress: v.optional(v.boolean()),
    sessionId: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
  }),
  // The agent surfaced stored memories into the turn (Claude `memory_recall`).
  // First-class rather than a notice because it needs structure a flat
  // title/message cannot hold: n memory files with their scope, or one
  // synthesized paragraph.
  v.object({
    kind: v.literal("memory-recall"),
    // `files` = the agent chose whole memory files; `synthesis` = it authored
    // one paragraph distilled from many small memories.
    mode: v.union(v.literal("files"), v.literal("synthesis")),
    memories: v.array(
      v.object({
        // Absent for synthesized memories, which have no single source file.
        path: v.optional(v.string()),
        scope: v.optional(v.union(v.literal("personal"), v.literal("team"))),
        // Body text when the provider ships it inline (synthesis always does;
        // file recalls leave it out and the renderer shows the path).
        content: v.optional(v.string()),
      })
    ),
    sessionId: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
  }),
  // Provider usage/rate-limit state snapshot; consumed thread-level (footer
  // pill), silent inline except on severity escalation.
  v.object({
    kind: v.literal("usage-limit"),
    window: v.string(),
    utilization: v.optional(v.number()),
    resetsAt: v.optional(v.number()),
    isUsingOverage: v.optional(v.boolean()),
    status: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
  }),
  // A runtime goal transition (`/goal`); folded into `metadata.goal`, silent
  // inline. `run-completed` means met only while a goal is active (OS-2276).
  v.object({
    kind: v.literal("goal"),
    source: v.union(
      v.literal("set"),
      v.literal("check"),
      v.literal("report"),
      v.literal("cleared"),
      v.literal("run-completed")
    ),
    objective: v.optional(v.string()),
    status: v.optional(v.union(cliGoalStatusValidator, v.literal("none"))),
    iterations: v.optional(v.number()),
    lastReason: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    tokenBudget: v.optional(v.number()),
    sessionId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("tool-input"),
    toolFamily: v.optional(v.literal("codex-collaboration")),
    toolCallId: v.optional(v.string()),
    toolName: v.string(),
    inputJson: v.string(),
    parentToolUseId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("tool-output"),
    toolFamily: v.optional(v.literal("codex-collaboration")),
    toolCallId: v.optional(v.string()),
    outputJson: v.string(),
    parentToolUseId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("tool-error"),
    toolFamily: v.optional(v.literal("codex-collaboration")),
    toolCallId: v.optional(v.string()),
    errorText: v.string(),
    parentToolUseId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("tool-progress"),
    toolCallId: v.string(),
    toolName: v.optional(v.string()),
    elapsedSeconds: v.optional(v.number()),
    parentToolUseId: v.optional(v.string()),
  }),
  // Provider-neutral full plan snapshot (Claude `TodoWrite` / `TaskList`,
  // Codex `todo_list` / `turn/plan/updated`). Replaces the thread's plan
  // wholesale. Nothing renders inline; the fold feeds `metadata.plan`.
  v.object({
    kind: v.literal("plan-progress"),
    steps: v.array(cliPlanStepValidator),
  }),
  // Incremental plan edit, upserted by step id (Claude `TaskCreate` /
  // `TaskUpdate`, which never resend the whole list). Steps not named here
  // keep their current text/status.
  v.object({
    kind: v.literal("plan-step-update"),
    steps: v.array(
      v.object({
        id: v.string(),
        text: v.optional(v.string()),
        status: v.optional(cliPlanStepStatusValidator),
      })
    ),
  }),
  v.object({
    kind: v.literal("metadata"),
    backgroundTasks: v.optional(cliBackgroundTasksValidator),
    sessionId: v.optional(v.string()),
    otherJson: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("runtime-notice"),
    code: v.string(),
    title: v.string(),
    message: v.string(),
    detailsJson: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("warning"),
    code: v.string(),
    message: v.string(),
  }),
  v.object({
    kind: v.literal("unknown"),
    reason: v.string(),
    rawType: v.string(),
    rawData: v.optional(v.string()),
  })
);
export type CliNormalizedEvent = Infer<typeof cliNormalizedEventValidator>;

// Interactive CLI approval requests (provider-neutral kinds/status)
export const cliInteractionKindValidator = v.union(v.literal("tool-approval"), v.literal("question"), v.literal("plan-approval"));
export type CliInteractionKind = Infer<typeof cliInteractionKindValidator>;

export const cliInteractionStatusValidator = v.union(v.literal("pending"), v.literal("answered"), v.literal("cancelled"));
export type CliInteractionStatus = Infer<typeof cliInteractionStatusValidator>;

// Absent = a configured path; "repo" = a git repo inside one (docs/specs/cli-multi-repo-projects.md).
export const cliProfilePathKindValidator = v.union(v.literal("worktree"), v.literal("repo"));
export type CliProfilePathKind = Infer<typeof cliProfilePathKindValidator>;

/** A path the user configured: not a synced worktree, not a detected repo. */
export function isConfiguredPath(entry: { kind?: CliProfilePathKind }): boolean {
  return entry.kind === undefined;
}

/** A `/`-separated path strictly inside the folder: a detected repo's relative path. */
export function isInsideRelativePath(relativePath: string): boolean {
  return relativePath !== "" && relativePath !== "." && !relativePath.startsWith("/") && !relativePath.includes("\\")
    && !/^[A-Za-z]:/.test(relativePath) && !relativePath.split("/").includes("..");
}

/** The detected repos of a multi-repo folder, in stored order; [] for any other path. */
export function folderRepos<T extends { kind?: CliProfilePathKind; parentPathId?: string }>(paths: readonly T[], folderId: string | undefined): T[] {
  return folderId === undefined ? [] : paths.filter((path) => path.kind === "repo" && path.parentPathId === folderId);
}

// A profile path entry as returned to clients (regular path, synced worktree or detected repo)
export const cliProfilePathEntryValidator = v.object({
  id: v.string(),
  path: v.string(),
  label: v.string(),
  gitRemoteUrl: v.optional(v.string()),
  kind: v.optional(cliProfilePathKindValidator),
  parentPathId: v.optional(v.string()),
  branch: v.optional(v.string()),
});
export type CliProfilePathEntry = Infer<typeof cliProfilePathEntryValidator>;

// Git worktree support (thread-scoped creation spec + CLI-fulfilled ops)
export const cliThreadWorktreeStatusValidator = v.union(v.literal("pending"), v.literal("created"));
export type CliThreadWorktreeStatus = Infer<typeof cliThreadWorktreeStatusValidator>;

export const cliThreadWorktreeSpecValidator = v.object({
  parentPathId: v.string(),
  branch: v.string(),
  baseRef: v.optional(v.string()),
  startFromOrigin: v.optional(v.boolean()),
});
export type CliThreadWorktreeSpec = Infer<typeof cliThreadWorktreeSpecValidator>;

export const cliThreadWorktreeValidator = v.object({
  parentPathId: v.string(),
  parentPath: v.optional(v.string()),
  parentGitRemoteUrl: v.optional(v.string()),
  repositoryId: v.optional(v.string()),
  worktreeId: v.optional(v.string()),
  branch: v.string(),
  baseRef: v.optional(v.string()),
  startFromOrigin: v.optional(v.boolean()),
  status: cliThreadWorktreeStatusValidator,
});
export type CliThreadWorktree = Infer<typeof cliThreadWorktreeValidator>;

// Where a forked thread came from (OS-1397). Spec: docs/specs/cli-thread-fork.md.
export const cliThreadForkedFromValidator = v.object({
  threadId: v.id("cliThreads"),
  /** The copied run's first user message in the parent: the envelope cutoff. */
  runStart: v.object({ messageId: v.id("cliMessages"), createdAt: v.number() }),
  /** The copied reply in the parent: the chunk cutoff (chunk rows are stamped on append). */
  reply: v.object({ messageId: v.id("cliMessages"), createdAt: v.number() }),
  /** The copied run's id, shared with the parent: anchors the "Forked from" divider. Absent on forks made before it was recorded. */
  runId: v.optional(v.string()),
  continuationId: v.optional(v.string()),
  /** The Codex turn `continuationId` is forked through (OS-2073). */
  turnId: v.optional(v.string()),
  /** Chunk-copy chains still scheduled; the fork is complete at 0 or absent. */
  copiesInFlight: v.optional(v.number()),
});
export type CliThreadForkedFrom = Infer<typeof cliThreadForkedFromValidator>;

// rescan/remove operate on worktrees; readFile/diffFile serve the run-diff viewer (OS-1143)
// by reading checkpoint refs on demand; revertRun restores the working tree to a pre-run
// checkpoint (OS-1151); revertFile restores one file (OS-1156) — a distinct kind, not
// revertRun + filePath, so an old CLI fails cleanly instead of reverting the whole run;
// searchFiles serves the composer's @-mention autocomplete (OS-1144);
// worktreeChanges returns the uncommitted working tree as one patch for the
// worktree changes view (OS-2036) — its own kind so a pre-upgrade CLI fails it
// cleanly instead of diffing against a bad revision; revertWorkingFile discards
// one file's uncommitted changes from that view (OS-2043).
export const cliWorktreeOpKindValidator = v.union(
  v.literal("rescan"),
  v.literal("remove"),
  v.literal("readFile"),
  v.literal("diffFile"),
  v.literal("revertRun"),
  v.literal("revertFile"),
  v.literal("searchFiles"),
  v.literal("worktreeChanges"),
  v.literal("revertWorkingFile"),
  // Discard uncommitted changes of the listed files (OS-2234).
  v.literal("revertWorkingTree"),
  // Current on-disk bytes via file storage, for the browser to save (OS-2050).
  v.literal("downloadFile"),
  // Commit history of the checkout and one commit's patch (OS-2534).
  v.literal("gitLog"),
  v.literal("commitPatch")
);
export type CliWorktreeOpKind = Infer<typeof cliWorktreeOpKindValidator>;
/** `branch` scope: gitLog walks HEAD's commits no default branch has (OS-2595); worktreeChanges diffs from the fork point (OS-2596). */
export const cliHistoryScopeValidator = v.literal("branch");
export type CliHistoryScope = Infer<typeof cliHistoryScopeValidator>;

export const cliWorktreeOpStatusValidator = v.union(v.literal("pending"), v.literal("done"), v.literal("failed"));
export type CliWorktreeOpStatus = Infer<typeof cliWorktreeOpStatusValidator>;

// Browser-approve login requests (OS-1137)
export const cliLoginRequestStatusValidator = v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"));
export type CliLoginRequestStatus = Infer<typeof cliLoginRequestStatusValidator>;

// Provenance/audience of auto-minted API keys (OS-1137/OS-1192).
// undefined = manually created in Settings (full capability, user-managed).
// "cli-login"  = minted by the CLI browser-login flow.
// "mcp-oauth"  = minted at the MCP OAuth token exchange; accepted ONLY by the
//                MCP endpoint, rejected by the agent-bridge HTTP endpoints.
export const apiKeyKindValidator = v.union(v.literal("cli-login"), v.literal("mcp-oauth"), v.literal("project-worker"));
export type ApiKeyKind = Infer<typeof apiKeyKindValidator>;

// Chat sidebar sort options
export const threadSortByValidator = v.union(v.literal("lastActivity"), v.literal("created"));
export type ThreadSortBy = Infer<typeof threadSortByValidator>;
// Task section appearance (OS-2137), per user.
export const sectionHeaderStyleValidator = v.union(v.literal("compact"), v.literal("spacious"));
export type SectionHeaderStyle = Infer<typeof sectionHeaderStyleValidator>;
export const sectionColorStyleValidator = v.union(v.literal("dot"), v.literal("stripe"), v.literal("tint"));
export type SectionColorStyle = Infer<typeof sectionColorStyleValidator>;

// Cost source and coverage are independent. See docs/specs/cost-tracking.md.
export const costMetadataValidator = v.object({
  hasReported: v.boolean(),
  hasEstimated: v.boolean(),
  hasUnpriced: v.boolean(),
  hasLegacy: v.boolean(),
  modelAllocationIncomplete: v.boolean(),
  hasDataGap: v.optional(v.boolean()),
  // A single catalog version/basis, or "mixed" across different estimates.
  pricingSnapshot: v.optional(v.string()),
  tariffBasis: v.optional(v.string()),
});
export type CostMetadata = Infer<typeof costMetadataValidator>;

export const costTotalValidator = v.object({
  costUsd: v.number(),
  costMetadata: v.optional(costMetadataValidator),
});
export type CostTotal = Infer<typeof costTotalValidator>;

export const resolvedCostTotalValidator = v.object({
  costUsd: v.number(),
  costMetadata: costMetadataValidator,
});
export type ResolvedCostTotal = Infer<typeof resolvedCostTotalValidator>;

export const costModelUsageValidator = v.object({
  // Provider model id; "unknown" when attribution is unavailable.
  model: v.string(),
  // Uncached input; cache reads/writes are disjoint categories below.
  inputTokens: v.number(),
  // Combined cache tokens for display, never a substitute for the split.
  cachedInputTokens: v.number(),
  // Absent if any contribution lacks that category's quantity.
  cacheReadTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  outputTokens: v.number(),
  costUsd: v.number(),
  // Legacy stored rows may have no provenance.
  costMetadata: v.optional(costMetadataValidator),
});
export type CostModelUsage = Infer<typeof costModelUsageValidator>;

// Extraction/scheduler inputs only; never persisted or returned as rollup fields.
export const extractedCostModelUsageValidator = v.object({
  ...costModelUsageValidator.omit("costMetadata").fields,
  // true = runtime amount including zero; false = missing; absent = legacy.
  reportedCost: v.optional(v.boolean()),
  // Missing input/output quantities prohibit estimation even if displayed as zero.
  quantitiesIncomplete: v.optional(v.boolean()),
});
export type ExtractedCostModelUsage = Infer<typeof extractedCostModelUsageValidator>;

export const extractedCostUsageValidator = v.object({
  costUsd: v.number(),
  reportedCost: v.optional(v.boolean()),
  byModel: v.array(extractedCostModelUsageValidator),
});
export type ExtractedCostUsage = Infer<typeof extractedCostUsageValidator>;

export const costUsageValidator = v.object({
  ...resolvedCostTotalValidator.fields,
  byModel: v.array(costModelUsageValidator),
});
export type CostUsage = Infer<typeof costUsageValidator>;

export function toCostModelUsage(entry: ExtractedCostModelUsage): CostModelUsage {
  return {
    model: entry.model,
    inputTokens: entry.inputTokens,
    cachedInputTokens: entry.cachedInputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    outputTokens: entry.outputTokens,
    costUsd: entry.costUsd,
  };
}
