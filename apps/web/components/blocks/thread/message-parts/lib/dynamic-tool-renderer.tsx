import type { ReactNode } from "react";
import type { DynamicToolUIPart } from "ai";
import { toast } from "sonner";
import {
  parseAskUserQuestionToolPart,
} from "@/lib/ai-tools/ask-user-question";
import { parseExitPlanModeToolPart } from "@/lib/ai-tools/exit-plan-mode";
import { parseGlobToolPart } from "@/lib/ai-tools/glob-tool";
import { parseGrepToolPart } from "@/lib/ai-tools/grep-tool";
import { parseTerminalToolPart } from "@/lib/ai-tools/terminal-tool";
import { parseApplyChangesToolPart } from "@/lib/ai-tools/apply-changes-tool";
import { parseFileChangeToolPart } from "@/lib/ai-tools/file-change-tool";
import { parseMcpToolPart } from "@/lib/ai-tools/mcp-tool";
import { parseConvoyArtifactToolPart } from "@/lib/ai-tools/convoy-artifact-tool";
import { parseConvoyTaskReaderToolPart } from "@/lib/ai-tools/convoy-task-reader-tool";
import { parseConvoyTaskWriterToolPart } from "@/lib/ai-tools/convoy-task-writer-tool";
import type { CliUiPartRenderContext } from "./part-renderer-registry";
import { ApplyChangesToolPart } from "../apply-changes-tool-part";
import { AskUserQuestionPart } from "../ask-user-question-part";
import { DynamicToolPart } from "../dynamic-tool-part";
import { ExitPlanModePart } from "../exit-plan-mode-part";
import { FileChangeToolPart } from "../file-change-tool-part";
import { GlobToolPart } from "../glob-tool-part";
import { GrepToolPart } from "../grep-tool-part";
import { McpToolPart } from "../mcp-tool-part";
import { ConvoyArtifactPart } from "../convoy-artifact-part";
import { ConvoyTaskReaderPart } from "../convoy-task-reader-part";
import { ConvoyTaskWriterPart } from "../convoy-task-writer-part";
import { TerminalToolPart } from "../terminal-tool-part";

function buildToolDebugHandler(part: DynamicToolUIPart): () => void {
  return () => {
    const payload = {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      state: part.state,
      ...("input" in part ? { input: part.input } : {}),
      ...("output" in part ? { output: part.output } : {}),
      ...("errorText" in part ? { errorText: part.errorText } : {}),
    };
    const json = JSON.stringify(payload, null, 2);
    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard is not available");
      return;
    }
    navigator.clipboard.writeText(json).then(
      () => toast.success("Tool call JSON copied"),
      () => toast.error("Could not copy the tool call JSON")
    );
  };
}

export function renderDynamicToolPartElement(
  part: DynamicToolUIPart,
  context: CliUiPartRenderContext
): ReactNode {
  const onDebug = buildToolDebugHandler(part);

  const askUserQuestionPayload = parseAskUserQuestionToolPart(part);
  if (askUserQuestionPayload) {
    const submittedResponse =
      context.submittedAskUserQuestionResponses?.[
        askUserQuestionPayload.toolCallId
      ];
    return (
      <AskUserQuestionPart
        part={part}
        submittedResponse={submittedResponse}
        onSubmit={context.onSubmitAskUserQuestion}
      />
    );
  }

  const exitPlanModePayload = parseExitPlanModeToolPart(part);
  if (exitPlanModePayload) {
    return (
      <ExitPlanModePart
        payload={exitPlanModePayload}
        cliType={context.cliType}
        onPlanDecision={context.onPlanDecision}
        showPlanDecisions={context.showPlanDecisions}
      />
    );
  }

  const terminalPayload = parseTerminalToolPart(part);
  if (terminalPayload) {
    return <TerminalToolPart payload={terminalPayload} onDebug={onDebug} />;
  }

  const grepPayload = parseGrepToolPart(part);
  if (grepPayload) {
    return <GrepToolPart payload={grepPayload} onDebug={onDebug} />;
  }

  const globPayload = parseGlobToolPart(part);
  if (globPayload) {
    return <GlobToolPart payload={globPayload} onDebug={onDebug} />;
  }

  const applyChangesPayload = parseApplyChangesToolPart(part);
  if (applyChangesPayload) {
    return (
      <ApplyChangesToolPart payload={applyChangesPayload} onDebug={onDebug} />
    );
  }

  const fileChangePayload = parseFileChangeToolPart(part);
  if (fileChangePayload) {
    return <FileChangeToolPart payload={fileChangePayload} onDebug={onDebug} />;
  }

  const taskReaderPayload = parseConvoyTaskReaderToolPart(part);
  if (taskReaderPayload) {
    return (
      <ConvoyTaskReaderPart
        payload={taskReaderPayload}
        onDebug={onDebug}
        onOpenTask={context.onOpenTaskRef}
      />
    );
  }

  const artifactPayload = parseConvoyArtifactToolPart(part);
  if (artifactPayload) {
    return (
      <ConvoyArtifactPart
        payload={artifactPayload}
        onDebug={onDebug}
        onOpenArtifact={context.onOpenArtifact}
        onOpenTask={context.onOpenTaskRef}
      />
    );
  }

  const taskWriterPayload = parseConvoyTaskWriterToolPart(part);
  if (taskWriterPayload) {
    return (
      <ConvoyTaskWriterPart
        payload={taskWriterPayload}
        onDebug={onDebug}
        onOpenTask={context.onOpenTaskRef}
      />
    );
  }

  const mcpPayload = parseMcpToolPart(part);
  if (mcpPayload) {
    return <McpToolPart payload={mcpPayload} onDebug={onDebug} />;
  }

  return <DynamicToolPart part={part} onDebug={onDebug} />;
}
