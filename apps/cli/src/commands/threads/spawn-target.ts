import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../lib/config/index.js";
import { CliType } from "./parsers.js";
import { ThreadRow } from "./formatters.js";

/** Where `threads create` should create the thread and whether it joins a group. */
export interface SpawnTarget {
  profileId: Id<"cliProfiles">;
  pathId: string;
  cliType: CliType;
  projectId: Id<"projects">;
  /** Absent for a from-scratch create; see `resolveSpawnTarget` in the MCP layer. */
  addToGroup?: {
    sourceThreadId: Id<"cliThreads">;
    spawnedByThreadId: Id<"cliThreads">;
    expectedContainerId?: Id<"cliThreads">;
  };
}

interface ExplicitTarget {
  profileId?: Id<"cliProfiles">;
  pathId?: string;
  cliType?: CliType;
}

function require<T>(value: T | undefined, flag: string, reason = "unless --source is given"): T {
  if (value === undefined) {
    throw new Error(`--${flag} is required ${reason}.`);
  }
  return value;
}

/**
 * Mirrors `resolveSpawnTarget` (`apps/web/convex/mcp/lib/threads/resolution.ts`)
 * against the same two queries — that one runs in a Convex action this package
 * cannot import. Keep the two in sync; the rules are spec'd in
 * `docs/specs/mcp-server.md`.
 */
export async function resolveSpawnTarget(
  client: ConvoyClient,
  explicit: ExplicitTarget,
  sourceId: Id<"cliThreads"> | undefined,
  fallbackProjectId: () => Promise<Id<"projects">>
): Promise<SpawnTarget> {
  if (!sourceId) {
    return {
      profileId: require(explicit.profileId, "profile-id"),
      pathId: require(explicit.pathId, "path-id"),
      cliType: require(explicit.cliType, "cli-type"),
      projectId: await fallbackProjectId(),
    };
  }

  const source: ThreadRow | null = await client.query(api.cli.threads.summaries.getSummary, {
    threadId: sourceId,
  });
  if (!source) {
    throw new Error("Source thread not found or not accessible.");
  }

  const member = source.kind === "group" ? await resolveGroupMember(client, source) : source;
  if (!member && source.workflowRunId === undefined) {
    throw new Error("Group has no live threads to spawn beside.");
  }
  const child = member ?? source;
  const requiredReason = !member ? "when the workflow container has no live threads" : undefined;

  // `pathId` is a per-profile UUID, so it cannot be inherited across machines.
  if (explicit.profileId && child.profileId && explicit.profileId !== child.profileId && !explicit.pathId) {
    throw new Error("--path-id is required when --profile-id names a different machine.");
  }

  return {
    profileId: require(explicit.profileId ?? child.profileId, "profile-id", requiredReason),
    pathId: require(explicit.pathId ?? child.pathId, "path-id", requiredReason),
    cliType: require(explicit.cliType ?? child.cliType, "cli-type", requiredReason),
    // The source's, not the resolved default: a group never spans projects.
    projectId: source.projectId,
    addToGroup: {
      sourceThreadId: child.threadId,
      spawnedByThreadId: sourceId,
      ...(source.kind === "group" ? { expectedContainerId: source.threadId } : {}),
    },
  };
}

/** Prefer the origin among live members; empty workflow containers use an explicit target. */
async function resolveGroupMember(client: ConvoyClient, container: ThreadRow): Promise<ThreadRow | undefined> {
  const members: ThreadRow[] = await client.query(api.cli.threads.summaries.listGroupSummaries, {
    parentThreadId: container.threadId,
    includeDone: true,
  });
  const child = members.find((member) => member.threadId === container.originThreadId) ?? members[0];
  return child;
}
