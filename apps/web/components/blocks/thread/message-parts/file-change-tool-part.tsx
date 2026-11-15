"use client";

import { useMemo } from "react";
import { FileText, FilePlus, Pencil } from "lucide-react";
import { PatchDiff, File as FileView } from "@pierre/diffs/react";
import type { FileChangeToolPayload } from "@/lib/ai-tools/file-change-tool";
import {
  buildReplacementPatch,
  buildReadPatch,
  buildUnifiedDiff,
  getFileChangeLineCounts,
  getFileChangeTitle,
} from "@/lib/ai-tools/file-change-tool";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ExpandableLines } from "./lib/expandable-lines";
import { ToolSurface } from "./components/tool-surface";
import { useDiffTheme } from "@/lib/threads/hooks/use-diff-theme";

const PREVIEW_LINE_LIMIT = 50;

function getIcon(toolName: string) {
  switch (toolName.toLowerCase()) {
    case "edit":
      return Pencil;
    case "write":
      return FilePlus;
    default:
      return FileText;
  }
}

function PatchContent({ patch }: { patch: string }) {
  const diffTheme = useDiffTheme();

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <PatchDiff
        patch={patch}
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

function EditReplacementContent({ payload }: { payload: FileChangeToolPayload }) {
  const oldString = payload.oldString ?? "";
  const newString = payload.newString ?? "";
  const patch = useMemo(
    () => buildReplacementPatch(payload.filePath, oldString, newString),
    [payload.filePath, oldString, newString]
  );

  return <PatchContent patch={patch} />;
}

function EditOutputTextContent({ outputText }: { outputText: string }) {
  return (
    <ToolSurface className="text-sm text-muted-foreground">
      {outputText}
    </ToolSurface>
  );
}

function EditToolContent({ payload }: { payload: FileChangeToolPayload }) {
  if (payload.structuredPatch && payload.structuredPatch.length > 0) {
    return (
      <PatchContent
        patch={buildUnifiedDiff(payload.filePath, payload.structuredPatch)}
      />
    );
  }

  if (payload.oldString !== undefined || payload.newString !== undefined) {
    return <EditReplacementContent payload={payload} />;
  }

  if (payload.outputText) {
    return <EditOutputTextContent outputText={payload.outputText} />;
  }

  return null;
}

function FileContent({ payload }: { payload: FileChangeToolPayload }) {
  const fullContent = payload.content ?? "";
  const diffTheme = useDiffTheme();

  return (
    <ExpandableLines
      text={fullContent}
      lineLimit={PREVIEW_LINE_LIMIT}
      className="overflow-hidden rounded-md border border-border"
    >
      {(displayContent) => (
        <FileView
          file={{ name: payload.filePath, contents: displayContent }}
          options={{
            ...diffTheme,
            disableFileHeader: true,
            overflow: "scroll",
          }}
        />
      )}
    </ExpandableLines>
  );
}

const HIDE_HUNK_SEPARATOR = () => null;

function ReadPatchContent({ payload }: { payload: FileChangeToolPayload }) {
  const offset = payload.startLine ?? payload.offset ?? 1;
  const diffTheme = useDiffTheme();
  const patch = useMemo(
    () => buildReadPatch(payload.filePath, payload.content ?? "", offset),
    [payload.filePath, payload.content, offset]
  );

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <PatchDiff
        patch={patch}
        options={{
          ...diffTheme,
          diffStyle: "unified",
          disableFileHeader: true,
          overflow: "scroll",
          disableBackground: true,
          hunkSeparators: HIDE_HUNK_SEPARATOR,
        }}
      />
    </div>
  );
}

function FileChangeContent({ payload }: { payload: FileChangeToolPayload }) {
  const lowerToolName = payload.toolName.toLowerCase();

  if (lowerToolName === "edit") {
    return <EditToolContent payload={payload} />;
  }

  // Read with offset → PatchDiff for correct line numbers
  if (lowerToolName === "read" && payload.content !== undefined && (payload.offset !== undefined || payload.startLine !== undefined)) {
    return <ReadPatchContent payload={payload} />;
  }

  // Full-file Read or Write → File component with truncation
  if (payload.content !== undefined) {
    return <FileContent payload={payload} />;
  }

  return null;
}

interface FileChangeToolPartProps {
  payload: FileChangeToolPayload;
  onDebug?: () => void;
}

export function FileChangeToolPart({ payload, onDebug }: FileChangeToolPartProps) {
  const Icon = getIcon(payload.toolName);
  const lineCounts = getFileChangeLineCounts(payload);

  function renderTrailing() {
    if (!lineCounts || (lineCounts.additions === 0 && lineCounts.deletions === 0)) {
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
      icon={Icon}
      title={getFileChangeTitle(payload)}
      state={payload.state}
      errorText={payload.errorText}
      onDebug={onDebug}
      trailing={renderTrailing()}
      // Pending and failed calls have no diff to disclose (OS-1769).
      hasBody={payload.state === "output-available"}
      renderChildren={() => <FileChangeContent payload={payload} />}
    />
  );
}
