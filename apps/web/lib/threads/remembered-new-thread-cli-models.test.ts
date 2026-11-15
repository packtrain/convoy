/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  loadRememberedNewThreadCliModels,
  loadRememberedNewThreadCliSelection,
  rememberNewThreadCliModel,
} from "./remembered-new-thread-cli-models";

describe("remembered-new-thread-cli-models", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("returns an empty map for missing or malformed payloads", () => {
    expect(loadRememberedNewThreadCliModels()).toEqual({});

    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      "{oops"
    );
    expect(loadRememberedNewThreadCliModels()).toEqual({});

    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify([])
    );
    expect(loadRememberedNewThreadCliModels()).toEqual({});

    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({ version: 999, modelsByCliType: { "claude-code": "opus" } })
    );
    expect(loadRememberedNewThreadCliModels()).toEqual({});
  });

  test("remembers Opus 5.5 selections across runtimes", () => {
    rememberNewThreadCliModel("claude-code", "opus-5-5", "high");
    rememberNewThreadCliModel("cursor", "claude-opus-5-5", "default");
    expect(loadRememberedNewThreadCliModels()).toEqual({
      "claude-code": "opus-5-5", cursor: "claude-opus-5-5",
    });
  });

  test("saves and loads remembered models for supported cli types", () => {
    rememberNewThreadCliModel("claude-code", "opus-4-7", "high");
    rememberNewThreadCliModel("codex", "gpt-5", "high");

    expect(loadRememberedNewThreadCliModels()).toEqual({
      "claude-code": "opus-4-7",
    });
    expect(loadRememberedNewThreadCliSelection().effortsByCliType).toEqual({
      "claude-code": "high",
      codex: "high",
    });
  });

  test("remembers the last used cli type even when the model is unsupported", () => {
    rememberNewThreadCliModel("claude-code", "opus-4-7");
    expect(loadRememberedNewThreadCliSelection().lastCliType).toBe("claude-code");

    rememberNewThreadCliModel("codex", "gpt-5");
    expect(loadRememberedNewThreadCliSelection()).toEqual({
      modelsByCliType: { "claude-code": "opus-4-7" },
      effortsByCliType: {},
      combosByCliType: {
        "claude-code": [{ cliModel: "opus-4-7", cliEffort: undefined }],
      },
      lastCliType: "codex",
    });

    rememberNewThreadCliModel("claude-code", undefined);
    expect(loadRememberedNewThreadCliSelection().lastCliType).toBe("claude-code");
  });

  test("drops an invalid persisted last cli type", () => {
    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({
        version: 1,
        modelsByCliType: {},
        lastCliType: "unknown-cli",
      })
    );

    expect(loadRememberedNewThreadCliSelection().lastCliType).toBeUndefined();
  });

  test("keeps the last three unique model+effort combos, newest first", () => {
    rememberNewThreadCliModel("codex", "gpt-5.5", "medium");
    rememberNewThreadCliModel("codex", "gpt-5.5", "high");
    rememberNewThreadCliModel("codex", "gpt-5.4", "low");
    // Re-using an existing combo moves it to the front instead of duplicating.
    rememberNewThreadCliModel("codex", "gpt-5.5", "medium");

    expect(loadRememberedNewThreadCliSelection().combosByCliType.codex).toEqual([
      { cliModel: "gpt-5.5", cliEffort: "medium" },
      { cliModel: "gpt-5.4", cliEffort: "low" },
      { cliModel: "gpt-5.5", cliEffort: "high" },
    ]);

    rememberNewThreadCliModel("codex", "gpt-5.4-mini", "default");
    const combos = loadRememberedNewThreadCliSelection().combosByCliType.codex;
    expect(combos).toHaveLength(3);
    expect(combos?.[0]).toEqual({ cliModel: "gpt-5.4-mini", cliEffort: "default" });
  });

  test("drops persisted combos with unsupported models", () => {
    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({
        version: 1,
        modelsByCliType: {},
        combosByCliType: {
          codex: [
            { cliModel: "gpt-5.5", cliEffort: "high" },
            { cliModel: "not-a-model", cliEffort: "high" },
            { cliModel: "gpt-5.4", cliEffort: "not-an-effort" },
          ],
          unknown: [{ cliModel: "whatever" }],
        },
      })
    );

    expect(loadRememberedNewThreadCliSelection().combosByCliType).toEqual({
      codex: [
        { cliModel: "gpt-5.5", cliEffort: "high" },
        { cliModel: "gpt-5.4", cliEffort: undefined },
      ],
    });
  });

  test("drops unknown cli types and unsupported model values", () => {
    window.localStorage.setItem(
      "convoy.remembered-new-thread-cli-models",
      JSON.stringify({
        version: 1,
        modelsByCliType: {
          "claude-code": "opus-4-7",
          codex: "gpt-5",
          unknown: "whatever",
        },
      })
    );

    expect(loadRememberedNewThreadCliModels()).toEqual({
      "claude-code": "opus-4-7",
    });
  });
});
