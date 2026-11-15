import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type {
  ComposerRef,
  SlashCommandComposerDocument,
} from "../contracts/slashCommands";
import { errors } from "../../slashCommands/errors";
import { getSlashCommandById } from "../../slashCommands/lib/slashCommandsRepo";
import { errors as skillErrors } from "../../skills/errors";
import { getSkillById } from "../../skills/lib/skillsRepo";

function replaceFirstRequired(source: string, search: string, replacement: string, missingError: string): string {
  const index = source.indexOf(search);
  if (index < 0) {
    throw new ConvexError(missingError);
  }

  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

export function buildSlashCommandCanonicalKey(
  command: Pick<Doc<"slashCommands">, "scope" | "key">
): string {
  if (command.scope === "organization") {
    return `org:${command.key}`;
  }

  if (command.scope === "project") {
    return `project:${command.key}`;
  }

  return command.key;
}

export function buildSlashCommandDisplayLabel(command: { key: string }): string {
  return `/${command.key}`;
}

export function buildSlashCommandMarkdownLink(
  command: Pick<ComposerRef, "type" | "key" | "canonicalKey" | "displayLabel">
): string {
  if (command.type === "skill") {
    return `[${command.displayLabel}](convoy://skill/${command.key})`;
  }

  return `[${command.displayLabel}](convoy://command/${command.canonicalKey})`;
}

export function slashCommandDisplayText(text: string): string {
  return text.replace(
    /\[(\/[A-Za-z0-9:_-]+)\]\(convoy:\/\/(?:command|skill)\/[A-Za-z0-9:_-]+\)/g,
    "$1"
  );
}

/**
 * What a Skill mention becomes: the Skill's name, not its body. A noun phrase,
 * not a sentence — the pill is replaced where it sat, so it has to read correctly
 * leading, trailing, mid-sentence, and repeated
 * (docs/specs/skills.md#composer-mentions).
 */
export function buildSkillMentionDirective(name: string): string {
  return `the \`${name}\` skill (load it with load_skill before acting)`;
}

export async function resolveSlashCommandComposerContent(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    projectId: Id<"projects">;
    displayContent: string;
    composerDocument?: SlashCommandComposerDocument;
  }
): Promise<string | undefined> {
  const refs = args.composerDocument?.refs ?? [];
  if (refs.length === 0) {
    return undefined;
  }

  let processedContent = args.displayContent;

  for (const ref of refs) {
    if (ref.type === "skill") {
      const skill = await getSkillById(ctx, ref.id);
      // Only the thread's own project Skills are mentionable, and only while they
      // exist — a stale draft must not reach a deleted or foreign Skill.
      if (
        !skill ||
        skill.isDeleted ||
        skill.scope !== "project" ||
        skill.organizationId !== args.organizationId ||
        skill.projectId !== args.projectId ||
        ref.key !== skill.normalizedName
      ) {
        throw new ConvexError(skillErrors.SKILL_NOT_FOUND);
      }

      // Searched for as the stored record spells it, never as the ref does: a ref
      // is client-supplied, so a lying `displayLabel` would show one name to every
      // reader of the thread while pointing the agent at another Skill.
      processedContent = replaceFirstRequired(
        processedContent,
        buildSlashCommandMarkdownLink({
          type: "skill",
          key: skill.normalizedName,
          canonicalKey: `skill:${skill.normalizedName}`,
          displayLabel: buildSlashCommandDisplayLabel({ key: skill.name }),
        }),
        buildSkillMentionDirective(skill.name),
        skillErrors.SKILL_NOT_FOUND
      );
      continue;
    }

    const slashCommand = await getSlashCommandById(ctx, ref.id);
    if (
      !slashCommand ||
      slashCommand.isDeleted ||
      slashCommand.organizationId !== args.organizationId ||
      (slashCommand.scope === "project" && slashCommand.projectId !== args.projectId) ||
      (slashCommand.scope !== "organization" && slashCommand.scope !== "project")
    ) {
      throw new ConvexError(errors.SLASH_COMMAND_NOT_FOUND);
    }

    const canonicalKey = buildSlashCommandCanonicalKey(slashCommand);
    if (
      ref.scope !== slashCommand.scope ||
      ref.key !== slashCommand.key ||
      ref.canonicalKey !== canonicalKey
    ) {
      throw new ConvexError(errors.SLASH_COMMAND_NOT_FOUND);
    }

    processedContent = replaceFirstRequired(
      processedContent,
      buildSlashCommandMarkdownLink({
        type: "slash-command",
        key: slashCommand.key,
        canonicalKey,
        displayLabel: buildSlashCommandDisplayLabel(slashCommand),
      }),
      slashCommand.content,
      errors.SLASH_COMMAND_NOT_FOUND
    );
  }

  return processedContent;
}
