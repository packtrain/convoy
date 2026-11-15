/**
 * Small helpers for working with filesystem-like paths.
 */

import type { Doc } from "../../_generated/dataModel";
import { threadExecutionBranch } from "./watchStatus";

/**
 * Extract basename from a path (last component after final slash).
 * Handles paths with trailing slashes.
 */
export function getBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

/**
 * Resolve a thread's path label and string from its profile's paths, falling
 * back to the snapshot stored on the thread when the entry is gone.
 *
 * Shared by every tier that reports where a thread runs — the sidebar row, the
 * detail view, and the summary contract (`lib/threadSummaries.ts`).
 */
export function resolvePathInfo(
  chat: Doc<"cliThreads">,
  profile: Doc<"cliProfiles"> | null
): { pathLabel: string; pathString: string; gitRemoteUrl?: string; branch?: string } {
  const pathEntry = profile?.paths.find((p) => p.id === chat.pathId);
  if (pathEntry) {
    return {
      pathLabel: pathEntry.label,
      pathString: pathEntry.path,
      gitRemoteUrl: pathEntry.gitRemoteUrl,
      branch: threadExecutionBranch(chat, pathEntry.branch),
    };
  }
  // Fallback: path was removed from profile, use the snapshot stored on the chat
  return {
    pathLabel: getBasename(chat.path),
    pathString: chat.path,
    branch: threadExecutionBranch(chat),
  };
}

