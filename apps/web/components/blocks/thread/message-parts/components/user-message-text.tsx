import { SlashCommandDisplayText } from "@/lib/slash-commands/display";

import { SentMessageText } from "@/components/blocks/thread/sent-attachment-references";
import type { ThreadMessageAttachment } from "@/components/blocks/thread/response-attachments";

interface UserMessageTextProps {
  text: string;
  messageId?: string;
  attachments?: ThreadMessageAttachment[];
}

export function UserMessageText({ text, messageId, attachments }: UserMessageTextProps) {
  if (messageId && attachments?.length) {
    return <SentMessageText key={messageId} text={text} messageId={messageId} attachments={attachments} />;
  }
  return (
    <span className="whitespace-pre-wrap wrap-anywhere">
      <SlashCommandDisplayText text={text} />
    </span>
  );
}
