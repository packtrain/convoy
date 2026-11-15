"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Spinner } from "@/components/custom/spinner";
import {
  buildComposerJsonFromPromptContent,
  buildSkillComposerItems,
  buildSlashCommandMarkdownLink,
  SLASH_COMMAND_MARKDOWN_LINK_PATTERN,
  type ThreadComposerCommandRef,
} from "@/lib/slash-commands/composer";
import { toast } from "sonner";
import { ThreadComposer } from "../thread-composer";
import { ThreadAttachmentPill } from "../thread-attachment-pill";
import { Button } from "@/components/ui/button";
import { getFileIcon } from "@/lib/tasks/files";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import type { EditCliMessageOptions, UseCliMessagesResult } from "@/lib/threads/hooks/use-cli-messages";
import { getErrorMessage } from "@/lib/errors";

type ComposerProps = ComponentProps<typeof ThreadComposer>;

interface EditLastMessageProps {
  message: UseCliMessagesResult["envelopes"][number];
  initialText: string;
  context: Pick<ComposerProps,
    | "projectId" | "organizationId" | "runtimeSlashCommands" | "selectorsProps"
    | "readOnlyAgent" | "readOnlyWorkspace" | "getTaskHref" | "onOpenAttachedTask"
  >;
  onCancel: () => void;
  onSubmit: (content: string, options: EditCliMessageOptions) => Promise<void>;
}

export function EditLastMessage(props: EditLastMessageProps) {
  const links = [...props.initialText.matchAll(SLASH_COMMAND_MARKDOWN_LINK_PATTERN)];
  const { organizationId, projectId } = props.context;
  const commands = useQuery(api.slashCommands.core.listComposerCatalog,
    links.length > 0 && organizationId ? { organizationId, projectId } : "skip");
  const skills = useQuery(api.skills.core.listByProject,
    links.length > 0 && projectId ? { projectId } : "skip");
  if (links.length > 0 && ((organizationId && commands === undefined) || (projectId && skills === undefined))) {
    return <Spinner />;
  }
  const catalog: ThreadComposerCommandRef[] = [
    ...(commands ?? []).map(({ id, scope, key, canonicalKey, displayLabel }) => ({ type: "slash-command" as const, id, scope, key, canonicalKey, displayLabel })),
    ...buildSkillComposerItems(skills ?? []).map(({ id, scope, key, canonicalKey, displayLabel }) => ({ type: "skill" as const, id, scope, key, canonicalKey, displayLabel })),
  ];
  const refs = links.flatMap((link) => {
    const ref = catalog.find((item) => buildSlashCommandMarkdownLink(item) === link[0]);
    return ref ? [ref] : [];
  });
  return <EditLastMessageForm {...props} initialContent={buildComposerJsonFromPromptContent(props.initialText, refs)} />;
}

function EditLastMessageForm({ message, initialText, context, onCancel, onSubmit, initialContent }: EditLastMessageProps & {
  initialContent: ReturnType<typeof buildComposerJsonFromPromptContent>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      hostRef.current?.querySelector<HTMLElement>('[data-thread-composer-editor="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const [mode, setMode] = useState(message.cliMode);
  const [model, setModel] = useState(message.cliModel);
  const [effort, setEffort] = useState(message.cliEffort);
  const [retained, setRetained] = useState(message.attachments);
  const [saving, setSaving] = useState(false);
  const uploads = useThreadMessageAttachmentUpload(context.projectId);
  const isMobile = useIsMobile();

  return (
    <div
      ref={hostRef}
      className="w-full"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !saving) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <ThreadComposer
        hideContextBar
        projectId={context.projectId}
        organizationId={context.organizationId}
        runtimeSlashCommands={context.runtimeSlashCommands}
        readOnlyAgent={context.readOnlyAgent}
        readOnlyWorkspace={context.readOnlyWorkspace}
        getTaskHref={context.getTaskHref}
        onOpenAttachedTask={context.onOpenAttachedTask}
        initialInput={initialText}
        initialComposerContent={initialContent}
        initialAttachedTask={message.task}
        initialAttachedPullRequest={message.pullRequest}
        textareaPlaceholder="Edit message..."
        textareaDisabled={saving}
        isSubmitting={saving}
        submitDisabled={saving}
        pendingAttachments={uploads.pendingAttachments}
        onAttachmentsChange={(files) => {
          void uploads.syncFileParts(files).catch((error: unknown) => {
            toast.error(getErrorMessage(error, "Failed to process attachments"));
          });
        }}
        extraAttachmentPills={retained.length > 0 ? retained.map((attachment) => (
          <ThreadAttachmentPill
            key={attachment.storageId}
            fileName={attachment.fileName}
            icon={getFileIcon(attachment.contentType)}
            onRemove={saving ? undefined : () => setRetained((previous) => previous.filter((item) => item.storageId !== attachment.storageId))}
          />
        )) : undefined}
        extraSubmitActions={
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        }
        selectorsProps={{
          ...context.selectorsProps,
          mode,
          cliModel: model,
          cliEffort: effort,
          disabled: saving,
          onModeChange: setMode,
          onCliModelChange: (value) => {
            setModel(value);
            setEffort(undefined);
          },
          onCliEffortChange: setEffort,
          lockAgentContext: true,
          // Icon-only on mobile so Cancel and Send fit the bubble (OS-2151).
          compact: isMobile,
        }}
        onSubmit={async (draft) => {
          setSaving(true);
          try {
            const added = await uploads.prepareAttachmentsForSubmit();
            await onSubmit(draft.text, {
              composerDocument: draft.composerDocument,
              cliMode: mode ?? null,
              cliModel: model ?? null,
              cliEffort: effort ?? null,
              taskId: draft.taskId ?? null,
              pullRequestUrl: draft.pullRequestUrl ?? null,
              runtimeCommand: retained.length === 0 && draft.runtimeCommand === true,
              attachments: [
                ...retained.map(({ storageId, fileName, fileSize, contentType, dimensions }) => ({
                  storageId, fileName, fileSize, contentType, dimensions,
                })),
                ...added,
              ],
            });
            uploads.clearAfterSubmit();
          } catch (error) {
            toast.error(getErrorMessage(error, "Failed to edit message"));
            throw error;
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
