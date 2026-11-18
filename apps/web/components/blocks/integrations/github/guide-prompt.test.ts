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
});
