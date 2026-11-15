"use client";

import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadComposerAttachedTask } from "@/components/blocks/thread/thread-composer";
import type { ContextWindowUsage, UsageLimitUsage } from "@/lib/cli-stream-ui";

export interface MockThreadComposerMessage {
  text: string;
  files: Array<{
    type: "file";
    url: string;
    mediaType?: string;
    filename: string;
  }>;
  taskId?: Id<"tasks">;
}

export interface MockThreadComposerProps {
  onSubmit: (
    message: MockThreadComposerMessage
  ) => Promise<void> | void;
  initialInput?: string;
  organizationId?: Id<"organizations">;
  onInputChange?: (value: string) => void;
  initialAttachedTask?: ThreadComposerAttachedTask | null;
  isAttachedTaskRemovable?: boolean;
  onTaskDrop?: (task: { id: string; refId: string }) => void;
  focusRequestKey?: number;
  textareaDisabled?: boolean;
  submitDisabled?: boolean;
  textareaClassName?: string;
  contextWindowUsage?: ContextWindowUsage | null;
  usageLimits?: UsageLimitUsage[];
  selectorsProps: {
    profileId?: string;
    pathId?: string;
    cliType?: string;
    cliModel?: string;
    mode?: string;
    profiles?: Array<{ _id: string }>;
    disabled?: boolean;
    lockAgentContext?: boolean;
    onModeChange?: (value: string) => void;
    onCliModelChange?: (value: string) => void;
  };
}

function submitMockMessage(
  onSubmit: MockThreadComposerProps["onSubmit"],
  message: MockThreadComposerMessage
) {
  void Promise.resolve(onSubmit(message)).catch(() => {});
}

export function NewThreadComposerMock(
  props: Pick<
    MockThreadComposerProps,
    "initialAttachedTask" | "isAttachedTaskRemovable" | "onSubmit" | "onTaskDrop"
  >
) {
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          submitMockMessage(props.onSubmit, {
            text: "  New thread request  ",
            files: [],
          })
        }
      >
        Submit new thread
      </button>
      <button
        type="button"
        onClick={() => props.onTaskDrop?.({ id: "task_9", refId: "OS-9" })}
      >
        Drop task on composer
      </button>
      <button
        type="button"
        onClick={() =>
          submitMockMessage(props.onSubmit, {
            text: "",
            files: [],
            taskId: "task_1" as Id<"tasks">,
          })
        }
      >
        Submit task-only thread
      </button>
      <p data-testid="initial-attached-task-ref">
        {props.initialAttachedTask?.refId ?? ""}
      </p>
      <p data-testid="initial-attached-task-name">
        {props.initialAttachedTask?.name ?? ""}
      </p>
      <p data-testid="attached-task-removable">
        {String(props.isAttachedTaskRemovable !== false)}
      </p>
    </div>
  );
}

export function DetailThreadComposerMock(
  props: Pick<
    MockThreadComposerProps,
    | "contextWindowUsage"
    | "usageLimits"
    | "onInputChange"
    | "onSubmit"
    | "onTaskDrop"
    | "selectorsProps"
    | "submitDisabled"
    | "textareaDisabled"
  >
) {
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          submitMockMessage(props.onSubmit, {
            text: "  Follow up  ",
            files: [],
          })
        }
      >
        Composer submit
      </button>
      <button
        type="button"
        onClick={() => props.onTaskDrop?.({ id: "task_9", refId: "OS-9" })}
      >
        Drop task on composer
      </button>
      <button
        type="button"
        onClick={() =>
          submitMockMessage(props.onSubmit, {
            text: "",
            files: [],
            taskId: "task_1" as Id<"tasks">,
          })
        }
      >
        Composer task-only submit
      </button>
      <button
        type="button"
        onClick={() => props.onInputChange?.("Edited draft")}
      >
        Change draft
      </button>
      <button
        type="button"
        onClick={() => props.selectorsProps.onModeChange?.("agent")}
      >
        Change mode
      </button>
      <button
        type="button"
        onClick={() => props.selectorsProps.onCliModelChange?.("haiku")}
      >
        Change model
      </button>
      <p data-testid="textarea-disabled">
        {String(Boolean(props.textareaDisabled))}
      </p>
      <p data-testid="submit-disabled">
        {String(Boolean(props.submitDisabled))}
      </p>
      <p data-testid="selectors-disabled">
        {String(Boolean(props.selectorsProps.disabled))}
      </p>
      <p data-testid="selectors-mode">{props.selectorsProps.mode ?? ""}</p>
      <p data-testid="selectors-lock-agent-context">
        {String(Boolean(props.selectorsProps.lockAgentContext))}
      </p>
      <p data-testid="context-window-usage">
        {props.contextWindowUsage ? JSON.stringify(props.contextWindowUsage) : ""}
      </p>
      <p data-testid="usage-limits">{JSON.stringify(props.usageLimits ?? [])}</p>
    </div>
  );
}

export function TaskSidebarThreadComposerMock(
  props: Pick<
    MockThreadComposerProps,
    | "initialInput"
    | "organizationId"
    | "initialAttachedTask"
    | "isAttachedTaskRemovable"
    | "onSubmit"
    | "selectorsProps"
    | "submitDisabled"
    | "textareaDisabled"
    | "focusRequestKey"
    | "textareaClassName"
  >
) {
  const attachedTaskId = props.initialAttachedTask?._id;

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          submitMockMessage(props.onSubmit, {
            text: "  Start a task thread  ",
            files: [],
            taskId: attachedTaskId,
          })
        }
      >
        Submit task thread
      </button>
      <p data-testid="thread-composer-initial-input">{props.initialInput ?? ""}</p>
      <p data-testid="thread-composer-organization-id">
        {props.organizationId ?? ""}
      </p>
      <p data-testid="thread-composer-attached-task-ref">
        {props.initialAttachedTask?.refId ?? ""}
      </p>
      <p data-testid="thread-composer-attached-task-name">
        {props.initialAttachedTask?.name ?? ""}
      </p>
      <p data-testid="thread-composer-attached-task-removable">
        {String(props.isAttachedTaskRemovable !== false)}
      </p>
      <p data-testid="thread-composer-textarea-disabled">
        {String(Boolean(props.textareaDisabled))}
      </p>
      <p data-testid="thread-composer-submit-disabled">
        {String(Boolean(props.submitDisabled))}
      </p>
      <p data-testid="thread-composer-selectors-disabled">
        {String(Boolean(props.selectorsProps.disabled))}
      </p>
      <p data-testid="thread-composer-selector-model">
        {props.selectorsProps.cliModel ?? ""}
      </p>
      <p data-testid="thread-composer-textarea-class">
        {props.textareaClassName ?? ""}
      </p>
      <p data-testid="thread-composer-focus-request">
        {String(props.focusRequestKey ?? 0)}
      </p>
    </div>
  );
}

export function MockLink({
  children,
  href,
  ...props
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
