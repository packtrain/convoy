import { v, type Infer } from "convex/values";
import { skillComposerRefValidator } from "./skills";

// The composer document a prompt carries: display text plus unexpanded
// slash-command and Skill refs. In root contracts because schema.ts (via
// `projectAgentAutomation`), the cli domain and the slashCommands domain all
// share it; resolution lives in `lib/slashCommands/composer.ts`.

export const slashCommandComposerScopeValidator = v.union(
  v.literal("organization"),
  v.literal("project"),
  v.literal("personal")
);

export const slashCommandComposerRefValidator = v.object({
  type: v.literal("slash-command"),
  id: v.id("slashCommands"),
  scope: slashCommandComposerScopeValidator,
  key: v.string(),
  canonicalKey: v.string(),
  displayLabel: v.string(),
});

export type SlashCommandComposerRef = Infer<typeof slashCommandComposerRefValidator>;

/** Every mentionable kind. The Skill member is owned by `contracts/skills.ts`. */
export const composerRefValidator = v.union(slashCommandComposerRefValidator, skillComposerRefValidator);

export type ComposerRef = Infer<typeof composerRefValidator>;

export const slashCommandComposerDocumentValidator = v.object({
  version: v.literal(1),
  refs: v.array(composerRefValidator),
});

export type SlashCommandComposerDocument = Infer<typeof slashCommandComposerDocumentValidator>;
