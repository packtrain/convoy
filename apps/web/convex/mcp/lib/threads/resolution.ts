import { api } from "../../../_generated/api";
import type { ActionCtx } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";
import { getSupportedCliTypes, type CliType } from "../../../lib/contracts/validators";
import { should, throwInvalidParams } from "../should";

/** Where `create_thread` should create a thread (OS-1629): which path, which target. */
export type SpawnTarget = {
  profileId: Id<"cliProfiles">;
  pathId: string;
  cliType: CliType;
  /**
   * Absent for a from-scratch create. The two ids differ on purpose:
   * `sourceThreadId` is the member or empty workflow container, `spawnedByThreadId` is
   * what the agent named (a container, when it named one). `expectedContainerId`
   * is set only when a container was named, and the mutation re-checks it.
   */
  addToGroup?: {
    sourceThreadId: Id<"cliThreads">;
    spawnedByThreadId: Id<"cliThreads">;
    expectedContainerId?: Id<"cliThreads">;
  };
};

/** The tuple as it arrives: optional until we know whether there is a source. */
function parseTargetArgs(args: Record<string, unknown>) {
  return {
    profileId: should.beOptionalId<"cliProfiles">(args, "profileId"),
    pathId: should.beOptionalString(args, "pathId")?.trim() || undefined,
    cliType: should.beOptionalEnum(args, "cliType", getSupportedCliTypes()),
  };
}

/**
 * No source: the tuple is required. With one: each field is `explicit ??
 * inherited`, except that `pathId` is profile-local — a different `profileId`
 * needs its own `pathId`. Spec: `docs/specs/mcp-server.md`.
 */
export async function resolveSpawnTarget(ctx: ActionCtx, apiKey: string, args: Record<string, unknown>): Promise<SpawnTarget> {
  const explicit = parseTargetArgs(args);
  // Shape only; `getSummary` diagnoses existence (a `v.id` arg would -32603).
  const spawnedByThreadId = should.beOptionalId<"cliThreads">(args, "sourceThreadId");

  if (!spawnedByThreadId) {
    return {
      profileId: requireTargetField(explicit.profileId, "profileId"),
      pathId: requireTargetField(explicit.pathId, "pathId"),
      cliType: requireTargetField(explicit.cliType, "cliType"),
    };
  }

  const source = await ctx.runQuery(api.cli.threads.summaries.getSummary, {
    threadId: spawnedByThreadId,
    apiKey,
  });
  if (!source) {
    throwInvalidParams("Source thread not found");
  }
  const member = source.kind === "group" ? await resolveGroupMember(ctx, apiKey, source.threadId, source.originThreadId) : source;
  if (!member && source.workflowRunId === undefined) {
    throwInvalidParams("Group has no live threads to spawn beside");
  }
  const child = member ?? source;
  const requiredReason = !member ? "when the workflow container has no live threads" : undefined;

  // `pathId` is a per-profile UUID, so it cannot be inherited across machines.
  if (explicit.profileId && child.profileId && explicit.profileId !== child.profileId && !explicit.pathId) {
    throwInvalidParams("pathId is required when profileId names a different machine");
  }

  return {
    profileId: requireTargetField(explicit.profileId ?? child.profileId, "profileId", requiredReason),
    pathId: requireTargetField(explicit.pathId ?? child.pathId, "pathId", requiredReason),
    cliType: requireTargetField(explicit.cliType ?? child.cliType, "cliType", requiredReason),
    addToGroup: {
      sourceThreadId: child.threadId,
      spawnedByThreadId,
      ...(source.kind === "group" ? { expectedContainerId: source.threadId } : {}),
    },
  };
}

/** Prefer the origin among live members; empty workflow containers use an explicit target. */
async function resolveGroupMember(
  ctx: ActionCtx,
  apiKey: string,
  containerId: Id<"cliThreads">,
  originThreadId: Id<"cliThreads"> | undefined
) {
  const members = await ctx.runQuery(api.cli.threads.summaries.listGroupSummaries, {
    parentThreadId: containerId,
    includeDone: true,
    apiKey,
  });
  const child = members.find((member) => member.threadId === originThreadId) ?? members[0];
  return child;
}

/** Per field, so a caller learns which one it still owes. */
function requireTargetField<T>(value: T | undefined, key: string, reason = "unless sourceThreadId is given"): T {
  if (value === undefined) {
    throwInvalidParams(`${key} is required ${reason}`);
  }
  return value;
}
