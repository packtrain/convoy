import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { errors } from "../errors";
import { listAllArtifactCommentsByArtifact } from "./artifactComments/artifactCommentsRepo";
import { resolveArtifactContentType, type TaskArtifactContentType } from "./artifacts/validators";

const ARTIFACT_FILE_EXTENSIONS: Record<TaskArtifactContentType, string> = {
  markdown: "md",
  html: "html",
};

type Ctx = QueryCtx | MutationCtx;

export function normalizeTaskArtifactId(ctx: Ctx, id: string): Id<"taskArtifacts"> | null {
  return ctx.db.normalizeId("taskArtifacts", id);
}

export async function getArtifactById(ctx: Ctx, artifactId: Id<"taskArtifacts">): Promise<Doc<"taskArtifacts"> | null> {
  return ctx.db.get("taskArtifacts", artifactId);
}

export async function listArtifactsByTaskNewestFirst(ctx: Ctx, taskId: Id<"tasks">): Promise<Doc<"taskArtifacts">[]> {
  return ctx.db
    .query("taskArtifacts")
    .withIndex("by_task_and_updatedAt", (q) => q.eq("taskId", taskId))
    .order("desc")
    .collect();
}

async function findArtifactByFileName(
  ctx: Ctx,
  taskId: Id<"tasks">,
  fileName: string
): Promise<Doc<"taskArtifacts"> | null> {
  return ctx.db
    .query("taskArtifacts")
    .withIndex("by_task_and_fileName", (q) => q.eq("taskId", taskId).eq("fileName", fileName))
    .unique();
}

function toArtifactFileNameBase(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "artifact";
}

/**
 * Allocates the first free `<slug>.<ext>` / `<slug>-N.<ext>` filename within
 * the task (extension follows the artifact's content type), optionally
 * treating one existing artifact (a rename) as free.
 */
export async function generateUniqueArtifactFileName(
  ctx: Ctx,
  taskId: Id<"tasks">,
  name: string,
  contentType: TaskArtifactContentType | undefined,
  artifactIdToExclude?: Id<"taskArtifacts">
): Promise<string> {
  const base = toArtifactFileNameBase(name);
  const extension = ARTIFACT_FILE_EXTENSIONS[resolveArtifactContentType(contentType)];

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 1 ? `${base}.${extension}` : `${base}-${suffix}.${extension}`;
    const existing = await findArtifactByFileName(ctx, taskId, candidate);
    if (!existing || existing._id === artifactIdToExclude) {
      return candidate;
    }
  }

  // Unconditional failure after exhausting suffixes — not a value guard.
  throw new ConvexError(errors.ARTIFACT_FILENAME_ALLOCATION_FAILED);
}

/** Insert an artifact, stamping `createdBy`/`updatedBy`/`createdAt`/`updatedAt`. */
export async function insertArtifact(
  ctx: MutationCtx,
  props: {
    taskId: Id<"tasks">;
    name: string;
    fileName: string;
    content: string;
    contentType?: TaskArtifactContentType;
    source: "user" | "agent";
    runId?: string;
  },
  userId: Id<"users">
): Promise<Id<"taskArtifacts">> {
  const now = Date.now();
  return ctx.db.insert("taskArtifacts", {
    ...props,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
}

export type TaskArtifactPatch = {
  name?: string;
  fileName?: string;
  content?: string;
  // An explicitly `undefined` runId clears the field (Convex removes fields
  // patched to `undefined`).
  runId?: string;
};

/** Patch an artifact, stamping `updatedBy`/`updatedAt`. */
export async function updateArtifact(
  ctx: MutationCtx,
  artifactId: Id<"taskArtifacts">,
  patch: TaskArtifactPatch,
  userId: Id<"users">
): Promise<void> {
  await ctx.db.patch("taskArtifacts", artifactId, {
    ...patch,
    updatedBy: userId,
    updatedAt: Date.now(),
  });
}

/** Delete an artifact, cascading its comments (roots and replies). */
export async function deleteArtifact(ctx: MutationCtx, artifactId: Id<"taskArtifacts">): Promise<void> {
  for (const comment of await listAllArtifactCommentsByArtifact(ctx, artifactId)) {
    await ctx.db.delete("artifactComments", comment._id);
  }
  await ctx.db.delete("taskArtifacts", artifactId);
}

/**
 * Re-owns an artifact, re-anchoring its comments' denormalized `taskId` (the
 * permission anchor — a stale copy resolves against the old task).
 */
export async function moveArtifactToTask(
  ctx: MutationCtx,
  artifactId: Id<"taskArtifacts">,
  taskId: Id<"tasks">,
  fileName: string,
  userId: Id<"users">
): Promise<void> {
  await ctx.db.patch("taskArtifacts", artifactId, {
    taskId,
    fileName,
    updatedBy: userId,
    updatedAt: Date.now(),
  });
  for (const comment of await listAllArtifactCommentsByArtifact(ctx, artifactId)) {
    await ctx.db.patch("artifactComments", comment._id, { taskId });
  }
}
