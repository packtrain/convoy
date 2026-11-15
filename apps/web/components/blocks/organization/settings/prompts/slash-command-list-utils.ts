import type { Id } from "@/convex/_generated/dataModel";
import {
  ALL_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  filterCatalogItems,
  getCatalogCategories,
  getCatalogItemCategory,
  markdownToPlainText,
  stripMatchingFirstMarkdownHeading,
  type SettingsCatalogCategory,
} from "@/components/blocks/settings-catalog/settings-catalog-list-utils";

export { ALL_CATEGORY, UNCATEGORIZED_CATEGORY };

export interface SlashCommandListItem {
  _id: Id<"slashCommands">;
  title?: string;
  key: string;
  description?: string;
  category?: string;
  content: string;
  autoExpand: boolean;
  autoSubmit?: boolean;
}

export type SlashCommandCategory = SettingsCatalogCategory;

export function getSlashCommandDisplayKey(key: string): string {
  return key.startsWith("/") ? key : `/${key}`;
}

export function getSlashCommandCategory(command: Pick<SlashCommandListItem, "category">): string {
  return getCatalogItemCategory(command);
}

export function deriveSlashCommandCardPreview(command: Pick<SlashCommandListItem, "description" | "content" | "key" | "title">): string {
  const description = command.description?.trim();
  if (description) {
    return description;
  }

  return markdownToPlainText(stripMatchingFirstMarkdownHeading(command.content, command.title ?? getSlashCommandDisplayKey(command.key)));
}

export function getSlashCommandCategories(commands: SlashCommandListItem[]): SlashCommandCategory[] {
  return getCatalogCategories(commands);
}

function searchTextForCommand(command: SlashCommandListItem): string {
  return [
    command.key,
    getSlashCommandDisplayKey(command.key),
    command.description,
    getSlashCommandCategory(command),
    deriveSlashCommandCardPreview(command),
    markdownToPlainText(command.content),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterSlashCommands(commands: SlashCommandListItem[], args: { category: string; search: string }): SlashCommandListItem[] {
  return filterCatalogItems(commands, {
    ...args,
    searchText: searchTextForCommand,
    sortKey: (command) => command.key,
  });
}
