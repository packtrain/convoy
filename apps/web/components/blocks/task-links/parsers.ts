import { getAppUrlBase } from "@/convex/lib/shared/appUrl";
import { TASK_REF_PATTERN } from "@/lib/ai-tools/convoy-task-writer-tool";
import { Status } from "@/lib/tasks/status";

export type ConvoyLink = {
  refId: string;
  artifactId?: string;
  organizationSlug: string;
  projectAlias: string;
  /** Path plus query, for in-app navigation. */
  path: string;
};

const PROJECT_PATH = /^\/o\/([^/]+)\/([^/]+)(?:\/kanban)?\/?$/;
const STATUSES = new Set<string>(Object.values(Status));

/** A `?task=REF[&artifact=ID]` link on the app origin (docs/specs/cli-thread-message-links.md). */
export function parseConvoyLink(href: string | undefined): ConvoyLink | null {
  if (!href) return null;
  const base = getAppUrlBase();
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  const match = PROJECT_PATH.exec(url.pathname);
  const refId = url.searchParams.get("task");
  if (url.origin !== new URL(base).origin || !match || !refId || !TASK_REF_PATTERN.test(refId)) {
    return null;
  }
  return {
    refId,
    artifactId: url.searchParams.get("artifact") || undefined,
    organizationSlug: decodeURIComponent(match[1]),
    projectAlias: decodeURIComponent(match[2]),
    path: url.pathname + url.search,
  };
}

/** Reads the snapshot from the link title: `type=bug; status=In Progress`. */
export function parseSnapshot(title: string | undefined) {
  const fields = new Map(
    (title ?? "").split(";").map((pair) => {
      const [key, ...value] = pair.split("=");
      return [key.trim().toLowerCase(), value.join("=").trim()] as const;
    })
  );
  const status = fields.get("status");
  return {
    typeKey: fields.get("type") || undefined,
    status: status && STATUSES.has(status) ? (status as Status) : undefined,
  };
}
