import { describe, expect, it, vi } from "vitest";
import {
  parsePageSize,
  parsePaginationCursor,
  printPaginatedOutput,
} from "./pagination.js";

describe("pagination helpers", () => {
  it("uses the default page size when omitted", () => {
    expect(parsePageSize(undefined)).toBe(20);
  });

  it("parses and validates page size", () => {
    expect(parsePageSize("10")).toBe(10);
    expect(() => parsePageSize("0")).toThrow(/Invalid limit/);
    expect(() => parsePageSize("51")).toThrow(/Invalid limit/);
    expect(() => parsePageSize("abc")).toThrow(/Invalid limit/);
  });

  it("parses cursor values", () => {
    expect(parsePaginationCursor(undefined)).toBeNull();
    expect(parsePaginationCursor(" next ")).toBe("next");
    expect(() => parsePaginationCursor("   ")).toThrow(/Cursor must be/);
  });

  it("prints pagination footer for additional pages in text mode", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    printPaginatedOutput(
      "text",
      {
        page: [{ id: "1" }],
        isDone: false,
        continueCursor: "cursor_2",
      },
      () => undefined,
      "convoy tasks search 'bug' --cursor 'cursor_2'"
    );

    const calls = consoleSpy.mock.calls.flatMap((call) => call).join("\n");
    expect(calls).toContain("Next cursor: cursor_2");
    expect(calls).toContain("Next page: convoy tasks search 'bug' --cursor 'cursor_2'");

    consoleSpy.mockRestore();
  });
});
