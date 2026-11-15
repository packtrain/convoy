export const UNCATEGORIZED_CATEGORY = "Uncategorized";
export const ALL_CATEGORY = "All";

export interface CategorizedCatalogItem {
  category?: string;
}

export interface SettingsCatalogCategory {
  name: string;
  count: number;
}

export function getCatalogItemCategory(
  item: CategorizedCatalogItem
): string {
  const category = item.category?.trim();
  return category || UNCATEGORIZED_CATEGORY;
}

export function getCatalogCategories<TItem extends CategorizedCatalogItem>(
  items: TItem[]
): SettingsCatalogCategory[] {
  return getCatalogCategoriesFromCounts(items.map((item) => ({ category: item.category, count: 1 })));
}

/** Same navigation, but from server-side counts — a paginated list cannot count its own categories. */
export function getCatalogCategoriesFromCounts(
  entries: (CategorizedCatalogItem & { count: number })[]
): SettingsCatalogCategory[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    const category = getCatalogItemCategory(entry);
    counts.set(category, (counts.get(category) ?? 0) + entry.count);
    total += entry.count;
  }

  const sortedCategories = [...counts.entries()]
    .filter(([name]) => name !== UNCATEGORIZED_CATEGORY)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }));

  const uncategorizedCount = counts.get(UNCATEGORIZED_CATEGORY);
  if (uncategorizedCount !== undefined) {
    sortedCategories.push({
      name: UNCATEGORIZED_CATEGORY,
      count: uncategorizedCount,
    });
  }

  return [
    {
      name: ALL_CATEGORY,
      count: total,
    },
    ...sortedCategories,
  ];
}

/**
 * The category + search + sort every settings catalog list runs (Skills,
 * Prompts, Agents). `searchText` is only built for a non-empty search.
 */
export function filterCatalogItems<TItem extends CategorizedCatalogItem>(
  items: TItem[],
  args: {
    category: string;
    search: string;
    searchText: (item: TItem) => string;
    sortKey: (item: TItem) => string;
  }
): TItem[] {
  const search = args.search.trim().toLowerCase();

  return items
    .filter(
      (item) =>
        (args.category === ALL_CATEGORY || getCatalogItemCategory(item) === args.category) &&
        (search === "" || args.searchText(item).includes(search))
    )
    .sort((left, right) => args.sortKey(left).localeCompare(args.sortKey(right)));
}

export function normalizeMarkdownHeadingText(value: string): string {
  return value.trim().toLowerCase();
}

export function stripMatchingFirstMarkdownHeading(
  content: string,
  title: string
): string {
  const lines = content.split(/\r?\n/);
  const firstContentLineIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstContentLineIndex === -1) {
    return content;
  }

  const firstLine = lines[firstContentLineIndex].trim();
  const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(firstLine);
  if (!match) {
    return content;
  }

  if (normalizeMarkdownHeadingText(match[2]) !== normalizeMarkdownHeadingText(title)) {
    return content;
  }

  return [
    ...lines.slice(0, firstContentLineIndex),
    ...lines.slice(firstContentLineIndex + 1),
  ].join("\n");
}

export function markdownToPlainText(markdown: string): string {
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
