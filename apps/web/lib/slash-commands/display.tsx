import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { SLASH_COMMAND_MARKDOWN_LINK_PATTERN } from "./composer";

type SlashCommandDisplayPart =
  | { type: "text"; value: string }
  | { type: "slash-command"; label: string; canonicalKey: string; isSkill: boolean };

export function splitSlashCommandDisplayLinks(
  text: string
): SlashCommandDisplayPart[] {
  const parts: SlashCommandDisplayPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(SLASH_COMMAND_MARKDOWN_LINK_PATTERN)) {
    const linkStart = match.index;
    const fullMatch = match[0];
    const label = match[1] ?? "";
    const isSkill = match[2] === "skill";
    const key = match[3] ?? "";
    // A Skill link carries the bare name; the pill's key is scope-prefixed.
    const canonicalKey = isSkill ? `skill:${key}` : key;

    if (linkStart > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, linkStart) });
    }

    parts.push({ type: "slash-command", label, canonicalKey, isSkill });
    lastIndex = linkStart + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts;
}

export function slashCommandDisplayText(text: string): string {
  return splitSlashCommandDisplayLinks(text)
    .map((part) => (part.type === "slash-command" ? part.label : part.value))
    .join("");
}

export function SlashCommandDisplayText({
  text,
  className,
  highlightCommands = true,
}: {
  text: string;
  className?: string;
  highlightCommands?: boolean;
}) {
  return (
    <>
      {splitSlashCommandDisplayLinks(text).map((part, index) => {
        if (part.type === "slash-command") {
          return (
            <span
              key={`${part.type}-${index}`}
              className={cn(
                highlightCommands &&
                  (part.isSkill
                    ? "font-medium text-violet-600 dark:text-violet-400"
                    : "font-medium text-info"),
                className
              )}
              data-slash-command-text
              data-slash-command-canonical-key={part.canonicalKey}
            >
              {part.label}
            </span>
          );
        }

        return <Fragment key={`${part.type}-${index}`}>{part.value}</Fragment>;
      })}
    </>
  );
}
