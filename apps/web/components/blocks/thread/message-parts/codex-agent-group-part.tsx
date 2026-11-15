"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Braces, CheckCircle2, Users } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { isRecord } from "@/lib/type-guards";
import type { TaskNoticeGroupPart } from "@/lib/cli-stream-ui/types";
import { buildTaskNoticeGroupChildToolParts, summarizeTaskNoticeGroup } from "@/lib/cli-stream-ui/runtime-notices";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolSurface } from "./components/tool-surface";

const TERMINAL_STATUSES = new Set(["completed", "failed", "interrupted", "closed", "killed", "ended"]);
const OPERATIONS: Record<string, string> = {
  spawnAgent: "Spawn agent",
  sendInput: "Send message",
  wait: "Wait for agents",
  resumeAgent: "Resume agent",
  closeAgent: "Close agent",
};

export function CodexAgentGroupPart({ part }: { part: TaskNoticeGroupPart }) {
  const [rawOpen, setRawOpen] = useState(false);
  const agents = (part.childTaskNoticeGroups ?? []).map((agent) => {
    const summary = summarizeTaskNoticeGroup(agent);
    return {
      ...summary,
      id: agent.groupKey,
      notices: agent.notices,
      status:
        part.runStatus && !TERMINAL_STATUSES.has(summary.status) ? (part.runStatus === "failed" ? "interrupted" : "ended") : summary.status,
    };
  });
  const calls = buildTaskNoticeGroupChildToolParts(part.childToolEvents).map((call) => {
    const input = isRecord(call.input) ? call.input : {};
    const output = "output" in call && isRecord(call.output) ? call.output : {};
    let error: unknown;
    if (call.state === "output-error") {
      try {
        error = JSON.parse(call.errorText);
      } catch {
        /* Plain errors have no provider status. */
      }
    }
    const interrupted = output.status === "interrupted" || (isRecord(error) && error.status === "interrupted");
    const operation = typeof input.tool === "string" ? input.tool : "collaboration";
    const states = isRecord(output.agentsStates) ? Object.values(output.agentsStates) : [];
    const results = states.flatMap((state) =>
      isRecord(state) && typeof state.message === "string" && state.message.trim() ? [state.message] : []
    );
    const failed = call.state === "output-error" && !interrupted;
    const pending = call.state !== "output-error" && call.state !== "output-available";
    return {
      id: call.toolCallId,
      operation,
      title: OPERATIONS[operation] ?? operation,
      prompt: typeof input.prompt === "string" ? input.prompt : undefined,
      results,
      failed,
      pending: pending && !part.runStatus,
      interrupted: interrupted || (pending && !!part.runStatus),
    };
  });
  const failed =
    agents.some((agent) => ["failed", "interrupted", "killed"].includes(agent.status)) ||
    calls.some((call) => call.failed || call.interrupted);
  const pending = agents.some((agent) => !TERMINAL_STATUSES.has(agent.status)) || calls.some((call) => call.pending);
  const status = failed ? "failed" : pending ? "running" : agents.some((agent) => agent.status === "ended") ? "ended" : "completed";
  const title = agents.length === 1 ? agents[0].title : agents.length > 1 ? `${agents.length} agents` : "Agent calls";
  const copyDebugData = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(part, null, 2));
      toast.success("Agent data copied");
    } catch {
      toast.error("Could not copy agent data");
    }
  };

  return (
    <CollapsibleToolPart
      title={`${title} (${status})`}
      icon={status === "completed" ? CheckCircle2 : Users}
      iconClassName={status === "completed" ? "text-success" : undefined}
      state={failed ? "output-error" : pending ? "input-available" : "output-available"}
      errorText={failed ? "An agent operation failed or was interrupted" : undefined}
      onDebug={() => {
        void copyDebugData();
      }}
      renderChildren={() => (
        <ToolSurface className="space-y-3 text-sm">
          {agents.map((agent) => (
            <div key={agent.id} className="space-y-1">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="break-all">{agent.title}</span>
                <span className="shrink-0 text-muted-foreground">{agent.status}</span>
              </div>
              <ol aria-label={`${agent.title} events`} className="space-y-1 border-l border-border pl-3 text-muted-foreground">
                {agent.notices
                  .map((notice) => notice.message ?? notice.title)
                  .filter((label, index, labels) => index === 0 || label !== labels[index - 1])
                  .map((label, index) => (
                    <li key={index} className="whitespace-pre-wrap break-words">
                      {label}
                    </li>
                  ))}
              </ol>
            </div>
          ))}
          {calls.map((call) => (
            <div key={call.id} className="space-y-1">
              <div className={call.failed || call.interrupted ? "text-destructive" : "text-muted-foreground"}>
                {call.title}
                {call.failed ? " failed" : call.interrupted ? " interrupted" : call.pending ? "…" : " completed"}
              </div>
              {call.prompt ? <div className="whitespace-pre-wrap break-words">{call.prompt}</div> : null}
              {call.results.map((result, index) => (
                <div key={index} className="whitespace-pre-wrap break-words">
                  {result}
                </div>
              ))}
            </div>
          ))}
          <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
            <CollapsibleTrigger asChild>
              <button type="button" className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                <Braces className="size-3.5 shrink-0" />
                {rawOpen ? "Hide" : "Show"} raw data
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              {rawOpen ? (
                <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
                  <code>{JSON.stringify(part, null, 2)}</code>
                </pre>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        </ToolSurface>
      )}
    />
  );
}
