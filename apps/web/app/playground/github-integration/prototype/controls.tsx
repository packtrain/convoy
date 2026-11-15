import { Check as CheckIcon, CircleDashed, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Layers, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { prKey, stackOf, type Check, type CheckState, type PullRequest } from "./fixtures";

export function Picker({
  label,
  value,
  onChange,
  options,
  badge = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  badge?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="max-w-full cursor-pointer" size={badge ? "default" : "sm"} variant={badge ? "badge" : "default"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// GitHub's stack map: the top layer first and main at the bottom; a layer opens its PR.
export function StackMap({ pr, layers, onSelect, inline = false }: { pr: PullRequest; layers: PullRequest[]; onSelect: (pr: PullRequest) => void; inline?: boolean }) {
  if (inline) {
    const colors = {
      open: "bg-green-500/10 text-green-600 dark:text-green-500",
      draft: "bg-muted text-muted-foreground",
      merged: "bg-purple-500/10 text-purple-500",
      closed: "bg-destructive/10 text-destructive",
    };
    return (
      <ol className="space-y-3">
        {[...layers].reverse().map((item, index) => {
          const current = prKey(item) === prKey(pr);
          return (
            <li key={prKey(item)} className="relative after:absolute after:top-8 after:bottom-[-0.5rem] after:left-3 after:w-px after:bg-border">
              <button
                aria-label={`#${item.number} ${item.title}`}
                aria-current={current ? "true" : undefined}
                title={`#${item.number} ${item.title}`}
                onClick={() => onSelect(item)}
                className={`-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              >
                <span role="img" aria-label={item.state} className={`flex size-6 shrink-0 items-center justify-center rounded-md ${colors[item.state]}`}>
                  <span className="size-2 rounded-full bg-current" />
                </span>
                <span className="shrink-0 text-muted-foreground">{layers.length - index}</span>
                <span className="min-w-0 flex-1 truncate leading-5">{item.title}</span>
              </button>
            </li>
          );
        })}
        <li className="flex items-center gap-2 py-1 text-muted-foreground">
          <span className="flex size-6 items-center justify-center"><span className="size-5 rounded-full border-2 border-border" /></span>
          <span className="font-mono text-xs">main</span>
        </li>
      </ol>
    );
  }
  return (
    <div>
      {[...layers].reverse().map((item) => (
        <button key={prKey(item)} aria-current={prKey(item) === prKey(pr) ? "true" : undefined} onClick={() => onSelect(item)} className={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${prKey(item) === prKey(pr) ? "bg-accent" : "hover:bg-muted/50"}`}>
          <PrState state={item.state} />
          <span className="shrink-0 text-muted-foreground">#{item.number}</span>
          <span className="min-w-0 truncate">{item.title}</span>
        </button>
      ))}
      <p className="flex items-center gap-2 px-2 py-1.5 font-mono text-xs text-muted-foreground"><GitBranch className="size-4" />main</p>
    </div>
  );
}

// The stack position (REST `stack.position` / `stack.size`) as a badge, or the header's button; both open the map.
export function StackBadge({ records, pr, onSelect, header = false }: { records: PullRequest[]; pr: PullRequest; onSelect: (pr: PullRequest) => void; header?: boolean }) {
  const layers = stackOf(records, pr);
  if (!layers.length) return null;
  const label = `Stack ${layers.findIndex((item) => prKey(item) === prKey(pr)) + 1}/${layers.length}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        {header ? (
          <Button variant="outline" size="sm"><Layers />{label}</Button>
        ) : (
          <button className="relative z-10 shrink-0 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><Badge variant="outline" className="hover:bg-muted">{label}</Badge></button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={`Stack #${pr.stack}`} className="w-80 max-w-[calc(100vw-2rem)] p-1">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Stack #{pr.stack}</p>
        <StackMap pr={pr} layers={layers} onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  );
}

export function PrState({ state }: { state: PullRequest["state"] }) {
  const Icon =
    state === "merged"
      ? GitMerge
      : state === "closed"
        ? GitPullRequestClosed
        : state === "draft"
          ? GitPullRequestDraft
          : GitPullRequest;
  const color =
    state === "merged"
      ? "text-violet-500"
      : state === "closed"
        ? "text-destructive"
        : state === "draft"
          ? "text-muted-foreground"
          : "text-green-600";
  return <Icon className={`size-4 shrink-0 ${color}`} aria-label={state} role="img" />;
}

const checkIcons: Record<CheckState, { icon: typeof X; className: string; label: string }> = {
  success: { icon: CheckIcon, className: "text-green-600", label: "passed" },
  failure: { icon: X, className: "text-destructive", label: "failed" },
  pending: { icon: CircleDashed, className: "text-muted-foreground", label: "pending" },
};

// GitHub's checks list; Details opens the check's own page.
export function CheckList({ checks, onDetails, className }: { checks: Check[]; onDetails: () => void; className?: string }) {
  return (
    <ul aria-label="Checks" className={cn("divide-y rounded-md border text-xs", className)}>
      {checks.map((check) => {
        const { icon: Icon, className, label } = checkIcons[check.state];
        return (
          <li key={check.name} aria-label={`${check.name} ${label}`} className="flex min-w-0 items-center gap-2 py-1 pr-1 pl-2">
            <Icon className={`size-3.5 shrink-0 ${className}`} />
            <span className="min-w-0 flex-1 truncate" title={`${check.name} – ${check.summary}`}>
              <span className="font-medium">{check.name}</span>
              <span className="text-muted-foreground"> – {check.summary}</span>
            </span>
            <Button variant="link" size="xs" className="shrink-0" onClick={onDetails}>Details</Button>
          </li>
        );
      })}
    </ul>
  );
}

// The short sha, linking to the commit on GitHub.
export function CommitSha({ sha, onExternal }: { sha: string; onExternal: () => void }) {
  return (
    <button
      onClick={onExternal}
      aria-label={`Open commit ${sha} on GitHub`}
      title="Open commit on GitHub"
      className="shrink-0 cursor-pointer font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      {sha}
    </button>
  );
}
