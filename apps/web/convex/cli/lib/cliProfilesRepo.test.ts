import { describe, expect, test } from "vitest";
import type { Doc } from "../../_generated/dataModel";
import { buildProfileReconnectPatch } from "./cliProfilesRepo";

const PATHS: Doc<"cliProfiles">["paths"] = [
  { id: "path_1", path: "/home/user/project", label: "project" },
];

/**
 * A registration applies exactly one patch, so both fat fields must fold into it
 * (OS-1721). Each is omitted only when the caller has nothing to say about it —
 * an omitted field keeps whatever the document already holds.
 */
describe("buildProfileReconnectPatch", () => {
  test("folds reported paths and advertised runtimes into one patch", () => {
    const availableClis: Doc<"cliProfiles">["lastKnownClis"] = [{ type: "codex", version: "0.142.3" }];

    expect(buildProfileReconnectPatch({ hostname: "my-laptop", paths: PATHS, availableClis, now: 1000 })).toEqual({
      hostname: "my-laptop",
      lastConnectedAt: 1000,
      paths: PATHS,
      lastKnownClis: availableClis,
    });
  });

  test("leaves paths alone when the caller reports none", () => {
    expect(buildProfileReconnectPatch({ hostname: "my-laptop", now: 1000 })).toEqual({
      hostname: "my-laptop",
      lastConnectedAt: 1000,
    });
  });

  test("an empty detection never overwrites the snapshot", () => {
    expect(buildProfileReconnectPatch({ hostname: "my-laptop", availableClis: [], now: 1000 })).toEqual({
      hostname: "my-laptop",
      lastConnectedAt: 1000,
    });
  });
});
