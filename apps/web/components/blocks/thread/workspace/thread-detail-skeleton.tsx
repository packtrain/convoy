"use client";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { Skeleton } from "@/components/ui/skeleton";

export function ThreadDetailSkeleton() {
  return (
    // Held invisible for the first 200ms (`fill-mode-backwards` applies the
    // faded-out start state during the delay): a thread that resolves inside
    // that window never flashes a skeleton, it just stays blank for a beat.
    <main
      data-testid="thread-detail-skeleton"
      className="grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden animate-in fade-in delay-200 fill-mode-backwards"
    >
      <header className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <Skeleton className="h-5 w-40" />
      </header>
      <ThreadTranscriptSkeleton />
    </main>
  );
}

/**
 * The transcript + composer placeholders on their own: a group tab switch
 * keeps the workspace mounted and only this part reloads (OS-1558).
 */
export function ThreadTranscriptSkeleton() {
  return (
    <>
      <Conversation
        data-testid="thread-transcript-skeleton"
        className="min-h-0 flex-1"
      >
        <ConversationContent className="mx-auto max-w-3xl px-4 py-6">
          <div className="ml-auto flex w-full max-w-[95%] flex-col gap-2">
            <Skeleton className="ml-auto h-10 w-48 rounded-lg" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
          <div className="flex w-full max-w-[95%] flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="ml-auto flex w-full max-w-[95%] flex-col gap-2">
            <Skeleton className="ml-auto h-10 w-64 rounded-lg" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
          <div className="flex w-full max-w-[95%] flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </ConversationContent>
      </Conversation>
      {/* The composer row: without it the input collapses while loading and
          the whole page reads as a reload. */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </>
  );
}
