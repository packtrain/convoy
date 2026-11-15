"use client";

import type { CSSProperties } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleDashed,
  FileText,
} from "lucide-react";
import {
  InvitationStateCard,
  type InvitationDisplayState,
  type InvitationStateCardInvitation,
} from "@/components/blocks/auth/invitation-state-card";
import { EmptyMessage } from "@/components/custom/empty-state";
import { Spinner } from "@/components/custom/spinner";
import { Centered } from "@/components/custom/centered";
import { LogoText } from "@/components/custom/logo/logo-text";
import { Button } from "@/components/ui/button";
import { PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { ContextWindowMeter } from "@/components/blocks/thread/context-window-meter";
import { ThreadAttachmentPill } from "@/components/blocks/thread/thread-attachment-pill";
import { ToolLoadingIndicator } from "@/components/blocks/thread/message-parts/components/tool-loading-indicator";
import { ToolSurface } from "@/components/blocks/thread/message-parts/components/tool-surface";
import { CollapsibleToolPart } from "@/components/blocks/thread/message-parts/components/collapsible-tool-part";
import { ConvoyTaskWriterPart } from "@/components/blocks/thread/message-parts/convoy-task-writer-part";
import { TaskDetailLinks } from "@/components/blocks/tasks/task-detail-sidebar/task-detail-links";
import { ThreadListNewThreadLink } from "@/components/blocks/thread/thread-list-new-thread-link";
import { ThreadsLoadMoreButton } from "@/components/blocks/thread/threads-load-more-button";
import {
  Pill,
  PillAction,
  PillContent,
  PillIcon,
  PillText,
} from "@/components/ui/pill";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConvoyTaskWriterPayload } from "@/lib/ai-tools/convoy-task-writer-tool";
import type { ContextWindowUsage } from "@/lib/cli-stream-ui";
import type { TaskExternalLink } from "@/lib/tasks/external-links";
import { cn } from "@/lib/utils";

const sampleInvitation: InvitationStateCardInvitation = {
  email: "teammate@example.com",
  inviterName: "Alex Morgan",
  organizationName: "Northstar Product",
  role: "member",
};

const lightThemeStyle = {
  "--background": "oklch(1 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--card": "oklch(1 0 0)",
  "--card-foreground": "oklch(0.145 0 0)",
  "--primary": "oklch(0.205 0 0)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--border": "oklch(0.922 0 0)",
  "--muted": "oklch(0.97 0 0)",
  "--muted-foreground": "oklch(0.556 0 0)",
  "--ring": "oklch(0.708 0 0)",
} as CSSProperties;

const darkThemeStyle = {
  "--background": "oklch(0.185 0 0)",
  "--foreground": "oklch(0.93 0 0)",
  "--card": "oklch(0.21 0 0)",
  "--card-foreground": "oklch(0.93 0 0)",
  "--primary": "oklch(0.85 0 0)",
  "--primary-foreground": "oklch(0.205 0 0)",
  "--border": "oklch(1 0 0 / 12%)",
  "--muted": "oklch(0.25 0 0)",
  "--muted-foreground": "oklch(0.65 0 0)",
  "--ring": "oklch(0.556 0 0)",
} as CSSProperties;

const states: Array<{
  displayState: InvitationDisplayState;
  title: string;
  invitation?: InvitationStateCardInvitation;
}> = [
  {
    displayState: "loading",
    title: "Loading",
  },
  {
    displayState: "not-authenticated",
    title: "Not authenticated",
    invitation: sampleInvitation,
  },
  {
    displayState: "accepting",
    title: "Accepting",
  },
  {
    displayState: "success",
    title: "Success",
    invitation: sampleInvitation,
  },
  {
    displayState: "unauthorized",
    title: "Unauthorized",
  },
  {
    displayState: "expired",
    title: "Expired",
  },
  {
    displayState: "revoked",
    title: "Revoked",
  },
  {
    displayState: "already-accepted",
    title: "Already accepted",
  },
  {
    displayState: "invalid",
    title: "Invalid",
  },
  {
    displayState: "error",
    title: "Error",
  },
];

const threadSkeletonKeys = [
  "thread-skeleton-1",
  "thread-skeleton-2",
  "thread-skeleton-3",
  "thread-skeleton-4",
  "thread-skeleton-5",
] as const;

const playgroundThreads = [
  {
    _id: "thread_1",
    title: "Investigate agent streaming delay",
    status: "streaming",
    cliType: "codex",
    hasUnread: true,
    lastActivityLabel: "2m ago",
  },
  {
    _id: "thread_2",
    title: "Refactor invitation acceptance state",
    status: "completed",
    cliType: "claude",
    hasUnread: false,
    lastActivityLabel: "18m ago",
  },
  {
    _id: "thread_3",
    title: "Audit task sidebar attachments",
    status: "failed",
    cliType: "codex",
    hasUnread: false,
    lastActivityLabel: "1h ago",
  },
  {
    _id: "thread_4",
    title: "Onboarding copy pass",
    status: "completed",
    cliType: "claude",
    hasUnread: false,
    lastActivityLabel: "Yesterday",
  },
] as const;

function noop() {
  return undefined;
}

function PlaygroundLogoTextSamples() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2">
        <div className="text-sm font-medium">Current theme</div>
        <div className="flex min-h-24 items-center rounded-lg border border-border bg-background p-5 text-foreground">
          <LogoText className="h-10 w-auto max-w-full" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Forced light theme</div>
        <div
          className="flex min-h-24 items-center rounded-lg border border-border bg-background p-5 text-foreground"
          style={lightThemeStyle}
        >
          <LogoText className="h-10 w-auto max-w-full" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Forced dark theme</div>
        <div
          className="flex min-h-24 items-center rounded-lg border border-border bg-background p-5 text-foreground"
          style={darkThemeStyle}
        >
          <LogoText className="h-10 w-auto max-w-full" />
        </div>
      </div>
    </div>
  );
}

const contextWindowTiers: Array<{ label: string; usedTokens: number }> = [
  { label: "Empty (no usage yet)", usedTokens: 0 },
  { label: "80k · muted", usedTokens: 80_000 },
  { label: "150k · muted (boundary)", usedTokens: 150_000 },
  { label: "151k · amber", usedTokens: 151_000 },
  { label: "300k · amber (boundary)", usedTokens: 300_000 },
  { label: "301k · red", usedTokens: 301_000 },
  { label: "900k · red", usedTokens: 900_000 },
];

function contextWindowSample(usedTokens: number): ContextWindowUsage | null {
  if (usedTokens <= 0) {
    return null;
  }
  const maxTokens = 1_000_000;
  const usedPercentage = Math.min(100, (usedTokens / maxTokens) * 100);

  return {
    usedTokens,
    maxTokens,
    remainingTokens: Math.max(0, maxTokens - usedTokens),
    usedPercentage,
    remainingPercentage: Math.max(0, 100 - usedPercentage),
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
  };
}

function PlaygroundContextWindowMeters() {
  return (
    <div className="flex flex-wrap items-end gap-5">
      {contextWindowTiers.map((tier) => (
        <div key={tier.label} className="space-y-2">
          <div className="text-xs text-muted-foreground">{tier.label}</div>
          <ContextWindowMeter usage={contextWindowSample(tier.usedTokens)} />
        </div>
      ))}
    </div>
  );
}

const taskLinkFixtures: TaskExternalLink[] = [
  {
    id: "commit-83f69e1",
    kind: "commit",
    sha: "83f69e1c0ffee1234567890abcdef1234567890a",
    title: "docs(specs): rescope thread groups to tabs design (OS-1364)",
    url: "https://github.com/acme/convoy/commit/83f69e1",
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  },
  {
    id: "branch-os-1769",
    kind: "branch",
    name: "feat/os-1769-inline-link-preview",
    url: "https://github.com/acme/convoy/tree/feat/os-1769-inline-link-preview",
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  },
  {
    id: "pr-482",
    kind: "pull_request",
    url: "https://github.com/acme/convoy/pull/482",
    title: "Inline the task link tool-call preview",
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  },
  {
    id: "url-figma",
    kind: "url",
    url: "https://figma.com/file/abc/thread-tool-parts",
    title: "Figma: thread tool parts",
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  },
];

function taskLinkWrite(link: TaskExternalLink): ConvoyTaskWriterPayload {
  return {
    kind: "update_task_link",
    server: "convoy",
    toolCallId: `call_${link.id}`,
    state: "output-available",
    action: "Updated link on",
    refId: "OS-1769",
    link,
  };
}

/** Every family's row carries its state in the leading icon (OS-1769). */
function PlaygroundToolRowStates() {
  return (
    <div className="flex flex-col gap-2">
      <CollapsibleToolPart
        icon={FileText}
        title="Read src/app/page.tsx"
        state="output-available"
      >
        <ToolSurface className="text-sm text-muted-foreground">
          File contents…
        </ToolSurface>
      </CollapsibleToolPart>
      <CollapsibleToolPart
        icon={FileText}
        title="Read src/app/page.tsx"
        state="input-available"
        hasBody={false}
      />
      <CollapsibleToolPart
        icon={FileText}
        title="Read src/app/missing.tsx"
        state="output-error"
        errorText="ENOENT: no such file or directory"
        hasBody={false}
      />
    </div>
  );
}

/** Link writes render inline on the row, not in a box under it (OS-1769). */
function PlaygroundTaskLinkWriterRows() {
  return (
    <div className="flex flex-col gap-2">
      {taskLinkFixtures.map((link) => (
        <ConvoyTaskWriterPart key={link.id} payload={taskLinkWrite(link)} />
      ))}
      <ConvoyTaskWriterPart
        payload={{
          kind: "update_task_link",
          server: "convoy",
          toolCallId: "call_delete",
          state: "output-available",
          action: "Removed link from",
          refId: "OS-1769",
        }}
      />
      {/* An update's changed fields are inline too — no box under the row. */}
      <ConvoyTaskWriterPart
        payload={{
          kind: "update_task",
          server: "convoy",
          toolCallId: "call_update",
          state: "output-available",
          action: "Updated",
          refId: "OS-1805",
          detail: "→ In Progress",
          status: "In Progress",
          priority: "High",
          changes: ["Description updated", "Tags: soc2"],
        }}
      />
      <ConvoyTaskWriterPart
        payload={{
          ...taskLinkWrite(taskLinkFixtures[0]),
          state: "input-available",
          action: "Update link on",
        }}
      />
      <ConvoyTaskWriterPart
        payload={{
          ...taskLinkWrite(taskLinkFixtures[2]),
          state: "output-error",
          action: "Update link on",
          errorText: "Link limit reached (20 per task)",
        }}
      />
    </div>
  );
}

function PromptSubmitStates() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="space-y-2">
        <div className="text-sm font-medium">Ready</div>
        <PromptInputSubmit />
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Submitted</div>
        <PromptInputSubmit status="submitted" />
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Streaming</div>
        <PromptInputSubmit status="streaming" onStop={noop} />
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Error</div>
        <PromptInputSubmit status="error" />
      </div>
    </div>
  );
}

function PlaygroundCenteredInlineLoader() {
  return (
    <div className="h-28 rounded-lg border border-border bg-background">
      <Centered>
        <Spinner
          className="text-muted-foreground"
          text="Loading..."
          textClassName="text-current"
          textPlacement="inline"
        />
      </Centered>
    </div>
  );
}

function PlaygroundStreamingLoader() {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <Spinner
        className="text-sm text-muted-foreground"
        shimmer
        text="Streaming..."
        textClassName="text-current"
        textPlacement="inline"
      />
    </div>
  );
}

function PlaygroundAttachmentPillLoading() {
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-background p-4">
      <ThreadAttachmentPill
        fileName="design-reference.png"
        icon={FileText}
        onRemove={noop}
        state="loading"
      />
      <ThreadAttachmentPill
        fileName="research-notes.pdf"
        icon={FileText}
        onClick={noop}
        state="loading"
        tooltipContent="research-notes.pdf (428 KB)"
      />
    </div>
  );
}

function PlaygroundComposerAttachmentOverflow() {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
      <button
        type="button"
        aria-label="3 attachments"
        className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Pill className="max-w-[240px]">
          <PillContent>
            <PillIcon>
              <Spinner className="size-4 text-muted-foreground" />
            </PillIcon>
            <PillText>3 attachments</PillText>
            <ChevronDown className="size-3 text-muted-foreground" />
          </PillContent>
        </Pill>
      </button>
      <div className="flex items-center gap-2 rounded-md px-1 py-0.5">
        <Spinner className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">
          product-wireframe.png
        </span>
      </div>
    </div>
  );
}

function PlaygroundCommentAttachmentLoading() {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
      <Pill size="compact" className="max-w-[160px]">
        <PillContent className="gap-1">
          <PillIcon>
            <Spinner className="size-3 text-muted-foreground" />
          </PillIcon>
          <PillText>brief.pdf</PillText>
        </PillContent>
        <PillAction onClick={noop} aria-label="Remove brief.pdf" />
      </Pill>
      <button
        type="button"
        aria-label="Send comment"
        disabled
        className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Spinner className="size-5" />
      </button>
    </div>
  );
}

function PlaygroundToolLoadingIndicators() {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-background p-4 lg:grid-cols-2">
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          Search tool pending
        </div>
        <ToolSurface className="text-sm text-muted-foreground">
          <ToolLoadingIndicator label="Searching files..." />
        </ToolSurface>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          File read pending
        </div>
        <ToolSurface className="text-sm text-muted-foreground">
          <ToolLoadingIndicator label="Reading..." />
        </ToolSurface>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          File write pending
        </div>
        <ToolSurface className="text-sm text-muted-foreground">
          <ToolLoadingIndicator label="Writing..." />
        </ToolSurface>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          File edit pending
        </div>
        <ToolSurface className="text-sm text-muted-foreground">
          <ToolLoadingIndicator label="Editing..." />
        </ToolSurface>
      </div>
      <div className="space-y-2 lg:col-span-2">
        <div className="text-xs font-medium text-muted-foreground">
          Terminal running
        </div>
        <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-xs leading-5 text-zinc-300">
          <code>
            <span className="text-green-600">$</span>{" "}
            <span>pnpm test</span>
          </code>
          {"\n"}
          <ToolLoadingIndicator
            className="text-zinc-500"
            label="Running..."
            loaderClassName="size-3"
            textClassName="text-current text-xs"
          />
        </pre>
      </div>
    </div>
  );
}

function PlaygroundTaskStatusVisuals() {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-background p-4 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner className="size-3.5" />
        <span>Task in progress</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <CircleDashed className="size-3.5 text-blue-500" />
        <span>Task started</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-emerald-500" />
        <span>Task completed</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <CircleAlert className="size-3.5 text-destructive" />
        <span>Task failed</span>
      </div>
    </div>
  );
}

function PlaygroundExecutePlanButton() {
  return (
    <div className="flex justify-center rounded-lg border border-border bg-background p-4">
      <Button
        type="button"
        size="sm"
        shape="pill"
        disabled
        className="px-6"
      >
        <Spinner className="size-4" />
        Execute plan
      </Button>
    </div>
  );
}

function PlaygroundListLoadingStates() {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
      <div className="flex items-center justify-center border-b border-border pb-4">
        <Spinner
          text="Loading more..."
          textPlacement="inline"
          className="text-muted-foreground"
          textClassName="text-current"
        />
      </div>
      <div className="flex items-center justify-center p-4">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
      <Button variant="ghost" size="sm" disabled className="w-full">
        <Spinner
          text="Loading..."
          textPlacement="inline"
          className="text-muted-foreground"
          textClassName="text-current"
        />
      </Button>
    </div>
  );
}

function PlaygroundThreadListSkeleton({
  compactLayout,
}: {
  compactLayout: boolean;
}) {
  return (
    <>
      {threadSkeletonKeys.map((key) => (
        <div key={key} className="border-b border-border px-3 py-2.5">
          {compactLayout ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1 rounded-sm" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4 rounded-sm" />
              <Skeleton className="h-3 w-1/3 rounded-sm" />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function PlaygroundThreadListItem({
  chat,
  isActive,
}: {
  chat: (typeof playgroundThreads)[number];
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative border-b border-border bg-card transition-colors hover:bg-muted",
        isActive && "bg-muted"
      )}
    >
      <div className="relative z-10 flex gap-2 p-2 pb-3.5">
        <span className="mt-2.5">
          {chat.status === "streaming" ? (
            <Spinner className="size-3" />
          ) : (
            <Circle
              className={cn(
                "size-2.5",
                chat.hasUnread
                  ? "fill-blue-500 text-blue-500"
                  : "fill-muted-foreground/30 text-muted-foreground/30",
                chat.status === "failed" && "fill-destructive text-destructive"
              )}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <h4
              className="min-w-0 truncate text-sm font-medium leading-5 text-foreground"
              title={chat.title}
            >
              {chat.title}
            </h4>
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground/70">
              {chat.cliType}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground/70">
              {chat.lastActivityLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaygroundThreadSidebarList({
  hasMore = true,
  isLoading = false,
  isLoadingMore = false,
  threads = playgroundThreads,
}: {
  hasMore?: boolean;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  threads?: typeof playgroundThreads | [];
}) {
  const compactLayout = false;
  const organizationSlug = "northstar";
  const projectAlias = "WEB";
  const currentThreadId = threads[0]?._id;

  return (
    <div className="flex h-[420px] min-h-0 w-full max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-card">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {isLoading ? (
            <PlaygroundThreadListSkeleton compactLayout={compactLayout} />
          ) : (
            <>
              <ThreadListNewThreadLink
                organizationSlug={organizationSlug}
                projectAlias={projectAlias}
              />
              {threads.map((chat) => (
                <PlaygroundThreadListItem
                  key={chat._id}
                  chat={chat}
                  isActive={chat._id === currentThreadId}
                />
              ))}
              {threads.length === 0 && (
                <EmptyMessage>No threads yet</EmptyMessage>
              )}
              {hasMore && (
                <ThreadsLoadMoreButton
                  isLoadingMore={isLoadingMore}
                  onClick={noop}
                />
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function ComponentPlaygroundPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8">
        <header className="space-y-3 border-b border-border pb-6">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Component playground
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Real component states
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Isolated app components rendered with production primitives and
              realistic state props.
            </p>
          </div>
        </header>

        <Accordion type="multiple" className="gap-3">
          <AccordionItem
            value="brand-logo"
            className="rounded-lg border border-border bg-card px-4"
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="space-y-1">
                <div className="text-base font-semibold">Brand logo</div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Text SVG rendered against current, light, and dark theme
                  surfaces.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <PlaygroundLogoTextSamples />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="invitation-acceptance"
            className="rounded-lg border border-border bg-card px-4"
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="space-y-1">
                <div className="text-base font-semibold">
                  Invitation acceptance
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Shared production component used by the invitation acceptance
                  route.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
                {states.map((state) => (
                  <div key={state.displayState} className="space-y-2">
                    <div className="text-sm font-medium">{state.title}</div>
                    <InvitationStateCard
                      acceptedOrgSlug="northstar-product"
                      displayState={state.displayState}
                      errorMessage="The invitation could not be accepted. Please try again."
                      invitation={state.invitation}
                      onGoDashboard={noop}
                      onGoHome={noop}
                      onGoOrganizations={noop}
                      onSignIn={noop}
                      onSignOut={noop}
                      onTryAgain={noop}
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="prompt-input-submit"
            className="rounded-lg border border-border bg-card px-4"
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="space-y-1">
                <div className="text-base font-semibold">
                  Prompt input submit
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Submit button status variants from the prompt input surface.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                  <div>
                    <div className="text-sm font-medium">Current theme</div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Inherits the active app theme.
                    </p>
                  </div>
                  <PromptSubmitStates />
                </div>

                <div
                  className="space-y-3 rounded-lg border border-border bg-background p-4 text-foreground"
                  style={lightThemeStyle}
                >
                  <div>
                    <div className="text-sm font-medium">
                      Forced light theme
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Uses the light theme dark primary button background.
                    </p>
                  </div>
                  <PromptSubmitStates />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="context-window-meter"
            className="rounded-lg border border-border bg-card px-4"
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="space-y-1">
                <div className="text-base font-semibold">
                  Context window meter
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Ring tone tiers by absolute used tokens: muted up to 150k,
                  amber above 150k, destructive above 300k (OS-1796).
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pb-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Current theme</div>
                <div className="rounded-lg border border-border bg-background p-4">
                  <PlaygroundContextWindowMeters />
                </div>
              </div>
              <div className="space-y-2">
                {/* Only dark is forced: `dark:` variants key off an ancestor
                    `.dark`, so a light block can't opt out of a dark page. */}
                <div className="text-sm font-medium">Forced dark theme</div>
                <div className="dark rounded-lg border border-border bg-background p-4 text-foreground">
                  <PlaygroundContextWindowMeters />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="task-link-tool-rows"
            className="rounded-lg border border-border bg-card px-4"
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="space-y-1">
                <div className="text-base font-semibold">
                  Tool rows: state and task links
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  The leading icon carries the call state — spinner in flight, a
                  red alert whose tooltip is the error message on failure.
                  `update_task_link` rows render the link inline with the
                  kind-colored label the task sidebar uses (OS-1769).
                  Refs are plain text here: the playground has no project route.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid items-start gap-5 lg:grid-cols-2">
                <div className="space-y-2 lg:col-span-2">
                  <div className="text-sm font-medium">
                    Row states (any tool family)
                  </div>
                  <div className="rounded-lg border border-border bg-background p-4">
                    <PlaygroundToolRowStates />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Thread tool rows</div>
                  <div className="rounded-lg border border-border bg-background p-4">
                    <PlaygroundTaskLinkWriterRows />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Task sidebar links (same component)
                  </div>
                  <div className="rounded-lg border border-border bg-background p-4">
                    <TaskDetailLinks links={taskLinkFixtures} />
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="loader-states"
            className="rounded-lg border border-border bg-card px-4"
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="space-y-1">
                <div className="text-base font-semibold">Loader states</div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Inline Spinner states copied from production loading
                  surfaces.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid items-start gap-5 lg:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Centered inline loading
                  </div>
                  <PlaygroundCenteredInlineLoader />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Streaming shimmer</div>
                  <PlaygroundStreamingLoader />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Attachment pill uploading
                  </div>
                  <PlaygroundAttachmentPillLoading />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Composer attachment overflow
                  </div>
                  <PlaygroundComposerAttachmentOverflow />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Comment attachment + submit
                  </div>
                  <PlaygroundCommentAttachmentLoading />
                </div>
                <div className="space-y-2 lg:col-span-3">
                  <div className="text-sm font-medium">
                    Tool loading indicators
                  </div>
                  <PlaygroundToolLoadingIndicators />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Task status</div>
                  <PlaygroundTaskStatusVisuals />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Execute plan</div>
                  <PlaygroundExecutePlanButton />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    List loading states
                  </div>
                  <PlaygroundListLoadingStates />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="thread-sidebar-list"
            className="rounded-lg border border-border bg-card px-4"
          >
            <AccordionTrigger className="py-4 hover:no-underline">
              <div className="space-y-1">
                <div className="text-base font-semibold">
                  Thread sidebar list
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Scrollable thread list states with new-thread and load-more
                  actions.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid items-start gap-5 lg:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Loaded</div>
                  <PlaygroundThreadSidebarList />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Loading</div>
                  <PlaygroundThreadSidebarList isLoading />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Empty + loading more</div>
                  <PlaygroundThreadSidebarList
                    threads={[]}
                    hasMore
                    isLoadingMore
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </main>
  );
}
