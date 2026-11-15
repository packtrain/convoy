import { describe, expect, test } from "vitest";
import { resolveAgentContextPreselection } from "./preselection";

const profiles = [
  {
    _id: "profile-1",
    paths: [
      { id: "path-1" },
      { id: "path-2" },
    ],
  },
  {
    _id: "profile-2",
    paths: [{ id: "path-3" }],
  },
];

describe("resolveAgentContextPreselection", () => {
  test("returns a valid profile/path preselection", () => {
    expect(
      resolveAgentContextPreselection(profiles, {
        profileId: "profile-1",
        pathId: "path-2",
      })
    ).toEqual({
      profileId: "profile-1",
      pathId: "path-2",
    });
  });

  test("returns null when profile does not exist", () => {
    expect(
      resolveAgentContextPreselection(profiles, {
        profileId: "missing-profile",
        pathId: "path-1",
      })
    ).toBeNull();
  });

  test("returns null when path does not belong to profile", () => {
    expect(
      resolveAgentContextPreselection(profiles, {
        profileId: "profile-1",
        pathId: "path-3",
      })
    ).toBeNull();
  });

  test("returns null when either query param is missing", () => {
    expect(
      resolveAgentContextPreselection(profiles, {
        profileId: "profile-1",
        pathId: null,
      })
    ).toBeNull();
    expect(
      resolveAgentContextPreselection(profiles, {
        profileId: null,
        pathId: "path-1",
      })
    ).toBeNull();
  });
});
