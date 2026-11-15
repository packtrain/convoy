"use client";

import {
  CornerDownRight,
  ListEnd,
  Paperclip,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import { SlashCommandDisplayText } from "@/lib/slash-commands/display";
import { cn } from "@/lib/utils";

export interface QueuedStripMessage {
  _id: Id<"cliMessages">;
  text: string;
  steerRequested: boolean;
  /** Runtime slash commands are never steerable (they wait for their own run). */
  runtimeCommand?: boolean;
  /** Delivered before the rest of the queue (OS-2339), so it leads the strip. */
  queueFirst?: boolean;
  /** File names of the message's attachments — fallback label + count badge (OS-1877). */
  attachmentFileNames?: string[];
}

interface QueuedMessagesStripProps {
  messages: QueuedStripMessage[];
  canSteer: boolean;
  onSteer: (messageId: Id<"cliMessages">) => Promise<void> | void;
  /** Remove the queued message and restore its text into the composer. */
  onEdit: (messageId: Id<"cliMessages">) => Promise<void> | void;
  /** Remove the queued message without sending it. */
  onDelete: (messageId: Id<"cliMessages">) => Promise<void> | void;
  /** When set, Edit is disabled and this explains why (shown as a tooltip). */
  editDisabledReason?: string;
  /** Held queue (OS-1374): the first row's Steer slot becomes "Send now", releasing the queue as-is. */
  onSendNow?: () => void;
  className?: string;
}

/**
 * Messages queued behind a streaming run or held by Stop, docked above the composer as one
 * bordered list (OS-2153) so Steer stays stationary while the stream scrolls. Queued
 * messages are hidden from the message list while this shows them.
 */
export function QueuedMessagesStrip({
  messages,
  canSteer,
  onSteer,
  onEdit,
  onDelete,
  editDisabledReason,
  onSendNow,
  className,
}: QueuedMessagesStripProps) {
  if (messages.length === 0) {
    return null;
  }
  // Same order the CLI is handed (cliMessagesRepo.listUnprocessedUserMessages).
  const ordered = [...messages.filter((message) => message.queueFirst), ...messages.filter((message) => !message.queueFirst)];

  return (
    <div className={cn("min-w-0 max-w-full", className)}>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {ordered.map((message, index) => {
          const fileNames = message.attachmentFileNames ?? [];
          return (
          <li
            key={message._id}
            className="flex min-w-0 max-w-full items-center gap-2 px-3 py-1.5"
          >
            <ListEnd className="size-4 shrink-0 text-muted-foreground" />
            {message.text !== "" && fileNames.length > 0 && (
              <span
                className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground"
                title={fileNames.join(", ")}
              >
                <Paperclip className="size-3.5" />
                {fileNames.length}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm">
              {message.text === "" && fileNames.length > 0 ? (
                <span
                  className="italic text-muted-foreground"
                  title={fileNames.join(", ")}
                >
                  {fileNames.length === 1
                    ? fileNames[0]
                    : `${fileNames.length} attachments`}
                </span>
              ) : (
                <SlashCommandDisplayText text={message.text} />
              )}
            </span>
            {message.steerRequested ? (
              <Spinner
                className="text-xs text-muted-foreground"
                text="Steering…"
                textClassName="text-current"
                textPlacement="inline"
              />
            ) : (
              <>
                {onSendNow && index === 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    title="Send the held messages now"
                    onClick={onSendNow}
                  >
                    <Send className="mr-1 size-3.5" />
                    Send now
                  </Button>
                )}
                {canSteer && message.runtimeCommand !== true && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={() => void onSteer(message._id)}
                  >
                    <CornerDownRight className="mr-1 size-3.5" />
                    Steer
                  </Button>
                )}
                <span
                  title={editDisabledReason ?? "Edit: move back into the composer"}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    aria-label="Edit queued message"
                    disabled={editDisabledReason !== undefined}
                    onClick={() => void onEdit(message._id)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="cursor-pointer text-muted-foreground hover:text-destructive"
                  aria-label="Delete queued message"
                  title="Delete: remove without sending"
                  onClick={() => void onDelete(message._id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
