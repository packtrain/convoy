"use client";

import { ChevronDown } from "lucide-react";
import {
  PLAN_MODE_TOGGLE_SHORTCUT,
  formatHotkeyForCrossPlatformLabel,
} from "@/lib/browser/hotkeys";
import { getCliModes, type CliTypeSlug } from "@/lib/cli-runtime-ui/registry";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ModeSelectorProps {
  cliType: CliTypeSlug;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ModeSelector({
  cliType,
  value,
  onChange,
  disabled = false,
  compact = false,
}: ModeSelectorProps) {
  const modes = getCliModes(cliType);

  if (modes.length === 0) return null;

  const currentMode = modes.find((m) => m.value === value) ?? modes[0];
  const CurrentIcon = currentMode.icon;
  const hasPlanMode = modes.some((mode) => mode.value === "plan");
  const isPlanModeActive = currentMode.value === "plan";
  const planTriggerAccentClass = isPlanModeActive ? "text-info" : undefined;

  return (
    // Non-modal like the other composer selectors: a modal menu breaks
    // tap-outside dismissal when the composer is hosted inside a vaul drawer.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            compact ? "gap-1 px-2" : "gap-2",
            !disabled && "cursor-pointer",
            disabled && "cursor-default text-muted-foreground/80"
          )}
          aria-disabled={disabled}
          title={currentMode.label}
        >
          <CurrentIcon className={cn("size-4", planTriggerAccentClass)} />
          {compact ? (
            <span className={cn("sr-only", planTriggerAccentClass)}>{currentMode.label}</span>
          ) : (
            <span className={planTriggerAccentClass}>{currentMode.label}</span>
          )}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={value ?? currentMode.value}
          onValueChange={(nextValue) => {
            if (disabled) {
              return;
            }
            onChange(nextValue);
          }}
        >
          {modes.map((mode) => (
            <DropdownMenuRadioItem
              key={mode.value}
              value={mode.value}
              title={mode.description}
            >
              <div className="flex w-full items-center gap-2">
                <mode.icon className="size-4 shrink-0 text-muted-foreground" />
                <span>{mode.label}</span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {hasPlanMode && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-[11px] text-muted-foreground/80">
              {formatHotkeyForCrossPlatformLabel(PLAN_MODE_TOGGLE_SHORTCUT)} toggles
              {" "}Plan mode
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
