"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ExpandableLines } from "./lib/expandable-lines";
import { ToolSurface } from "./components/tool-surface";

const PREVIEW_LINE_LIMIT = 80;

export type SearchToolState =
  | "input-available"
  | "output-available"
  | "output-error";

export type SearchToolView = {
  icon: LucideIcon;
  title: string;
  state: SearchToolState;
  errorFallback: string;
  emptyLabel: string;
  resultText?: string;
  errorText?: string;
  isEmpty?: boolean;
  footerNotice?: ReactNode;
};

interface SearchToolPartProps {
  view: SearchToolView;
  onDebug?: () => void;
}

function SearchToolContent({ view }: { view: SearchToolView }) {
  const resultText = view.resultText ?? "";

  if ((view.isEmpty ?? false) || resultText.trim().length === 0) {
    return (
      <ToolSurface className="text-sm text-muted-foreground">
        {view.emptyLabel}
      </ToolSurface>
    );
  }

  return (
    <ExpandableLines
      text={resultText}
      lineLimit={PREVIEW_LINE_LIMIT}
      className="overflow-hidden rounded-md border border-border bg-muted/40"
      footer={view.footerNotice}
    >
      {(displayText) => (
        <pre className="max-h-[28rem] overflow-auto p-3 font-mono text-xs leading-5 text-foreground">
          <code>{displayText}</code>
        </pre>
      )}
    </ExpandableLines>
  );
}

export function SearchToolPart({ view, onDebug }: SearchToolPartProps) {
  const Icon = view.icon;

  return (
    <CollapsibleToolPart
      icon={Icon}
      title={view.title}
      state={view.state}
      errorText={view.errorText ?? view.errorFallback}
      onDebug={onDebug}
      // Pending and failed searches have no results to disclose; the row's icon
      // carries both states (OS-1769).
      hasBody={view.state === "output-available"}
      renderChildren={() => <SearchToolContent view={view} />}
    />
  );
}
