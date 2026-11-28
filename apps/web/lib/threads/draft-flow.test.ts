import { describe, expect, test } from "vitest";
import { buildAddToGroupDraftSeed, resolveNewThreadDraftState } from "./draft-flow";

describe("buildAddToGroupDraftSeed", () => {
  const profiles = [
    {
      _id: "profile-1",
      isOnline: true,
      paths: [
        { id: "path-1" },
        { id: "wt-1", kind: "worktree" as const, parentPathId: "path-1" },
      ],
    },
  ];
  const baseChat = {
    _id: "thread-1",
    profileId: "profile-1",
    pathId: "path-1",
    cliType: "claude-code" as const,
  };

  test("seeds the source thread's settings with an empty composer", () => {
    const seed = buildAddToGroupDraftSeed(
      {
        ...baseChat,
        metadata: { cli: { lastUsedMode: "plan" } },
        agent: { projectAgentId: "agent-1", isDeleted: false },
      },
      profiles
    );

    expect(seed.text).toBe("");
    expect(seed.composerContent).toBeUndefined();
    expect(seed.profileId).toBe("profile-1");
    expect(seed.pathId).toBe("path-1");
    expect(seed.baseRef).toBeUndefined();
    expect(seed.cliType).toBe("claude-code");
    expect(seed.mode).toBe("plan");
    expect(seed.projectAgentId).toBe("agent-1");
    expect(seed.attachments).toEqual({ pending: false });
    expect(seed.seededFrom).toBe("thread-1");
  });

  test("a worktree source selects the existing worktree instead of spawning a new one", () => {
    const seed = buildAddToGroupDraftSeed({ ...baseChat, pathId: "wt-1" }, profiles);

    expect(seed.pathId).toBe("path-1");
    expect(seed.baseRef).toEqual({ type: "worktree", pathId: "wt-1" });
  });

  test("drops a deleted agent and falls back on unsupported last-used values", () => {
    const seed = buildAddToGroupDraftSeed(
      {
        ...baseChat,
        metadata: { cli: { lastUsedMode: "not-a-mode" } },
        agent: { projectAgentId: "agent-1", isDeleted: true },
      },
      profiles
    );

    expect(seed.projectAgentId).toBeUndefined();
    expect(seed.mode).not.toBe("not-a-mode");
  });

  test("a stale profile or path seeds the raw ids without a worktree mapping", () => {
    const seed = buildAddToGroupDraftSeed({ ...baseChat, profileId: "gone", pathId: "wt-1" }, profiles);

    expect(seed.profileId).toBe("gone");
    expect(seed.pathId).toBe("wt-1");
    expect(seed.baseRef).toBeUndefined();
  });
});

describe("resolveNewThreadDraftState Codex on AWS (OS-2105)", () => {
  const profile = (provider?: "mantle") => ({
    _id: "profile-1",
    isOnline: true,
    availableClis: [{ type: "codex" as const, version: "0.156.1", ...(provider ? { provider, region: "us-east-1" } : {}) }],
    paths: [{ id: "path-1" }],
  });
  const resolve = (provider: "mantle" | undefined, cliModel: string, remembered: Record<string, string> = {}) =>
    resolveNewThreadDraftState({
      profiles: [profile(provider)],
      draft: { text: "", cliType: "codex", cliModel, profileId: "profile-1", pathId: "path-1" } as never,
      preselection: null,
      fallbackCliType: "codex",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: remembered,
    }).cliModel;

  test("starts a fresh thread on GPT-6 Sol instead of the hidden Default", () => {
    expect(resolve("mantle", "default")).toBe("gpt-6-sol");
    expect(resolve("mantle", "default", { codex: "default" })).toBe("gpt-6-sol");
  });

  test("keeps a model the user picked and the native Default", () => {
    expect(resolve("mantle", "gpt-6-luna")).toBe("gpt-6-luna");
    expect(resolve("mantle", "gpt-6.1-sol")).toBe("gpt-6.1-sol");
    expect(resolve(undefined, "default", { codex: "gpt-6-luna" })).toBe("default");
  });
});

describe("resolveNewThreadDraftState detected repos (OS-2647)", () => {
  test("a draft on a repo entry keeps the repo", () => {
    const state = resolveNewThreadDraftState({
      profiles: [{ _id: "profile-1", isOnline: true, availableClis: [{ type: "codex", version: "0.156.1" }],
        paths: [{ id: "top" }, { id: "repo", kind: "repo", parentPathId: "top" }] }],
      draft: { text: "", cliType: "codex", profileId: "profile-1", pathId: "repo" } as never,
      preselection: null,
      fallbackCliType: "codex",
      fallbackProfileId: "profile-1",
      fallbackPathId: "top",
      rememberedCliModels: {},
    });
    expect(state.pathId).toBe("repo");
  });
});
