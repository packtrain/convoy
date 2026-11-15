"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getPlanDecisionOptions,
  type PlanDecision,
} from "@/lib/threads/plan-decision";
import type { CliTypeSlug } from "@/lib/threads/types";
import { cn } from "@/lib/utils";

/** Shared plan approval actions. See docs/specs/cli-interactive-approvals.md. */
export function PlanDecisionButtons({
  cliType,
  onDecide,
  className,
}: {
  cliType?: CliTypeSlug;
  onDecide: (decision: PlanDecision) => Promise<void> | void;
  className?: string;
}) {
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const options = getPlanDecisionOptions(cliType);
  const [defaultOption, ...secondary] = options.filter(option => option.decision.nextMode !== "agent");
  const actOption = options.find(option => option.decision.nextMode === "agent");
  const primary = defaultOption ?? actOption;

  const handleDecide = async (key: string, decision: PlanDecision) => {
    if (decidingKey) {
      return;
    }

    setDecidingKey(key);
    try {
      await onDecide(decision);
    } finally {
      setDecidingKey(null);
    }
  };

  if (!primary) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ButtonGroup className="group/split [&>*:first-child]:rounded-l-full [&>[data-slot]:not(:has(~[data-slot]))]:!rounded-r-full">
        <Button
          type="button"
          size="sm"
          shape="pill"
          className="cursor-pointer group-hover/split:bg-primary/90 hover:!bg-primary/80"
          disabled={decidingKey !== null}
          onClick={() => void handleDecide(primary.key, primary.decision)}
        >
          {decidingKey === primary.key || decidingKey === actOption?.key ? (
            <Spinner className="size-4" />
          ) : (
            <Check className="size-3.5" />
          )}
          {primary.label}
        </Button>
        {actOption && actOption !== primary && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                aria-label="More approval modes"
                className="!w-auto !pl-1 !pr-2 cursor-pointer group-hover/split:bg-primary/90 hover:!bg-primary/80"
                disabled={decidingKey !== null}
              >
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max">
              <DropdownMenuItem
                disabled={decidingKey !== null}
                onSelect={() => void handleDecide(actOption.key, actOption.decision)}
              >
                {actOption.label}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ButtonGroup>
      {secondary.map(option => (
        <Button
          key={option.key}
          type="button"
          size="sm"
          shape="pill"
          variant="outline"
          className="cursor-pointer"
          disabled={decidingKey !== null}
          onClick={() => void handleDecide(option.key, option.decision)}
        >
          {decidingKey === option.key ? (
            <Spinner className="size-4" />
          ) : null}
          {option.label}
        </Button>
      ))}
    </div>
  );
}
