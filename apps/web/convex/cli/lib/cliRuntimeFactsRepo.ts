import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { CliType } from "../../lib/contracts/validators";
import { toRuntimeSlashCommand, type RuntimeSlashCommand } from "./runtimes/validators";

type Ctx = QueryCtx | MutationCtx;

/** Fact key for the runtime's advertised slash commands (`{ commands: [...] }`). */
export const RUNTIME_FACT_SLASH_COMMANDS = "slashCommands";

export interface RuntimeFactKey {
  profileId: Id<"cliProfiles">;
  cliType: CliType;
  pathId: string;
  key: string;
}

export async function getRuntimeFact(ctx: Ctx, args: RuntimeFactKey): Promise<Doc<"cliRuntimeFacts"> | null> {
  return ctx.db
    .query("cliRuntimeFacts")
    .withIndex("by_profile_cliType_key_pathId", (q) =>
      q.eq("profileId", args.profileId).eq("cliType", args.cliType).eq("key", args.key).eq("pathId", args.pathId)
    )
    .unique();
}

/**
 * Exact (profile, cliType, key, pathId) fact, falling back to any path of the
 * same profile+cliType (worktree threads reuse the parent repo's inventory
 * until their own first run reports).
 */
export async function getRuntimeFactWithPathFallback(ctx: Ctx, args: RuntimeFactKey): Promise<Doc<"cliRuntimeFacts"> | null> {
  const exact = await getRuntimeFact(ctx, args);
  if (exact) {
    return exact;
  }

  return ctx.db
    .query("cliRuntimeFacts")
    .withIndex("by_profile_cliType_key_pathId", (q) =>
      q.eq("profileId", args.profileId).eq("cliType", args.cliType).eq("key", args.key)
    )
    .first();
}

/** Upsert a fact row; unchanged payloads are a no-op (steady-state cost zero). */
export async function upsertRuntimeFact(ctx: MutationCtx, args: RuntimeFactKey & { payload: string; now: number }): Promise<void> {
  const existing = await getRuntimeFact(ctx, args);
  if (existing) {
    if (existing.payload === args.payload) {
      return;
    }
    await ctx.db.patch("cliRuntimeFacts", existing._id, { payload: args.payload, reportedAt: args.now });
    return;
  }

  await ctx.db.insert("cliRuntimeFacts", {
    profileId: args.profileId,
    cliType: args.cliType,
    pathId: args.pathId,
    key: args.key,
    payload: args.payload,
    reportedAt: args.now,
  });
}

/**
 * Parse a `slashCommands` fact payload; malformed payloads read as empty.
 * Entries are bare names (rows written before OS-1806, and runtimes that
 * advertise names only) or `{ name, description?, argumentHint? }`.
 */
export function parseSlashCommandsFactPayload(payload: string): RuntimeSlashCommand[] {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { commands?: unknown }).commands)) {
      return [];
    }
    return (parsed as { commands: unknown[] }).commands
      .map(toRuntimeSlashCommand)
      .filter((command): command is RuntimeSlashCommand => command !== null);
  } catch {
    return [];
  }
}
