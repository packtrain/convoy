"use client";

import { FileDiff } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import type {
  ApplyChangesFileChange,
  ApplyChangesToolPayload,
} from "@/lib/ai-tools/apply-changes-tool";
import {
  buildApplyChangePatch,
  countApplyChangesLines,
  getApplyChangesTitle,
} from "@/lib/ai-tools/apply-changes-tool";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { useDiffTheme } from "@/lib/threads/hooks/use-diff-theme";

function ChangeDiff({
  change,
  showPath,
}: {
  change: ApplyChangesFileChange;
  showPath: boolean;
}) {
  const diffTheme = useDiffTheme();

  return (
    <div className="overflow-hidden rounded-md border border-border">
      {showPath && (
        <div className="truncate border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
          {change.movePath ? `${change.path} → ${change.movePath}` : change.path}
        </div>
      )}
      <PatchDiff
        patch={buildApplyChangePatch(change)}
        options={{
          ...diffTheme,
          diffStyle: "unified",
          disableFileHeader: true,
          overflow: "scroll",
        }}
      />
    </div>
  );
}

function ApplyChangesContent({ payload }: { payload: ApplyChangesToolPayload }) {
  const showPath = payload.changes.length > 1;

  return (
    <div className="flex flex-col gap-2">
      {payload.changes.map((change, index) => (
        <ChangeDiff key={index} change={change} showPath={showPath} />
      ))}
    </div>
  );
}

interface ApplyChangesToolPartProps {
  payload: ApplyChangesToolPayload;
  onDebug?: () => void;
}

export function ApplyChangesToolPart({
  payload,
  onDebug,
}: ApplyChangesToolPartProps) {
  const lineCounts = countApplyChangesLines(payload.changes);

  function renderTrailing() {
    if (lineCounts.additions === 0 && lineCounts.deletions === 0) {
      return undefined;
    }

    return (
      <span
        className="flex shrink-0 items-center gap-1 text-xs tabular-nums"
        aria-label={`${lineCounts.additions} additions, ${lineCounts.deletions} deletions`}
      >
        {" "}
        <span className="text-success">+{lineCounts.additions}</span>
        {" "}
        <span className="text-destructive">-{lineCounts.deletions}</span>
      </span>
    );
  }

  return (
    <CollapsibleToolPart
      icon={FileDiff}
      title={getApplyChangesTitle(payload)}
      state={payload.state}
      errorText={payload.errorText}
      onDebug={onDebug}
      trailing={renderTrailing()}
      // No changes yet (or none at all) means nothing to disclose (OS-1769).
      hasBody={payload.changes.length > 0}
      renderChildren={() => <ApplyChangesContent payload={payload} />}
    />
  );
}
