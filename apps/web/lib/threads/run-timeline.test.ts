import { describe, expect, it } from "vitest";
import { buildTimelineRuns, timelineRangeSummary } from "./run-timeline";

// The envelope-sized preview the backend ships: roll-up totals and the true
// file count travel alongside the leading file rows (OS-1600).
const summary = (n: number) => ({
  preRef: `refs/pre-${n}`,
  postRef: `refs/post-${n}`,
  files: [
    { path: `file-${n}.ts`, kind: "modified" as const, additions: n, deletions: 1 },
    { path: `other-${n}.ts`, kind: "added" as const, additions: 2, deletions: 0 },
  ],
  fileCount: 2,
  additions: n + 2,
  deletions: 1,
});

const envelopes = [
  { _id: "u1", role: "user", runId: "b1", createdAt: 1 },
  { _id: "a1", role: "assistant", runId: "b1", createdAt: 2, diffSummary: summary(1) },
  { _id: "u2", role: "user", runId: "b2", createdAt: 3 },
  { _id: "u2b", role: "user", runId: "b2", createdAt: 4 },
  { _id: "a2", role: "assistant", runId: "b2", createdAt: 5 },
  { _id: "u3", role: "user", runId: "b3", createdAt: 6 },
  { _id: "a3", role: "assistant", runId: "b3", createdAt: 7, diffSummary: summary(3) },
];
const userText = new Map([
  ["u1", "fix the bug"],
  ["u2", "add the feature"],
  ["u2b", "steering follow-up"],
]);

describe("buildTimelineRuns", () => {
  it("keeps only assistant messages with a summary, oldest-first, with run prompt and totals", () => {
    const runs = buildTimelineRuns(envelopes, userText);
    expect(runs.map((run) => run.diffSummary.postRef)).toEqual([
      "refs/post-1",
      "refs/post-3",
    ]);
    expect(runs[0]).toMatchObject({
      prompt: "fix the bug",
      fileCount: 2,
      additions: 3,
      deletions: 1,
    });
    // u3 has no text entry — prompt falls back to "".
    expect(runs[1].prompt).toBe("");
  });

  it("reads totals and file count off the preview, not the previewed rows", () => {
    // A truncated preview: 2 rows shipped out of 120 files. Summing the rows
    // would report 2 files / +3 — the preview's own totals are authoritative.
    const runs = buildTimelineRuns(
      [
        envelopes[0],
        {
          _id: "a1",
          role: "assistant",
          runId: "b1",
          createdAt: 2,
          diffSummary: { ...summary(1), fileCount: 120, additions: 400, deletions: 90 },
        },
      ],
      userText
    );
    expect(runs[0]).toMatchObject({
      fileCount: 120,
      additions: 400,
      deletions: 90,
    });
  });

  it("uses the first user message of a run as the prompt", () => {
    const runs = buildTimelineRuns(
      [
        envelopes[2],
        envelopes[3],
        { _id: "a2", role: "assistant", runId: "b2", createdAt: 5, diffSummary: summary(2) },
      ],
      userText
    );
    expect(runs[0].prompt).toBe("add the feature");
  });
});

describe("timelineRangeSummary", () => {
  const runs = buildTimelineRuns(envelopes, userText);

  it("spans oldest preRef to newest postRef regardless of endpoint order", () => {
    const expected = { preRef: "refs/pre-1", postRef: "refs/post-3", files: [] };
    expect(timelineRangeSummary(runs, 0, 1)).toEqual(expected);
    expect(timelineRangeSummary(runs, 1, 0)).toEqual(expected);
  });

  it("degenerates to the single run's own range", () => {
    expect(timelineRangeSummary(runs, 1, 1)).toEqual({
      preRef: "refs/pre-3",
      postRef: "refs/post-3",
      files: [],
    });
  });
});
