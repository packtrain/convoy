import { describe, expect, test } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { describeInteractionRequest } from "./interactionPreview";

function request(
  kind: Doc<"cliInteractionRequests">["kind"],
  payloadJson: string
): Doc<"cliInteractionRequests"> {
  return { kind, payloadJson } as Doc<"cliInteractionRequests">;
}

describe("describeInteractionRequest", () => {
  test("question: the first question text", () => {
    const payload = JSON.stringify({
      toolName: "AskUserQuestion",
      questions: [{ question: "Postgres or SQLite?", options: [] }, { question: "Second" }],
    });
    expect(describeInteractionRequest(request("question", payload))).toBe("Postgres or SQLite?");
  });

  test("plan-approval: the plan's first non-empty line", () => {
    const payload = JSON.stringify({ toolName: "ExitPlanMode", plan: "\n\n# Refactor auth\n\nStep 1" });
    expect(describeInteractionRequest(request("plan-approval", payload))).toBe("# Refactor auth");
  });

  test("tool-approval: the runtime title, falling back to the tool name", () => {
    const titled = JSON.stringify({ toolName: "Bash", title: "Run tests" });
    expect(describeInteractionRequest(request("tool-approval", titled))).toBe("Run tests");

    const untitled = JSON.stringify({ toolName: "Bash" });
    expect(describeInteractionRequest(request("tool-approval", untitled))).toBe("Wants to use Bash");
  });

  test("malformed or empty payloads yield no preview", () => {
    expect(describeInteractionRequest(request("question", "not json"))).toBeUndefined();
    expect(describeInteractionRequest(request("question", "{}"))).toBeUndefined();
    expect(describeInteractionRequest(request("plan-approval", JSON.stringify({ plan: "  " })))).toBeUndefined();
    expect(describeInteractionRequest(request("tool-approval", "[]"))).toBeUndefined();
  });
});
