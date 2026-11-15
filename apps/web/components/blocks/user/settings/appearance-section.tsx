"use client";

import type { ReactNode } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserPreferences } from "@/lib/preferences/use-user-preferences";
import type {
  SectionColorStyle,
  SectionHeaderStyle,
} from "@/convex/lib/contracts/validators";
import { SectionStylePreview } from "@/components/blocks/task-grouping";
import { CodeDiffThemeField } from "./code-diff-theme-field";

const themes = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Customize how the app looks on your device.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Theme</Label>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => (
            <Button
              key={t.value}
              type="button"
              variant="outline"
              onClick={() => setTheme(t.value)}
              className={cn(
                "h-auto py-3 flex flex-col items-center gap-2 relative",
                theme === t.value && "border-primary bg-accent"
              )}
            >
              <t.icon className="size-5" />
              <span className="text-sm">{t.label}</span>
              {theme === t.value && (
                <Check className="size-3 text-primary absolute top-2 right-2" />
              )}
            </Button>
          ))}
        </div>
      </div>

      <CodeDiffThemeField />

      <TaskSectionsField />
    </div>
  );
}

const SECTION_HEADER_STYLES: { value: SectionHeaderStyle; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "spacious", label: "Spacious" },
];
const SECTION_COLOR_STYLES: { value: SectionColorStyle; label: string }[] = [
  { value: "tint", label: "Tint" },
  { value: "stripe", label: "Stripe" },
  { value: "dot", label: "Dot" },
];

function TaskSectionsField() {
  const {
    sectionHeaderStyle,
    sectionColorStyle,
    setSectionHeaderStyle,
    setSectionColorStyle,
  } = useUserPreferences();

  return (
    <div className="space-y-3">
      <Label>Task sections</Label>
      <p className="text-sm text-muted-foreground">
        How section headers and colors look in task lists and boards.
      </p>
      <PreviewCards
        label="Header style"
        options={SECTION_HEADER_STYLES}
        value={sectionHeaderStyle}
        onChange={setSectionHeaderStyle}
        preview={(headerStyle) => (
          <SectionStylePreview headerStyle={headerStyle} colorStyle="tint" />
        )}
      />
      <PreviewCards
        label="Color accent"
        hint="(sections only)"
        options={SECTION_COLOR_STYLES}
        value={sectionColorStyle}
        onChange={setSectionColorStyle}
        preview={(colorStyle) => (
          <SectionStylePreview headerStyle="compact" colorStyle={colorStyle} />
        )}
      />
    </div>
  );
}

function PreviewCards<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  preview,
}: {
  label: string;
  hint?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  preview: (value: T) => ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="text-muted-foreground/70"> {hint}</span>}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="outline"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-auto flex-col items-stretch justify-between gap-2 p-2",
              value === option.value && "border-primary bg-accent",
            )}
          >
            {preview(option.value)}
            <span className="flex items-center justify-center gap-1 text-sm">
              {option.label}
              {value === option.value && (
                <Check className="size-3 text-primary" />
              )}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
