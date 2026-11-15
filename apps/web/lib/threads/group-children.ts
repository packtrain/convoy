import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadGroupChild } from "@/lib/threads/thread-query-patches";

/** Prefer the most recently active unfinished child, then the most recently done.
 * Shared by container entry and deletion. Spec: docs/specs/thread-groups.md.
 */
export function pickDefaultChild(
  children: readonly ThreadGroupChild[],
  options?: { exclude?: Id<"cliThreads"> }
): ThreadGroupChild | undefined {
  const candidates = children
    .filter((child) => child._id !== options?.exclude)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return (
    candidates.find((child) => !child.isDone) ??
    candidates.sort((a, b) => (b.doneAt ?? b.lastActivityAt) - (a.doneAt ?? a.lastActivityAt))[0]
  );
}
