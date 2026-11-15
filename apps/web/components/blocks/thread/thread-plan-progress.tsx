"use client";

import { Circle, CircleCheck } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { CircularProgress } from "@/components/ui/circular-progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CliPlanStep, PlanProgress } from "@/lib/threads/plan-progress";
import { cn } from "@/lib/utils";

interface ThreadPlanProgressProps {
  plan: PlanProgress | null;
  className?: string;
}

function StepIcon({ status }: { status: CliPlanStep["status"] }) {
  switch (status) {
    case "completed":
      return <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
    case "in-progress":
      return <Spinner className="mt-0.5 size-4 shrink-0" />;
    case "pending":
      return <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * The agent's plan as a composer top-bar chip: a progress ring, plus `Step X / Y` where
 * the bar is wide enough. The counter drops once the plan is finished (a full ring says
 * so) and in narrow containers, like the bar's other chips. The full checklist is a
 * popover, not a hover card, so it opens on touch too.
 */
export function ThreadPlanProgress({ plan, className }: ThreadPlanProgressProps) {
  if (!plan) {
    return null;
  }

  const isDone = plan.completed === plan.total;
  const counter = `Step ${plan.currentIndex} / ${plan.total}`;
  const label = isDone
    ? `Plan complete: ${plan.total} ${plan.total === 1 ? "step" : "steps"}`
    : `Plan progress: ${counter}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 px-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <CircularProgress
            completed={plan.completed}
            total={plan.total}
            progressClassName="text-info"
          />
          {isDone ? null : (
            <span className="hidden whitespace-nowrap text-xs tabular-nums @lg/composer-bar:inline">
              {counter}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 max-w-[90vw]">
        <ul className="flex flex-col gap-2">
          {plan.steps.map((step, index) => (
            <li key={`${index}-${step.text}`} className="flex items-start gap-2.5 text-sm">
              <StepIcon status={step.status} />
              <span className="min-w-0 break-words text-foreground">{step.text}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
