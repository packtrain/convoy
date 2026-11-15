import { describe, expect, test } from "vitest";
import {
  DEFAULT_CLAUDE_CODE_MODEL,
  getCliEffortOptions,
  getCliModelOption,
  getCliModelOptions,
  getCliModes,
  getCliTriggerLabel,
  getDefaultCliEffort,
  getDefaultCliModel,
  getDefaultMode,
  isSupportedCliEffort,
  isSupportedCliModel,
  type AvailableCliInfo,
} from "./registry";

describe("cli runtime ui registry", () => {
  test("prefers agent as default for claude-code and codex", () => {
    expect(getDefaultMode("claude-code")).toBe("agent");
    expect(getDefaultMode("codex")).toBe("agent");
  });

  test("returns undefined when cli type has no configured modes", () => {
    expect(getDefaultMode("other")).toBeUndefined();
  });

  test("returns default models for runtimes with model catalogs", () => {
    expect(getDefaultCliModel("claude-code")).toBe(DEFAULT_CLAUDE_CODE_MODEL);
    expect(getDefaultCliModel("codex")).toBe("default");
    expect(getDefaultCliModel("droid")).toBeUndefined();
  });

  test("recognizes supported model values per cli type", () => {
    expect(isSupportedCliModel("claude-code", "default")).toBe(true);
    expect(isSupportedCliModel("claude-code", "opus")).toBe(true);
    expect(isSupportedCliModel("claude-code", "sonnet-1m")).toBe(true);
    expect(isSupportedCliModel("claude-code", "opus-1m")).toBe(true);
    expect(isSupportedCliModel("claude-code", "opus-4-7")).toBe(true);
    expect(isSupportedCliModel("claude-code", "opus-4-7-1m")).toBe(true);
    expect(isSupportedCliModel("claude-code", "invalid")).toBe(false);
    expect(isSupportedCliModel("codex", "opus")).toBe(false);
    expect(isSupportedCliModel("codex", "default")).toBe(true);
    expect(isSupportedCliModel("codex", "gpt-6-astra")).toBe(true);
    expect(isSupportedCliModel("codex", "gpt-6.1-sol")).toBe(true);
    expect(isSupportedCliModel("codex", "gpt-6-sol")).toBe(true);
    expect(isSupportedCliModel("codex", "gpt-6-luna")).toBe(true);
    expect(isSupportedCliModel("codex", "gpt-5.5")).toBe(true);
  });

  test("uses provider-aware model labels when available", () => {
    const availableClis: AvailableCliInfo[] = [
      {
        type: "claude-code",
        version: "2.1.52",
        provider: "bedrock" as const,
      },
    ];

    expect(
      getCliModelOption("claude-code", "sonnet", availableClis)?.label
    ).toBe(
      "Sonnet 5"
    );
    expect(
      getCliTriggerLabel("claude-code", "sonnet-1m", availableClis)
    ).toBe(
      "Sonnet 5 (1M)"
    );
  });

  test("falls back to generic model labels when runtime metadata is absent", () => {
    expect(getCliModelOption("claude-code", "opus-1m")?.label).toBe("Opus (1M)");
    expect(getCliModelOption("claude-code", "opus-4-7")?.label).toBe("Opus 4.7");
    expect(getCliTriggerLabel("claude-code", "default")).toBe("Claude Code");
    expect(getCliModelOptions("droid")).toEqual([]);
    expect(getCliTriggerLabel("codex", undefined)).toBe("Codex");
  });

  test("codex exposes its model catalog and trigger labels", () => {
    expect(getCliModelOptions("codex").map((option) => option.value)).toEqual([
      "default",
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(getCliTriggerLabel("codex", "default")).toBe("Codex");
    expect(getCliTriggerLabel("codex", "gpt-6-astra")).toBe("GPT-6 Astra");
    expect(getCliTriggerLabel("codex", "gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(getCliTriggerLabel("codex", "gpt-6-sol")).toBe("GPT-6 Sol");
    expect(getCliTriggerLabel("codex", "gpt-6-luna")).toBe("GPT-6 Luna");
    expect(getCliTriggerLabel("codex", "gpt-5.6-sol")).toBe("GPT-5.6 Sol");
  });

  test("exposes reasoning-effort catalogs per cli type", () => {
    expect(getCliEffortOptions("claude-code").map((option) => option.value)).toEqual([
      "default",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
    ]);
    expect(getCliEffortOptions("codex").map((option) => option.value)).toEqual([
      "default",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getCliEffortOptions("droid")).toEqual([]);
    expect(getDefaultCliEffort("claude-code")).toBe("default");
    expect(getDefaultCliEffort("droid")).toBeUndefined();
    expect(isSupportedCliEffort("claude-code", "xhigh")).toBe(true);
    expect(isSupportedCliEffort("claude-code", "minimal")).toBe(false);
    expect(isSupportedCliEffort("codex", "minimal")).toBe(false);
    expect(isSupportedCliEffort("codex", "low")).toBe(true);
  });

  // OS-1790: the removed `threads/types` wrapper dropped this context, so
  // per-model variants silently resolved to an empty list.
  test("forwards effort context so per-model variants resolve (opencode)", () => {
    const availableClis: AvailableCliInfo[] = [
      {
        type: "opencode",
        version: "1.14.19",
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
      getCliEffortOptions("opencode", {
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }).map((option) => option.value)
    ).toEqual(["default", "low", "high"]);
  });

  test("codex forwards Astra model context to the reasoning picker", () => {
    const context = { cliModel: "gpt-6-astra" };
    expect(getCliEffortOptions("codex", context).map((option) => option.value))
      .toEqual(["default", "low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(isSupportedCliEffort("codex", "ultra", context)).toBe(true);
    expect(isSupportedCliEffort("codex", "ultra", { cliModel: "gpt-5.5" }))
      .toBe(false);
  });

  test("codex supports agent, ask-to-approve, sandboxed auto, and plan modes", () => {
    const codexModes = getCliModes("codex").map((mode) => mode.value);
    expect(codexModes).toEqual(["agent", "default", "auto", "plan"]);
  });
});
