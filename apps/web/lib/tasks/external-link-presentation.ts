/**
 * Canonical kind → presentation mapping for task external links, shared by the
 * detail sidebar and the activity log.
 */
import {
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Link2,
  type LucideIcon,
} from "lucide-react";
import type { TaskExternalLinkKind } from "./external-links";

export const EXTERNAL_LINK_PRESENTATION: Record<
  TaskExternalLinkKind,
  { icon: LucideIcon; color: string; noun: string }
> = {
  commit: { icon: GitCommitHorizontal, color: "text-amber-500", noun: "commit" },
  branch: { icon: GitBranch, color: "text-purple-500", noun: "branch" },
  pull_request: { icon: GitPullRequest, color: "text-emerald-500", noun: "pull request" },
  url: { icon: Link2, color: "text-sky-500", noun: "link" },
};
