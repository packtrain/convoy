"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TerminalToolPayload } from "@/lib/ai-tools/terminal-tool";
import { buildTerminalText } from "@/lib/ai-tools/terminal-tool";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolLoadingIndicator } from "./components/tool-loading-indicator";
import { ExpandableLines, TOOL_OUTPUT_LINE_LIMIT } from "./lib/expandable-lines";
import { getErrorMessage } from "@/lib/errors";

interface TerminalToolPartProps {
  payload: TerminalToolPayload;
  onDebug?: () => void;
}

function getDownloadFilename(toolCallId: string): string {
  const safeToolId = toolCallId.replace(/[^a-z0-9_-]/gi, "-");
  return `terminal-${safeToolId}.txt`;
}

function getTitle(payload: TerminalToolPayload): string {
  if (payload.description) {
    return payload.description;
  }
  const cmd = payload.command;
  return cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
}

/** Inner content — only mounted when the collapsible is expanded. */
function TerminalContent({ payload }: { payload: TerminalToolPayload }) {
  const [didCopy, setDidCopy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const fullText = buildTerminalText(payload);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is not available.");
      }
      await navigator.clipboard.writeText(fullText);
      setDidCopy(true);
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setDidCopy(false);
        copyTimerRef.current = null;
      }, 1200);
    } catch (copyError) {
      setError(
        getErrorMessage(copyError, "Could not copy.")
      );
    }
  }, [fullText]);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([fullText], {
        type: "text/plain;charset=utf-8",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = getDownloadFilename(payload.toolCallId);
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(
        getErrorMessage(downloadError, "Could not download.")
      );
    }
  }, [fullText, payload.toolCallId]);

  const isError = payload.state === "output-error";
  const isPending = payload.state === "input-available";

  // stdout and stderr share one cap; the first `stdoutLineCount` shown lines are stdout.
  const outputText = [payload.stdout, payload.stderr].filter(Boolean).join("\n");
  const stdoutLineCount = payload.stdout ? payload.stdout.split("\n").length : 0;

  return (
    <>
      <ExpandableLines
        text={outputText}
        lineLimit={TOOL_OUTPUT_LINE_LIMIT}
        className="group/terminal relative overflow-hidden rounded-md border border-border"
      >
        {(shownOutput) => {
          const shownLines = outputText ? shownOutput.split("\n") : [];
          const shownStdout = shownLines.slice(0, stdoutLineCount).join("\n");
          const shownStderr = shownLines.slice(stdoutLineCount).join("\n");

          return (
            <>
              {/* Copy/Download buttons, visible on hover or keyboard focus */}
              <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-focus-within/terminal:opacity-100 group-hover/terminal:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={handleDownload}
                  aria-label="Download output"
                  title="Download output"
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={handleCopy}
                  aria-label="Copy output"
                  title="Copy output"
                >
                  {didCopy ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </Button>
              </div>

              <pre className="overflow-x-auto bg-muted/50 p-3 font-mono text-xs leading-5 text-foreground">
                <code>
                  <span className="text-success">$</span>{" "}
                  <span>{payload.command}</span>
                </code>

                {shownStdout && (
                  <>
                    {"\n"}
                    <code>{shownStdout}</code>
                  </>
                )}

                {shownStderr && (
                  <>
                    {"\n"}
                    <code className="text-destructive">{shownStderr}</code>
                  </>
                )}

                {isError && payload.errorText && (
                  <>
                    {"\n"}
                    <code className="text-destructive">{payload.errorText}</code>
                  </>
                )}

                {payload.interrupted && (
                  <>
                    {"\n"}
                    <code className="italic text-muted-foreground">[Interrupted]</code>
                  </>
                )}

                {isPending && (
                  <>
                    {"\n"}
                    <ToolLoadingIndicator
                      className="text-muted-foreground"
                      label="Running…"
                      loaderClassName="size-3"
                      textClassName="text-current text-xs"
                    />
                  </>
                )}
              </pre>
            </>
          );
        }}
      </ExpandableLines>

      {error && (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      )}
    </>
  );
}

export function TerminalToolPart({ payload, onDebug }: TerminalToolPartProps) {
  return (
    <CollapsibleToolPart
      icon={SquareTerminal}
      title={getTitle(payload)}
      state={payload.state}
      errorText={payload.errorText}
      onDebug={onDebug}
      renderChildren={() => <TerminalContent payload={payload} />}
    />
  );
}
