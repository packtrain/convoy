"use client";

import { useMutation } from "convex/react";
import { ChevronDown, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import type { TaskCheck, TaskChecks } from "./types";

export const NO_CHECKS = "none";

const isPendingOrFailed = (check: TaskCheck) => {
  const status = check.results[0]?.status;
  return status === undefined || status === "failed";
};

/** The prompt the menu sends: each Check's key, label, and instruction, then the attach command. */
function runChecksPrompt(threadId: Id<"cliThreads">, data: TaskChecks, checks: TaskCheck[], scope: "pending" | "all", owner: "task" | "thread") {
  const catalog = new Set(data.catalog.map((definition) => definition.key));
  const lines = checks.map((check) => {
    // The CLI rejects a key outside the catalog without a label.
    const label = catalog.has(check.key) ? "" : ` (not in the catalog: add --label ${JSON.stringify(check.label)})`;
    return `- \`${check.key}\` ${check.label}${check.instruction ? `: ${check.instruction}` : ""}${label}`;
  });
  return [
    scope === "pending" ? `Run the pending and failed checks for this ${owner}:` : `Run all checks for this ${owner}:`,
    "",
    ...lines,
    "",
    `Report each one with \`convoy threads attach ${threadId} [file...] --check <key> --passed | --warning | --failed | --not-performed --note <why>\`, ` +
      "adding this reply's --message-id and --session-id. Attach the files that prove the result.",
  ].join("\n");
}

/** Switches the task's Checklist, or a task-less thread's own; `NO_CHECKS` picks none. */
export function useSwitchChecklist(owner: { taskId: Id<"tasks"> } | { threadId: Id<"cliThreads"> }, data: TaskChecks) {
  const setTaskChecklist = useMutation(api.tasks.core.setChecklist);
  const setThreadChecklist = useMutation(api.cli.threads.core.setChecklist);
  return (value: string) => {
    const checklistId = data.checklists.find((checklist) => checklist._id === value)?._id ?? null;
    const request = "taskId" in owner ? setTaskChecklist({ taskId: owner.taskId, checklistId }) : setThreadChecklist({ threadId: owner.threadId, checklistId });
    request.catch((error) => showConvexErrorToast(error, "Failed to switch checklist"));
  };
}

/** Checks tab menu: ask the thread's agent to run the Checks, or switch the Checklist (docs/specs/task-checks.md → Requesting a run). */
export function RunChecksMenu({
  taskId,
  threadId,
  data,
  readOnlyReason,
}: {
  /** Unset while the thread owns its Checks. */
  taskId: Id<"tasks"> | undefined;
  threadId: Id<"cliThreads">;
  data: TaskChecks;
  /** Disables Switch checklist only: sending needs thread ownership, not task edit. */
  readOnlyReason: string | null;
}) {
  const send = useMutation(api.cli.messages.send);
  const switchChecklist = useSwitchChecklist(taskId ? { taskId } : { threadId }, data);
  const pending = data.checks.filter(isPendingOrFailed);
  const run = (checks: TaskCheck[], scope: "pending" | "all") => {
    send({ threadId, content: runChecksPrompt(threadId, data, checks, scope, taskId ? "task" : "thread") })
      .then(() => toast.success(`Asked the agent to run ${checks.length} ${checks.length === 1 ? "check" : "checks"}`))
      .catch((error) => showConvexErrorToast(error, "Failed to send the checks prompt"));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline">
          <ListChecks /> Run checks <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {data.checks.length > 0 ? (
          <>
            <DropdownMenuItem disabled={pending.length === 0} onSelect={() => run(pending, "pending")}>
              Pending and failed
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(data.checks, "all")}>All checks</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch checklist</DropdownMenuLabel>
        {readOnlyReason ? <p className="px-2 pb-1 text-xs text-muted-foreground">{readOnlyReason}</p> : null}
        <DropdownMenuRadioGroup value={data.checklistId ?? NO_CHECKS} onValueChange={switchChecklist}>
          <DropdownMenuRadioItem value={NO_CHECKS} disabled={readOnlyReason !== null}>
            No checks
          </DropdownMenuRadioItem>
          {data.checklists.map((checklist) => (
            <DropdownMenuRadioItem key={checklist._id} value={checklist._id} disabled={readOnlyReason !== null}>
              <span className="flex-1">{checklist.name}</span>
              {checklist.isDefault ? <span className="text-xs text-muted-foreground">Default</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
