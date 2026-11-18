"use client";

import { Check, ChevronDown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const AUTO_START_LABELS = {
  ask: "Ask each time",
  auto: "Auto-start next time",
} as const;

/**
 * "Next time" dropdown among the composer pills (OS-1131, OS-2414): keep opening the composer,
 * or start without it. The host saves the choice only when the member sends.
 */
export function AutoStartPreferenceSelector({
  label: flow,
  value,
  disabled = false,
  onChange,
}: {
  /** The flow it applies to, for the accessible name: "Assignment automation", "Generate guide". */
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const label = value ? AUTO_START_LABELS.auto : AUTO_START_LABELS.ask;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="min-w-0 max-w-44 cursor-pointer gap-1.5 px-2"
          aria-label={`${flow}: ${label}`}
          title={`${flow}: ${label}`}
        >
          <Zap className={value ? "size-3.5 shrink-0 text-info" : "size-3.5 shrink-0 opacity-70"} />
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      {/* The content default locks width to the trigger; let it fit the longer option. */}
      <DropdownMenuContent align="start" className="w-auto">
        {([false, true] as const).map((auto) => (
          <DropdownMenuItem key={String(auto)} className="cursor-pointer gap-2" onSelect={() => onChange(auto)}>
            <span className="min-w-0 flex-1 truncate">{auto ? AUTO_START_LABELS.auto : AUTO_START_LABELS.ask}</span>
            {auto === value ? <Check className="size-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
