"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  DEFAULT_DIFF_THEME_PRESET,
  type DiffThemePair,
  type DiffThemePresetId,
  readDiffThemePreset,
  resolveDiffThemePreset,
  resolveMarkdownCodeThemes,
  subscribeToDiffThemePreset,
} from "@/lib/threads/diff-theme-prefs";

/**
 * The one code-theme source for diffs and markdown code (OS-2256). Markdown
 * gets a `[light, dark]` pair, so a resolving app theme never re-highlights it.
 */
export function useCodeTheme(): {
  diff: DiffThemePair;
  markdown: readonly [string, string];
} {
  const presetId = useDiffThemePreset();
  return useMemo(
    () => ({ diff: resolveDiffThemePreset(presetId), markdown: resolveMarkdownCodeThemes(presetId) }),
    [presetId]
  );
}

/**
 * Diff renderer options shared by every `@pierre/diffs` surface (OS-1684).
 * `themeType` binds the app's resolved theme to the diff: the library otherwise
 * defaults to `system` and picks the light/dark member from the OS preference,
 * which disagrees with an explicit in-app choice.
 */
export function useDiffTheme(): { theme: DiffThemePair; themeType: "light" | "dark" | "system" } {
  const { diff } = useCodeTheme();
  const { resolvedTheme } = useTheme();
  // Undefined until next-themes hydrates — `system` matches its own fallback.
  const themeType = resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "system";

  return useMemo(() => ({ theme: diff, themeType }), [diff, themeType]);
}

export function useDiffThemePreset(): DiffThemePresetId {
  return useSyncExternalStore(
    subscribeToDiffThemePreset,
    readDiffThemePreset,
    () => DEFAULT_DIFF_THEME_PRESET
  );
}
