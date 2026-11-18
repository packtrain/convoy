import { describe, expect, test } from "vitest";
import { DEFAULT_GUIDE_INSTRUCTIONS, guidePrompt } from "./guide-prompt";

describe("guidePrompt", () => {
  test("names the revision, the checkout, the instructions, and the submit command", () => {
    const prompt = guidePrompt({ pullRequest: { owner: "acme", name: "web", number: 482, ref: "acme/web#482" } as never, baseSha: "b1", headSha: "h2" });
    expect(prompt).toContain("acme/web#482 at commit h2");
    expect(prompt).toContain("`gh pr checkout 482 --detach`");
    expect(prompt).toContain("`git diff b1...h2`");
    expect(prompt).toContain(DEFAULT_GUIDE_INSTRUCTIONS);
    expect(prompt).toContain('"headSha": "h2"');
    expect(prompt).toContain("convoy threads submit-guide <threadId> /tmp/guide.json");
    expect(prompt).toContain('convoy threads submit-guide <threadId> --failed --note "<why>"');
  });

  test("the rules Convoy enforces stay when a project replaces the instructions", () => {
    const prompt = guidePrompt({ pullRequest: { owner: "acme", name: "web", number: 1, ref: "acme/web#1" } as never, baseSha: "b", headSha: "h", instructions: "Be brief." });
    expect(prompt).toContain("Be brief.");
    expect(prompt).not.toContain(DEFAULT_GUIDE_INSTRUCTIONS);
    expect(prompt).toContain("1 to 8 steps");
    expect(prompt).toContain("at most 2 questions per step");
  });

  test("on a Stack, the guide covers only its own Layer and names the others", () => {
    const pullRequest = { owner: "acme", name: "web", number: 11, ref: "acme/web#11" } as never;
    const layers = [
      { number: 10, title: "Add the schema" },
      { number: 11, title: "Add the API" },
      { number: 12, title: "Add the UI" },
    ];
    const prompt = guidePrompt({ pullRequest, baseSha: "b", headSha: "h", layers });
    expect(prompt).toContain("This pull request is one Layer of a Stack, from the base up: #10 Add the schema; #11 Add the API (this pull request); #12 Add the UI.");
    expect(prompt).toContain('Cover only this Layer\'s changes. Mention another Layer in a phrase at most, such as "added in #10".');
    expect(guidePrompt({ pullRequest, baseSha: "b", headSha: "h", layers: [layers[1]] })).not.toContain("Stack");
  });

  test("a follow-up gets its base's steps and the rules for Unchanged, Updated, New, and Removed steps", () => {
    const pullRequest = { owner: "acme", name: "web", number: 1, ref: "acme/web#1" } as never;
    const base = {
      headSha: "8a3e7d1c",
      steps: [{ title: "Add the schema", explanation: "Adds a table.", files: [{ path: "convex/schema.ts" }, { path: "convex/a.ts" }], questions: [] }],
    };
    const prompt = guidePrompt({ pullRequest, baseSha: "b", headSha: "c91f02a9", base });
    expect(prompt).toContain("This guide follows up the guide written for 8a3e7d1c.");
    expect(prompt).toContain("Base step 1: Add the schema\n```json");
    expect(prompt).toContain('"explanation": "Adds a table."');
    expect(prompt).toContain('"path": "convex/a.ts"');
    expect(prompt).toContain("`git diff --stat 8a3e7d1c c91f02a9`");
    expect(prompt).toContain('{ "unchangedFrom": <its number> }');
    expect(prompt).toContain('"updatedFrom": <its number>');
    expect(prompt).toContain('"unchangedFrom": 1');
    expect(guidePrompt({ pullRequest, baseSha: "b", headSha: "h" })).not.toContain("unchangedFrom");
  });

  test("a follow-up's base steps keep their notes, questions, attention, and what changed", () => {
    const pullRequest = { owner: "acme", name: "web", number: 1, ref: "acme/web#1" } as never;
    const steps = [
      {
        title: "Add the schema",
        explanation: "Adds a table.",
        attention: { kind: "risk" as const, note: "Backfill needed." },
        files: [{ path: "convex/schema.ts", note: "The table", sha: "blob-1" }],
        questions: ["Why a new table?"],
        change: "updated" as const,
        whatChanged: "Adds an index.",
      },
    ];
    const prompt = guidePrompt({ pullRequest, baseSha: "b", headSha: "h", base: { headSha: "8a3e7d1c", steps } });
    for (const text of ["Backfill needed.", "The table", "Why a new table?", "Adds an index."]) expect(prompt).toContain(text);
    expect(prompt).not.toContain("blob-1");
  });
});
