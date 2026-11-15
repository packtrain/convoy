import type { CliThreadKind } from "@/convex/lib/contracts/validators";

/**
 * Client-side mirror of the backend's `isContainerThread` (OS-1364): a set
 * `kind` marks a transcript-less container. A workflow run's container is a
 * group with `workflowRunId` set (OS-1366).
 */
export function isContainerThread(thread: { kind?: CliThreadKind }): boolean {
  return thread.kind !== undefined;
}

/**
 * Delete-confirmation copy shared by the desktop sidebar and the mobile
 * thread list (OS-1476). Group deletes cascade to every child, so the copy
 * must say what the action takes; the caller renders the quoted thread title
 * between `title` and `body`.
 */
export function threadDeleteDialogCopy(kind: CliThreadKind | undefined): { title: string; body: string } {
  if (kind === "group") {
    return {
      title: "Delete group?",
      body: " and all threads in the group will be permanently deleted.",
    };
  }
  return { title: "Delete thread?", body: " will be permanently deleted." };
}
