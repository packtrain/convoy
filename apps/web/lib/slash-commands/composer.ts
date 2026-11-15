import type { Id } from "@/convex/_generated/dataModel";
import type { RuntimeSlashCommand } from "@/convex/cli/lib/runtimes/validators";

export type SlashCommandScope = "organization" | "project" | "personal";

export interface SlashCommandCatalogItem {
  id: Id<"slashCommands">;
  scope: SlashCommandScope;
  key: string;
  canonicalKey: string;
  displayLabel: string;
  description?: string;
  content: string;
  autoExpand: boolean;
  autoSubmit: boolean;
}

/**
 * Runtime slash command advertised by the thread's live agent (Claude Code
 * built-ins, custom commands, skills — from `cli.facts.getThreadRuntimeCommands`).
 * Selection inserts the literal `/name` text (always autoExpand); the message
 * is then forwarded to the runtime raw instead of expanded server-side.
 */
export interface RuntimeSlashCommandCatalogItem {
  scope: "runtime";
  id: string;
  key: string;
  canonicalKey: string;
  displayLabel: string;
  title: string;
  description?: string;
  /** `[pr-number]`-style hint the runtime reports; rendered after the label. */
  argumentHint?: string;
  content: string;
  autoExpand: true;
  autoSubmit: boolean;
}

/**
 * A project Skill under the same `/` trigger (docs/specs/skills.md#composer-mentions).
 * `content` stays empty: selecting a Skill inserts a pill that resolves server-side
 * into a `load_skill` directive, never its `SKILL.md`.
 */
export interface SkillCatalogItem {
  scope: "skill";
  id: Id<"skills">;
  key: string;
  canonicalKey: string;
  displayLabel: string;
  description?: string;
  content: "";
  autoExpand: false;
  autoSubmit: false;
}

export type ComposerSlashCommandItem = SlashCommandCatalogItem | RuntimeSlashCommandCatalogItem | SkillCatalogItem;

export interface SlashCommandRef {
  type: "slash-command";
  id: Id<"slashCommands">;
  scope: SlashCommandScope;
  key: string;
  canonicalKey: string;
  displayLabel: string;
}

/** Mirrors `skillComposerRefValidator`; `scope` restates `type` so the pill's attrs stay one shape. */
export interface SkillRef {
  type: "skill";
  id: Id<"skills">;
  scope: "skill";
  key: string;
  canonicalKey: string;
  displayLabel: string;
}

export type ThreadComposerCommandRef = SlashCommandRef | SkillRef;
export type SlashCommandNodeAttrs = ThreadComposerCommandRef;

export interface ThreadComposerDocument {
  version: 1;
  refs: ThreadComposerCommandRef[];
}

export function buildSlashCommandCanonicalKey(command: { scope: SlashCommandScope; key: string }): string {
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
  command: Pick<ThreadComposerCommandRef, "type" | "key" | "canonicalKey" | "displayLabel">
): string {
  // Own scheme, so the rendered mention can carry the Skill accent.
  if (command.type === "skill") {
    return `[${command.displayLabel}](convoy://skill/${command.key})`;
  }

  return `[${command.displayLabel}](convoy://command/${command.canonicalKey})`;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSlashCommandMenuDescription(command: Pick<ComposerSlashCommandItem, "description" | "content">): string {
  const description = command.description?.trim();
  if (description) {
    return description;
  }

  return markdownToPlainText(command.content);
}

/** How much prompt-content preview a hover title carries before it is cut. */
const MENU_TITLE_DESCRIPTION_MAX = 240;

/**
 * The whole row as one line, for the menu row's hover title: rows truncate, and
 * an argument hint is exactly what gets cut first (OS-1806).
 */
export function getSlashCommandMenuTitle(item: ComposerSlashCommandItem): string {
  const description = getSlashCommandMenuDescription(item);
  return [
    item.displayLabel,
    item.scope === "runtime" ? item.argumentHint : undefined,
    description.length > MENU_TITLE_DESCRIPTION_MAX
      ? `${description.slice(0, MENU_TITLE_DESCRIPTION_MAX)}…`
      : description,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ");
}

export function createEmptyThreadComposerDocument(): ThreadComposerDocument {
  return {
    version: 1,
    refs: [],
  };
}

// Structurally a tiptap JSONContent doc built from type aliases only (no
// interfaces), so it stays assignable to both the editor's `initialContent`
// and the JSON-shaped draft serialized-content type.
type ComposerJsonNode =
  | { type: "text"; text: string }
  | { type: "slashCommand"; attrs: { [key: string]: string } }
  | { type: "paragraph"; content?: ComposerJsonNode[] };

export type ComposerJsonDoc = { type: "doc"; content: ComposerJsonNode[] };

/** The mention-link grammar, shared with `display.tsx`. Groups: 1 label, 2 kind, 3 key. */
export const SLASH_COMMAND_MARKDOWN_LINK_PATTERN = /\[(\/[A-Za-z0-9:_-]+)\]\(convoy:\/\/(command|skill)\/([A-Za-z0-9:_-]+)\)/g;

/**
 * Rebuild an editable tiptap document from persisted composer content
 * (display text with slash-command markdown links + the matching refs), so a
 * stored prompt (e.g. project-agent automation, OS-1094) prefills the thread
 * composer with real slash-command nodes instead of literal link text.
 * Links without a matching unconsumed ref stay as plain text.
 */
export function buildComposerJsonFromPromptContent(displayContent: string, refs: ThreadComposerCommandRef[]): ComposerJsonDoc {
  const remainingRefs = [...refs];

  const paragraphs = displayContent.split("\n").map((line) => {
    const content: ComposerJsonNode[] = [];
    let lastIndex = 0;

    for (const match of line.matchAll(SLASH_COMMAND_MARKDOWN_LINK_PATTERN)) {
      const refIndex = remainingRefs.findIndex((ref) => buildSlashCommandMarkdownLink(ref) === match[0]);
      if (refIndex < 0) {
        continue;
      }

      if (match.index > lastIndex) {
        content.push({ type: "text", text: line.slice(lastIndex, match.index) });
      }
      const [ref] = remainingRefs.splice(refIndex, 1);
      content.push({ type: "slashCommand", attrs: { ...ref } });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      content.push({ type: "text", text: line.slice(lastIndex) });
    }

    return { type: "paragraph" as const, ...(content.length > 0 ? { content } : {}) };
  });

  return { type: "doc", content: paragraphs };
}

/**
 * Agent commands that take no arguments and are always the whole message, so
 * selecting one from the menu sends it immediately (OS-1614). Everything else
 * — custom commands, skills, prompt templates — only inserts its text,
 * because the user still has arguments to type. Names are matched
 * case-insensitively against the runtime's advertised inventory.
 */
const AUTO_SUBMIT_RUNTIME_COMMANDS = new Set(["compact", "usage"]);

export function isAutoSubmitRuntimeCommand(name: string): boolean {
  return AUTO_SUBMIT_RUNTIME_COMMANDS.has(name.toLowerCase());
}

// Matches what each runtime advertises once it reports (Codex: apps/cli/.../codex/commands.ts).
const COLD_START_GOAL_COMMANDS: Record<"claude-code" | "codex", RuntimeSlashCommand> = {
  "claude-code": { name: "goal", description: "Keep working until a condition holds", argumentHint: "[condition | clear]" },
  codex: { name: "goal", description: "Keep working until a condition holds", argumentHint: "[objective | pause | resume | clear]" },
};

/**
 * Usage is a local control request and works before command discovery. `/goal`
 * is assumed until discovery reports, so a new thread can open on one.
 */
export function getComposerRuntimeCommands(
  cliType: string,
  advertised: RuntimeSlashCommand[] = [],
): RuntimeSlashCommand[] {
  if (cliType !== "codex" && cliType !== "claude-code") return advertised;
  const coldStart = advertised.length === 0 ? [COLD_START_GOAL_COMMANDS[cliType]] : [];
  if (advertised.some(command => command.name === "usage")) return advertised;
  return [...advertised, { name: "usage", description: cliType === "codex" ? "Show current Codex account quota" : "Show reported Claude account quota" }, ...coldStart];
}

export function buildRuntimeSlashCommandItems(
  commands: readonly RuntimeSlashCommand[]
): RuntimeSlashCommandCatalogItem[] {
  return commands.map(({ name, description, argumentHint }) => ({
    scope: "runtime",
    id: `runtime:${name}`,
    key: name.toLowerCase(),
    canonicalKey: `runtime:${name.toLowerCase()}`,
    displayLabel: `/${name}`,
    title: name,
    // Runtimes that advertise names only keep the generic label (OS-1806).
    description: description ?? "Agent command",
    ...(argumentHint !== undefined ? { argumentHint } : {}),
    content: `/${name}`,
    autoExpand: true,
    autoSubmit: isAutoSubmitRuntimeCommand(name),
  }));
}

/**
 * The project's Skills as `/` menu items. Organization templates are never
 * mentionable — same rule as agent delivery (docs/specs/skills.md#composer-mentions).
 */
export function buildSkillComposerItems(
  skills: { _id: Id<"skills">; name: string; description?: string }[]
): SkillCatalogItem[] {
  return skills.map((skill) => ({
    scope: "skill",
    id: skill._id,
    key: skill.name,
    canonicalKey: `skill:${skill.name}`,
    displayLabel: `/${skill.name}`,
    ...(skill.description !== undefined ? { description: skill.description } : {}),
    content: "",
    autoExpand: false,
    autoSubmit: false,
  }));
}

/**
 * Match tiers for the `/` suggestion menu, best first. A plain substring
 * filter ranked `/com` as `convex-create-component`, `autocompact`, `compact`
 * (OS-1645) — a prefix of the key must always beat a match buried inside one.
 */
const SLASH_COMMAND_MATCH_RANK = {
  exact: 0,
  keyPrefix: 1,
  /** Prefix of a later `-`/`_`/`.`/`:` segment, e.g. `comp` in `create-component`. */
  segmentPrefix: 2,
  keySubstring: 3,
  /** Only the scope-prefixed key matched, e.g. `org:rev` for `review`. */
  canonicalSubstring: 4,
} as const;

const SLASH_COMMAND_SEGMENT_SEPARATOR = /[-_.:]/;

function rankSlashCommandMatch(key: string, canonicalKey: string, query: string, queryWithoutScope: string): number | null {
  if (queryWithoutScope.length === 0) {
    return SLASH_COMMAND_MATCH_RANK.exact;
  }

  if (key === queryWithoutScope) {
    return SLASH_COMMAND_MATCH_RANK.exact;
  }

  if (key.startsWith(queryWithoutScope)) {
    return SLASH_COMMAND_MATCH_RANK.keyPrefix;
  }

  const segments = key.split(SLASH_COMMAND_SEGMENT_SEPARATOR);
  if (segments.some((segment, index) => index > 0 && segment.startsWith(queryWithoutScope))) {
    return SLASH_COMMAND_MATCH_RANK.segmentPrefix;
  }

  if (key.includes(queryWithoutScope)) {
    return SLASH_COMMAND_MATCH_RANK.keySubstring;
  }

  if (canonicalKey.includes(query)) {
    return SLASH_COMMAND_MATCH_RANK.canonicalSubstring;
  }

  return null;
}

/**
 * Filter and rank the `/` suggestion menu for the typed query (without the
 * leading slash). A `project:`/`org:` prefix restricts results to that scope
 * and is stripped before matching the key. Ties break by shorter key, then
 * catalog order, so equal-rank duplicates (project vs organization) stay
 * deterministic.
 */
export function matchComposerSlashCommands<T extends Pick<ComposerSlashCommandItem, "key" | "canonicalKey" | "scope">>(
  commands: T[],
  query: string
): T[] {
  const normalizedQuery = query.toLowerCase();
  const explicitScope = normalizedQuery.startsWith("project:")
    ? "project"
    : normalizedQuery.startsWith("org:")
      ? "organization"
      : null;
  const queryWithoutScope = explicitScope ? normalizedQuery.slice(normalizedQuery.indexOf(":") + 1) : normalizedQuery;

  return commands
    .map((command, index) => {
      if (explicitScope && command.scope !== explicitScope) {
        return null;
      }

      const rank = rankSlashCommandMatch(
        command.key.toLowerCase(),
        command.canonicalKey.toLowerCase(),
        normalizedQuery,
        queryWithoutScope
      );
      return rank === null ? null : { command, rank, index };
    })
    .filter((match): match is { command: T; rank: number; index: number } => match !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        // An empty query matches everything equally, so keep catalog order
        // instead of promoting whichever command happens to be shortest.
        (queryWithoutScope.length > 0 ? a.command.key.length - b.command.key.length : 0) ||
        a.index - b.index
    )
    .map((match) => match.command);
}

/**
 * Whether the composed message is a runtime command: the whole message is
 * `/name` plus optional free-text args, with `name` in the advertised list.
 */
export function isRuntimeCommandMessage(
  text: string,
  commands: readonly RuntimeSlashCommand[]
): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return false;
  }

  const token = trimmed.split(/\s+/, 1)[0].slice(1);
  return token.length > 0 && commands.some((command) => command.name === token);
}
