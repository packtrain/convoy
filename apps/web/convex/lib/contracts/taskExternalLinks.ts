/**
 * Convex validators mirroring the task external link union defined in
 * `apps/web/lib/tasks/external-links.ts`. Shared by `schema.ts`, the tasks
 * domain, and adapters.
 */
import { v } from "convex/values";
import { TASK_EXTERNAL_LINK_KINDS } from "@/lib/tasks/external-links";

/** The link kinds as a bare union, for callers that store the kind on its own. */
export const taskExternalLinkKindValidator = v.union(
  ...TASK_EXTERNAL_LINK_KINDS.map((kind) => v.literal(kind))
);

const commitFields = {
  kind: v.literal("commit"),
  sha: v.string(),
  title: v.optional(v.string()),
  repo: v.optional(v.string()),
  branch: v.optional(v.string()),
  url: v.optional(v.string()),
};

const branchFields = {
  kind: v.literal("branch"),
  name: v.string(),
  repo: v.optional(v.string()),
  url: v.optional(v.string()),
};

const pullRequestFields = {
  kind: v.literal("pull_request"),
  url: v.string(),
  title: v.optional(v.string()),
  identifier: v.optional(v.string()),
  repo: v.optional(v.string()),
  branch: v.optional(v.string()),
};

const urlFields = {
  kind: v.literal("url"),
  url: v.string(),
  title: v.optional(v.string()),
};

const linkMetaFields = {
  id: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/** Link payload as provided by clients — `id` travels separately, timestamps are server-stamped. */
export const taskExternalLinkInputValidator = v.union(
  v.object(commitFields),
  v.object(branchFields),
  v.object(pullRequestFields),
  v.object(urlFields)
);

/** Stored/returned link item. */
export const taskExternalLinkValidator = v.union(
  v.object({ ...commitFields, ...linkMetaFields }),
  v.object({ ...branchFields, ...linkMetaFields }),
  v.object({ ...pullRequestFields, ...linkMetaFields }),
  v.object({ ...urlFields, ...linkMetaFields })
);
