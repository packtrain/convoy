import { v, type Infer } from "convex/values";

// Skill shapes shared by schema.ts and the skills domain (see docs/specs/skills.md).

export const skillScopeValidator = v.union(v.literal("organization"), v.literal("project"));

// Git provenance of a Skill copied from a repository (docs/specs/skills.md#git-sources).
// Every field is optional: partial provenance still beats none, and a person who
// only knows the repository should not have to invent a commit to record it. A
// source with nothing in it is not stored at all.
export const skillSourceValidator = v.object({
  repoUrl: v.optional(v.string()),
  ref: v.optional(v.string()),
  commitSha: v.optional(v.string()),
  subpath: v.optional(v.string()),
});

// One file of a Skill. Shared with the editor, which holds the whole set as a
// local draft and saves it in one call (docs/specs/skills.md#create-and-edit-ui).
export const skillFileValidator = v.object({
  path: v.string(),
  content: v.string(),
});

/**
 * A Skill mentioned in the thread composer, as one member of the composer
 * document's ref union (docs/specs/skills.md#composer-mentions). Same field set
 * as a slash-command ref so the pill carries one shape; `scope` restates `type`
 * for that reason.
 */
export const skillComposerRefValidator = v.object({
  type: v.literal("skill"),
  id: v.id("skills"),
  scope: v.literal("skill"),
  key: v.string(),
  canonicalKey: v.string(),
  displayLabel: v.string(),
});

export type SkillComposerRef = Infer<typeof skillComposerRefValidator>;
export type SkillFile = Infer<typeof skillFileValidator>;
export type SkillScope = Infer<typeof skillScopeValidator>;
export type SkillSource = Infer<typeof skillSourceValidator>;
