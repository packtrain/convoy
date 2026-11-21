/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { useThreadProfileClis } from "./use-thread-profile-clis";

const queryResults = vi.hoisted(() => new Map<string, unknown>());

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : queryResults.get(getFunctionName(reference)),
}));

const PROFILE_ID = "profile_1" as Id<"cliProfiles">;
const PROJECT_ID = "project_1" as Id<"projects">;
const MODELS = [{ slug: "gemini-4-neon", name: "Gemini 4 Neon", variants: ["high"] }];
const CLIS = [{ type: "antigravity" as const, version: "1.0.0" }];
const PROFILE = { _id: PROFILE_ID, name: "Sandbox", paths: [], createdAt: 0, isOnline: true, availableClis: CLIS };

function setup({ profile, projectProfiles }: { profile: unknown; projectProfiles: unknown }) {
  queryResults.clear();
  queryResults.set("cli/profiles:get", profile);
  queryResults.set("cli/profiles:listByProject", projectProfiles);
  queryResults.set("cli/profiles:listRuntimeCatalogs", [
    { profileId: PROFILE_ID, cliType: "antigravity", models: MODELS },
  ]);
  return renderHook(() =>
    useThreadProfileClis({ projectId: PROJECT_ID, profileId: PROFILE_ID, readOnly: false })
  ).result.current;
}

describe("useThreadProfileClis", () => {
  test("hydrates the thread's profile with its catalog", () => {
    const result = setup({ profile: PROFILE, projectProfiles: [PROFILE] });

    expect(result.activeProfile?._id).toBe(PROFILE_ID);
    expect(result.activeProfileClis).toEqual([{ ...CLIS[0], models: MODELS }]);
  });

  // A thread opened right after creation: `profiles.get` is cold, but the project
  // list the threads layout keeps subscribed is not. Without it the model label
  // flashes its raw slug.
  test("falls back to the project's profile list while the profile loads", () => {
    const result = setup({ profile: undefined, projectProfiles: [PROFILE] });

    expect(result.activeProfile).toBeUndefined();
    expect(result.activeProfileClis).toEqual([{ ...CLIS[0], models: MODELS }]);
  });
});
