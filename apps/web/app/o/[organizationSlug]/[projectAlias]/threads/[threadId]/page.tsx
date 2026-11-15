import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New thread",
  description: "View and continue a project thread.",
};

/**
 * Deliberately empty: the threads layout renders `ThreadWorkspace` above this
 * segment, so switching group tabs re-renders the workspace instead of
 * remounting it (OS-1558, docs/specs/thread-groups.md → Rendering). This page
 * exists only so the child-thread URL resolves.
 */
export default function ThreadDetailPage() {
  return null;
}
