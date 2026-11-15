import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { toUserFacingError } from "./convex-error.js";

/** How the Convex client rejects: clean text in `data`, transport blob in `message`. */
function convexQueryError(clean: string): ConvexError<string> {
  const blob: string = `[CONVEX Q(cli/messages:listRecentSummaries)] [Request ID: abc] Server Error\nUncaught ConvexError: ${clean}\n    at handler (../../convex/cli/messages.ts:720:37)\n\n  Called by client`;
  const error = new ConvexError(blob);
  error.data = clean;
  return error;
}

describe("toUserFacingError", () => {
  it("unwraps a ConvexError to its clean data payload", () => {
    const message = toUserFacingError(
      convexQueryError("Groups and workflow runs have no messages — list the group's members instead")
    );

    expect(message).toBe(
      "Groups and workflow runs have no messages — list the group's members instead"
    );
    expect(message).not.toContain("CONVEX Q(");
    expect(message).not.toContain("Called by client");
  });

  it("falls back to the message when data is not a string", () => {
    const error = new ConvexError("blob");
    error.data = { code: 42 } as never;

    expect(toUserFacingError(error)).toBe("blob");
  });

  it("names --cursor as the likely cause of a server-side failure", () => {
    // Production redacts a plain Error's text, so the cursor cannot be matched on.
    const error = new Error(
      "[CONVEX Q(cli/threads/summaries:listSummaries)] [Request ID: abc] Server Error\n  Called by client"
    );

    expect(toUserFacingError(error, "garbage")).toContain("--cursor is no longer valid");
  });

  it("leaves a server-side failure alone when no cursor was passed", () => {
    const error = new Error("[CONVEX Q(cli/threads/summaries:listSummaries)] Server Error");

    expect(toUserFacingError(error)).not.toContain("--cursor");
  });

  it("does not blame the cursor for an error we raised ourselves", () => {
    expect(
      toUserFacingError(new Error("Thread not found or not accessible."), "valid_cursor")
    ).toBe("Thread not found or not accessible.");
  });

  it("passes a plain Error through unchanged", () => {
    expect(toUserFacingError(new Error("Thread not found or not accessible."))).toBe(
      "Thread not found or not accessible."
    );
  });

  it("stringifies a non-Error throw", () => {
    expect(toUserFacingError("boom")).toBe("boom");
  });
});
