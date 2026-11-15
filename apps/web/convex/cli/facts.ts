import { query } from "../_generated/server";
import { v } from "convex/values";
import { getOptionalAuthenticatedUser } from "../lib/access/auth";
import { hasProjectAccess } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { getAccessibleThread } from "./lib/permissions";
import { runtimeSlashCommandValidator } from "./lib/runtimes/validators";
import {
  RUNTIME_FACT_SLASH_COMMANDS,
  getRuntimeFactWithPathFallback,
  parseSlashCommandsFactPayload,
} from "./lib/cliRuntimeFactsRepo";

/**
 * Slash commands the thread's runtime advertised on its last run (captured
 * from the init event into `cliRuntimeFacts`). Empty until the first run has
 * reported for this profile+cliType; a worktree path without its own fact
 * falls back to any Group child path's inventory.
 */
export const getThreadRuntimeCommands = query({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.array(runtimeSlashCommandValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const chat = await getAccessibleThread(ctx, user._id, args.threadId);
    if (!chat) {
      return [];
    }

    const hasAccess = await hasProjectAccess(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return [];
    }

    const fact = await getRuntimeFactWithPathFallback(ctx, {
      profileId: chat.profileId,
      cliType: chat.cliType,
      pathId: chat.pathId,
      key: RUNTIME_FACT_SLASH_COMMANDS,
    });
    if (!fact) {
      return [];
    }

    return parseSlashCommandsFactPayload(fact.payload);
  },
});
