"use client";

import { MAX_ATTACHMENT_SIZE, MAX_MESSAGE_ATTACHMENTS } from "@/convex/lib/constants";
import { dedupeAttachmentFileName } from "@/lib/threads/message-attachments";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import type { FileUIPart } from "ai";
import type { JSONContent } from "@tiptap/react";
import { ChevronDown, FolderGit2, GitBranch, Laptop, Paperclip, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { BackgroundTasksPill } from "@/components/blocks/background-tasks";
import type { CliThreadBackgroundTasks, CliStopConfirmation, CliThreadGoal, CliThreadRepoBranch } from "@/convex/lib/contracts/validators";
import { folderRepos, isWorktreeParent } from "@/convex/lib/contracts/validators";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { useQuery } from "convex/react";
import { ContextWindowMeter } from "@/components/blocks/thread/context-window-meter";
import { AttachmentLightbox } from "@/components/blocks/tasks/attachment-lightbox";
import { CostIndicator } from "@/components/blocks/thread/cost-indicators";
import { UsageLimitPills } from "@/components/blocks/thread/usage-limit-pill";
import { GoalButton } from "@/components/blocks/thread/goal";
import { WorkspaceSelectors } from "@/components/blocks/thread/base-ref-selector";
import { ThreadAgentSelector } from "@/components/blocks/thread/thread-agent-selector";
import { WorkingDirectorySelector } from "@/components/blocks/thread/working-directory-selector";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { ThreadAttachmentMenu } from "@/components/blocks/thread/thread-attachment-menu";
import { ThreadComposerTaskDropZone } from "@/components/blocks/thread/thread-composer-task-drop-zone";
import { ThreadAttachmentPill } from "@/components/blocks/thread/thread-attachment-pill";
import { ThreadContextSelectors } from "@/components/blocks/thread/thread-context-selectors";
import { ThreadPrBadges } from "@/components/blocks/thread/thread-pr-badge";
import { ThreadPlanProgress } from "@/components/blocks/thread/thread-plan-progress";
import { ThreadTaskSelectorDialog } from "@/components/blocks/thread/thread-task-selector-dialog";
import { AttachedPullRequestPill, PullRequestSelectorDialog } from "@/components/blocks/integrations";
import { attachedPullRequestUrl, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { ThreadAgentChip, type ThreadAgentChipAgent } from "@/components/blocks/thread/thread-agent-chip";
import { Spinner } from "@/components/custom/spinner";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pill, PillAction, PillContent, PillIcon, PillText } from "@/components/ui/pill";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { OrgPermission, ProjectPermission, hasOrgPermission, hasProjectPermission } from "@/lib/authz/permissions";
import { useOptionalCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import type { SlashCommandCatalogItem } from "@/lib/slash-commands/composer";
import type { RuntimeSlashCommand } from "@/convex/cli/lib/runtimes/validators";
import { PLAN_MODE_TOGGLE_SHORTCUT, THREAD_ATTACH_FILES_SHORTCUT } from "@/lib/browser/hotkeys";
import { useAttachmentPreview } from "@/hooks/uploads/use-attachment-preview";
import type { ContextWindowUsage, UsageLimitUsage } from "@/lib/cli-stream-ui";
import { downloadFile, getFileIcon, isPreviewableImageAttachment, isPreviewableTextAttachment } from "@/lib/tasks/files";
import type { TaskSelectorOption } from "@/lib/tasks/task-selector";
import { getPlanModeToggleTarget } from "@/lib/threads/types";
import { cn } from "@/lib/utils";
import type { ThreadComposerDocument } from "@/lib/slash-commands/composer";
import {
  buildRuntimeSlashCommandItems,
  buildSkillComposerItems,
  createEmptyThreadComposerDocument,
  isRuntimeCommandMessage,
  getComposerRuntimeCommands,
} from "@/lib/slash-commands/composer";
import type { ThreadComposerSerializedContent } from "@/lib/threads/draft-storage";
import type { FileMentionContext } from "@/lib/threads/hooks/use-file-mention-search";
import type { PlanProgress } from "@/lib/threads/plan-progress";
import { supportsAttachedPullRequest } from "@/lib/threads/cli-version";
import type { ThreadPullRequest } from "@/lib/threads/pull-request";
import { threadBranchLabel } from "@/lib/threads/repo-branches";
import { isRecord } from "@/lib/type-guards";
import { appRoute, href, useRouteParams } from "@/lib/navigation";
import { PromptInputTiptapTextarea, type PromptInputMentionApi } from "./prompt-input-tiptap-textarea";

export type ThreadComposerAttachedTask = Pick<TaskSelectorOption, "_id" | "refId" | "name" | "taskType">;

function toComposerAttachedTask(task: TaskSelectorOption): ThreadComposerAttachedTask {
  return {
    _id: task._id,
    refId: task.refId,
    name: task.name,
    taskType: task.taskType,
  };
}

export interface ThreadComposerSubmitMessage {
  text: string;
  composerDocument?: ThreadComposerDocument;
  files: FileUIPart[];
  taskId?: Id<"tasks">;
  /** The attached task's summary (branch naming and other task-aware submit handling). */
  attachedTask?: ThreadComposerAttachedTask | null;
  /** The message's Attached pull request, as a github.com URL. */
  pullRequestUrl?: string;
  /** Whole message is a runtime slash command ("/compact args") — forward raw to the agent. */
  runtimeCommand?: boolean;
}

/**
 * Imperative access to the composer input for callers outside the prompt
 * provider (e.g. "edit queued message" restoring text into the composer).
 */
export interface ThreadComposerControllerApi {
  getInput: () => string;
  setInput: (value: string) => void;
  /** Append an `@path` mention pill to the draft and focus (OS-1159). */
  insertFileMention: (path: string) => void;
  /** Focus the draft's end, e.g. after a callout holding focus unmounts (OS-2584). */
  focus: () => void;
  /**
   * Attach pre-built file parts with caller-supplied ids (e.g. restoring an
   * edited queued message's already-uploaded attachments).
   */
  addFileParts: (parts: (FileUIPart & { id: string })[]) => void;
}

/**
 * Pushes an out-of-band seed into a mounted composer, once per `seedKey`
 * (OS-1716, docs/specs/artifact-comments.md). `initialInput` only seeds state
 * on mount, which a seed for the thread already on screen never reaches.
 */
function ThreadComposerSeedSync({
  seedKey,
  seedText,
}: {
  seedKey: string | undefined;
  seedText: string;
}) {
  const controller = usePromptInputController();
  // Seeded at mount, so the seed `initialInput` already carries isn't re-pushed.
  const appliedSeedKeyRef = useRef(seedKey);

  useEffect(() => {
    if (seedKey === undefined || appliedSeedKeyRef.current === seedKey) {
      return;
    }

    appliedSeedKeyRef.current = seedKey;
    controller.textInput.setInput(seedText);
  }, [controller, seedKey, seedText]);

  return null;
}

function ThreadComposerControllerBridge({
  controllerRef,
  mentionApiRef,
}: {
  controllerRef: RefObject<ThreadComposerControllerApi | null>;
  mentionApiRef: RefObject<PromptInputMentionApi | null>;
}) {
  const controller = usePromptInputController();

  useEffect(() => {
    controllerRef.current = {
      getInput: () => controller.textInput.value,
      setInput: (value: string) => controller.textInput.setInput(value),
      insertFileMention: (path: string) => mentionApiRef.current?.insertFileMention(path),
      focus: () => mentionApiRef.current?.focus(),
      addFileParts: (parts) => controller.attachments.addParts(parts),
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controller, controllerRef, mentionApiRef]);

  return null;
}

const THREAD_COMPOSER_PLACEHOLDER = "Describe a task or ask a question";

interface ThreadComposerProps {
  projectId?: Id<"projects">;
  organizationId?: Id<"organizations">;
  /** Slash commands advertised by the thread's runtime (offered in the `/` autocomplete). */
  runtimeSlashCommands?: RuntimeSlashCommand[];
  onSubmit: (message: ThreadComposerSubmitMessage) => void | Promise<void>;
  /** Defaults to `THREAD_COMPOSER_PLACEHOLDER`. */
  textareaPlaceholder?: string;
  selectorsProps: ComponentProps<typeof ThreadContextSelectors>;
  draftScopeKey?: string;
  initialInput?: string;
  /** File parts the composer mounts with, e.g. a draft's uploaded attachments (OS-2141). */
  initialAttachments?: (FileUIPart & { id: string })[];
  /**
   * Changes whenever `initialInput` was re-seeded from outside the composer,
   * pushing the new text into the already-mounted editor (OS-1716).
   */
  seedKey?: string;
  initialAttachedTask?: ThreadComposerAttachedTask | null;
  initialAttachedPullRequest?: AttachedPullRequest | null;
  isAttachedTaskRemovable?: boolean;
  /** False locks the PR pill, as on the PR page's own composer. */
  isAttachedPullRequestRemovable?: boolean;
  onOpenAttachedTask?: (task: ThreadComposerAttachedTask) => void;
  getTaskHref?: (task: Pick<TaskSelectorOption, "refId" | "isArchived">) => string;
  onAttachedTaskChange?: (task: ThreadComposerAttachedTask | null) => void;
  /**
   * Notified when a task drag lands on the input box (first dragged root task).
   * Optional: attaching is the composer's own state, so a drop attaches with or
   * without this — hosts that mirror the attachment into the URL pass it.
   */
  onTaskDrop?: (task: { id: string; refId: string }) => void;
  onInputChange?: (value: string) => void;
  onComposerContentChange?: (content: ThreadComposerSerializedContent) => void;
  onAttachmentsChange?: (files: (FileUIPart & { id: string })[]) => void;
  pendingAttachments?: ThreadComposerPendingAttachment[];
  onStop?: () => void | Promise<void>;
  showStopWhenIdleInput?: boolean;
  isSubmitting?: boolean;
  stopDisabled?: boolean;
  focusRequestKey?: number;
  /** Focus the editor on mount and each time it becomes enabled, for surfaces that open to type. */
  autoFocus?: boolean;
  textareaDisabled?: boolean;
  submitDisabled?: boolean;
  contextWindowUsage?: ContextWindowUsage | null;
  /**
   * Reserve space for the context-window meter even before the agent reports
   * usage, so the footer layout doesn't shift when it appears (OS-1132).
   */
  showContextWindowMeter?: boolean;
  /** Shows the thread cost indicator when set (OS-1132). */
  costThreadId?: Id<"cliThreads"> | null;
  /** Thread's associated task; shows the task cost indicator when set (OS-1132). */
  costTaskId?: Id<"tasks"> | null;
  usageLimits?: UsageLimitUsage[];
  goal?: CliThreadGoal;
  /** Sends `/goal clear`; offered only when the runtime advertises `/goal`. */
  onClearGoal?: () => void;
  /** Sends `/compact` ahead of the queue; offered only when the runtime advertises it (OS-2339). */
  onCompact?: () => void;
  backgroundTasks?: CliThreadBackgroundTasks;
  stopConfirmation?: CliStopConfirmation;
  containerClassName?: string;
  contentClassName?: string;
  textareaClassName?: string;
  initialComposerContent?: ThreadComposerSerializedContent;
  /** Receives imperative input access while the composer is mounted. */
  controllerRef?: RefObject<ThreadComposerControllerApi | null>;
  // Config-editor mode (agent automation): the composer edits a stored prompt
  // instead of sending a message, so the sending affordances are hidden and
  // the slash-command document streams out continuously.
  /** Hide the attach-file / attach-task tools. */
  hideAttachmentTools?: boolean;
  /** Hide the send/stop control (onSubmit is never called). */
  hideSubmit?: boolean;
  /** Omit thread context above the input, as in the last-message editor. */
  hideContextBar?: boolean;
  /** Continuous slash-command document updates (config editors persist it with the text). */
  onComposerDocumentChange?: (document: ThreadComposerDocument) => void;
  /** Extra pill controls rendered before the context selectors, in the working-directory slot (e.g. a workspace preference). */
  extraSelectorTools?: ReactNode;
  /** Secondary actions immediately before Send or Stop in the footer. */
  extraSubmitActions?: ReactNode;
  /** New-thread composers' workflow picker, rendered in the top context bar (docs/specs/workflows.md → Start). */
  workflowSelector?: ReactNode;
  /** Extra pills in the attachment row above the input (e.g. pending review comments); counts as queued content for send. */
  extraAttachmentPills?: ReactNode;
  /** Existing-thread composers show the immutable bound persona below the input. */
  readOnlyAgent?: ThreadAgentChipAgent;
  /** Started threads use their execution metadata, even after a profile path disappears. */
  readOnlyWorkspace?: { kind: "local" | "worktree"; branch?: string; repoBranches?: CliThreadRepoBranch[] };
  /** Existing-thread composers show branch-derived PR info after the workspace controls; one per repo in a multi-repo folder. */
  pullRequests?: ThreadPullRequest[];
  /** The agent's current plan, shown as a progress chip after the PR badge. */
  planProgress?: PlanProgress | null;
}

export interface ThreadComposerPendingAttachment {
  id: string;
  filePartId?: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: "uploading" | "uploaded" | "error";
  error?: string;
}

interface ThreadComposerSubmitControlProps {
  isSubmitting: boolean;
  submitDisabled: boolean;
  hasBlockingAttachmentState: boolean;
  hasAttachedTask: boolean;
  hasExtraQueuedContent: boolean;
  showStopWhenIdleInput: boolean;
  stopDisabled: boolean;
  onStop?: () => void | Promise<void>;
}

interface ThreadComposerTiptapInputProps {
  pendingAttachments: ThreadComposerPendingAttachment[];
  projectId?: Id<"projects">;
  organizationId?: Id<"organizations">;
  runtimeSlashCommands?: RuntimeSlashCommand[];
  fileMention?: FileMentionContext | null;
  mentionApiRef?: RefObject<PromptInputMentionApi | null>;
  textareaPlaceholder: string;
  textareaDisabled: boolean;
  autoFocus?: boolean;
  isSubmitting: boolean;
  textareaClassName?: string;
  initialInput: string;
  initialComposerContent?: ThreadComposerSerializedContent;
  onInputChange?: (value: string) => void;
  onComposerContentChange?: (content: ThreadComposerSerializedContent) => void;
  onComposerDocumentChange: (document: ThreadComposerDocument) => void;
  onAutoSubmit?: () => void;
}

interface AttachmentDisplayItem {
  file: FileUIPart & { id: string };
  pending?: ThreadComposerPendingAttachment;
}

function getAttachmentPresentation({ file, pending }: AttachmentDisplayItem) {
  const fileName = file.filename ?? "attachment";
  const contentType = pending?.contentType ?? (typeof file.mediaType === "string" ? file.mediaType : "application/octet-stream");
  const Icon = getFileIcon(contentType);
  const isUploading = pending?.status === "uploading";
  const isError = pending?.status === "error";
  const url = typeof file.url === "string" ? file.url : null;
  // Text needs a known size; a part without an upload row has none.
  const canPreview =
    isPreviewableImageAttachment(contentType, url) ||
    (pending !== undefined && isPreviewableTextAttachment(contentType, url, pending.fileSize));

  return {
    fileName,
    Icon,
    canPreview,
    isUploading,
    isError,
    error: pending?.error,
  };
}

function ThreadComposerTiptapInput({ projectId, organizationId, ...props }: ThreadComposerTiptapInputProps) {
  if (!organizationId) {
    return <ThreadComposerTiptapInputBase {...props} slashCommands={[]} />;
  }

  return <ThreadComposerTiptapInputWithCatalog {...props} organizationId={organizationId} projectId={projectId} />;
}

function ThreadComposerTiptapInputWithCatalog({
  projectId,
  organizationId,
  ...props
}: Omit<ThreadComposerTiptapInputProps, "organizationId"> & {
  organizationId: Id<"organizations">;
}) {
  const slashCommands = useQuery(api.slashCommands.core.listComposerCatalog, {
    organizationId,
    ...(projectId ? { projectId } : {}),
  });
  // The project's Skills join the same `/` menu (docs/specs/skills.md#composer-mentions).
  const skills = useQuery(api.skills.core.listByProject, projectId ? { projectId } : "skip");
  const catalog = useMemo(
    () => [...(slashCommands ?? []), ...buildSkillComposerItems(skills ?? [])],
    [skills, slashCommands]
  );
  // Both queries are already subscribed by the sidebar, so these add no reads.
  const orgRoute = useOptionalCurrentOrgProject();
  const orgRole = useQuery(api.organizations.members.getMyRole, { organizationId });
  const projects = useQuery(api.projects.core.listByOrganization, projectId ? { organizationId } : "skip");
  const project = projects?.find((row) => row._id === projectId);
  const organizationSlug = orgRoute?.organizationId === organizationId ? orgRoute.organizationSlug : null;
  // Edit link on a manageable Prompt row (docs/specs/slash-commands.md#composer-behavior).
  const getPromptEditHref = (item: SlashCommandCatalogItem) => {
    if (!organizationSlug) return null;
    if (item.scope === "organization") {
      return hasOrgPermission(orgRole, OrgPermission.SLASH_COMMANDS_MANAGE) ? appRoute.organizationPromptDetail(organizationSlug, item.id) : null;
    }
    return project && hasProjectPermission(project.myRole, ProjectPermission.SLASH_COMMANDS_MANAGE)
      ? appRoute.projectPromptDetail(organizationSlug, project.alias, item.id)
      : null;
  };

  return <ThreadComposerTiptapInputBase {...props} slashCommands={catalog} getPromptEditHref={getPromptEditHref} />;
}

function ThreadComposerTiptapInputBase({
  pendingAttachments,
  textareaPlaceholder,
  textareaDisabled,
  autoFocus,
  isSubmitting,
  textareaClassName,
  initialInput,
  initialComposerContent,
  onInputChange,
  onComposerContentChange,
  onComposerDocumentChange,
  onAutoSubmit,
  runtimeSlashCommands,
  fileMention,
  mentionApiRef,
  slashCommands,
  getPromptEditHref,
}: Omit<ThreadComposerTiptapInputProps, "organizationId" | "projectId"> & {
  slashCommands: ComponentProps<typeof PromptInputTiptapTextarea>["slashCommands"];
  getPromptEditHref?: ComponentProps<typeof PromptInputTiptapTextarea>["getPromptEditHref"];
}) {
  const initialEditorContent = isTiptapDocJsonContent(initialComposerContent) ? initialComposerContent : initialInput;
  const mergedSlashCommands = useMemo(
    () => [...buildRuntimeSlashCommandItems(runtimeSlashCommands ?? []), ...(slashCommands ?? [])],
    [runtimeSlashCommands, slashCommands]
  );

  return (
    <PromptInputTiptapTextarea
      pendingAttachments={pendingAttachments}
      placeholder={textareaPlaceholder}
      className={textareaClassName}
      disabled={textareaDisabled || isSubmitting}
      autoFocus={autoFocus}
      initialContent={initialEditorContent}
      slashCommands={mergedSlashCommands}
      getPromptEditHref={getPromptEditHref}
      fileMention={fileMention}
      mentionApiRef={mentionApiRef}
      onChange={onInputChange}
      onComposerDocumentChange={onComposerDocumentChange}
      onEditorContentChange={onComposerContentChange}
      onAutoSubmit={onAutoSubmit}
    />
  );
}

function isTiptapDocJsonContent(value: ThreadComposerSerializedContent | undefined): value is JSONContent {
  return isRecord(value) && value.type === "doc";
}

function AttachmentPill({
  item,
  onPreview,
  onRemove,
}: {
  item: AttachmentDisplayItem;
  onPreview: (item: AttachmentDisplayItem) => void;
  onRemove: (id: string) => void;
}) {
  const { file } = item;
  const { fileName, Icon, canPreview, isUploading, isError, error } = getAttachmentPresentation(item);

  return (
    <ThreadAttachmentPill
      fileName={fileName}
      icon={Icon}
      clickLabel={canPreview ? `Preview ${fileName}` : undefined}
      onClick={canPreview ? () => onPreview(item) : undefined}
      onRemove={() => onRemove(file.id)}
      state={isUploading ? "loading" : isError ? "error" : "idle"}
      tooltipContent={isError ? (error ?? fileName) : fileName}
    />
  );
}

function MoreAttachmentsPill({
  items,
  onPreview,
  onRemove,
}: {
  items: AttachmentDisplayItem[];
  onPreview: (item: AttachmentDisplayItem) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hiddenCount = items.length;
  const label = hiddenCount === 1 ? "1 more attachment" : `${hiddenCount} more attachments`;
  const hasError = items.some((item) => item.pending?.status === "error");
  const hasUploading = items.some((item) => item.pending?.status === "uploading");

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Pill className="max-w-[240px]">
            <PillContent>
              <PillIcon>
                {hasError ? (
                  <TriangleAlert className="size-4 text-destructive" />
                ) : hasUploading ? (
                  <Spinner className="size-4 text-muted-foreground" />
                ) : (
                  <Paperclip className="size-4 text-muted-foreground" />
                )}
              </PillIcon>
              <PillText className={cn(hasError && "text-destructive")}>{label}</PillText>
              <ChevronDown className="size-3 text-muted-foreground" />
            </PillContent>
          </Pill>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-1.5">
        <div className="flex flex-col gap-1">
          {items.map((item) => {
            const { file } = item;
            const { fileName, Icon, canPreview, isUploading, isError, error } = getAttachmentPresentation(item);

            return (
              <div key={file.id} className="flex items-center gap-2 rounded-md px-1 py-0.5">
                {isUploading ? (
                  <Spinner className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Icon className={cn("size-4 shrink-0", isError ? "text-destructive" : "text-muted-foreground")} />
                )}
                {canPreview ? (
                  <button
                    type="button"
                    aria-label={`Preview ${fileName}`}
                    className={cn(
                      "min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isError && "text-destructive"
                    )}
                    title={isError ? (error ?? fileName) : fileName}
                    onClick={() => {
                      setOpen(false);
                      onPreview(item);
                    }}
                  >
                    {fileName}
                  </button>
                ) : (
                  <span
                    className={cn("min-w-0 flex-1 truncate text-sm", isError && "text-destructive")}
                    title={isError ? (error ?? fileName) : fileName}
                  >
                    {fileName}
                  </span>
                )}
                <button
                  type="button"
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => onRemove(file.id)}
                  aria-label={`Remove ${fileName}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThreadComposerAttachmentTools({
  projectId,
  disabled,
  attachTaskDisabled = false,
  hotkeyTargetRef,
  onSelectTask,
  onSelectPullRequest,
  getTaskHref,
}: {
  projectId?: Id<"projects">;
  disabled: boolean;
  attachTaskDisabled?: boolean;
  hotkeyTargetRef: RefObject<HTMLDivElement | null>;
  onSelectTask: (task: ThreadComposerAttachedTask) => void;
  /** Absent while the PR is locked or the profile's CLI predates PRs: the menu offers no picker. */
  onSelectPullRequest?: (pullRequest: AttachedPullRequest) => void;
  getTaskHref?: (task: Pick<TaskSelectorOption, "refId" | "isArchived">) => string;
}) {
  const { openFileDialog } = usePromptInputAttachments();
  const [isTaskSelectorOpen, setIsTaskSelectorOpen] = useState(false);
  const [isPullRequestSelectorOpen, setIsPullRequestSelectorOpen] = useState(false);
  const canAttachTask = !!projectId && !attachTaskDisabled;
  const canAttachPullRequest = !!projectId && !!onSelectPullRequest;

  const handleOpenTaskSelector = useCallback(() => {
    if (!canAttachTask) {
      return;
    }
    setIsTaskSelectorOpen(true);
  }, [canAttachTask]);

  const handleSelectTask = useCallback(
    (task: TaskSelectorOption) => {
      onSelectTask(toComposerAttachedTask(task));
    },
    [onSelectTask]
  );
  const organizationSlug = useRouteParams<{ organizationSlug: string }>()?.organizationSlug ?? "";
  // The task page, never a relative `?task=`: the current page may be a thread (OS-2326).
  const getSelectorTaskHref = useCallback(
    (task: TaskSelectorOption) => getTaskHref?.(task) ?? href(appRoute.task(organizationSlug, task.refId)),
    [getTaskHref, organizationSlug]
  );

  useHotkey(
    THREAD_ATTACH_FILES_SHORTCUT,
    (event) => {
      event.preventDefault();
      openFileDialog();
    },
    {
      target: hotkeyTargetRef,
      enabled: !disabled,
      ignoreInputs: false,
    }
  );

  return (
    <>
      <ThreadAttachmentMenu
        disabled={disabled}
        attachTaskDisabled={!canAttachTask}
        onAttachTask={handleOpenTaskSelector}
        onAttachPullRequest={canAttachPullRequest ? () => setIsPullRequestSelectorOpen(true) : undefined}
      />
      {canAttachPullRequest && projectId && onSelectPullRequest ? (
        <PullRequestSelectorDialog
          projectId={projectId}
          open={isPullRequestSelectorOpen}
          onOpenChange={setIsPullRequestSelectorOpen}
          onSelect={onSelectPullRequest}
        />
      ) : null}
      <ThreadTaskSelectorDialog
        projectId={projectId}
        open={isTaskSelectorOpen}
        onOpenChange={setIsTaskSelectorOpen}
        onSelectTask={handleSelectTask}
        getTaskHref={getSelectorTaskHref}
      />
    </>
  );
}

// A folder of repos has no one repo to branch from (cli-multi-repo-projects.md#picking-a-repo).
const FOLDER_WORKTREE_TOOLTIP = "Pick a repo of this folder in the working directory menu to use a worktree.";
const WORKTREE_UNAVAILABLE_TOOLTIP =
  "Worktree options are unavailable because no Git origin was detected for this directory. Add an origin remote, then reconnect the CLI.";

function ThreadComposerWorkspaceSummary({
  kind,
  branch: knownBranch,
  repoBranches,
  tooltip,
}: NonNullable<ThreadComposerProps["readOnlyWorkspace"]> & { tooltip?: string }) {
  const branchLabel = threadBranchLabel({ branch: knownBranch, repoBranches });
  const branch = branchLabel?.branch;
  const label = kind === "worktree" ? "Worktree" : "Work locally";
  const EnvironmentIcon = kind === "worktree" ? FolderGit2 : Laptop;
  const chipClassName =
    // px-1 in the narrowest bar: a thread with per-repo PRs needs the room for its meters (UX OS-2523 round 2).
    "flex h-7 min-w-0 max-w-44 shrink items-center gap-1.5 rounded-[min(var(--radius-md),12px)] px-1 text-[0.8rem] leading-4 text-muted-foreground @sm/composer-bar:px-2";
  const summary = (
    <div
      className={cn(chipClassName, tooltip && "cursor-help")}
      role="img"
      aria-label={`Workspace: ${label}`}
      title={tooltip ? undefined : `Workspace: ${label}`}
      tabIndex={tooltip ? 0 : undefined}
    >
      <EnvironmentIcon className="size-3.5 shrink-0 opacity-70" />
      {/* Icon-only in a narrow composer bar, like the editable environment selector. */}
      <span className="hidden min-w-0 truncate @2xl/composer-bar:inline">{label}</span>
    </div>
  );

  return (
    <>
      {tooltip ? (
        <TooltipExt content={tooltip} delayDuration={500}>
          {summary}
        </TooltipExt>
      ) : summary}
      {branch ? (
        <button
          type="button"
          className={cn(chipClassName, "cursor-pointer hover:bg-muted hover:text-foreground")}
          title={`${kind === "worktree" ? "Worktree branch" : "Branch checked out locally"}: ${branch} · Click to copy`}
          aria-label={`Copy branch name ${branch}`}
          onClick={() => {
            navigator.clipboard.writeText(branch).then(
              () => toast.success("Branch name copied to clipboard"),
              () => toast.error("Failed to copy branch name"),
            );
          }}
        >
          <GitBranch className="size-3.5 shrink-0 opacity-70" />
          <MiddleTruncate text={branch} />
        </button>
      ) : branchLabel ? (
        <TooltipExt content={branchLabel.title} delayDuration={300}>
          <span className={cn(chipClassName, "shrink-0 cursor-default")} role="img" tabIndex={0} aria-label={`${branchLabel.text}: ${branchLabel.repoLines?.join(", ")}`}>
            <GitBranch className="size-3.5 shrink-0 opacity-70" />
            {/* The count alone in a narrow bar, as the environment pill drops its label. */}
            <span className="@md/composer-bar:hidden">{branchLabel.shortText}</span>
            <span className="hidden truncate @md/composer-bar:inline">{branchLabel.text}</span>
          </span>
        </TooltipExt>
      ) : null}
    </>
  );
}

function AttachmentsDisplay({
  projectId,
  attachedTask,
  isAttachedTaskRemovable,
  onOpenTask,
  onRemoveTask,
  attachedPullRequest,
  onRemovePullRequest,
  pendingAttachments,
  onAttachmentsChange,
  extraAttachmentPills,
}: {
  projectId?: Id<"projects">;
  attachedTask: ThreadComposerAttachedTask | null;
  isAttachedTaskRemovable: boolean;
  onOpenTask?: (task: ThreadComposerAttachedTask) => void;
  onRemoveTask: () => void;
  attachedPullRequest: AttachedPullRequest | null;
  /** Absent for a locked PR pill. */
  onRemovePullRequest?: () => void;
  pendingAttachments: ThreadComposerPendingAttachment[];
  onAttachmentsChange?: (files: (FileUIPart & { id: string })[]) => void;
  extraAttachmentPills?: ReactNode;
}) {
  const { files, remove } = usePromptInputAttachments();
  const lastNotifiedFilesSignatureRef = useRef<string | null>(null);

  const filesSignature = useMemo(
    () =>
      files
        .map((file) => [file.id, file.filename ?? "", file.mediaType ?? "", typeof file.url === "string" ? file.url : ""].join(":"))
        .join("|"),
    [files]
  );

  useEffect(() => {
    if (!onAttachmentsChange) {
      return;
    }

    if (lastNotifiedFilesSignatureRef.current === filesSignature) {
      return;
    }

    lastNotifiedFilesSignatureRef.current = filesSignature;
    onAttachmentsChange?.(files);
  }, [files, filesSignature, onAttachmentsChange]);

  const displayItems = useMemo(() => {
    const pendingByFilePartId = new Map(
      pendingAttachments
        .filter((pending) => typeof pending.filePartId === "string")
        .map((pending) => [pending.filePartId as string, pending] as const)
    );
    const unmatchedPending = pendingAttachments.filter((pending) => !pending.filePartId);
    // Each name-matched row backs one pill at most.
    const claimed = new Set<string>();

    return files.map((file) => {
      const byId = pendingByFilePartId.get(file.id);
      if (byId) {
        return { file, pending: byId };
      }

      const pending = unmatchedPending.find(
        (candidate) =>
          !claimed.has(candidate.id) &&
          candidate.fileName === file.filename &&
          (!file.mediaType || candidate.contentType === file.mediaType)
      );
      if (pending) claimed.add(pending.id);
      return { file, pending };
    });
  }, [files, pendingAttachments]);
  const maxVisibleFiles = attachedTask || attachedPullRequest ? 1 : 2;
  const visibleItems = displayItems.length > maxVisibleFiles ? displayItems.slice(0, maxVisibleFiles) : displayItems;
  const groupedItems = displayItems.length > maxVisibleFiles ? displayItems.slice(maxVisibleFiles) : [];
  const previewAttachments = useMemo(
    () =>
      displayItems.map(({ file, pending }) => ({
        id: file.id,
        fileName: file.filename ?? "attachment",
        contentType: pending?.contentType ?? file.mediaType ?? "application/octet-stream",
        url: typeof file.url === "string" ? file.url : null,
        fileSize: pending?.fileSize,
      })),
    [displayItems]
  );
  const handlePreviewDownload = useCallback(async (attachment: (typeof previewAttachments)[number]) => {
    if (!attachment.url) {
      return;
    }

    const success = await downloadFile(attachment.url, attachment.fileName);
    if (!success) {
      toast.error(`Download failed: ${attachment.fileName}`);
    }
  }, []);
  const { tryOpenPreview, lightboxProps } = useAttachmentPreview({
    attachments: previewAttachments,
    onDownload: handlePreviewDownload,
  });
  const handlePreview = useCallback(
    (item: AttachmentDisplayItem) => {
      const attachment = previewAttachments.find((candidate) => candidate.id === item.file.id);
      if (attachment) {
        tryOpenPreview(attachment);
      }
    },
    [previewAttachments, tryOpenPreview]
  );

  if (!attachedTask && !attachedPullRequest && files.length === 0 && !extraAttachmentPills) return null;

  return (
    <PromptInputHeader className="items-center gap-2 pt-3 pb-1">
      {extraAttachmentPills}
      {attachedTask ? (
        <TooltipExt
          content={`${attachedTask.refId} ${attachedTask.name}`}
          delayDuration={500}
        >
          <Pill
            // Locked pills have no trailing remove action; pr-1 would leave the
            // task name flush against the rounded edge.
            className={cn("max-w-[280px]", !isAttachedTaskRemovable && "pr-2")}
            style={{ borderColor: attachedTask.taskType.color }}
          >
            {onOpenTask ? (
              <PillContent asChild>
                <button
                  type="button"
                  onClick={() => onOpenTask(attachedTask)}
                  className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={`Open ${attachedTask.refId}`}
                >
                  <TaskRefWithType
                    refId={attachedTask.refId}
                    taskType={attachedTask.taskType}
                    refInteractive={false}
                    className="shrink-0 gap-1.5"
                    refClassName="shrink-0 font-medium text-foreground"
                    typeClassName="shrink-0"
                  />
                  <PillText className="text-muted-foreground">{attachedTask.name}</PillText>
                </button>
              </PillContent>
            ) : (
              <PillContent>
                <TaskRefWithType
                  refId={attachedTask.refId}
                  taskType={attachedTask.taskType}
                  refInteractive={false}
                  className="shrink-0 gap-1.5"
                  refClassName="shrink-0 font-medium text-foreground"
                  typeClassName="shrink-0"
                />
                <PillText className="text-muted-foreground">{attachedTask.name}</PillText>
              </PillContent>
            )}
            {isAttachedTaskRemovable ? <PillAction onClick={onRemoveTask} aria-label={`Remove ${attachedTask.refId}`} /> : null}
          </Pill>
        </TooltipExt>
      ) : null}
      {attachedPullRequest ? (
        <AttachedPullRequestPill pullRequest={attachedPullRequest} projectId={projectId} onRemove={onRemovePullRequest} />
      ) : null}
      {(attachedTask || attachedPullRequest) && displayItems.length > 0 ? (
        <div className="mx-2 flex h-7 items-center">
          <div aria-hidden="true" className="bg-border h-5 w-px" />
        </div>
      ) : null}
      {visibleItems.map((item) => (
        <AttachmentPill key={item.file.id} item={item} onPreview={handlePreview} onRemove={remove} />
      ))}
      {groupedItems.length > 0 ? (
        <MoreAttachmentsPill items={groupedItems} onPreview={handlePreview} onRemove={remove} />
      ) : null}
      <AttachmentLightbox {...lightboxProps} />
    </PromptInputHeader>
  );
}

function ThreadComposerSubmitControl({
  isSubmitting,
  submitDisabled,
  hasBlockingAttachmentState,
  hasAttachedTask,
  hasExtraQueuedContent,
  showStopWhenIdleInput,
  stopDisabled,
  onStop,
}: ThreadComposerSubmitControlProps) {
  const { attachments, textInput } = usePromptInputController();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasQueuedContent = textInput.value.trim().length > 0 || attachments.files.length > 0 || hasAttachedTask || hasExtraQueuedContent;
  const showStopAction = !isSubmitting && !!onStop && showStopWhenIdleInput && !hasQueuedContent;
  const canStop = showStopAction && !stopDisabled;

  const stop = useCallback(() => {
    if (!onStop) return;
    void Promise.resolve(onStop()).catch((error: unknown) => {
      console.error("[ThreadComposer] Stop handler failed", error);
    });
  }, [onStop]);

  // Escape anywhere in the composer stops the run while Stop is offered; menus
  // that consume Escape first (the suggestion list) mark it handled.
  useEffect(() => {
    const form = buttonRef.current?.closest("form");
    if (!canStop || !form) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      stop();
    };
    form.addEventListener("keydown", handleKeyDown);
    return () => form.removeEventListener("keydown", handleKeyDown);
  }, [canStop, stop]);

  return (
    <PromptInputSubmit
      ref={buttonRef}
      disabled={isSubmitting ? true : showStopAction ? stopDisabled : submitDisabled || hasBlockingAttachmentState || !hasQueuedContent}
      status={isSubmitting ? "submitted" : showStopAction ? "streaming" : undefined}
      onStop={showStopAction ? stop : undefined}
    />
  );
}

/**
 * Resolves a dropped task's label, then hands it back once. Mounted only while
 * a drop is pending: the subscription (and its Convex provider requirement)
 * must not exist just because a composer rendered.
 */
function DroppedTaskResolver({
  taskId,
  onResolved,
}: {
  taskId: Id<"tasks">;
  onResolved: (task: ThreadComposerAttachedTask) => void;
}) {
  const summaries = useQuery(api.tasks.core.getSummariesByIds, { taskIds: [taskId] });
  const resolved = summaries?.find((task) => task._id === taskId);

  useEffect(() => {
    if (resolved) {
      onResolved(resolved);
    }
  }, [onResolved, resolved]);

  return null;
}

type ThreadComposerContentProps = ThreadComposerProps & {
  attachedPullRequest: AttachedPullRequest | null;
  setAttachedPullRequest: (pullRequest: AttachedPullRequest | null) => void;
};

function ThreadComposerContent({
  projectId,
  organizationId,
  runtimeSlashCommands: advertisedRuntimeSlashCommands,
  onSubmit,
  textareaPlaceholder = THREAD_COMPOSER_PLACEHOLDER,
  selectorsProps,
  draftScopeKey = "default",
  initialInput = "",
  initialAttachments,
  seedKey,
  initialAttachedTask = null,
  isAttachedTaskRemovable = true,
  isAttachedPullRequestRemovable = true,
  attachedPullRequest,
  setAttachedPullRequest,
  onOpenAttachedTask,
  getTaskHref,
  onAttachedTaskChange,
  onTaskDrop,
  onInputChange,
  onComposerContentChange,
  onAttachmentsChange,
  pendingAttachments = [],
  onStop,
  showStopWhenIdleInput = false,
  isSubmitting = false,
  stopDisabled = false,
  focusRequestKey,
  autoFocus = false,
  textareaDisabled = false,
  submitDisabled = false,
  contextWindowUsage = null,
  showContextWindowMeter = false,
  costThreadId = null,
  costTaskId = null,
  usageLimits = [],
  goal,
  onClearGoal,
  onCompact,
  backgroundTasks,
  stopConfirmation,
  containerClassName,
  contentClassName,
  textareaClassName,
  initialComposerContent,
  controllerRef,
  hideAttachmentTools = false,
  hideSubmit = false,
  hideContextBar = false,
  onComposerDocumentChange,
  extraSelectorTools,
  extraSubmitActions,
  workflowSelector,
  extraAttachmentPills,
  readOnlyAgent,
  readOnlyWorkspace,
  pullRequests,
  planProgress,
}: ThreadComposerContentProps) {
  const runtimeSlashCommands = useMemo(
    () => getComposerRuntimeCommands(selectorsProps.cliType, advertisedRuntimeSlashCommands),
    [selectorsProps.cliType, advertisedRuntimeSlashCommands],
  );
  const hotkeyTargetRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mentionApiRef = useRef<PromptInputMentionApi | null>(null);
  const [attachedTask, setAttachedTask] = useState<ThreadComposerAttachedTask | null>(initialAttachedTask);
  const composerDocumentRef = useRef<ThreadComposerDocument>(createEmptyThreadComposerDocument());
  const handleComposerDocumentChange = useCallback(
    (document: ThreadComposerDocument) => {
      composerDocumentRef.current = document;
      onComposerDocumentChange?.(document);
    },
    [onComposerDocumentChange]
  );
  const controlsDisabled = isSubmitting || selectorsProps.disabled === true;
  const attachmentActionsDisabled = textareaDisabled || isSubmitting || selectorsProps.disabled === true;

  // A drag carries only ids, so the pill's label is resolved for the host
  // rather than pushed onto every one of them. Resolution lives in a child
  // mounted by the drop: composers without a Convex provider (the automation
  // prompt field) must not subscribe just by rendering.
  const [droppedTaskId, setDroppedTaskId] = useState<Id<"tasks"> | null>(null);
  const handleDroppedTaskResolved = useCallback(
    (task: ThreadComposerAttachedTask) => {
      // Cleared as it is applied, so dropping the same task again after
      // removing the pill re-attaches it instead of being a no-op.
      setDroppedTaskId(null);
      setAttachedTask(task);
      onAttachedTaskChange?.(task);
    },
    [onAttachedTaskChange]
  );

  const handleTaskDrop = useCallback(
    (task: { id: string; refId: string }) => {
      setDroppedTaskId(task.id as Id<"tasks">);
      onTaskDrop?.(task);
    },
    [onTaskDrop]
  );

  // Single composer layout on every surface (OS-1377): the context bar above the input owns the
  // working directory, workspace/base-ref, agent and right-aligned meters; the footer toolbar owns
  // the labeled CLI/model and mode selectors. Only content availability varies, never placement.
  const onBaseRefChange = selectorsProps.onBaseRefChange;
  const baseRefProfile = onBaseRefChange ? selectorsProps.profiles.find((profile) => profile._id === selectorsProps.profileId) : undefined;
  const showWorkspaceSelectors = Boolean(
    baseRefProfile?.paths.some((path) => path.id === selectorsProps.pathId && isWorktreeParent(baseRefProfile.paths, path) && path.gitRemoteUrl)
  );
  // A stored id with no active agents left (last agent deleted) must stay clearable.
  const showTopBarAgentSelector =
    Boolean(selectorsProps.onProjectAgentChange) &&
    ((selectorsProps.projectAgents?.length ?? 0) > 0 || selectorsProps.projectAgentId !== undefined);
  const selectedProfile = selectorsProps.profiles.find((profile) => profile._id === selectorsProps.profileId);
  const selectedPath = selectedProfile?.paths.find((path) => path.id === selectorsProps.pathId);
  const workspaceSummary = readOnlyWorkspace ?? (selectedPath ? {
    kind: selectedPath.kind === "worktree" ? "worktree" as const : "local" as const,
    branch: selectedPath.kind === "worktree" ? selectedPath.branch : undefined,
  } : undefined);
  const showWorkspaceSummary = !showWorkspaceSelectors && Boolean(workspaceSummary);
  const workspaceSummaryTooltip = !onBaseRefChange || selectedPath?.kind === "worktree"
    ? undefined
    : selectedProfile && folderRepos(selectedProfile.paths, selectedPath?.id).length > 0
      ? FOLDER_WORKTREE_TOOLTIP
      : !selectedPath?.gitRemoteUrl ? WORKTREE_UNAVAILABLE_TOOLTIP : undefined;
  const showReadOnlyAgent = Boolean(readOnlyAgent);
  const showTopBarWorkingDirectory = !selectorsProps.hideWorkingDirectory;
  const showMeters =
    showContextWindowMeter || Boolean(contextWindowUsage) || Boolean(costThreadId) || Boolean(costTaskId) || usageLimits.length > 0 || Boolean(backgroundTasks?.totalCount) || Boolean(stopConfirmation);
  const showTopBar =
    showTopBarWorkingDirectory ||
    showWorkspaceSelectors ||
    showWorkspaceSummary ||
    Boolean(pullRequests?.length) ||
    showTopBarAgentSelector ||
    showReadOnlyAgent ||
    Boolean(workflowSelector) ||
    showMeters;
  // @-file mentions search the selected working directory via the connected
  // CLI (OS-1144); disabled without a resolved profile + path.
  const fileMentionContext = useMemo<FileMentionContext | null>(() => {
    if (!selectedProfile || !selectedPath) {
      return null;
    }
    return {
      profileId: selectedProfile._id,
      pathId: selectedPath.id,
      isProfileOnline: selectedProfile.isOnline,
    };
  }, [selectedProfile, selectedPath]);

  useHotkey(
    PLAN_MODE_TOGGLE_SHORTCUT,
    (event) => {
      if (controlsDisabled) return;
      const nextMode = getPlanModeToggleTarget(selectorsProps.cliType, selectorsProps.mode);
      if (!nextMode) return;
      event.preventDefault();
      selectorsProps.onModeChange(nextMode);
    },
    {
      target: hotkeyTargetRef,
      enabled: !controlsDisabled,
      ignoreInputs: false,
    }
  );
  const hasBlockingAttachmentState = pendingAttachments.some(
    (attachment) => attachment.status === "uploading" || attachment.status === "error"
  );
  // Sending disables the editor, which drops its focus; hand it back if nothing
  // else took it meanwhile. Spec: docs/specs/cli-thread-drafts.md.
  const refocusAfterSendRef = useRef(false);
  useEffect(() => {
    if (isSubmitting || !refocusAfterSendRef.current) {
      return;
    }
    refocusAfterSendRef.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      mentionApiRef.current?.focus();
    }
  }, [isSubmitting]);
  const handleSubmit = async (message: { text: string; files: FileUIPart[] }) => {
    refocusAfterSendRef.current = containerRef.current?.contains(document.activeElement) ?? false;
    // Runtime command = whole message is "/name args" with a known agent
    // command and nothing attached; it is forwarded to the runtime raw.
    const runtimeCommand = message.files.length === 0 && isRuntimeCommandMessage(message.text, runtimeSlashCommands ?? []);
    await onSubmit({
      text: message.text,
      composerDocument: composerDocumentRef.current,
      files: message.files,
      taskId: attachedTask?._id,
      attachedTask,
      ...(attachedPullRequest ? { pullRequestUrl: attachedPullRequestUrl(attachedPullRequest) } : {}),
      ...(runtimeCommand ? { runtimeCommand } : {}),
    });
    composerDocumentRef.current = createEmptyThreadComposerDocument();
    setAttachedTask(null);
    if (isAttachedPullRequestRemovable) setAttachedPullRequest(null);
    onAttachedTaskChange?.(null);
  };

  const handleAutoSubmit = useCallback(() => {
    const submitButton = containerRef.current?.querySelector('button[type="submit"]');
    if (!(submitButton instanceof HTMLButtonElement) || submitButton.disabled) {
      return;
    }

    submitButton.form?.requestSubmit(submitButton);
  }, []);

  // Only steal focus when the key actually changes (an explicit focus request),
  // never on the initial mount. The composer mounts (hidden) whenever the task
  // sidebar opens; focusing on mount would yank focus out of whatever the user
  // was editing — e.g. the inline task-name input in the table.
  const lastFocusRequestKey = useRef(focusRequestKey);
  useEffect(() => {
    if (focusRequestKey === undefined) {
      return;
    }
    if (focusRequestKey === lastFocusRequestKey.current) {
      return;
    }
    lastFocusRequestKey.current = focusRequestKey;

    const input = containerRef.current?.querySelector('textarea[name="message"], [data-thread-composer-editor="true"]');
    if (!(input instanceof HTMLTextAreaElement) && !(input instanceof HTMLElement)) {
      return;
    }

    input.focus();
    if (input instanceof HTMLTextAreaElement) {
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }
  }, [focusRequestKey]);

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        hotkeyTargetRef.current = node;
      }}
      className={cn(
        // Conversations render full-screen on mobile (the global nav bar hides
        // there), so the composer only needs safe-area clearance.
        "shrink-0 px-4 pb-5 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        containerClassName
      )}
    >
      <div className={cn("mx-auto max-w-3xl", contentClassName)}>
        <PromptInputProvider key={draftScopeKey} initialInput={initialInput} initialFiles={initialAttachments}>
          {controllerRef ? <ThreadComposerControllerBridge controllerRef={controllerRef} mentionApiRef={mentionApiRef} /> : null}
          <ThreadComposerSeedSync seedKey={seedKey} seedText={initialInput} />
          <div className="flex flex-col">
            {showTopBar && !hideContextBar ? (
              // [contain:inline-size]: without it this non-wrapping row reports its full chip sum
              // as intrinsic width, and intrinsically sized ancestors grow past the viewport
              // instead of letting the chips shrink.
              // @container/composer-bar: below 2xl the environment, agent, and workflow pills collapse
              // to icons rather than truncating every label to noise.
              <div className="-mb-2 flex items-center gap-1 rounded-t-xl border border-b-0 border-border/70 bg-muted/50 px-2 pt-1 pb-3 @container/composer-bar [contain:inline-size]">
                {showTopBarWorkingDirectory && (
                  <WorkingDirectorySelector
                    profiles={selectorsProps.profiles}
                    profileId={selectorsProps.profileId}
                    pathId={selectorsProps.pathId}
                    onChange={selectorsProps.onPathChange ?? (() => {})}
                    disabled={controlsDisabled || selectorsProps.lockAgentContext === true}
                  />
                )}
                {showWorkspaceSelectors && baseRefProfile && onBaseRefChange && (
                  <WorkspaceSelectors
                    profileId={selectorsProps.profileId}
                    pathId={selectorsProps.pathId}
                    paths={baseRefProfile.paths}
                    isProfileOnline={baseRefProfile.isOnline}
                    value={selectorsProps.baseRef}
                    onChange={onBaseRefChange}
                    disabled={controlsDisabled}
                  />
                )}
                {showWorkspaceSummary && workspaceSummary ? (
                  <ThreadComposerWorkspaceSummary {...workspaceSummary} tooltip={workspaceSummaryTooltip} />
                ) : null}
                {pullRequests && pullRequests.length > 1 ? (
                  // One badge and +N below 2xl, so the meters keep their room (UX OS-2523 round 2).
                  <>
                    <span className="contents @2xl/composer-bar:hidden">
                      <ThreadPrBadges pullRequests={pullRequests} max={1} className="h-7 px-1 @sm/composer-bar:px-2" refClassName="hidden @sm/composer-bar:inline" />
                    </span>
                    <span className="hidden @2xl/composer-bar:contents">
                      <ThreadPrBadges pullRequests={pullRequests} className="h-7 px-2" />
                    </span>
                  </>
                ) : pullRequests ? (
                  <ThreadPrBadges pullRequests={pullRequests} className="h-7 px-2" />
                ) : null}
                <ThreadPlanProgress plan={planProgress ?? null} />
                {showTopBarAgentSelector && selectorsProps.onProjectAgentChange ? (
                  <ThreadAgentSelector
                    agents={selectorsProps.projectAgents ?? []}
                    value={selectorsProps.projectAgentId}
                    onChange={selectorsProps.onProjectAgentChange}
                    disabled={controlsDisabled}
                    locked={selectorsProps.projectAgentLocked}
                  />
                ) : null}
                {showReadOnlyAgent && readOnlyAgent ? (
                  <ThreadAgentChip
                    agent={readOnlyAgent}
                    className="max-w-40 px-2"
                  />
                ) : null}
                {workflowSelector}
                {showMeters ? (
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <BackgroundTasksPill snapshot={backgroundTasks} stopConfirmation={stopConfirmation} />
                    <UsageLimitPills usageLimits={usageLimits} />
                    {costTaskId || costThreadId ? (
                      <CostIndicator taskId={costTaskId ?? undefined} threadId={costThreadId ?? undefined} />
                    ) : null}
                    {showContextWindowMeter || contextWindowUsage ? (
                      <ContextWindowMeter
                        usage={contextWindowUsage}
                        onCompact={onCompact && isRuntimeCommandMessage("/compact", runtimeSlashCommands ?? []) ? onCompact : undefined}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <ThreadComposerTaskDropZone
              projectId={projectId ?? null}
              disabled={!isAttachedTaskRemovable}
              onDropTask={handleTaskDrop}
            >
              {droppedTaskId ? (
                <DroppedTaskResolver taskId={droppedTaskId} onResolved={handleDroppedTaskResolved} />
              ) : null}
              <PromptInput
                nameFile={dedupeAttachmentFileName}
                maxFiles={MAX_MESSAGE_ATTACHMENTS}
                maxFileSize={MAX_ATTACHMENT_SIZE}
                onError={({ message }) => toast.error(message)}
                as={hideSubmit ? "div" : "form"}
                className="[&>[data-slot=input-group]]:bg-thread-composer-input"
                onSubmit={handleSubmit}
                multiple
              >
                <AttachmentsDisplay
                  projectId={projectId}
                  attachedPullRequest={attachedPullRequest}
                  onRemovePullRequest={isAttachedPullRequestRemovable ? () => setAttachedPullRequest(null) : undefined}
                  attachedTask={attachedTask}
                  isAttachedTaskRemovable={isAttachedTaskRemovable}
                  onOpenTask={onOpenAttachedTask}
                  onRemoveTask={() => {
                    setAttachedTask(null);
                    onAttachedTaskChange?.(null);
                  }}
                  pendingAttachments={pendingAttachments}
                  onAttachmentsChange={onAttachmentsChange}
                  extraAttachmentPills={extraAttachmentPills}
                />
                <ThreadComposerTiptapInput
                  pendingAttachments={pendingAttachments}
                  projectId={projectId}
                  organizationId={organizationId}
                  runtimeSlashCommands={runtimeSlashCommands}
                  fileMention={fileMentionContext}
                  mentionApiRef={mentionApiRef}
                  textareaPlaceholder={textareaPlaceholder}
                  textareaDisabled={textareaDisabled}
                  autoFocus={autoFocus}
                  isSubmitting={isSubmitting}
                  textareaClassName={textareaClassName}
                  initialInput={initialInput}
                  initialComposerContent={initialComposerContent}
                  onInputChange={onInputChange}
                  onComposerContentChange={onComposerContentChange}
                  onComposerDocumentChange={handleComposerDocumentChange}
                  onAutoSubmit={hideSubmit ? undefined : handleAutoSubmit}
                />
                {/* [contain:inline-size]: same as the top bar, so long model labels truncate
                    instead of widening the host past the viewport (OS-2144). */}
                <PromptInputFooter className="[contain:inline-size]">
                  <PromptInputTools className="min-w-0">
                    {!hideAttachmentTools && (
                      <ThreadComposerAttachmentTools
                        projectId={projectId}
                        disabled={attachmentActionsDisabled}
                        attachTaskDisabled={!isAttachedTaskRemovable}
                        hotkeyTargetRef={hotkeyTargetRef}
                        onSelectTask={(task) => {
                          setAttachedTask(task);
                          onAttachedTaskChange?.(task);
                        }}
                        onSelectPullRequest={
                          isAttachedPullRequestRemovable && supportsAttachedPullRequest(selectedProfile?.appVersion)
                            ? setAttachedPullRequest
                            : undefined
                        }
                        getTaskHref={getTaskHref}
                      />
                    )}
                    {extraSelectorTools}
                    <ThreadContextSelectors
                      {...selectorsProps}
                      disabled={controlsDisabled}
                    />
                    <GoalButton
                      goal={goal}
                      onClear={onClearGoal && isRuntimeCommandMessage("/goal clear", runtimeSlashCommands ?? []) ? onClearGoal : undefined}
                    />
                  </PromptInputTools>
                  <div className="flex shrink-0 items-center gap-2">
                    {extraSubmitActions}
                    {!hideSubmit && (
                      <ThreadComposerSubmitControl
                        isSubmitting={isSubmitting}
                        submitDisabled={submitDisabled}
                        hasBlockingAttachmentState={hasBlockingAttachmentState}
                        hasAttachedTask={attachedTask !== null || attachedPullRequest !== null}
                        hasExtraQueuedContent={extraAttachmentPills != null}
                        showStopWhenIdleInput={showStopWhenIdleInput}
                        stopDisabled={stopDisabled}
                        onStop={onStop}
                      />
                    )}
                  </div>
                </PromptInputFooter>
              </PromptInput>
            </ThreadComposerTaskDropZone>
          </div>
        </PromptInputProvider>
      </div>
    </div>
  );
}

export function ThreadComposer(props: ThreadComposerProps) {
  const draftScopeKey = props.draftScopeKey ?? "default";
  const attachedTaskKey = props.initialAttachedTask?._id ?? "none";
  // The PR lives above the keyed content, so a task attachment's remount keeps it.
  // A new `initialAttachedPullRequest` from the host replaces it.
  const initialPullRequest = props.initialAttachedPullRequest ?? null;
  const [attachedPullRequest, setAttachedPullRequest] = useState(initialPullRequest);
  const [initialPullRequestRef, setInitialPullRequestRef] = useState(initialPullRequest?.ref);
  if (initialPullRequest?.ref !== initialPullRequestRef) {
    setInitialPullRequestRef(initialPullRequest?.ref);
    setAttachedPullRequest(initialPullRequest);
  }

  return (
    <ThreadComposerContent
      key={`${draftScopeKey}:${attachedTaskKey}`}
      {...props}
      draftScopeKey={draftScopeKey}
      attachedPullRequest={attachedPullRequest}
      setAttachedPullRequest={setAttachedPullRequest}
    />
  );
}
