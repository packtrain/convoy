import { AccountUsage } from "@/components/blocks/account-usage";
import type { ReactNode } from "react";
import { CODEX_AGENT_GROUP_KEY } from "@/lib/cli-stream-ui/types";
import { toCliProposedPlanSource } from "@/convex/lib/contracts/validators";
import {
  type DynamicToolUIPart,
  type ReasoningUIPart,
  type TextUIPart,
} from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import type {
  CliRenderMessage,
  CliUiPart,
  MemoryRecallPart as MemoryRecallPartModel,
  RuntimeNoticePart as RuntimeNoticePartModel,
  TaskNoticeGroupPart as TaskNoticeGroupPartModel,
} from "@/lib/cli-stream-ui";
import type {
  AskUserQuestionResponseMap,
  AskUserQuestionResponsePayload,
} from "@/lib/ai-tools/ask-user-question";
import type { PlanDecision } from "@/lib/threads/plan-decision";
import type { CliTypeSlug } from "@/lib/threads/types";
import type { ThreadMessageAttachment } from "@/components/blocks/thread/response-attachments";
import { renderDynamicToolPartElement as renderDynamicToolPartInner } from "./dynamic-tool-renderer";
import { MemoryRecallPart } from "../memory-recall-part";
import { PlanPart } from "../plan-part";
import { SleepPart } from "../sleep-part";
import { ReasoningPart } from "../reasoning-part";
import { RuntimeNoticePart } from "../runtime-notice-part";
import { SteeredMessagePart } from "../steered-message-part";
import { CodexAgentGroupPart } from "../codex-agent-group-part";
import { TaskNoticeGroupPart } from "../task-notice-group-part";
import { TextPart } from "../text-part";
import { UnknownPart } from "../unknown-part";

export type CliUiPartRenderContext = {
  partIndex: number;
  message: CliRenderMessage;
  onSubmitAskUserQuestion?: (
    payload: AskUserQuestionResponsePayload
  ) => Promise<void> | void;
  submittedAskUserQuestionResponses?: AskUserQuestionResponseMap;
  /** Runtime of the thread — decides which plan approve modes are offered. */
  cliType?: CliTypeSlug;
  onPlanDecision?: (decision: PlanDecision) => Promise<void> | void;
  showPlanDecisions?: boolean;
  pendingProposedPlan?: PlanDecision["proposedPlan"];
  /** Resolves a user message's attachments (steered-message inline bubbles). */
  getUserMessageAttachments?: (
    messageId: string
  ) => ThreadMessageAttachment[] | undefined;
  /** Opens an artifact in the host's sidebar; when omitted, links navigate. */
  onOpenArtifact?: (artifactId: string) => void;
  /** Same, for the task ref links in task tool parts (OS-1686). */
  onOpenTaskRef?: (refId: string) => void;
};

export type CliUiPartRenderer = (args: {
  part: CliUiPart;
  context: CliUiPartRenderContext;
}) => ReactNode;

function isCliTextPart(part: CliUiPart): part is TextUIPart {
  return part.type === "text";
}

function isCliReasoningPart(part: CliUiPart): part is ReasoningUIPart {
  return part.type === "reasoning";
}

function isRuntimeNoticePart(part: CliUiPart): part is RuntimeNoticePartModel {
  return part.type === "runtime-notice";
}

function isTaskNoticeGroupPart(part: CliUiPart): part is TaskNoticeGroupPartModel {
  return part.type === "task-notice-group";
}

function isMemoryRecallPart(part: CliUiPart): part is MemoryRecallPartModel {
  return part.type === "memory-recall";
}

const renderProposedPlanPart: CliUiPartRenderer = ({ part, context }) => {
  if (part.type !== "proposed-plan" || !part.text.trim()) return null;
  const source = context.pendingProposedPlan;
  const matchesSource = source?.messageId === context.message.id &&
    source?.itemId === part.itemId && source?.turnId === part.turnId;
  return <PlanPart
    payload={{ id: part.itemId, text: part.text }}
    cliType={context.cliType}
    showPlanDecisions={context.showPlanDecisions && part.state === "completed" && matchesSource}
    onPlanDecision={context.onPlanDecision && source ? (decision) => context.onPlanDecision?.({
      ...decision, proposedPlan: toCliProposedPlanSource(source),
    }) : undefined}
  />;
};

const renderUnknownPart: CliUiPartRenderer = ({ part }) => {
  return <UnknownPart part={part} />;
};

const renderTextPart: CliUiPartRenderer = ({ part, context }) => {
  if (!isCliTextPart(part)) {
    return <UnknownPart part={part} />;
  }
  return <TextPart part={part} onOpenTask={context.onOpenTaskRef} onOpenArtifact={context.onOpenArtifact} />;
};

const renderReasoningPart: CliUiPartRenderer = ({ part, context }) => {
  if (!isCliReasoningPart(part)) {
    return <UnknownPart part={part} />;
  }
  return <ReasoningPart part={part} partIndex={context.partIndex} />;
};

/**
 * Render one `DynamicToolUIPart` via its specialized component (TerminalTool, TodoWrite,
 * AskUserQuestion, ExitPlanMode), falling back to the generic `DynamicToolPart`.
 *
 * Exported so `TaskNoticeGroupPart` can reuse the dispatch for the child tool calls it
 * renders inside a sub-agent card.
 */
export function renderDynamicToolPartElement(
  part: DynamicToolUIPart,
  context: CliUiPartRenderContext
): ReactNode {
  return renderDynamicToolPartInner(part, context);
}

const renderDynamicToolPart: CliUiPartRenderer = ({ part, context }) => {
  if (!isDynamicToolUIPart(part)) {
    return <UnknownPart part={part} />;
  }
  return renderDynamicToolPartElement(part, context);
};

const renderRuntimeNoticePart: CliUiPartRenderer = ({ part, context }) => {
  if (!isRuntimeNoticePart(part)) {
    return <UnknownPart part={part} />;
  }

  if (part.code === "steered-message") {
    return (
      <SteeredMessagePart
        part={part}
        getUserMessageAttachments={context.getUserMessageAttachments}
      />
    );
  }

  return <RuntimeNoticePart part={part} />;
};

const renderMemoryRecallPart: CliUiPartRenderer = ({ part }) => {
  if (!isMemoryRecallPart(part)) {
    return <UnknownPart part={part} />;
  }

  return <MemoryRecallPart part={part} />;
};

const renderAccountUsagePart: CliUiPartRenderer = ({ part }) =>
  part.type === "account-usage" ? <AccountUsage usage={part.usage} /> : <UnknownPart part={part} />;

const renderSleepPart: CliUiPartRenderer = ({ part }) => {
  return part.type === "sleep" ? <SleepPart part={part} /> : <UnknownPart part={part} />;
};

const renderTaskNoticeGroupPart: CliUiPartRenderer = ({ part, context }) => {
  if (!isTaskNoticeGroupPart(part)) {
    return <UnknownPart part={part} />;
  }

  return part.groupKey === CODEX_AGENT_GROUP_KEY
    ? <CodexAgentGroupPart part={part} />
    : <TaskNoticeGroupPart part={part} context={context} />;
};

/**
 * Add new part renderers by:
 * 1) Creating a dedicated part component in the parent message-parts folder
 * 2) Registering the component in `resolveCliUiPartRenderer`
 *
 * Unknown and unregistered part types intentionally go through the JSON fallback renderer.
 */
export function resolveCliUiPartRenderer(part: CliUiPart): CliUiPartRenderer {
  if (isCliTextPart(part)) {
    return renderTextPart;
  }
  if (isCliReasoningPart(part)) {
    return renderReasoningPart;
  }
  if (isDynamicToolUIPart(part)) {
    return renderDynamicToolPart;
  }
  if (part.type === "runtime-notice") {
    return renderRuntimeNoticePart;
  }
  if (part.type === "task-notice-group") {
    return renderTaskNoticeGroupPart;
  }
  if (part.type === "memory-recall") {
    return renderMemoryRecallPart;
  }
  if (part.type === "proposed-plan") return renderProposedPlanPart;
  if (part.type === "account-usage") return renderAccountUsagePart;
  if (part.type === "sleep") {
    return renderSleepPart;
  }

  return renderUnknownPart;
}

export function renderCliUiMessagePart(args: {
  part: CliUiPart;
  context: CliUiPartRenderContext;
}): ReactNode {
  const renderer = resolveCliUiPartRenderer(args.part);
  return renderer(args);
}
