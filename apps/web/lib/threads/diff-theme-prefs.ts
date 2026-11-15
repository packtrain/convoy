/**
 * Device-local code diff theme selection (OS-1684). Curated presets only —
 * `@pierre/diffs` resolves theme names through Shiki and throws asynchronously
 * on an unknown one, so stored junk must never reach a renderer.
 * See docs/specs/cli-thread-run-diffs.md#code-diff-theme.
 */

import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

const STORAGE_KEY = "convoy.code-diff-theme";
const CHANGE_EVENT = "convoy:code-diff-theme-change";

export type DiffThemePair = { light: string; dark: string };

/**
 * Each entry is a light/dark pair whose members both exist in Shiki's bundle and
 * both carry diff +/− colors — `diff-theme-prefs.test.ts` enforces exactly that,
 * which is why `light-plus`/`one-light`/`min-dark`/`vesper` are absent.
 */
export const DIFF_THEME_PRESETS = [
  { id: "pierre", label: "Pierre", theme: { light: "pierre-light", dark: "pierre-dark" } },
  { id: "github", label: "GitHub", theme: { light: "github-light", dark: "github-dark" } },
  {
    id: "github-high-contrast",
    label: "GitHub High Contrast",
    theme: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    theme: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
  },
  { id: "vitesse", label: "Vitesse", theme: { light: "vitesse-light", dark: "vitesse-dark" } },
  { id: "ayu", label: "Ayu", theme: { light: "ayu-light", dark: "ayu-dark" } },
  {
    id: "everforest",
    label: "Everforest",
    theme: { light: "everforest-light", dark: "everforest-dark" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    theme: { light: "gruvbox-light-medium", dark: "gruvbox-dark-medium" },
  },
  {
    id: "kanagawa",
    label: "Kanagawa",
    theme: { light: "kanagawa-lotus", dark: "kanagawa-wave" },
  },
  {
    id: "material",
    label: "Material",
    theme: { light: "material-theme-lighter", dark: "material-theme" },
  },
  {
    id: "night-owl",
    label: "Night Owl",
    theme: { light: "night-owl-light", dark: "night-owl" },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    theme: { light: "rose-pine-dawn", dark: "rose-pine" },
  },
  {
    id: "solarized",
    label: "Solarized",
    theme: { light: "solarized-light", dark: "solarized-dark" },
  },
  { id: "slack", label: "Slack", theme: { light: "slack-ochin", dark: "slack-dark" } },
] as const satisfies readonly { id: string; label: string; theme: DiffThemePair }[];

export type DiffThemePresetId = (typeof DIFF_THEME_PRESETS)[number]["id"];

export const DEFAULT_DIFF_THEME_PRESET: DiffThemePresetId = "pierre";

export function resolveDiffThemePreset(id: DiffThemePresetId): DiffThemePair {
  const preset = DIFF_THEME_PRESETS.find((candidate) => candidate.id === id);
  return preset?.theme ?? DIFF_THEME_PRESETS[0].theme;
}

/** pierre-* exist only inside @pierre/diffs, so markdown code (plain Shiki) falls back to GitHub. */
const MARKDOWN_FALLBACK_THEMES: readonly [string, string] = [
  "github-light",
  "github-dark-high-contrast",
];

/** `[light, dark]` Shiki themes for markdown code blocks under a preset. */
export function resolveMarkdownCodeThemes(id: DiffThemePresetId): readonly [string, string] {
  const { light, dark } = resolveDiffThemePreset(id);
  if (light.startsWith("pierre-") || dark.startsWith("pierre-")) {
    return MARKDOWN_FALLBACK_THEMES;
  }
  return [light, dark];
}

export function readDiffThemePreset(): DiffThemePresetId {
  const stored = readLocalString(STORAGE_KEY);
  const preset = DIFF_THEME_PRESETS.find((candidate) => candidate.id === stored);
  return preset?.id ?? DEFAULT_DIFF_THEME_PRESET;
}

export function writeDiffThemePreset(id: DiffThemePresetId): void {
  if (!writeLocalString(STORAGE_KEY, id)) {
    // Storage refused the write, so nothing changed to notify about.
    return;
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Same-tab writes fire the custom event; other tabs arrive via `storage`. */
export function subscribeToDiffThemePreset(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = (event: Event) => {
    if (event instanceof StorageEvent && event.key !== null && event.key !== STORAGE_KEY) {
      return;
    }
    onChange();
  };

  window.addEventListener("storage", handleChange);
  window.addEventListener(CHANGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}
