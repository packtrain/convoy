/**
 * Task external links domain language shared by the Convex backend,
 * MCP/CLI adapters, and the web UI. The Convex validators that mirror these
 * shapes live in `convex/lib/contracts/taskExternalLinks.ts`.
 */

export const TASK_EXTERNAL_LINK_KINDS = [
  "commit",
  "branch",
  "pull_request",
  "url",
] as const;

export type TaskExternalLinkKind = (typeof TASK_EXTERNAL_LINK_KINDS)[number];

export const MAX_EXTERNAL_LINKS_PER_TASK = 20;

/** Client-generated link IDs: stable, deterministic IDs enable idempotent upserts. */
export const EXTERNAL_LINK_ID_REGEX = /^[a-zA-Z0-9._:-]{1,160}$/;
export const EXTERNAL_LINK_URL_REGEX = /^https?:\/\/\S+$/;
export const EXTERNAL_LINK_COMMIT_SHA_REGEX = /^[0-9a-f]{7,64}$/i;
export const MAX_EXTERNAL_LINK_URL_LENGTH = 2000;
export const MAX_EXTERNAL_LINK_TEXT_LENGTH = 500;

export type TaskExternalLinkInput =
  | {
      kind: "commit";
      sha: string;
      title?: string;
      repo?: string;
      branch?: string;
      url?: string;
    }
  | {
      kind: "branch";
      name: string;
      repo?: string;
      url?: string;
    }
  | {
      kind: "pull_request";
      url: string;
      title?: string;
      identifier?: string;
      repo?: string;
      branch?: string;
    }
  | {
      kind: "url";
      url: string;
      title?: string;
    };

export type TaskExternalLink = TaskExternalLinkInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export function isTaskExternalLinkKind(
  value: string
): value is TaskExternalLinkKind {
  return (TASK_EXTERNAL_LINK_KINDS as readonly string[]).includes(value);
}

/** True for `<repo> PR #12`, false for the single-repo `PR #12` / `MR !7`. */
function isRepoPullRequestIdentifier(identifier: string): boolean {
  return /\S (PR #|MR !)\d+$/.test(identifier);
}

/** Compact one-line label used by the sidebar and CLI text output. */
export function getExternalLinkLabel(link: TaskExternalLinkInput): string {
  switch (link.kind) {
    case "commit":
      return link.title
        ? `${link.sha.slice(0, 7)} ${link.title}`
        : link.sha.slice(0, 7);
    case "branch":
      return link.name;
    case "pull_request":
      // A repo PR's identifier names its repo (`new-app PR #12`, OS-2523); it leads so repos stay apart.
      if (link.identifier && link.title && isRepoPullRequestIdentifier(link.identifier)) return `${link.identifier} · ${link.title}`;
      return link.title ?? link.identifier ?? link.url;
    case "url":
      return link.title ?? link.url;
  }
}
