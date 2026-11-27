import { GenericDatabaseWriter } from "convex/server";
import { LexoRank } from "lexorank";
import { DataModel, Doc, Id } from "../convex/_generated/dataModel";
import { gen } from "./generators";
import { normalizeCliChunkToEvent } from "../convex/cli/lib/chunks/normalizedEvents";
import { deriveThreadStatusProjection } from "../convex/cli/lib/watchStatus";
import { OrgRole, ProjectRole, InvitationRole, InvitationStatus } from "../lib/authz/roles";
import { INBOX_LIST_NAME, INBOX_LIST_REF } from "../convex/tasks/lib/lists/resolution";
import { createPersistedTaskListKey } from "../convex/lib/contracts/taskListKeys";
import { insertTask } from "../convex/tasks/lib/tasksRepo";
import { createTaskListSearchText, normalizeListName } from "../convex/tasks/lib/lists/naming";

type DB = GenericDatabaseWriter<DataModel>;

// Type helpers for overrides (exclude system fields)
type UserOverrides = Partial<Omit<Doc<"users">, "_id" | "_creationTime">>;
type OrgOverrides = Partial<Omit<Doc<"organizations">, "_id" | "_creationTime">>;
type ProjectOverrides = Partial<Omit<Doc<"projects">, "_id" | "_creationTime">>;
type TaskOverrides = Partial<Omit<Doc<"tasks">, "_id" | "_creationTime" | "refNumber">>;
type TaskAttachmentOverrides = Partial<Omit<Doc<"taskAttachments">, "_id" | "_creationTime">>;
type CommentOverrides = Partial<Omit<Doc<"taskComments">, "_id" | "_creationTime">>;
type OrganizationInvitationOverrides = Partial<Omit<Doc<"organizationInvitations">, "_id" | "_creationTime">>;
type CliProfileOverrides = Partial<Omit<Doc<"cliProfiles">, "_id" | "_creationTime">>;
type CliSessionOverrides = Partial<Omit<Doc<"cliSessions">, "_id" | "_creationTime">>;
type CliThreadOverrides = Partial<Omit<Doc<"cliThreads">, "_id" | "_creationTime">>;
type CliMessageOverrides = Partial<Omit<Doc<"cliMessages">, "_id" | "_creationTime">>;
type CliMessageChunkInput = {
  type: string;
  data: string;
  timestamp?: number;
  createdAt?: number;
};
type UserPreferencesOverrides = Partial<Omit<Doc<"userPreferences">, "_id" | "_creationTime">>;

// User builder
export async function buildUser(db: DB, overrides: UserOverrides = {}) {
  const now = gen.now();
  const data = {
    tokenIdentifier: gen.tokenIdentifier(),
    email: gen.email(),
    name: gen.name("User"),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const id = await db.insert("users", data);
  return { ...data, _id: id };
}

// Organization builder
export async function buildOrganization(db: DB, createdBy: Id<"users">, overrides: OrgOverrides = {}) {
  const now = gen.now();
  const name = overrides.name ?? gen.name("Org");
  const data = {
    name,
    slug: overrides.slug ?? gen.slug(name),
    createdBy,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    ...overrides,
  };
  const id = await db.insert("organizations", data);
  return { ...data, _id: id };
}

// Organization member builder
export async function buildOrgMember(db: DB, orgId: Id<"organizations">, userId: Id<"users">, role: OrgRole = OrgRole.OWNER) {
  const data = {
    organizationId: orgId,
    userId,
    role,
    joinedAt: gen.now(),
  };
  const id = await db.insert("organizationMembers", data);
  return { ...data, _id: id };
}

// Project member builder
export async function buildProjectMember(db: DB, projectId: Id<"projects">, userId: Id<"users">, role: ProjectRole = ProjectRole.MEMBER) {
  const data = {
    projectId,
    userId,
    role,
    addedAt: gen.now(),
  };
  const id = await db.insert("projectMembers", data);
  return { ...data, _id: id };
}

// Project builder
export async function buildProject(db: DB, orgId: Id<"organizations">, createdBy: Id<"users">, overrides: ProjectOverrides = {}) {
  const now = gen.now();
  const shouldCreateDefaultList = !Object.prototype.hasOwnProperty.call(overrides, "defaultListId");
  // The task ref counter lives in `taskRefCounters` (OS-934), created lazily on
  // first task creation — nothing ref-related is seeded on the project doc.
  const data = {
    organizationId: orgId,
    name: gen.name("Project"),
    alias: gen.alias(),
    isArchived: false,
    createdBy,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    ...overrides,
  };
  const id = await db.insert("projects", data);
  if (!shouldCreateDefaultList) {
    return { ...data, _id: id };
  }

  const defaultListId = await db.insert("taskLists", {
    projectId: id,
    name: INBOX_LIST_NAME,
    normalizedName: normalizeListName(INBOX_LIST_NAME),
    ref: INBOX_LIST_REF,
    rank: LexoRank.middle().toString(),
    searchText: createTaskListSearchText(INBOX_LIST_NAME, INBOX_LIST_REF),
    isArchived: false,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
  });
  await db.patch(id, { defaultListId });

  return { ...data, defaultListId, _id: id };
}

// Task builder (handles refNumber auto-increment)
export async function buildTask(db: DB, projectId: Id<"projects">, createdBy: Id<"users">, overrides: TaskOverrides = {}) {
  const project = await db.get(projectId);
  if (!project) throw new Error("Project not found");
  // Reserve a ref number from the project's dedicated counter, lazily creating
  // the row seeded at 1 (mirrors reserveTaskRefNumbers).
  const counter = await db
    .query("taskRefCounters")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  let refNumber: number;
  if (counter) {
    refNumber = counter.nextRefNumber;
    await db.patch(counter._id, { nextRefNumber: refNumber + 1 });
  } else {
    refNumber = 1;
    await db.insert("taskRefCounters", {
      projectId,
      nextRefNumber: refNumber + 1,
    });
  }
  const hasListKeyOverride = Object.prototype.hasOwnProperty.call(overrides, "listKey");
  const status = overrides.status ?? "To Do";
  const isArchived = overrides.isArchived ?? false;
  const isDeleted = overrides.isDeleted ?? false;
  const defaultListKey =
    !hasListKeyOverride && !isArchived && !isDeleted && project.defaultListId
      ? createPersistedTaskListKey(project.defaultListId)
      : undefined;

  const data = {
    projectId,
    clientId: gen.clientId(),
    refNumber,
    name: gen.name("Task"),
    searchText: `${project.alias}-${refNumber}`.toLowerCase(),
    priority: "Medium" as const,
    status,
    tags: [] as string[],
    rank: gen.rank(),
    createdBy,
    ...(defaultListKey ? { listKey: defaultListKey } : {}),
    ...overrides,
  };
  const id = await insertTask(db, data);
  const created = await db.get("tasks", id);
  if (!created) throw new Error("Failed to load created task");
  return created;
}

// Attachment builder
export async function buildTaskAttachment(
  db: DB,
  taskId: Id<"tasks">,
  uploadedBy: Id<"users">,
  storageId: Id<"_storage">,
  overrides: TaskAttachmentOverrides = {}
) {
  const now = gen.now();
  const data = {
    taskId,
    storageId,
    fileName: overrides.fileName ?? gen.name("file") + ".txt",
    fileSize: overrides.fileSize ?? 1024,
    contentType: overrides.contentType ?? "text/plain",
    uploadedBy,
    uploadedAt: now,
    ...overrides,
  };
  const id = await db.insert("taskAttachments", data);
  return { ...data, _id: id };
}

// Comment builder
export async function buildComment(db: DB, taskId: Id<"tasks">, authorId: Id<"users">, overrides: CommentOverrides = {}) {
  const now = gen.now();
  const data = {
    taskId,
    authorId,
    content: overrides.content ?? gen.name("Comment content"),
    createdAt: now,
    updatedAt: now,
    isEdited: false,
    ...overrides,
  };
  const id = await db.insert("taskComments", data);
  return { ...data, _id: id };
}

// Invitation builder
export async function buildOrganizationInvitation(
  db: DB,
  orgId: Id<"organizations">,
  invitedBy: Id<"users">,
  overrides: OrganizationInvitationOverrides = {}
) {
  const now = gen.now();
  const data = {
    organizationId: orgId,
    email: overrides.email ?? gen.email(),
    role: overrides.role ?? InvitationRole.MEMBER,
    token: overrides.token ?? crypto.randomUUID(),
    expiresAt: overrides.expiresAt ?? now + 7 * 24 * 60 * 60 * 1000, // 7 days
    invitedBy,
    createdAt: now,
    status: overrides.status ?? InvitationStatus.PENDING,
    ...overrides,
  };
  const id = await db.insert("organizationInvitations", data);
  return { ...data, _id: id };
}

// Helper to build a path entry for a profile
export function buildPathEntry(
  overrides: {
    id?: string;
    path?: string;
    label?: string;
    gitRemoteUrl?: string;
    kind?: "worktree" | "repo";
    parentPathId?: string;
    branch?: string;
  } = {}
) {
  const path = overrides.path ?? gen.repoPath();
  return {
    id: overrides.id ?? gen.pathId(),
    path,
    label: overrides.label ?? path.split("/").pop() ?? "project",
    gitRemoteUrl: overrides.gitRemoteUrl,
    kind: overrides.kind,
    parentPathId: overrides.parentPathId,
    branch: overrides.branch,
  };
}

// CLI Profile builder
export async function buildCliProfile(db: DB, userId: Id<"users">, projectId: Id<"projects">, overrides: CliProfileOverrides = {}) {
  const now = gen.now();
  const data = {
    userId,
    projectId,
    name: overrides.name ?? gen.hostname(),
    paths: overrides.paths ?? [buildPathEntry()],
    createdAt: now,
    isDeleted: overrides.isDeleted ?? false,
    deletedAt: overrides.deletedAt,
    deletedBy: overrides.deletedBy,
    ...overrides,
  };
  const id = await db.insert("cliProfiles", data);
  return { ...data, _id: id };
}

// CLI Session builder
export async function buildCliSession(db: DB, profileId: Id<"cliProfiles">, apiKeyId: Id<"apiKeys">, overrides: CliSessionOverrides = {}) {
  const now = gen.now();
  const profile = await db.get(profileId);
  if (!profile) {
    throw new Error("CLI profile not found");
  }

  const data = {
    profileId,
    instanceId: overrides.instanceId ?? gen.instanceId(),
    apiKeyId,
    userId: overrides.userId ?? profile.userId,
    projectId: overrides.projectId ?? profile.projectId,
    availableClis: overrides.availableClis ?? [],
    startedAt: now,
    isOnline: true,
    ...overrides,
  };
  const id = await db.insert("cliSessions", data);
  // An online session has a heartbeat row (OS-2549).
  if (data.isOnline) {
    await db.insert("cliSessionHeartbeats", { sessionId: id, lastHeartbeatAt: now });
  }
  return { ...data, _id: id };
}

/**
 * Minimal Workflow run fixture (OS-1366): inserts the workflow → version → run
 * chain so tests can mark a container/thread run-owned with a real
 * `workflowRunId`. Not a runnable definition — guard tests only.
 */
export async function buildWorkflowRun(db: DB, userId: Id<"users">, projectId: Id<"projects">, profileId: Id<"cliProfiles">) {
  const now = gen.now();
  const definition = { lanes: [], stages: [] };
  const workflowId = await db.insert("workflows", {
    projectId,
    name: gen.name("Workflow"),
    draftDefinition: definition,
    dirtySinceLastVersion: false,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
  const workflowVersionId = await db.insert("workflowVersions", {
    workflowId,
    projectId,
    versionNumber: 1,
    definition,
    createdBy: userId,
    createdAt: now,
  });
  const runId = await db.insert("workflowRuns", {
    workflowId,
    workflowVersionId,
    projectId,
    startedBy: userId,
    selection: { profileId, workspace: { pathId: gen.pathId(), pathSnapshot: gen.repoPath() } },
    status: "running" as const,
    startedAt: now,
    lastActivityAt: now,
  });
  return { runId, workflowId, workflowVersionId };
}

// CLI Thread builder
export async function buildCliThread(
  db: DB,
  userId: Id<"users">,
  projectId: Id<"projects">,
  profileId: Id<"cliProfiles">,
  overrides: CliThreadOverrides = {}
) {
  const now = gen.now();
  const pathId = overrides.pathId ?? gen.pathId();
  const data = {
    userId,
    projectId,
    profileId,
    pathId,
    path: overrides.path ?? gen.repoPath(),
    cliType: overrides.cliType ?? ("claude-code" as const),
    title: overrides.title ?? gen.name("Chat"),
    status: overrides.status ?? ("waiting_input" as const),
    processingState: overrides.processingState ?? ("idle" as const),
    hasPendingUserMessages: overrides.hasPendingUserMessages ?? false,
    claimedBySessionId: overrides.claimedBySessionId,
    claimedAt: overrides.claimedAt,
    claimLeaseExpiresAt: overrides.claimLeaseExpiresAt,
    activeAssistantMessageId: overrides.activeAssistantMessageId,
    readAt: overrides.readAt,
    createdAt: now,
    lastActivityAt: overrides.lastActivityAt ?? now,
    isDeleted: overrides.isDeleted ?? false,
    deletedAt: overrides.deletedAt,
    ...overrides,
  };
  // Mirror the production write seam: `statusProjection` is always derived (OS-1259).
  data.statusProjection = overrides.statusProjection ?? deriveThreadStatusProjection(data);
  const id = await db.insert("cliThreads", data);
  return { ...data, _id: id };
}

// CLI Message builder
export async function buildCliMessage(
  db: DB,
  threadId: Id<"cliThreads">,
  profileId: Id<"cliProfiles">,
  overrides: CliMessageOverrides = {}
) {
  const now = gen.now();
  const chat = await db.get(threadId);
  if (!chat) {
    throw new Error("CLI thread not found");
  }

  const data = {
    threadId,
    role: overrides.role ?? ("user" as const),
    profileId,
    cliType: overrides.cliType ?? chat.cliType,
    cliVersion: overrides.cliVersion,
    cliContext: overrides.cliContext,
    content: overrides.content ?? [{ type: "text", data: gen.name("Message content"), timestamp: now }],
    status: overrides.status ?? ("completed" as const),
    claimedBySessionId: overrides.claimedBySessionId,
    claimedAt: overrides.claimedAt,
    processedAt: overrides.processedAt,
    processedBySessionId: overrides.processedBySessionId,
    runId: overrides.runId,
    errorMessage: overrides.errorMessage,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const id = await db.insert("cliMessages", data);
  return { ...data, _id: id };
}

// CLI Message chunks builder
export async function buildCliMessageChunks(
  db: DB,
  messageId: Id<"cliMessages">,
  threadId: Id<"cliThreads">,
  profileId: Id<"cliProfiles">,
  chunks: CliMessageChunkInput[]
) {
  const inserted: Array<{ _id: Id<"cliMessageChunks"> } & Omit<Doc<"cliMessageChunks">, "_id" | "_creationTime">> = [];

  for (const [chunkOrder, chunk] of chunks.entries()) {
    const timestamp = chunk.timestamp ?? gen.now();
    const createdAt = chunk.createdAt ?? timestamp;
    const data = {
      messageId,
      threadId,
      profileId,
      chunkOrder,
      type: chunk.type,
      data: chunk.data,
      normalizedEvent: normalizeCliChunkToEvent({
        type: chunk.type,
        data: chunk.data,
      }),
      timestamp,
      createdAt,
    };
    const id = await db.insert("cliMessageChunks", data);
    inserted.push({ ...data, _id: id });
  }

  return inserted;
}

// User Preferences builder
export async function buildUserPreferences(db: DB, userId: Id<"users">, overrides: UserPreferencesOverrides = {}) {
  const now = gen.now();
  const data = {
    userId,
    updatedAt: now,
    ...overrides,
  };
  const id = await db.insert("userPreferences", data);
  return { ...data, _id: id };
}

// Export types for external use
export type {
  UserOverrides,
  OrgOverrides,
  ProjectOverrides,
  TaskOverrides,
  TaskAttachmentOverrides,
  CommentOverrides,
  OrganizationInvitationOverrides,
  CliProfileOverrides,
  CliSessionOverrides,
  CliThreadOverrides,
  CliMessageOverrides,
  CliMessageChunkInput,
  UserPreferencesOverrides,
};
