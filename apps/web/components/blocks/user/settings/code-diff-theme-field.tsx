"use client";

import { PatchDiff } from "@pierre/diffs/react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DIFF_THEME_PRESETS,
  type DiffThemePresetId,
  writeDiffThemePreset,
} from "@/lib/threads/diff-theme-prefs";
import { useDiffTheme, useDiffThemePreset } from "@/lib/threads/hooks/use-diff-theme";
import { PREVIEW_PATCH } from "./code-diff-theme-preview";

export function CodeDiffThemeField() {
  const presetId = useDiffThemePreset();
  const diffTheme = useDiffTheme();

  return (
    <div className="space-y-2">
      <Label htmlFor="code-diff-theme">Code diff theme</Label>
      <Select
        value={presetId}
        onValueChange={(value) => writeDiffThemePreset(value as DiffThemePresetId)}
      >
        <SelectTrigger id="code-diff-theme">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DIFF_THEME_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="overflow-hidden rounded-md border border-border">
        <PatchDiff
          patch={PREVIEW_PATCH}
          options={{
            ...diffTheme,
            diffStyle: "unified",
            disableFileHeader: true,
            overflow: "scroll",
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Applies to every diff and file preview in threads, on this device.
      </p>
    </div>
  );
}
