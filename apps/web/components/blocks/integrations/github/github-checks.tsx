import { Check, CircleCheck, CircleDashed, CircleX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GithubCheck } from "./types";

type CheckState = GithubCheck["state"];

const TITLES: Record<CheckState, string> = {
  success: "All checks have passed",
  failure: "Some checks were not successful",
  pending: "Some checks haven't completed yet",
};
const COUNTS: Record<CheckState, string> = { failure: "failing", pending: "pending", success: "successful" };

/** GitHub's rollup: any failure wins, then anything still running. "1 failing and 3 successful checks". */
export function checksRollup(checks: GithubCheck[]) {
  const count = (state: CheckState) => checks.filter((check) => check.state === state).length;
  const state: CheckState = count("failure") ? "failure" : count("pending") ? "pending" : "success";
  const parts = (["failure", "pending", "success"] as const).filter(count).map((value) => `${count(value)} ${COUNTS[value]}`);
  return {
    state,
    title: checks.length ? TITLES[state] : "No checks",
    body: checks.length ? `${new Intl.ListFormat("en").format(parts)} ${checks.length === 1 ? "check" : "checks"}` : "GitHub reports no checks on the head commit.",
    passed: count("success"),
  };
}

export const ROLLUP_ICONS: Record<CheckState, React.ReactNode> = {
  success: <CircleCheck className="size-4.5 text-success" />,
  failure: <CircleX className="size-4.5 text-destructive" />,
  pending: <CircleDashed className="size-4.5 text-muted-foreground" />,
};

const ROW_ICONS: Record<CheckState, { icon: typeof X; className: string; label: string }> = {
  success: { icon: Check, className: "text-success", label: "passed" },
  failure: { icon: X, className: "text-destructive", label: "failed" },
  pending: { icon: CircleDashed, className: "text-muted-foreground", label: "pending" },
};

/** GitHub's checks list; Details opens the check's own page. */
export function GithubCheckList({ checks, className }: { checks: GithubCheck[]; className?: string }) {
  return (
    <ul aria-label="Checks" className={cn("divide-y rounded-md border text-xs", className)}>
      {checks.map((check) => {
        const { icon: Icon, className: tone, label } = ROW_ICONS[check.state];
        return (
          <li key={check.id} aria-label={`${check.name} ${label}`} className="flex min-w-0 items-center gap-2 py-1 pr-1 pl-2">
            <Icon className={cn("size-3.5 shrink-0", tone)} />
            <span className="min-w-0 flex-1 truncate" title={check.summary ? `${check.name} – ${check.summary}` : check.name}>
              <span className="font-medium">{check.name}</span>
              {check.summary ? <span className="text-muted-foreground"> – {check.summary}</span> : null}
            </span>
            {check.url ? (
              <Button variant="link" size="xs" className="shrink-0" asChild>
                <a href={check.url} target="_blank" rel="noreferrer">
                  Details
                </a>
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
