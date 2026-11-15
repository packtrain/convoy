"use client";

import { useQuery } from "convex/react";
import { GitBranch, Layers } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppLink, type RouteTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { PullRequestStateIcon } from "./pull-request-state-icon";
import type { PullRequestSummary } from "./types";

export type StackTarget = { projectId: Id<"projects">; repositoryId: string; stackId: number };

/** The stored Layers of a stack, bottom first; undefined while loading. */
export function useStackLayers(target: StackTarget | null) {
  return useQuery(api.integrations.github.pullRequests.stack, target ?? "skip");
}

/** A Layer's base: the nearest open Layer below it, or the base branch once those merged. */
export function layerBelow(layers: PullRequestSummary[], number: number): PullRequestSummary | undefined {
  const index = layers.findIndex((layer) => layer.number === number);
  return layers.slice(0, Math.max(index, 0)).findLast((layer) => layer.state === "open");
}

/** GitHub's stack map: the top Layer first and the base branch at the bottom. */
export function StackMap({
  layers,
  current,
  hrefFor,
}: {
  layers: PullRequestSummary[];
  current: number;
  hrefFor: (number: number) => RouteTarget;
}) {
  return (
    <ol aria-label="Stack map">
      {[...layers].reverse().map((layer) => (
        <li key={layer._id}>
          <AppLink
            href={hrefFor(layer.number)}
            aria-current={layer.number === current ? "true" : undefined}
            title={`#${layer.number} ${layer.title}`}
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              layer.number === current ? "bg-accent" : "hover:bg-muted/50"
            )}
          >
            <PullRequestStateIcon pr={layer} />
            <span className="shrink-0 text-muted-foreground">#{layer.number}</span>
            <span className="min-w-0 truncate">{layer.title}</span>
          </AppLink>
        </li>
      ))}
      <li className="flex items-center gap-2 px-2 py-1.5 font-mono text-xs text-muted-foreground">
        <GitBranch className="size-4" />
        {layers[0]?.baseRef ?? "main"}
      </li>
    </ol>
  );
}

/** "Stack 2/3" from the PR's own `stack`; the popover loads the map only when opened. */
export function StackBadge({
  pr,
  projectId,
  hrefFor,
  header = false,
}: {
  pr: Pick<PullRequestSummary, "repositoryId" | "number" | "stack">;
  projectId: Id<"projects">;
  hrefFor: (number: number) => RouteTarget;
  header?: boolean;
}) {
  if (!pr.stack) return null;
  const label = `Stack ${pr.stack.position}/${pr.stack.size}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        {header ? (
          <Button variant="outline" size="sm">
            <Layers />
            {label}
          </Button>
        ) : (
          <button
            type="button"
            className="relative z-10 shrink-0 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Badge variant="outline" className="hover:bg-muted">
              {label}
            </Badge>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={`Stack #${pr.stack.number}`} className="w-80 max-w-[calc(100vw-2rem)] p-1">
        <StackPopoverBody target={{ projectId, repositoryId: pr.repositoryId, stackId: pr.stack.id }} stackNumber={pr.stack.number} current={pr.number} hrefFor={hrefFor} />
      </PopoverContent>
    </Popover>
  );
}

function StackPopoverBody({
  target,
  stackNumber,
  current,
  hrefFor,
}: {
  target: StackTarget;
  stackNumber: number;
  current: number;
  hrefFor: (number: number) => RouteTarget;
}) {
  const layers = useStackLayers(target);
  return (
    <>
      <p className="px-2 py-1.5 text-xs text-muted-foreground">Stack #{stackNumber}</p>
      {layers ? <StackMap layers={layers} current={current} hrefFor={hrefFor} /> : <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>}
    </>
  );
}
