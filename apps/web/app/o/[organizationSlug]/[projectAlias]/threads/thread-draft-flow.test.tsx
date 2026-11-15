import { describe, expect, test } from "vitest";
import {
  buildAutomationDraftSeed,
  buildProjectAgentDraftPatch,
  resolveChatDetailEffort,
  resolveChatDetailMode,
  resolveChatDetailModel,
  resolveNewThreadDraftState,
} from "@/lib/threads/draft-flow";

describe("resolveNewThreadDraftState", () => {
  const profiles = [
    {
      _id: "profile-1",
      isOnline: true,
      availableClis: [{ type: "claude-code" as const, version: "2.1.0" }],
      paths: [{ id: "path-1" }, { id: "path-2" }],
    },
    {
      _id: "profile-2",
      isOnline: false,
      availableClis: [{ type: "codex" as const, version: "0.1.0" }],
      paths: [{ id: "path-3" }],
    },
  ];

  test("preselection overrides draft profile/path but preserves draft text/cliType/mode", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "codex",
        mode: "auto",
        cliModel: "default",
        profileId: "profile-2",
        pathId: "path-3",
        updatedAt: Date.now(),
      },
      preselection: {
        profileId: "profile-1",
        pathId: "path-2",
      },
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
    });

    expect(state).toMatchObject({
      text: "draft text",
      cliType: "codex",
      mode: "auto",
      cliModel: "default",
      profileId: "profile-1",
      pathId: "path-2",
    });
  });

  test("uses draft profile/path when no preselection is present", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "codex",
        mode: "auto",
        cliModel: "default",
        profileId: "profile-2",
        pathId: "path-3",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
    });

    expect(state).toMatchObject({
      text: "draft text",
      cliType: "codex",
      mode: "auto",
      cliModel: "default",
      profileId: "profile-2",
      pathId: "path-3",
    });
  });

  test("uses URL preselection when draft profile/path are missing", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "has text",
        cliType: "codex",
        mode: "agent",
        cliModel: "default",
        updatedAt: Date.now(),
      },
      preselection: {
        profileId: "profile-1",
        pathId: "path-2",
      },
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
    });

    expect(state.profileId).toBe("profile-1");
    expect(state.pathId).toBe("path-2");
  });

  test("falls back to defaults when neither draft nor preselection is valid", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "",
        profileId: "missing",
        pathId: "missing",
        updatedAt: Date.now(),
      },
      preselection: {
        profileId: "profile-2",
        pathId: "missing",
      },
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
    });

    expect(state.profileId).toBe("profile-1");
    expect(state.pathId).toBe("path-1");
    expect(state.mode).toBe("agent");
    expect(state.cliModel).toBe("default");
  });

  test("uses the remembered cli type when the draft has none and the selected profile exposes it", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: undefined,
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-2",
      fallbackPathId: "path-3",
      rememberedCliModels: {},
      rememberedCliType: "codex",
    });

    expect(state.cliType).toBe("codex");
  });

  test("ignores the remembered cli type when the selected profile does not expose it", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: undefined,
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
      rememberedCliType: "codex",
    });

    expect(state.cliType).toBe("claude-code");
  });

  test("prioritizes the draft cli type over the remembered cli type", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        profileId: "profile-1",
        pathId: "path-1",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
      rememberedCliType: "codex",
    });

    expect(state.cliType).toBe("claude-code");
  });

  test("falls back to the remembered model for the selected cli type", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        mode: "agent",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {
        "claude-code": "opus",
      },
    });

    expect(state.cliModel).toBe("opus");
  });

  test("preserves remembered Opus 4.7 model selections for the selected cli type", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        mode: "agent",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {
        "claude-code": "opus-4-7",
      },
    });

    expect(state.cliModel).toBe("opus-4-7");
  });

  // The catalog arrives in its own subscription (OS-1721), so first render sees
  // runtimes without models. A remembered opencode model must not flicker to the
  // default while that resolves.
  test("keeps a remembered OpenCode model and variant while the catalog is still loading", () => {
    const state = resolveNewThreadDraftState({
      profiles: [
        {
          _id: "profile-1",
          isOnline: true,
          availableClis: [{ type: "opencode" as const, version: "1.17.13" }],
          paths: [{ id: "path-1" }],
        },
      ],
      draft: undefined,
      preselection: null,
      fallbackCliType: "opencode",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliType: "opencode",
      rememberedCliModels: { opencode: "anthropic/claude-sonnet-5" },
      rememberedCliEfforts: { opencode: "high" },
    });

    expect(state.cliType).toBe("opencode");
    expect(state.cliModel).toBe("anthropic/claude-sonnet-5");
    expect(state.cliEffort).toBe("high");
  });

  test("prioritizes draft model over remembered model", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        mode: "agent",
        cliModel: "haiku",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {
        "claude-code": "opus",
      },
    });

    expect(state.cliModel).toBe("haiku");
  });

  test("falls back to the remembered effort for the selected cli type", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        mode: "agent",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
      rememberedCliEfforts: {
        "claude-code": "high",
      },
    });

    expect(state.cliEffort).toBe("high");
  });

  test("prioritizes draft effort over remembered effort", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        mode: "agent",
        cliEffort: "medium",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
      rememberedCliEfforts: {
        "claude-code": "high",
      },
    });

    expect(state.cliEffort).toBe("medium");
  });

  test("ignores remembered models for other cli types", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        mode: "agent",
        profileId: "profile-1",
        pathId: "path-1",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {
        codex: "gpt-5",
        "claude-code": "opus",
      },
    });

    expect(state.cliModel).toBe("opus");
  });

  test("ignores remembered model when the selected profile does not expose that cli", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "draft text",
        cliType: "claude-code",
        mode: "agent",
        profileId: "profile-2",
        pathId: "path-3",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {
        "claude-code": "opus",
      },
    });

    expect(state.cliModel).toBe("default");
  });

  test("keeps the drafted project agent when it is still an active project agent", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "",
        projectAgentId: "agent-1",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
      projectAgents: [{ _id: "agent-1" }],
    });

    expect(state.projectAgentId).toBe("agent-1");
  });

  test("drops a stale drafted project agent (deleted or from another project)", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: {
        text: "",
        projectAgentId: "agent-gone",
        updatedAt: Date.now(),
      },
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
      projectAgents: [{ _id: "agent-1" }],
    });

    expect(state.projectAgentId).toBeUndefined();
  });

  test("defaults to No agent when the draft carries no project agent", () => {
    const state = resolveNewThreadDraftState({
      profiles,
      draft: undefined,
      preselection: null,
      fallbackCliType: "claude-code",
      fallbackProfileId: "profile-1",
      fallbackPathId: "path-1",
      rememberedCliModels: {},
      projectAgents: [{ _id: "agent-1" }],
    });

    expect(state.projectAgentId).toBeUndefined();
  });
});

describe("buildAutomationDraftSeed", () => {
  test("no automation config seeds nothing", () => {
    expect(buildAutomationDraftSeed(undefined)).toEqual({});
  });

  test("seeds cliType/model/effort/mode/workspace from a full config", () => {
    expect(
      buildAutomationDraftSeed({
        enabled: true,
        cliType: "codex",
        cliModel: "gpt-5.5",
        cliEffort: "high",
        mode: "plan",
        workspace: "worktree",
      })
    ).toEqual({
      cliType: "codex",
      cliModel: "gpt-5.5",
      cliEffort: "high",
      mode: "plan",
      baseRef: { type: "branch", startFromOrigin: false },
    });
  });

  // OS-1512: model/effort used to be nested under cliType, so a config saved
  // through the agent form without touching the runtime pill (which displays
  // the fallback runtime) lost its model and fell back to the user's
  // remembered last-used one.
  test("seeds model/effort stored without a cliType, pinned to the fallback runtime", () => {
    expect(
      buildAutomationDraftSeed({
        enabled: true,
        cliModel: "fable",
        cliEffort: "high",
      })
    ).toEqual({
      cliType: "claude-code",
      cliModel: "fable",
      cliEffort: "high",
    });
  });

  test("an unsupported stored cliType falls back to the runtime the form displayed", () => {
    expect(
      buildAutomationDraftSeed({
        enabled: true,
        cliType: "not-a-runtime",
        cliModel: "fable",
      })
    ).toEqual({
      cliType: "claude-code",
      cliModel: "fable",
      cliEffort: undefined,
    });
  });

  test("a cliType-less model the fallback runtime cannot run seeds no runtime", () => {
    expect(
      buildAutomationDraftSeed({
        enabled: true,
        cliModel: "gpt-5.5",
        cliEffort: "high",
      })
    ).toEqual({});
  });

  test("a cliType-less effort with no model pins the fallback runtime", () => {
    expect(buildAutomationDraftSeed({ enabled: true, cliEffort: "high" })).toEqual({
      cliType: "claude-code",
      cliModel: undefined,
      cliEffort: "high",
    });
  });

  test("a config with neither cliType nor model/effort seeds no runtime", () => {
    expect(
      buildAutomationDraftSeed({
        enabled: true,
        prompt: { displayContent: "Review the open PRs" },
      })
    ).toEqual({});
  });

  test("workspace local clears the base-ref instead of seeding a worktree", () => {
    expect(buildAutomationDraftSeed({ enabled: true, workspace: "local" })).toEqual({
      baseRef: undefined,
    });
  });
});

describe("buildProjectAgentDraftPatch", () => {
  const agents = [
    { _id: "agent-plain" },
    {
      _id: "agent-automation",
      automation: {
        enabled: true,
        cliType: "codex",
        cliModel: "gpt-5.5",
        cliEffort: "high",
        mode: "plan",
        workspace: "worktree" as const,
      },
    },
    {
      _id: "agent-local",
      automation: {
        enabled: true,
        workspace: "local" as const,
      },
    },
    {
      _id: "agent-disabled",
      automation: {
        enabled: false,
        cliType: "codex",
        mode: "plan",
        prompt: { displayContent: "Do the thing" },
      },
    },
    {
      _id: "agent-prompt",
      automation: {
        enabled: true,
        prompt: { displayContent: "Review the open PRs" },
      },
    },
    // OS-1512: real-world shape — a model/effort saved with no cliType.
    {
      _id: "agent-model-only",
      automation: {
        enabled: true,
        cliModel: "fable",
        cliEffort: "high",
      },
    },
    {
      _id: "agent-seeded",
      automation: {
        enabled: true,
        prompt: { displayContent: "Work on the attached task." },
      },
    },
  ];

  test("agents without automation config only bind the agent", () => {
    expect(buildProjectAgentDraftPatch("agent-plain", agents)).toEqual({
      projectAgentId: "agent-plain",
    });
  });

  test("agents with automation config default cliType/model/effort/mode/workspace", () => {
    expect(buildProjectAgentDraftPatch("agent-automation", agents)).toEqual({
      projectAgentId: "agent-automation",
      cliType: "codex",
      cliModel: "gpt-5.5",
      cliEffort: "high",
      mode: "plan",
      baseRef: { type: "branch", startFromOrigin: false },
    });
  });

  // OS-1512: selecting this agent left the model pill on the user's remembered
  // last-used model (e.g. "Opus 5 High") instead of the configured Fable 5.
  test("an automation config with a model but no cliType still seeds the model", () => {
    expect(buildProjectAgentDraftPatch("agent-model-only", agents)).toEqual({
      projectAgentId: "agent-model-only",
      cliType: "claude-code",
      cliModel: "fable",
      cliEffort: "high",
    });
  });

  test("deselecting reverts an unedited model/effort seed that had no cliType", () => {
    expect(
      buildProjectAgentDraftPatch(undefined, agents, {
        text: "",
        projectAgentId: "agent-model-only",
        cliType: "claude-code",
        cliModel: "fable",
        cliEffort: "high",
      })
    ).toEqual({
      projectAgentId: undefined,
      cliType: undefined,
      cliModel: undefined,
      cliEffort: undefined,
    });
  });

  test("deselecting keeps a model the user overrode after selecting the agent", () => {
    expect(
      buildProjectAgentDraftPatch(undefined, agents, {
        text: "",
        projectAgentId: "agent-model-only",
        cliType: "claude-code",
        cliModel: "sonnet",
        cliEffort: "high",
      })
    ).toEqual({
      projectAgentId: undefined,
      cliType: undefined,
      cliEffort: undefined,
    });
  });

  test("disabled automation config only binds the agent", () => {
    expect(buildProjectAgentDraftPatch("agent-disabled", agents)).toEqual({
      projectAgentId: "agent-disabled",
    });
  });

  test("automation prompt seeds an empty composer", () => {
    expect(buildProjectAgentDraftPatch("agent-prompt", agents)).toEqual({
      projectAgentId: "agent-prompt",
      text: "Review the open PRs",
      composerContent: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Review the open PRs" }] }],
      },
    });
  });

  test("automation prompt never overwrites typed composer text", () => {
    expect(buildProjectAgentDraftPatch("agent-prompt", agents, { text: "already typed" })).toEqual({
      projectAgentId: "agent-prompt",
    });
  });

  test("switching agents replaces the previous agent's unedited seed", () => {
    const patch = buildProjectAgentDraftPatch("agent-prompt", agents, {
      text: "Work on the attached task.",
      projectAgentId: "agent-seeded",
    });

    expect(patch.text).toBe("Review the open PRs");
  });

  test("switching agents keeps an edited seed", () => {
    const patch = buildProjectAgentDraftPatch("agent-prompt", agents, {
      text: "Work on the attached task. But first say hi.",
      projectAgentId: "agent-seeded",
    });

    expect(patch.text).toBeUndefined();
  });

  test("deselecting clears the previous agent's unedited seed", () => {
    expect(
      buildProjectAgentDraftPatch(undefined, agents, {
        text: "Work on the attached task.",
        projectAgentId: "agent-seeded",
      })
    ).toEqual({ projectAgentId: undefined, text: "", composerContent: undefined });
  });

  test("switching to a promptless agent clears the previous agent's unedited seed", () => {
    expect(
      buildProjectAgentDraftPatch("agent-plain", agents, {
        text: "Work on the attached task.",
        projectAgentId: "agent-seeded",
      })
    ).toEqual({ projectAgentId: "agent-plain", text: "", composerContent: undefined });
  });

  test("deselecting leaves typed composer text alone", () => {
    expect(
      buildProjectAgentDraftPatch(undefined, agents, {
        text: "my own message",
        projectAgentId: "agent-seeded",
      })
    ).toEqual({ projectAgentId: undefined });
  });

  test("deselecting unsets unedited automation pills so remembered defaults apply", () => {
    expect(
      buildProjectAgentDraftPatch(undefined, agents, {
        text: "",
        projectAgentId: "agent-automation",
        cliType: "codex",
        cliModel: "gpt-5.5",
        cliEffort: "high",
        mode: "plan",
        baseRef: { type: "branch", startFromOrigin: false },
      })
    ).toStrictEqual({
      projectAgentId: undefined,
      cliType: undefined,
      cliModel: undefined,
      cliEffort: undefined,
      mode: undefined,
      baseRef: undefined,
    });
  });

  test("deselecting keeps automation pills the user overrode", () => {
    expect(
      buildProjectAgentDraftPatch(undefined, agents, {
        text: "",
        projectAgentId: "agent-automation",
        cliType: "codex",
        cliModel: "gpt-5.4",
        cliEffort: "high",
        mode: "agent",
        baseRef: { type: "branch", startFromOrigin: false, branch: "my-branch" },
      })
    ).toStrictEqual({
      projectAgentId: undefined,
      cliType: undefined,
      cliEffort: undefined,
    });
  });

  test("deselecting keeps model and effort when the user switched cliType", () => {
    expect(
      buildProjectAgentDraftPatch(undefined, agents, {
        text: "",
        projectAgentId: "agent-automation",
        cliType: "claude-code",
        cliModel: "opus",
        mode: "plan",
      })
    ).toStrictEqual({
      projectAgentId: undefined,
      mode: undefined,
    });
  });

  test("switching agents reverts pills the new automation does not set", () => {
    const patch = buildProjectAgentDraftPatch("agent-prompt", agents, {
      text: "",
      projectAgentId: "agent-automation",
      cliType: "codex",
      cliModel: "gpt-5.5",
      cliEffort: "high",
      mode: "plan",
    });

    expect(patch.projectAgentId).toBe("agent-prompt");
    expect(patch.text).toBe("Review the open PRs");
    // agent-prompt's automation sets no cliType/mode, so the previous agent's
    // unedited pills revert to the remembered defaults.
    for (const key of ["cliType", "cliModel", "cliEffort", "mode"] as const) {
      expect(Object.prototype.hasOwnProperty.call(patch, key)).toBe(true);
      expect(patch[key]).toBeUndefined();
    }
  });

  test("workspace local clears a drafted worktree base ref", () => {
    const patch = buildProjectAgentDraftPatch("agent-local", agents);
    expect(patch.projectAgentId).toBe("agent-local");
    expect(Object.prototype.hasOwnProperty.call(patch, "baseRef")).toBe(true);
    expect(patch.baseRef).toBeUndefined();
    // Workspace-only automation leaves the CLI pills untouched.
    expect(Object.prototype.hasOwnProperty.call(patch, "cliType")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(patch, "mode")).toBe(false);
  });

  test("deselecting back to No agent changes no other pills", () => {
    expect(buildProjectAgentDraftPatch(undefined, agents)).toEqual({
      projectAgentId: undefined,
    });
  });

  test("unknown agent ids fail soft to No agent", () => {
    expect(buildProjectAgentDraftPatch("agent-unknown", agents)).toEqual({
      projectAgentId: undefined,
    });
  });

  // OS-1512 narrowed the original OS-1138 rule: a cliType-less config now
  // assumes the runtime the agent form displayed (the fallback), but only when
  // the stored model belongs to it. A model that runtime cannot run is still
  // dropped rather than seeded into a pill that cannot offer it.
  test("a cliType-less model the fallback runtime cannot run is dropped", () => {
    const patch = buildProjectAgentDraftPatch("agent-model-only", [
      { _id: "agent-model-only", automation: { enabled: true, cliModel: "gpt-5.5" } },
    ]);

    expect(patch).toEqual({ projectAgentId: "agent-model-only" });
  });
});

describe("resolveChatDetailMode", () => {
  test("prioritizes draft mode over last-used mode", () => {
    const mode = resolveChatDetailMode({
      cliType: "codex",
      draftMode: "auto",
      lastUsedMode: "agent",
    });

    expect(mode).toBe("auto");
  });

  test("falls back to last-used mode when draft mode is invalid", () => {
    const mode = resolveChatDetailMode({
      cliType: "codex",
      draftMode: "invalid",
      lastUsedMode: "agent",
    });

    expect(mode).toBe("agent");
  });

  test("falls back to default mode when neither mode is valid", () => {
    const mode = resolveChatDetailMode({
      cliType: "codex",
      draftMode: "invalid",
      lastUsedMode: "missing",
    });

    expect(mode).toBe("agent");
  });
});

describe("resolveChatDetailEffort", () => {
  test("prioritizes draft effort over last-used effort", () => {
    expect(
      resolveChatDetailEffort({
        cliType: "claude-code",
        cliModel: "opus",
        draftCliEffort: "xhigh",
        lastUsedCliEffort: "low",
      })
    ).toBe("xhigh");
  });

  test("falls back to last-used effort when draft effort is invalid", () => {
    expect(
      resolveChatDetailEffort({
        cliType: "codex",
        cliModel: "gpt-5.5",
        draftCliEffort: "not-real",
        lastUsedCliEffort: "low",
      })
    ).toBe("low");
  });

  test("falls back to the default effort and skips effort-less runtimes", () => {
    expect(
      resolveChatDetailEffort({
        cliType: "claude-code",
        cliModel: "opus",
        draftCliEffort: undefined,
        lastUsedCliEffort: undefined,
      })
    ).toBe("default");
    expect(
      resolveChatDetailEffort({
        cliType: "droid",
        cliModel: undefined,
        draftCliEffort: "high",
        lastUsedCliEffort: "high",
      })
    ).toBeUndefined();
  });

  test("rejects an effort the resolved model does not offer", () => {
    // Cursor tiers are per model: `thinking` only exists for Anthropic bases,
    // so a value left over from a model switch falls to the runtime default.
    expect(
      resolveChatDetailEffort({
        cliType: "cursor",
        cliModel: "gpt-5.5",
        draftCliEffort: "thinking",
        lastUsedCliEffort: undefined,
      })
    ).toBe("default");
    expect(
      resolveChatDetailEffort({
        cliType: "cursor",
        cliModel: "claude-sonnet-5",
        draftCliEffort: "thinking",
        lastUsedCliEffort: undefined,
      })
    ).toBe("thinking");
    // The stored last-used effort gets the same treatment.
    expect(
      resolveChatDetailEffort({
        cliType: "cursor",
        cliModel: "gpt-5.5",
        draftCliEffort: undefined,
        lastUsedCliEffort: "max",
      })
    ).toBe("default");
  });

  test("rejects an OpenCode variant the advertised model does not offer", () => {
    const availableClis = [
      {
        type: "opencode" as const,
        version: "1.17.13",
        models: [
          {
            slug: "anthropic/claude-sonnet-5",
            name: "Claude Sonnet 5",
            variants: ["low", "high"],
          },
        ],
      },
    ];

    expect(
      resolveChatDetailEffort({
        cliType: "opencode",
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
        draftCliEffort: "turbo",
        lastUsedCliEffort: undefined,
      })
    ).toBe("default");
    expect(
      resolveChatDetailEffort({
        cliType: "opencode",
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
        draftCliEffort: "high",
        lastUsedCliEffort: undefined,
      })
    ).toBe("high");
    // Unadvertised model (offline machine, stale slug): OpenCode is the
    // authority, so the stored variant survives.
    expect(
      resolveChatDetailEffort({
        cliType: "opencode",
        cliModel: "anthropic/claude-3-5-sonnet",
        availableClis,
        draftCliEffort: "turbo",
        lastUsedCliEffort: undefined,
      })
    ).toBe("turbo");
  });
});

describe("resolveChatDetailModel", () => {
  test("prioritizes draft model over last-used model", () => {
    const model = resolveChatDetailModel({
      cliType: "claude-code",
      draftCliModel: "haiku",
      lastUsedCliModel: "opus",
    });

    expect(model).toBe("haiku");
  });

  test("falls back to last-used model when draft model is missing", () => {
    const model = resolveChatDetailModel({
      cliType: "claude-code",
      draftCliModel: undefined,
      lastUsedCliModel: "sonnet",
    });

    expect(model).toBe("sonnet");
  });

  test("falls back to the default Claude model when neither is set", () => {
    const model = resolveChatDetailModel({
      cliType: "claude-code",
      draftCliModel: undefined,
      lastUsedCliModel: undefined,
    });

    expect(model).toBe("default");
  });
});
