import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProfile } from "./profile.js";
const profiles = vi.hoisted(() => new Map<string, { url: string; api_key: string; paths: string[] }>());
vi.mock("./toml.js", () => ({
  getProfileByKey: (key: string) => profiles.get(key),
  listAllProfiles: () => [...profiles].map(([key, profile]) => ({ key, profile })),
  getDefaultProfileKey: () => undefined,
  readConfig: () => ({ profiles: {} }),
}));
beforeEach(() => { profiles.clear(); vi.stubEnv("CONVOY_PROFILE", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("devcontainer profile resolution", () => {
  it.each(["os-prod", "os-devcontainer", "team-work"])("maps host workspace paths for %s", (key) => {
    profiles.set(key, { url: "https://example.convex.cloud", api_key: "test", paths: ["/Users/alex/work/app"] });
    vi.stubEnv("CONVOY_HOST_WORKSPACE", "/Users/alex/work/app");
    vi.stubEnv("CONVOY_CONTAINER_WORKSPACE", "/workspace");
    expect(resolveProfile("/workspace/apps/cli").key).toBe(key);
    expect(resolveProfile("/workspace/apps/cli").profile?.paths).toEqual(["/workspace"]);
    expect(resolveProfile("/workspace-other").key).toBeUndefined();
  });
  it("reports a missing explicit profile without switching backends", () => {
    vi.stubEnv("CONVOY_PROFILE", "missing");
    expect(() => resolveProfile("/workspace")).toThrow('Convoy profile "missing" was not found');
  });
});
