import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function listSkillFiles(ctx: Ctx, skillId: Id<"skills">): Promise<Doc<"skillFiles">[]> {
  return ctx.db
    .query("skillFiles")
    .withIndex("by_skillId", (q) => q.eq("skillId", skillId))
    .collect();
}

/** One file by path: the agent surface reads a single file, never the bundle. */
export async function getSkillFileByPath(ctx: Ctx, skillId: Id<"skills">, path: string): Promise<Doc<"skillFiles"> | null> {
  return ctx.db
    .query("skillFiles")
    .withIndex("by_skillId_and_path", (q) => q.eq("skillId", skillId).eq("path", path))
    .unique();
}

/**
 * Writes `desired` as the Skill's whole file set — insert what is new, patch
 * changed content, delete what is gone — and reports whether anything changed,
 * so a save that wrote nothing does not bump the Skill's version.
 */
export async function replaceSkillFiles(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  existing: Doc<"skillFiles">[],
  desired: { path: string; content: string }[]
): Promise<boolean> {
  const removed = new Map(existing.map((file) => [file.path, file]));
  let changed = false;

  for (const file of desired) {
    const current = removed.get(file.path);
    removed.delete(file.path);

    if (!current) {
      await insertSkillFile(ctx, { skillId, ...file });
      changed = true;
    } else if (current.content !== file.content) {
      await patchSkillFile(ctx, current._id, { content: file.content });
      changed = true;
    }
  }

  for (const file of removed.values()) {
    await deleteSkillFile(ctx, file._id);
    changed = true;
  }

  return changed;
}

export async function insertSkillFile(
  ctx: MutationCtx,
  args: { skillId: Id<"skills">; path: string; content: string }
): Promise<Id<"skillFiles">> {
  return ctx.db.insert("skillFiles", args);
}

export async function patchSkillFile(
  ctx: MutationCtx,
  fileId: Id<"skillFiles">,
  patch: Pick<Doc<"skillFiles">, "content">
): Promise<void> {
  await ctx.db.patch("skillFiles", fileId, patch);
}

export async function deleteSkillFile(ctx: MutationCtx, fileId: Id<"skillFiles">): Promise<void> {
  await ctx.db.delete("skillFiles", fileId);
}
