import { getAppUrlBase } from "@/convex/lib/shared/appUrl";
import { TASK_REF_PATTERN } from "@/lib/ai-tools/convoy-task-writer-tool";
import { Status } from "@/lib/tasks/status";
import { isThreadPullRequestState } from "@/lib/threads/pull-request";

export type ConvoyLink = {
  refId: string;
  artifactId?: string;
  organizationSlug: string;
  projectAlias: string;
  /** Path plus query, for in-app navigation. */
  path: string;
};

export type PullRequestLinkTarget = { number: number; path: string };

const PROJECT_PATH = /^\/o\/([^/]+)\/([^/]+)(?:\/kanban)?\/?$/;
const PULL_REQUESTS_PATH = /^\/o\/[^/]+\/[^/]+\/pull-requests\/?$/;
const STATUSES = new Set<string>(Object.values(Status));

/** The href as a URL on the app origin; null for other origins and unparsable hrefs. */
function parseAppUrl(href: string | undefined): URL | null {
  if (!href) return null;
  const base = getAppUrlBase();
  try {
    const url = new URL(href, base);
    return url.origin === new URL(base).origin ? url : null;
  } catch {
    return null;
  }
}

/** A `?task=REF[&artifact=ID]` link on the app origin (docs/specs/cli-thread-message-links.md). */
export function parseConvoyLink(href: string | undefined): ConvoyLink | null {
  const url = parseAppUrl(href);
  const match = url && PROJECT_PATH.exec(url.pathname);
  const refId = url?.searchParams.get("task");
  if (!url || !match || !refId || !TASK_REF_PATTERN.test(refId)) {
    return null;
  }
  try {
    return {
      refId,
      artifactId: url.searchParams.get("artifact") || undefined,
      organizationSlug: decodeURIComponent(match[1]),
      projectAlias: decodeURIComponent(match[2]),
      path: url.pathname + url.search,
    };
  } catch {
    // Malformed escapes (`%E0%A4`) throw URIError; render the link as external.
    return null;
  }
}

/** A PR reader link, `/pull-requests?repo=…&pr=N`, on the app origin. */
export function parsePullRequestLink(href: string | undefined): PullRequestLinkTarget | null {
  const url = parseAppUrl(href);
  const pr = url?.searchParams.get("pr") ?? "";
  if (!url || !PULL_REQUESTS_PATH.test(url.pathname) || !url.searchParams.get("repo") || !/^[1-9]\d*$/.test(pr)) {
    return null;
  }
  return { number: Number(pr), path: url.pathname + url.search };
}

/** Reads the snapshot from the link title: `type=bug; status=In Progress`, or `state=open` for a PR. */
export function parseSnapshot(title: string | undefined) {
  const fields = new Map(
    (title ?? "").split(";").map((pair) => {
      const [key, ...value] = pair.split("=");
      return [key.trim().toLowerCase(), value.join("=").trim()] as const;
    })
  );
  const status = fields.get("status");
  const state = fields.get("state");
  return {
    typeKey: fields.get("type") || undefined,
    status: status && STATUSES.has(status) ? (status as Status) : undefined,
    state: isThreadPullRequestState(state) ? state : undefined,
  };
}
