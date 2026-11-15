import { describe, expect, it } from "vitest";
import { ProfileSchema } from "./types.js";

const baseProfile = {
  name: "Local",
  url: "https://example.convex.cloud",
  api_key: "sk_test",
  project_id: "project_test",
  paths: ["/tmp/project"],
};

describe("ProfileSchema concurrency", () => {
  it.each([1, 5, 50])("accepts %i workers", (concurrency) => {
    expect(ProfileSchema.safeParse({ ...baseProfile, concurrency }).success).toBe(true);
  });

  it.each([0, -1, 1.5, 51])("rejects %i workers", (concurrency) => {
    expect(ProfileSchema.safeParse({ ...baseProfile, concurrency }).success).toBe(false);
  });

  it("keeps concurrency optional for existing profiles", () => {
    expect(ProfileSchema.safeParse(baseProfile).success).toBe(true);
  });
});
