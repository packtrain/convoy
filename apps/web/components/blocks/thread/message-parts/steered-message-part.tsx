"use client";

import { useMemo } from "react";
import type { RuntimeNoticePart as RuntimeNoticePartModel } from "@/lib/cli-stream-ui";
import { ResponseAttachments, type ThreadMessageAttachment } from "@/components/blocks/thread/response-attachments";
import { UserMessageText } from "./components/user-message-text";

interface SteeredMessagePartProps {
  part: RuntimeNoticePartModel;
  /** Resolves the steered user message's attachments (fresh signed URLs). */
  getUserMessageAttachments?: (
    messageId: string
  ) => ThreadMessageAttachment[] | undefined;
}

function parseSteeredMessageId(detailsJson: string | undefined): string | null {
  if (!detailsJson) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(detailsJson);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { messageId?: unknown }).messageId === "string"
    ) {
      return (parsed as { messageId: string }).messageId;
    }
  } catch {
    // Legacy markers have no details payload.
  }
  return null;
}

/**
 * A user message steered into the active run, rendered as a user-style bubble inline
 * in the assistant stream at its injection position. The standalone user bubble is hidden
 * once `steeredAt` is set, so this part is its visible representation — attachments
 * included (metadata from the hidden envelope; rendered like a reply's files).
 */
export function SteeredMessagePart({
  part,
  getUserMessageAttachments,
}: SteeredMessagePartProps) {
  const messageId = useMemo(
    () => parseSteeredMessageId(part.detailsJson),
    [part.detailsJson]
  );
  const attachments =
    (messageId ? getUserMessageAttachments?.(messageId) : undefined) ?? [];

  return (
    <div className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-2">
      {messageId && attachments.length > 0 && (
        <ResponseAttachments
          messageId={messageId}
          attachments={attachments}
          className="items-end"
        />
      )}
      {part.message.length > 0 && (
        <div className="w-fit rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
          <UserMessageText text={part.message} messageId={messageId ?? undefined} attachments={attachments} />
        </div>
      )}
    </div>
  );
}
