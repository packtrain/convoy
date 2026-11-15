import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New thread",
  description: "Start a new project thread through your CLI.",
};

/**
 * Deliberately empty: the threads layout renders `ThreadWorkspaceHost` above
 * this segment, so sending the first message swaps the composer for the
 * workspace without remounting the shell (OS-1660,
 * docs/specs/thread-groups.md → Page structure). This page exists only so
 * `/threads` resolves.
 */
export default function NewThreadPage() {
  return null;
}
