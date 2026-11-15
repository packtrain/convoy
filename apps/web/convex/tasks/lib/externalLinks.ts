import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { logTaskActivity } from "./activity/logger";
import { patchTask } from "./tasksRepo";
import {
  EXTERNAL_LINK_COMMIT_SHA_REGEX,
  EXTERNAL_LINK_ID_REGEX,
  EXTERNAL_LINK_URL_REGEX,
  MAX_EXTERNAL_LINK_TEXT_LENGTH,
  MAX_EXTERNAL_LINK_URL_LENGTH,
  MAX_EXTERNAL_LINKS_PER_TASK,
  type TaskExternalLinkInput,
} from "@/lib/tasks/external-links";

type StoredExternalLink = NonNullable<Doc<"tasks">["externalLinks"]>[number];

function normalizeRequiredText(value: string, field: string): string {
  const trimmed = value.trim();
  ensure(trimmed.length).gte(1, errors.linkFieldRequired(field));
  ensure(trimmed.length).between(1, MAX_EXTERNAL_LINK_TEXT_LENGTH, errors.linkFieldTooLong(field, MAX_EXTERNAL_LINK_TEXT_LENGTH));
  return trimmed;
}

/** Trims optional text; empty strings collapse to "not provided". */
function normalizeOptionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  ensure(trimmed.length).between(1, MAX_EXTERNAL_LINK_TEXT_LENGTH, errors.linkFieldTooLong(field, MAX_EXTERNAL_LINK_TEXT_LENGTH));
  return trimmed;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  ensure(trimmed).regex(EXTERNAL_LINK_URL_REGEX, errors.LINK_URL_INVALID);
  ensure(trimmed.length).between(1, MAX_EXTERNAL_LINK_URL_LENGTH, errors.linkFieldTooLong("url", MAX_EXTERNAL_LINK_URL_LENGTH));
  return trimmed;
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) return undefined;
  return normalizeUrl(value);
}

function normalizeCommitSha(value: string): string {
  const trimmed = value.trim();
  ensure(trimmed).regex(EXTERNAL_LINK_COMMIT_SHA_REGEX, errors.LINK_COMMIT_SHA_INVALID);
  return trimmed;
}

/**
 * Conservative normalization of a client link payload: trims text, drops empty
 * optionals, validates url/sha shapes. Throws `ConvexError` from the tasks catalog.
 * A flat module because links are an embedded field, not their own entity.
 */
export function normalizeExternalLinkInput(input: TaskExternalLinkInput): TaskExternalLinkInput {
  switch (input.kind) {
    case "commit": {
      const title = normalizeOptionalText(input.title, "title");
      const repo = normalizeOptionalText(input.repo, "repo");
      const branch = normalizeOptionalText(input.branch, "branch");
      const url = normalizeOptionalUrl(input.url);
      return {
        kind: "commit",
        sha: normalizeCommitSha(input.sha),
        ...(title !== undefined && { title }),
        ...(repo !== undefined && { repo }),
        ...(branch !== undefined && { branch }),
        ...(url !== undefined && { url }),
      };
    }
    case "branch": {
      const repo = normalizeOptionalText(input.repo, "repo");
      const url = normalizeOptionalUrl(input.url);
      return {
        kind: "branch",
        name: normalizeRequiredText(input.name, "name"),
        ...(repo !== undefined && { repo }),
        ...(url !== undefined && { url }),
      };
    }
    case "pull_request": {
      const title = normalizeOptionalText(input.title, "title");
      const identifier = normalizeOptionalText(input.identifier, "identifier");
      const repo = normalizeOptionalText(input.repo, "repo");
      const branch = normalizeOptionalText(input.branch, "branch");
      return {
        kind: "pull_request",
        url: normalizeUrl(input.url),
        ...(title !== undefined && { title }),
        ...(identifier !== undefined && { identifier }),
        ...(repo !== undefined && { repo }),
        ...(branch !== undefined && { branch }),
      };
    }
    case "url": {
      const title = normalizeOptionalText(input.title, "title");
      return {
        kind: "url",
        url: normalizeUrl(input.url),
        ...(title !== undefined && { title }),
      };
    }
  }
}

/**
 * Next external-links array for an upsert/delete op. Ids are client-generated
 * (upserts idempotent), timestamps server-stamped; `upsert` replaces in place or
 * appends within the per-task limit, `delete` is idempotent. The caller owns the
 * write and may skip it when nothing changed.
 */
async function applyExternalLinkOp(
  existing: StoredExternalLink[],
  args: { op: "upsert" | "delete"; id: string; link?: TaskExternalLinkInput }
): Promise<StoredExternalLink[]> {
  ensure(args.id).regex(EXTERNAL_LINK_ID_REGEX, errors.LINK_ID_INVALID);

  if (args.op === "delete") {
    return existing.filter((link) => link.id !== args.id);
  }

  const input = await ensure(args.link).notNull(errors.LINK_REQUIRED_FOR_UPSERT);
  const normalized = normalizeExternalLinkInput(input);
  const now = Date.now();
  const index = existing.findIndex((link) => link.id === args.id);

  if (index >= 0) {
    const next = [...existing];
    next[index] = {
      ...normalized,
      id: args.id,
      createdAt: existing[index].createdAt,
      updatedAt: now,
    };
    return next;
  }

  ensure(existing.length).between(
    0,
    MAX_EXTERNAL_LINKS_PER_TASK - 1,
    errors.linkLimitReached(MAX_EXTERNAL_LINKS_PER_TASK)
  );
  return [...existing, { ...normalized, id: args.id, createdAt: now, updatedAt: now }];
}

/** Content identity of a link, ignoring the server-restamped `updatedAt`. */
function linkFingerprint(link: StoredExternalLink): string {
  return JSON.stringify(
    Object.entries(link)
      .filter(([key]) => key !== "updatedAt")
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

/**
 * Canonical write-plus-log path for a single external link op. The op recorded
 * in the activity log is derived from the before/after arrays, not from
 * `args.op`, so a delete of a missing id and an identical re-upsert (a normal
 * MCP/CLI idempotency pattern) write nothing and log nothing.
 */
export async function applyAndLogExternalLinkOp(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  args: { op: "upsert" | "delete"; id: string; link?: TaskExternalLinkInput },
  userId: Id<"users">
): Promise<StoredExternalLink[]> {
  const existing = task.externalLinks ?? [];
  const next = await applyExternalLinkOp(existing, args);
  const before = existing.find((link) => link.id === args.id);
  const after = next.find((link) => link.id === args.id);

  const changed =
    after && !before
      ? ({ op: "added", link: after } as const)
      : before && !after
        ? ({ op: "removed", link: before } as const)
        : before && after && linkFingerprint(before) !== linkFingerprint(after)
          ? ({ op: "updated", link: after } as const)
          : null;

  if (!changed) return existing;

  await patchTask(ctx, task._id, { externalLinks: next });
  await logTaskActivity.externalLinkChanged(ctx, { taskId: task._id, userId, ...changed });
  return next;
}
