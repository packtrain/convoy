/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DIFF_THEME_PRESETS,
  readDiffThemePreset,
  resolveDiffThemePreset,
  resolveMarkdownCodeThemes,
  subscribeToDiffThemePreset,
  writeDiffThemePreset,
} from "./diff-theme-prefs";

const KEY = "convoy.code-diff-theme";

describe("code diff theme preference", () => {
  afterEach(() => window.localStorage.clear());

  test("defaults to the pierre preset when unset", () => {
    expect(readDiffThemePreset()).toBe("pierre");
  });

  test("round-trips a stored preset", () => {
    writeDiffThemePreset("catppuccin");
    expect(readDiffThemePreset()).toBe("catppuccin");

    writeDiffThemePreset("github");
    expect(readDiffThemePreset()).toBe("github");
  });

  test("falls back to pierre for unknown stored values", () => {
    // Shiki throws asynchronously on an unresolvable theme name, so an
    // unrecognized value must never reach the renderer.
    window.localStorage.setItem(KEY, "solarized-hotdog");
    expect(readDiffThemePreset()).toBe("pierre");
  });

  test("every preset maps to a light/dark pair", () => {
    for (const preset of DIFF_THEME_PRESETS) {
      expect(resolveDiffThemePreset(preset.id)).toEqual(preset.theme);
      expect(preset.theme.light).not.toBe(preset.theme.dark);
    }
  });

  test("every preset theme name resolves, with the right mode and git colors", async () => {
    const { bundledThemes } = await import("shiki");

    for (const preset of DIFF_THEME_PRESETS) {
      for (const [mode, name] of Object.entries(preset.theme)) {
        // pierre-* are registered by @pierre/diffs itself, not bundled by Shiki.
        if (name.startsWith("pierre-")) {
          continue;
        }

        const loader = bundledThemes[name as keyof typeof bundledThemes];
        // A name absent here throws asynchronously inside the renderer.
        expect(loader, `${name} is not a bundled Shiki theme`).toBeDefined();

        const theme = (await loader()).default;
        expect(theme.name, `${name} self-reports a different name`).toBe(name);
        expect(theme.type, `${name} is not a ${mode} theme`).toBe(mode);

        // Diff +/− colors come from these keys; without them a preset silently
        // falls back to pierre's defaults and misrepresents the selection.
        const colors = theme.colors ?? {};
        expect(
          colors["gitDecoration.addedResourceForeground"] ?? colors["terminal.ansiGreen"],
          `${name} has no addition color`
        ).toBeDefined();
        expect(
          colors["gitDecoration.deletedResourceForeground"] ?? colors["terminal.ansiRed"],
          `${name} has no deletion color`
        ).toBeDefined();
      }
    }
  });

  test("markdown code themes are Shiki-bundled pairs for every preset", async () => {
    const { bundledThemes } = await import("shiki");

    expect(resolveMarkdownCodeThemes("pierre")).toEqual([
      "github-light",
      "github-dark-high-contrast",
    ]);
    expect(resolveMarkdownCodeThemes("solarized")).toEqual([
      "solarized-light",
      "solarized-dark",
    ]);
    for (const preset of DIFF_THEME_PRESETS) {
      for (const name of resolveMarkdownCodeThemes(preset.id)) {
        expect(bundledThemes[name as keyof typeof bundledThemes], name).toBeDefined();
      }
    }
  });

  test("notifies subscribers when the preset changes", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToDiffThemePreset(onChange);

    writeDiffThemePreset("github");
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    writeDiffThemePreset("catppuccin");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
