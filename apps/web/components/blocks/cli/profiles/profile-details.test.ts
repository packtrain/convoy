import { describe, expect, it } from "vitest";
import { formatRuntimeDetail } from "./profile-details";

describe("formatRuntimeDetail", () => {
  it("names a managed Gemini key on Antigravity without a model count (OS-2476)", () => {
    expect(formatRuntimeDetail({ type: "antigravity", version: "1.5.14", provider: "gemini", modelCount: 8 })).toBe("1.5.14 · Gemini API key");
  });
  it("keeps other runtimes' model counts", () => {
    expect(formatRuntimeDetail({ type: "opencode", version: "1.19.5", modelCount: 150 })).toBe("1.19.5 · 150 models");
  });
});
