import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "../../../lib/contracts/workflowDefinition";
import { laneThreadTitle, stepTitle } from "./naming";

const THREAD_TITLE_MAX_LENGTH = 120;

function promptStep(name: string): WorkflowStep {
  return { stepId: "step-1", laneId: "lane-1", name, action: { type: "prompt", content: { displayContent: "Do the thing." } } };
}

// In /u mode a well-formed pair matches as one code point, so \p{Surrogate}
// hits only a lone half — which Convex rejects at write time.
const LONE_SURROGATE = /\p{Surrogate}/u;

describe("run-surface naming", () => {
  it("clips a step label at the cap without splitting a surrogate pair", () => {
    const title = stepTitle(promptStep(`${"a".repeat(78)}😀z`), undefined);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(LONE_SURROGATE);
  });

  it("clips a thread-title prefix at the cap without splitting a surrogate pair", () => {
    const title = laneThreadTitle(`${"w".repeat(118)}😀z`, undefined, undefined);
    expect(title.length).toBeLessThanOrEqual(THREAD_TITLE_MAX_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(LONE_SURROGATE);
  });
});
