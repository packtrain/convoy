import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  buildComposerJsonFromPromptContent,
  buildRuntimeSlashCommandItems,
  buildSkillComposerItems,
  buildSlashCommandCanonicalKey,
  buildSlashCommandMarkdownLink,
  getSlashCommandMenuDescription,
  getComposerRuntimeCommands,
  getSlashCommandMenuTitle,
  isAutoSubmitRuntimeCommand,
  isRuntimeCommandMessage,
  matchComposerSlashCommands,
} from "./composer";

describe("slash command composer helpers", () => {
  test("offers local Codex usage before discovery without duplicating or leaking it to another runtime", () => {
    expect(getComposerRuntimeCommands("codex")[0]).toEqual({ name: "usage", description: "Show current Codex account quota" });
    const commands = [{ name: "usage", description: "Reported usage" }, { name: "compact" }];
    expect(getComposerRuntimeCommands("codex", commands)).toBe(commands);
    expect(getComposerRuntimeCommands("claude-code", commands)).toBe(commands);
    expect(getComposerRuntimeCommands("opencode")).toEqual([]);
  });

  test("offers Claude /goal before discovery so a new thread can open on a goal (OS-2276)", () => {
    expect(getComposerRuntimeCommands("claude-code").map(command => command.name)).toEqual(["usage", "goal"]);
    expect(isRuntimeCommandMessage("/goal Create b.txt", getComposerRuntimeCommands("claude-code"))).toBe(true);
    // Discovery wins once the runtime reports: an inventory without /goal keeps it prose.
    expect(getComposerRuntimeCommands("claude-code", [{ name: "compact" }]).map(command => command.name)).toEqual(["compact", "usage"]);
  });

  test("offers Codex /goal before discovery with the Codex controls (OS-2277)", () => {
    expect(getComposerRuntimeCommands("codex")).toEqual([
      { name: "usage", description: "Show current Codex account quota" },
      { name: "goal", description: "Keep working until a condition holds", argumentHint: "[objective | pause | resume | clear]" },
    ]);
    expect(isRuntimeCommandMessage("/goal count.txt holds 3", getComposerRuntimeCommands("codex"))).toBe(true);
    expect(getComposerRuntimeCommands("codex", [{ name: "compact" }]).map(command => command.name)).toEqual(["compact", "usage"]);
  });

  test("offers agy's built-in commands before discovery, without compact or usage", () => {
    const names = getComposerRuntimeCommands("antigravity").map(command => command.name);
    expect(names).toEqual(["goal", "plan", "schedule", "browser", "grill-me", "teamwork", "learn", "boost"]);
    expect(isRuntimeCommandMessage("/plan add a login page", getComposerRuntimeCommands("antigravity"))).toBe(true);
    // Discovery wins once agy reports.
    const advertised = [{ name: "compact" }, { name: "my-skill" }];
    expect(getComposerRuntimeCommands("antigravity", advertised)).toBe(advertised);
  });

  test("builds scoped canonical keys", () => {
    expect(buildSlashCommandCanonicalKey({ scope: "organization", key: "review" })).toBe("org:review");
    expect(buildSlashCommandCanonicalKey({ scope: "project", key: "review" })).toBe("project:review");
  });

  test("builds command markdown links from display and canonical keys", () => {
    expect(
      buildSlashCommandMarkdownLink({
        type: "slash-command",
        key: "client-summary",
        displayLabel: "/client-summary",
        canonicalKey: "org:client-summary",
      })
    ).toBe("[/client-summary](convoy://command/org:client-summary)");
  });

  test("uses command description for menu secondary text", () => {
    expect(
      getSlashCommandMenuDescription({
        description: "Summarize client facts.",
        content: "# Client Summary\n\nDraft a summary.",
      })
    ).toBe("Summarize client facts.");
  });

  // OS-1806: rows truncate, so the whole line has to be readable on hover.
  test("builds the hover title from label, argument hint and description", () => {
    const [review] = buildRuntimeSlashCommandItems([
      { name: "code-review", description: "Review the changed code", argumentHint: "[low|high] [--fix]" },
    ]);

    expect(getSlashCommandMenuTitle(review!)).toBe(
      "/code-review [low|high] [--fix] Review the changed code"
    );
  });

  test("caps a long prompt-content preview in the hover title", () => {
    const title = getSlashCommandMenuTitle({
      scope: "organization",
      key: "long",
      canonicalKey: "org:long",
      displayLabel: "/long",
      content: "x".repeat(500),
      id: "cmd_long" as Id<"slashCommands">,
      autoExpand: false,
      autoSubmit: false,
    });

    expect(title.length).toBeLessThanOrEqual(320);
    expect(title.endsWith("…")).toBe(true);
  });

  test("falls back to prompt content", () => {
    expect(
      getSlashCommandMenuDescription({
        content: "# Client Summary\n\nDraft a summary from the selected context.",
      })
    ).toBe("Client Summary Draft a summary from the selected context.");
  });
});

// OS-1614: no-argument built-ins autosend on selection; commands that take
// free-text arguments must stay editable in the draft.
describe("runtime slash command items", () => {
  test("arms autosubmit only for no-argument built-ins", () => {
    expect(isAutoSubmitRuntimeCommand("compact")).toBe(true);
    expect(isAutoSubmitRuntimeCommand("Compact")).toBe(true);
    expect(isAutoSubmitRuntimeCommand("review")).toBe(false);
  });

  test("marks the built-in item autoSubmit and leaves others off", () => {
    const [compact, review] = buildRuntimeSlashCommandItems([{ name: "compact" }, { name: "review" }]);

    expect(compact).toMatchObject({ key: "compact", autoExpand: true, autoSubmit: true });
    expect(review).toMatchObject({ key: "review", autoExpand: true, autoSubmit: false });
  });

  // OS-1806: the runtime reports a description and an argument hint for every
  // command; a row with neither keeps the generic label.
  test("carries the reported description and argument hint onto the item", () => {
    const [review, compact] = buildRuntimeSlashCommandItems([
      { name: "review", description: "Review a PR", argumentHint: "[pr-number]" },
      { name: "compact" },
    ]);

    expect(review).toMatchObject({ description: "Review a PR", argumentHint: "[pr-number]" });
    expect(compact?.description).toBe("Agent command");
    expect(compact?.argumentHint).toBeUndefined();
  });
});

// OS-1784: Skills share the `/` trigger, so they must never carry a body into
// the draft — the pill resolves server-side into a `load_skill` directive.
describe("skill composer items", () => {
  const skills = [{ _id: "skill_pdf" as Id<"skills">, name: "pdf-tools", description: "Fill PDFs" }];

  test("builds a project skill item with no expandable content", () => {
    expect(buildSkillComposerItems(skills)).toEqual([
      {
        scope: "skill",
        id: "skill_pdf",
        key: "pdf-tools",
        canonicalKey: "skill:pdf-tools",
        displayLabel: "/pdf-tools",
        description: "Fill PDFs",
        content: "",
        autoExpand: false,
        autoSubmit: false,
      },
    ]);
  });

  test("links a skill mention through its own url scheme", () => {
    expect(
      buildSlashCommandMarkdownLink({
        type: "skill",
        key: "pdf-tools",
        canonicalKey: "skill:pdf-tools",
        displayLabel: "/pdf-tools",
      })
    ).toBe("[/pdf-tools](convoy://skill/pdf-tools)");
  });

  test("rehydrates a saved skill mention as a pill", () => {
    const ref = {
      type: "skill" as const,
      id: "skill_pdf" as Id<"skills">,
      scope: "skill" as const,
      key: "pdf-tools",
      canonicalKey: "skill:pdf-tools",
      displayLabel: "/pdf-tools",
    };

    expect(buildComposerJsonFromPromptContent("Use [/pdf-tools](convoy://skill/pdf-tools) now", [ref])).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Use " },
            { type: "slashCommand", attrs: ref },
            { type: "text", text: " now" },
          ],
        },
      ],
    });
  });
});

// OS-1645: `/com` used to rank `/compact` third behind substring matches in
// `/convex-create-component` and `/autocompact`.
describe("matchComposerSlashCommands", () => {
  const runtimeKeys = (keys: string[]) => buildRuntimeSlashCommandItems(keys.map((name) => ({ name })));

  test("ranks key prefixes above segment prefixes and mid-key substrings", () => {
    const matched = matchComposerSlashCommands(runtimeKeys(["convex-create-component", "autocompact", "compact"]), "com");

    expect(matched.map((item) => item.key)).toEqual(["compact", "convex-create-component", "autocompact"]);
  });

  test("treats a namespace prefix as a segment, so the name after it ranks as a segment prefix", () => {
    const matched = matchComposerSlashCommands(runtimeKeys(["regrill", "mp:grilling"]), "grill");

    expect(matched.map((item) => item.key)).toEqual(["mp:grilling", "regrill"]);
  });

  test("puts an exact key first even when a longer key also starts with it", () => {
    const matched = matchComposerSlashCommands(runtimeKeys(["compact-hard", "compact"]), "compact");

    expect(matched.map((item) => item.key)).toEqual(["compact", "compact-hard"]);
  });

  test("breaks prefix ties by shorter key then catalog order", () => {
    const matched = matchComposerSlashCommands(runtimeKeys(["review-pr", "review", "review-branch"]), "rev");

    expect(matched.map((item) => item.key)).toEqual(["review", "review-pr", "review-branch"]);
  });

  test("keeps every command for an empty query in catalog order", () => {
    const matched = matchComposerSlashCommands(runtimeKeys(["compact", "review"]), "");

    expect(matched.map((item) => item.key)).toEqual(["compact", "review"]);
  });

  test("drops commands that match nothing", () => {
    const matched = matchComposerSlashCommands(runtimeKeys(["compact", "review"]), "zzz");

    expect(matched).toEqual([]);
  });

  test("restricts an explicit scope prefix to that scope and matches the bare key", () => {
    const stored = [
      { key: "review", canonicalKey: "project:review", scope: "project" as const },
      { key: "review", canonicalKey: "org:review", scope: "organization" as const },
      { key: "review", canonicalKey: "review", scope: "runtime" as const },
    ];

    expect(matchComposerSlashCommands(stored, "project:rev")).toEqual([stored[0]]);
    expect(matchComposerSlashCommands(stored, "org:rev")).toEqual([stored[1]]);
  });

  test("matches a scope-prefixed canonical key as a last resort", () => {
    const stored = [
      { key: "compact", canonicalKey: "compact", scope: "runtime" as const },
      { key: "review", canonicalKey: "org:review", scope: "organization" as const },
    ];

    // "org" hits nothing in either key, so only the canonical-key match survives.
    expect(matchComposerSlashCommands(stored, "org")).toEqual([stored[1]]);
  });

  // OS-1784: `project:`/`org:` filter Prompts; a Skill is reached by its own
  // `skill:` canonical key (docs/specs/skills.md#trigger-and-appearance).
  test("narrows to Skills on a skill: prefix and excludes them from project:", () => {
    const catalog = [
      { key: "review", canonicalKey: "project:review", scope: "project" as const },
      ...buildSkillComposerItems([{ _id: "skill_review" as Id<"skills">, name: "review" }]),
    ];

    expect(matchComposerSlashCommands(catalog, "skill:rev")).toEqual([catalog[1]]);
    expect(matchComposerSlashCommands(catalog, "project:rev")).toEqual([catalog[0]]);
  });

  test("matches case-insensitively", () => {
    const matched = matchComposerSlashCommands(runtimeKeys(["Compact", "autocompact"]), "COM");

    expect(matched.map((item) => item.key)).toEqual(["compact", "autocompact"]);
  });
});
