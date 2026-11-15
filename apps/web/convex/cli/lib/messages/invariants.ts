import { ConvexError } from "convex/values";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { ensure } from "../../../lib/shared/ensure";
import { parseAttachedPullRequest, type AttachedPullRequest } from "../../../lib/contracts/github";
import { errors } from "../../errors";
import { getOnlineSessionForProfile } from "../cliSessionsRepo";

/** A current quota lookup cannot be answered by an offline runner. */
export async function requireRuntimeCommandRunner(
  ctx: MutationCtx,
  args: { profileId: Id<"cliProfiles">; cliType?: string; content: string; runtimeCommand?: boolean },
): Promise<void> {
  if (!args.runtimeCommand || (args.cliType !== "codex" && args.cliType !== "claude-code") || !/^\/usage(?:\s|$)/.test(args.content)) return;
  await ensure(getOnlineSessionForProfile(ctx, args.profileId, Date.now())).notNull(errors.USAGE_RUNNER_OFFLINE);
}

/** The PR a create, send, or attach names, parsed; unset stays unset. */
export function requireAttachedPullRequest(url: string | undefined): AttachedPullRequest | undefined {
  if (url === undefined) return undefined;
  const pullRequest = parseAttachedPullRequest(url);
  if (!pullRequest) throw new ConvexError(errors.PULL_REQUEST_URL_INVALID);
  return pullRequest;
}
