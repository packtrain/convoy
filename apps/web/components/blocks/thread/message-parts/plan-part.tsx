"use client";

import { useState } from "react";
import { Braces, Check, Copy, Download, Maximize2 } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import {
  CardBlock,
  CardBlockContent,
  CardBlockError,
  CardBlockFooter,
  CardBlockHeader,
  CardBlockTitle,
  CardBlockToolbar,
} from "@/components/custom/card-block";
import { TitledDialog } from "@/components/ui/dialog";
import type { PlanDecision } from "@/lib/threads/plan-decision";
import type { CliTypeSlug } from "@/lib/threads/types";
import { cn } from "@/lib/utils";
import { PlanDecisionButtons } from "./plan-decision-buttons";
import { getErrorMessage } from "@/lib/errors";

interface PlanPartProps {
  payload: { id: string; text: string };
  cliType?: CliTypeSlug;
  onPlanDecision?: (decision: PlanDecision) => Promise<void> | void;
  showPlanDecisions?: boolean;
}

function getDownloadFilename(toolCallId: string): string {
  const safeToolId = toolCallId.replace(/[^a-z0-9_-]/gi, "-");
  return `plan-${safeToolId}.md`;
}

export function PlanPart({
  payload,
  cliType,
  onPlanDecision,
  showPlanDecisions = false,
}: PlanPartProps) {
  const canDecide = showPlanDecisions && Boolean(onPlanDecision);
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [didCopy, setDidCopy] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);

  const handleCopyMarkdown = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is not available.");
      }
      await navigator.clipboard.writeText(payload.text);
      setDidCopy(true);
      setTimeout(() => setDidCopy(false), 1200);
    } catch (copyError) {
      setError(getErrorMessage(copyError, "Could not copy plan."));
    }
  };

  const handleDownloadMarkdown = () => {
    try {
      const blob = new Blob([payload.text], {
        type: "text/markdown;charset=utf-8",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = getDownloadFilename(payload.id);
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(
        getErrorMessage(downloadError, "Could not download plan.")
      );
    }
  };

  const handleDecide = async (decision: PlanDecision) => {
    if (!onPlanDecision) {
      return;
    }

    setError(null);
    try {
      await onPlanDecision(decision);
    } catch (decisionError) {
      setError(
        getErrorMessage(decisionError, "Could not send the plan decision.")
      );
    }
  };

  const planContent = showRaw ? (
    <pre className="overflow-x-auto rounded-md p-3 font-mono text-[11px] text-foreground">
      <code>{payload.text}</code>
    </pre>
  ) : (
    <MessageResponse
      className={cn(
        "text-sm leading-6",
        "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight",
        "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
        "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight",
        "[&_li]:text-sm [&_p]:text-sm"
      )}
    >
      {payload.text}
    </MessageResponse>
  );

  return (
    <>
    <CardBlock className="p-2 bg-muted/60">
      <CardBlockHeader className="border-none bg-transparent">
        <CardBlockTitle>Plan</CardBlockTitle>
        <CardBlockToolbar>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => setFocusOpen(true)}
            aria-label="Focus mode"
            title="Focus mode"
          >
            <Maximize2 />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleDownloadMarkdown}
            aria-label="Download markdown"
            title="Download markdown"
          >
            <Download />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleCopyMarkdown}
            aria-label="Copy markdown"
            title="Copy markdown"
          >
            {didCopy ? <Check /> : <Copy />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setShowRaw((current) => !current)}
            aria-label={showRaw ? "Show rendered plan" : "Show raw markdown"}
            title={showRaw ? "Show rendered plan" : "Show raw markdown"}
          >
            <Braces className="size-4" />
          </Button>
        </CardBlockToolbar>
      </CardBlockHeader>

      <CardBlockContent>
        {planContent}
      </CardBlockContent>

      {error && <CardBlockError>{error}</CardBlockError>}

      {canDecide && (
        <CardBlockFooter className="justify-center">
          <PlanDecisionButtons cliType={cliType} onDecide={handleDecide} />
        </CardBlockFooter>
      )}
    </CardBlock>

    <TitledDialog
      open={focusOpen}
      onClose={() => setFocusOpen(false)}
      screenReaderTitle="Plan — Focus mode"
      size="7xl"
      dialogContentClassName="flex max-h-[85vh] flex-col"
    >
      <div className="-mx-4 -mt-4 border-b border-border px-4 py-4 pb-3.5">
        <h2 className="text-sm font-medium leading-none">Plan</h2>
      </div>

      <div className="-mx-4 flex-1 overflow-y-auto px-8 py-4">
        {planContent}
      </div>

      {error && (
        <div className="-mx-4 border-t border-border px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {canDecide && (
        <div className="-mx-4 -mb-4 flex justify-center rounded-b-xl border-t border-border px-4 py-3">
          <PlanDecisionButtons cliType={cliType} onDecide={handleDecide} />
        </div>
      )}
    </TitledDialog>
    </>
  );
}
