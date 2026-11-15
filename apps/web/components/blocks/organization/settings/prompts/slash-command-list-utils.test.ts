import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ALL_CATEGORY,
  UNCATEGORIZED_CATEGORY,
  deriveSlashCommandCardPreview,
  filterSlashCommands,
  getSlashCommandCategories,
  getSlashCommandCategory,
  getSlashCommandDisplayKey,
  type SlashCommandListItem,
} from "./slash-command-list-utils";

function command(overrides: Partial<SlashCommandListItem> & Pick<SlashCommandListItem, "key">): SlashCommandListItem {
  return {
    _id: `${overrides.key}_id` as Id<"slashCommands">,
    description: undefined,
    category: undefined,
    content: "Default content",
    autoExpand: false,
    ...overrides,
  };
}

describe("slash command list utils", () => {
  test("display key prefixes slash", () => {
    expect(getSlashCommandDisplayKey("review")).toBe("/review");
    expect(getSlashCommandDisplayKey("/review")).toBe("/review");
  });

  test("categories include All first and missing category maps to Uncategorized", () => {
    const commands = [command({ key: "b", category: "Banking" }), command({ key: "a", category: "Corporate" }), command({ key: "c" })];

    expect(getSlashCommandCategory(commands[2])).toBe(UNCATEGORIZED_CATEGORY);
    expect(getSlashCommandCategories(commands)).toEqual([
      { name: ALL_CATEGORY, count: 3 },
      { name: "Banking", count: 1 },
      { name: "Corporate", count: 1 },
      { name: UNCATEGORIZED_CATEGORY, count: 1 },
    ]);
  });

  test("sorts commands by key", () => {
    const sorted = filterSlashCommands([command({ key: "b" }), command({ key: "review" }), command({ key: "a" })], {
      category: ALL_CATEGORY,
      search: "",
    });

    expect(sorted.map((item) => item.key)).toEqual(["a", "b", "review"]);
  });

  test("search matches key, display key, description, category, and preview text", () => {
    const commands = [
      command({
        key: "review",
        description: "Risk scan",
        category: "Legal",
        content: "ignored",
      }),
      command({
        key: "memo",
        category: "Client",
        content: "# Memo\n\nPlain language summary",
      }),
    ];

    expect(filterSlashCommands(commands, { category: ALL_CATEGORY, search: "review" }).map((item) => item.key)).toEqual(["review"]);
    expect(filterSlashCommands(commands, { category: ALL_CATEGORY, search: "/review" }).map((item) => item.key)).toEqual(["review"]);
    expect(filterSlashCommands(commands, { category: ALL_CATEGORY, search: "risk" }).map((item) => item.key)).toEqual(["review"]);
    expect(filterSlashCommands(commands, { category: ALL_CATEGORY, search: "legal" }).map((item) => item.key)).toEqual(["review"]);
    expect(filterSlashCommands(commands, { category: ALL_CATEGORY, search: "plain language" }).map((item) => item.key)).toEqual(["memo"]);
  });

  test("filters by category before search", () => {
    const commands = [command({ key: "review", category: "Legal" }), command({ key: "research", category: "Knowledge" })];

    expect(filterSlashCommands(commands, { category: "Legal", search: "re" }).map((item) => item.key)).toEqual(["review"]);
  });

  test("markdown preview strips matching first heading", () => {
    expect(
      deriveSlashCommandCardPreview({
        title: "Client Memo",
        key: "client-memo",
        content: "# Client Memo\n\nDraft a memo for the client.",
      })
    ).toBe("Draft a memo for the client.");
  });

  test("markdown preview keeps non-matching heading content", () => {
    expect(
      deriveSlashCommandCardPreview({
        title: "Client Memo",
        key: "client-memo",
        content: "# Instructions\n\nDraft a memo for the client.",
      })
    ).toBe("Instructions Draft a memo for the client.");
  });
});
