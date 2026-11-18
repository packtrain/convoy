import { describe, expect, test } from "vitest";
import { validateGuide, type GuideRevision } from "./invariants";

const revision: GuideRevision = {
  headSha: "head-1",
  files: [
    { path: "src/a.ts", sha: "blob-a" },
    { path: "src/b.ts", sha: "blob-b" },
  ],
  complete: true,
};

const step = (paths: string[], extra: Partial<{ title: string; questions: string[] }> = {}) => ({
  title: extra.title ?? "Add the parser",
  explanation: "Parses the payload.",
  files: paths.map((path) => ({ path })),
  questions: extra.questions,
});

describe("validateGuide", () => {
  test("a guide covering every file once is stored with each file's blob", () => {
    const result = validateGuide({ headSha: "head-1", steps: [step(["src/a.ts"]), { ...step([]), files: [{ path: " src/b.ts ", note: " Wiring " }] }] }, revision);
    expect(result).toEqual({
      ok: true,
      steps: [
        { title: "Add the parser", explanation: "Parses the payload.", files: [{ path: "src/a.ts", sha: "blob-a" }], questions: [] },
        { title: "Add the parser", explanation: "Parses the payload.", files: [{ path: "src/b.ts", note: "Wiring", sha: "blob-b" }], questions: [] },
      ],
    });
  });

  test("every error comes back at once, naming its step and path", () => {
    const result = validateGuide(
      { headSha: "head-0", steps: [step(["src/a.ts", "src/a.ts", "src/c.ts"], { title: " ", questions: ["Why?", "How?", "What?"] }), step([])] },
      revision
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        "This guide is for commit head-1, but the submit names head-0. Check out head-1 and write the guide for it.",
        "Step 1's title is empty.",
        "Step 1 has 3 questions; the limit is 2.",
        "Step 1 lists src/a.ts twice.",
        "Step 1 lists src/c.ts, which this pull request does not change.",
        "Step 2 has no files.",
        "src/b.ts is not in any step. Every changed file belongs to exactly one step.",
      ],
    });
  });

  test("a file in two steps and a guide without steps are rejected", () => {
    expect(validateGuide({ headSha: "head-1", steps: [step(["src/a.ts", "src/b.ts"]), step(["src/b.ts"])] }, revision)).toEqual({
      ok: false,
      errors: ["src/b.ts is in step 1 and step 2. Put it in one step."],
    });
    expect(validateGuide({ headSha: "head-1", steps: [] }, revision)).toMatchObject({ ok: false, errors: expect.arrayContaining(["A guide has 1 to 8 steps; this one has 0."]) });
  });

  test("with a partial file list, a path GitHub did not list is allowed", () => {
    expect(validateGuide({ headSha: "head-1", steps: [step(["src/a.ts", "src/b.ts", "src/c.ts"])] }, { ...revision, complete: false })).toMatchObject({ ok: true });
  });

  test("a step of the wrong shape is named in the error list, not thrown", () => {
    const result = validateGuide(
      {
        headSha: "head-1",
        steps: [
          { title: "Schema", files: [{ path: "src/a.ts", note: null }, "src/b.ts"], attention: { kind: "danger", note: "x" }, questions: "Why?" },
          null,
        ],
      },
      revision
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        "Step 1's explanation must be text.",
        "Step 1's attention kind must be tradeoff, contract, product, risk, or accessibility.",
        "Step 1's questions must be a list of text.",
        "Step 1's file 2 must be an object with a path.",
        "Step 2 must be an object with a title, an explanation, and files.",
        "src/b.ts is not in any step. Every changed file belongs to exactly one step.",
      ],
    });
  });

  test("files that are not a list, and blank paths, are named as such", () => {
    const steps = [
      { title: "A", explanation: "x", files: "src/a.ts" },
      { title: "B", explanation: "x", files: [{ path: " " }, { path: "src/b.ts" }] },
    ];
    expect(validateGuide({ headSha: "head-1", steps }, { ...revision, complete: false })).toEqual({
      ok: false,
      errors: ["Step 1's files must be a list of objects with a path.", "Step 2's file 1 must be an object with a path.", "src/a.ts is not in any step. Every changed file belongs to exactly one step."],
    });
  });

  test("the size cap counts bytes, not characters", () => {
    // 1,000 notes of 500 two-byte characters: about 520,000 characters but over 1 MB.
    const files = Array.from({ length: 1000 }, (_, index) => ({ path: `f${index}.ts`, sha: "s" }));
    const steps = [{ title: "All", explanation: "Everything.", files: files.map(({ path }) => ({ path, note: "é".repeat(500) })) }];
    expect(validateGuide({ headSha: "head-1", steps }, { ...revision, files })).toEqual({
      ok: false,
      errors: ["The guide is too large to store. Shorten the explanations and notes."],
    });
  });

  test("a long error list is cut with a count", () => {
    const files = Array.from({ length: 60 }, (_, index) => ({ path: `f${index}.ts` }));
    const result = validateGuide({ headSha: "head-1", steps: [step(["src/a.ts", "src/b.ts"])] }, { ...revision, files: [...revision.files, ...files] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(51);
      expect(result.errors.at(-1)).toBe("…and 10 more.");
    }
  });
});

describe("validateGuide for a follow-up", () => {
  // The base Guide, written when src/a.ts and src/b.ts were at blob-a and blob-b-old.
  const base = [
    { title: "Parser", explanation: "Parses.", change: "updated" as const, whatChanged: "Older note.", files: [{ path: "src/a.ts", sha: "blob-a" }], questions: [] },
    { title: "Wiring", explanation: "Wires.", files: [{ path: "src/b.ts", sha: "blob-b-old" }], questions: [] },
    { title: "Docs", explanation: "Docs.", files: [{ path: "docs/old.md", sha: "blob-doc" }], questions: [] },
  ];
  const head: GuideRevision = { ...revision, files: [...revision.files, { path: "src/c.ts", sha: "blob-c" }] };

  test("an Unchanged step is copied from the base, Updated and New steps are written out, and base steps left out are Removed", () => {
    const steps = [
      { unchangedFrom: 1 },
      { ...step(["src/b.ts"], { title: "Wiring, again" }), updatedFrom: 2, whatChanged: " Reads the new flag. " },
      { ...step(["src/c.ts"], { title: "Flag" }) },
    ];
    expect(validateGuide({ headSha: "head-1", steps }, head, base)).toEqual({
      ok: true,
      steps: [
        { title: "Parser", explanation: "Parses.", change: "unchanged", files: [{ path: "src/a.ts", sha: "blob-a" }], questions: [] },
        {
          title: "Wiring, again",
          explanation: "Parses the payload.",
          change: "updated",
          whatChanged: "Reads the new flag.",
          files: [{ path: "src/b.ts", sha: "blob-b" }],
          questions: [],
        },
        { title: "Flag", explanation: "Parses the payload.", change: "new", files: [{ path: "src/c.ts", sha: "blob-c" }], questions: [] },
      ],
      followUp: { removedStepTitles: ["Docs"], changes: { unchanged: 1, updated: 1, added: 1, removed: 1 } },
    });
  });

  test("an Unchanged step owns no file changed since the base, and an Updated step says what changed", () => {
    const steps = [{ unchangedFrom: 2 }, { ...step(["src/a.ts"]), updatedFrom: 1 }, { unchangedFrom: 2 }, { unchangedFrom: 9 }, step(["src/c.ts"])];
    expect(validateGuide({ headSha: "head-1", steps }, head, base)).toEqual({
      ok: false,
      errors: [
        "Step 1 copies base step 2, but src/b.ts changed since the base guide. Write the step out with updatedFrom and whatChanged.",
        "Step 2 updates base step 1 but has no whatChanged.",
        "Step 3 copies base step 2, which step 1 already uses. Use each base step once.",
        "Step 4 names base step 9; the base guide has 3 steps.",
      ],
    });
  });

  test("a guide without a base takes no unchangedFrom or updatedFrom", () => {
    expect(validateGuide({ headSha: "head-1", steps: [{ unchangedFrom: 1 }, { ...step(["src/a.ts", "src/b.ts"]), updatedFrom: 1, whatChanged: "x" }] }, revision)).toEqual({
      ok: false,
      errors: [
        "Step 1 copies a base guide step, but this guide has no base guide. Write the step out in full.",
        "Step 2 updates a base guide step, but this guide has no base guide. Write the step out in full.",
      ],
    });
  });
});
