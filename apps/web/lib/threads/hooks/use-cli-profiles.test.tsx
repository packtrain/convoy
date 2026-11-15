/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCliProfiles } from "./use-cli-profiles";

const queryState = vi.hoisted(() => ({
  profiles: undefined as unknown,
  catalogs: undefined as unknown,
  calls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    queryState.calls.push({ name, args });
    // A skipped query has no data, as in convex/react.
    if (args === "skip") {
      return undefined;
    }
    return name.endsWith("listRuntimeCatalogs") ? queryState.catalogs : queryState.profiles;
  },
}));

function makeProfile(id: string) {
  return {
    _id: id as Id<"cliProfiles">,
    name: id,
    paths: [],
    createdAt: Date.now(),
    isOnline: false,
    availableClis: [{ type: "opencode" as const, version: "1.17.13" }],
  };
}

const MODELS = [{ slug: "openai/gpt-5", name: "GPT-5", variants: ["high"] }];

function catalogArgs() {
  return queryState.calls.find((call) => call.name.includes("listRuntimeCatalogs"))?.args;
}

describe("useCliProfiles", () => {
  test("exposes the server-scoped profiles", () => {
    queryState.calls = [];
    queryState.profiles = [makeProfile("owned")];

    const { result } = renderHook(() => useCliProfiles("project-1" as Id<"projects">));

    expect(result.current.profiles.map((profile) => profile._id)).toEqual(["owned"]);
    expect(result.current.hasProfiles).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  // The catalog is a second subscription; consumers with no model picker (thread
  // list, group tabs) must not pay for it (OS-1721).
  test("does not subscribe to catalogs unless asked", () => {
    queryState.calls = [];
    queryState.profiles = [makeProfile("owned")];
    queryState.catalogs = [{ profileId: "owned", cliType: "opencode", models: MODELS }];

    const { result } = renderHook(() => useCliProfiles("project-1" as Id<"projects">));

    expect(catalogArgs()).toBe("skip");
    expect(result.current.profiles[0]?.availableClis).toEqual([{ type: "opencode", version: "1.17.13" }]);
  });

  test("attaches each profile's catalog when the caller offers models", () => {
    queryState.calls = [];
    queryState.profiles = [makeProfile("owned"), makeProfile("other")];
    queryState.catalogs = [{ profileId: "owned", cliType: "opencode", models: MODELS }];

    const { result } = renderHook(() =>
      useCliProfiles("project-1" as Id<"projects">, { withModelCatalogs: true })
    );

    expect(catalogArgs()).toEqual({ projectId: "project-1" });
    expect(result.current.profiles[0]?.availableClis).toEqual([
      { type: "opencode", version: "1.17.13", models: MODELS },
    ]);
    // Another profile's catalog never leaks onto this one.
    expect(result.current.profiles[1]?.availableClis).toEqual([{ type: "opencode", version: "1.17.13" }]);
  });

  // Project-scoped, so it does not wait for the profile list to resolve — no
  // serial round trip on composer mount.
  test("subscribes to catalogs before the profile list resolves", () => {
    queryState.calls = [];
    queryState.profiles = undefined;
    queryState.catalogs = undefined;

    renderHook(() => useCliProfiles("project-1" as Id<"projects">, { withModelCatalogs: true }));

    expect(catalogArgs()).toEqual({ projectId: "project-1" });
    expect(queryState.calls[0]?.name).toBe(getFunctionName(api.cli.profiles.listByProject));
  });

  test("skips both queries without a project", () => {
    queryState.calls = [];

    renderHook(() => useCliProfiles(undefined, { withModelCatalogs: true }));

    expect(queryState.calls.every((call) => call.args === "skip")).toBe(true);
  });
});
