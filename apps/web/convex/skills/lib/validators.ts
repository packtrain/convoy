import { v, type Infer } from "convex/values";
import { skillFileValidator, skillScopeValidator, skillSourceValidator } from "../../lib/contracts/skills";

export { skillFileValidator, skillScopeValidator, skillSourceValidator };
export type { SkillFile, SkillSource } from "../../lib/contracts/skills";

export const skillValidator = v.object({
  _id: v.id("skills"),
  _creationTime: v.number(),
  scope: skillScopeValidator,
  organizationId: v.id("organizations"),
  projectId: v.optional(v.id("projects")),
  name: v.string(),
  normalizedName: v.string(),
  description: v.optional(v.string()),
  category: v.optional(v.string()),
  version: v.number(),
  sourceSkillId: v.optional(v.id("skills")),
  installedVersion: v.optional(v.number()),
  locallyEdited: v.optional(v.boolean()),
  source: v.optional(skillSourceValidator),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
});

/**
 * One Skill plus its whole bundle: `SKILL.md` and its other files with content.
 * The editor edits the set locally and saves it in one call, so it needs all of
 * it (docs/specs/skills.md#backend-api).
 */
export const skillDetailValidator = v.object({
  ...skillValidator.fields,
  skillMd: v.string(),
  files: v.array(skillFileValidator),
});

/**
 * What an agent gets from `load_skill`: the entry point, plus the paths it can
 * read one at a time (docs/specs/skills.md#v1--mcp).
 */
export const skillLoadValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  skillMd: v.string(),
  paths: v.array(v.string()),
});

/**
 * One edit inside a batch. `write` upserts: a caller holding the Skill's file
 * list does not need a create/update distinction, only a create/update *result*
 * (docs/specs/skills.md#authoring).
 */
export const skillEditValidator = v.union(
  v.object({ op: v.literal("write"), path: v.string(), content: v.string() }),
  v.object({ op: v.literal("delete"), path: v.string() }),
  v.object({ op: v.literal("move"), path: v.string(), newPath: v.string() }),
  v.object({
    op: v.literal("replace"),
    path: v.string(),
    oldString: v.string(),
    newString: v.string(),
    replaceAll: v.optional(v.boolean()),
  })
);

/**
 * A partial edit reports failure instead of throwing, so an agent recovers
 * without a failed tool call (docs/specs/skills.md#authoring). Mirrors
 * `replaceInTaskArtifactResultValidator`, plus the occurrence count the agent
 * needs to decide between a longer `oldString` and `replaceAll`, and the batch
 * position of the edit that stopped the save — the save is atomic, so every
 * other edit was rolled back too. `version` is the saved drift signal.
 */
export const skillUpdateResultValidator = v.union(
  v.object({ ok: v.literal(true), version: v.number() }),
  v.object({
    ok: v.literal(false),
    index: v.number(),
    code: v.union(v.literal("old_string_not_found"), v.literal("multiple_matches")),
    message: v.string(),
    occurrences: v.number(),
  })
);

export type Skill = Infer<typeof skillValidator>;
export type SkillDetail = Infer<typeof skillDetailValidator>;
export type SkillEdit = Infer<typeof skillEditValidator>;
