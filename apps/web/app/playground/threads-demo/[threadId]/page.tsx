"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { Plus, Paperclip, X, ChevronDown, Circle, MoreVertical, Download, Pin, Archive, Trash2, GitBranch } from "lucide-react";
import ClaudeColorIcon from "@/components/icons/claude-color";
import { Centered } from "@/components/custom/centered";
import { Spinner } from "@/components/custom/spinner";
import OpenAIIcon from "@/components/icons/openai";
import DroidIcon from "@/components/icons/droid";
import AmpIcon from "@/components/icons/amp";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ModelSelectorDropdown,
  ModelSelectorDropdownTrigger,
  ModelSelectorDropdownContent,
  ModelSelectorDropdownInput,
  ModelSelectorDropdownList,
  ModelSelectorDropdownEmpty,
  ModelSelectorDropdownGroup,
  ModelSelectorDropdownItem,
  ModelSelectorDropdownLogo,
  ModelSelectorDropdownName,
} from "@/components/ai-elements/model-selector-dropdown";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { MOCK_THREADS, type DemoThread, type ThreadStatus } from "./thread-types";
import { AppLink, routeTarget, useRouteParams } from "@/lib/navigation";

// CLI tool icons mapping
const CLI_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Claude Code": ClaudeColorIcon,
  "Codex": OpenAIIcon,
  "Droid": DroidIcon,
  "Amp": AmpIcon,
};

// Model options grouped by CLI tool
const MODEL_GROUPS = [
  {
    label: "Claude Code",
    provider: "anthropic" as const,
    models: [
      { value: "claude-code-default", label: "Default" },
      { value: "claude-sonnet-4.5", label: "Sonnet 4.5" },
      { value: "claude-opus-4.5", label: "Opus 4.5" },
    ],
  },
  {
    label: "Codex",
    provider: "openai" as const,
    models: [
      { value: "codex-default", label: "Default" },
      { value: "gpt-5.2-codex", label: "GPT 5.2 Codex" },
      { value: "gpt-5.2-codex-ehr", label: "GPT 5.2 Codex Extra High Reasoning" },
      { value: "gpt-5.2", label: "GPT 5.2" },
      { value: "gpt-5.2-ehr", label: "GPT 5.2 Extra High Reasoning" },
    ],
  },
  {
    label: "Droid",
    provider: "google" as const,
    models: [
      { value: "droid-default", label: "Default" },
      { value: "gemini-3-pro", label: "Gemini 3 Pro" },
      { value: "gemini-3-flash", label: "Gemini 3 Flash" },
    ],
  },
  {
    label: "Amp",
    provider: "anthropic" as const,
    models: [
      { value: "amp-default", label: "Default" },
    ],
  },
];

// Helper to find model and its group by value
function findModelWithGroup(value: string) {
  for (const group of MODEL_GROUPS) {
    const model = group.models.find((m) => m.value === value);
    if (model) return { model, group };
  }
  return null;
}

// Status indicator component
function StatusIndicator({ status, isUnread, className }: { status: ThreadStatus; isUnread: boolean; className?: string }) {
  // Streaming always shows spinner
  if (status === "streaming") {
    return (
      <span title="Streaming response" className={className}>
        <Spinner className="size-2.5" />
      </span>
    );
  }

  // For other statuses, use colored dots
  const config = {
    pending: {
      color: "text-muted-foreground fill-muted-foreground",
      animate: false,
      title: "Pending",
    },
    completed: {
      color: isUnread ? "text-blue-500 fill-blue-500" : "text-transparent fill-transparent",
      animate: false,
      title: isUnread ? "Unread" : "Read",
    },
    awaiting_input: {
      color: "text-amber-500 fill-amber-500",
      animate: true,
      title: "Awaiting input",
    },
    error: {
      color: "text-red-500 fill-red-500",
      animate: false,
      title: "Error",
    },
  }[status];

  return (
    <span title={config.title} className={className}>
      <Circle
        className={cn(
          "size-2",
          config.color,
          config.animate && "animate-pulse"
        )}
      />
    </span>
  );
}

// Format relative time (e.g., "2 hours ago", "Yesterday")
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Thread list item component
function ThreadListItem({
  chat,
  isActive,
}: {
  chat: DemoThread;
  isActive: boolean;
}) {
  const CliIcon = CLI_ICONS[chat.cliTool];

  // Use title if provided, otherwise use first message content
  const displayTitle = chat.title || chat.messages[0]?.content || "New thread";

  // Use last message as preview (skip if it's the only message)
  const lastMessage = chat.messages[chat.messages.length - 1];
  const preview = chat.messages.length > 1 ? lastMessage?.content : null;

  return (
    <div
      className={cn(
        "group relative border-b border-border bg-card hover:bg-muted/50 transition-colors",
        isActive && "bg-muted"
      )}
    >
      <AppLink
        href={routeTarget(`/playground/threads-demo/${chat.id}`)}
        className="block p-2 pb-3.5"
      >
        {/* Two-column layout */}
        <div className="flex gap-2">
          {/* Column 1: Status indicator (aligned top) */}
          <StatusIndicator status={chat.status} isUnread={chat.isUnread} className="mt-2.5" />

          {/* Column 2: Title + Preview + Footer */}
          <div className="flex-1 min-w-0">
            {/* Title + Actions */}
            <div className="flex items-center gap-2">
              <h4 className="flex-1 text-sm font-medium text-foreground leading-snug line-clamp-1">
                {displayTitle}
              </h4>
              {/* Actions menu - visible on hover */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 bg-background shadow-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                      <Download className="mr-2 h-4 w-4" />
                      Continue locally
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                      <Pin className="mr-2 h-4 w-4" />
                      Pin
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                      <Archive className="mr-2 h-4 w-4" />
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => e.stopPropagation()}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Preview text */}
            {preview && (
              <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
                {preview}
              </p>
            )}

            {/* Footer: CLI Icon + Last updated + Branch */}
            <div className="mt-2 flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                {CliIcon && <CliIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground/70">
                  {formatRelativeTime(chat.updatedAt)}
                </span>
              </div>
              {chat.branch && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                  <GitBranch className="size-3" />
                  <span className="truncate max-w-32">{chat.branch}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </AppLink>
    </div>
  );
}

// Chat sidebar component
function ThreadSidebar({
  threads,
  currentThreadId,
}: {
  threads: DemoThread[];
  currentThreadId: string;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Threads</span>
        </div>
        <Button variant="ghost" size="icon-sm">
          <Plus />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {threads.map((chat) => (
            <ThreadListItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === currentThreadId}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}


// Attachments display component (inside PromptInput context)
function AttachmentsDisplay() {
  const { files, remove } = usePromptInputAttachments();

  if (files.length === 0) return null;

  return (
    <PromptInputHeader>
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
        >
          <Paperclip className="size-3 text-muted-foreground" />
          <span className="max-w-32 truncate">{file.filename}</span>
          <button
            type="button"
            onClick={() => remove(file.id)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </PromptInputHeader>
  );
}

// Attachment button component (inside PromptInput context)
function AttachmentButton() {
  const { openFileDialog } = usePromptInputAttachments();

  return (
    <PromptInputButton
      onClick={openFileDialog}
      aria-label="Attach file"
    >
      <Paperclip className="size-4" />
    </PromptInputButton>
  );
}

// Model selector component
function ChatModelSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const result = findModelWithGroup(value);
  const CliIcon = result ? CLI_ICONS[result.group.label] : null;
  const isDefault = result?.model.label === "Default";

  const handleSelect = (modelValue: string) => {
    onChange(modelValue);
    setOpen(false);
  };

  return (
    <ModelSelectorDropdown open={open} onOpenChange={setOpen}>
      <ModelSelectorDropdownTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {CliIcon && <CliIcon className="size-4" />}
          {!isDefault && <span>{result?.model.label ?? "Select model"}</span>}
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </ModelSelectorDropdownTrigger>
      <ModelSelectorDropdownContent>
        <ModelSelectorDropdownInput placeholder="Search models..." />
        <ModelSelectorDropdownList>
          <ModelSelectorDropdownEmpty>No models found.</ModelSelectorDropdownEmpty>
          {MODEL_GROUPS.map((group) => (
            <ModelSelectorDropdownGroup key={group.label} heading={group.label}>
              {group.models.map((model) => (
                <ModelSelectorDropdownItem
                  key={model.value}
                  value={model.value}
                  onSelect={() => handleSelect(model.value)}
                >
                  <ModelSelectorDropdownLogo provider={group.provider} />
                  <ModelSelectorDropdownName>{model.label}</ModelSelectorDropdownName>
                </ModelSelectorDropdownItem>
              ))}
            </ModelSelectorDropdownGroup>
          ))}
        </ModelSelectorDropdownList>
      </ModelSelectorDropdownContent>
    </ModelSelectorDropdown>
  );
}

// Main chat content component
function ThreadContent({ chat }: { chat: DemoThread }) {
  const [selectedModel, setSelectedModel] = useState("claude-code-default");

  const handleSubmit = () => {
    // Dummy handler - no-op for now
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-3xl px-4 py-6">
          {chat.messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.role === "assistant" ? (
                  <MessageResponse>{message.content}</MessageResponse>
                ) : (
                  <span>{message.content}</span>
                )}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="p-4 pb-12">
        <div className="mx-auto max-w-3xl">
          <PromptInput onSubmit={handleSubmit} multiple>
            <AttachmentsDisplay />
            <PromptInputTextarea placeholder="Ask a question..." className="p-4" />
            <PromptInputFooter>
              <PromptInputTools>
                <AttachmentButton />
                <ChatModelSelector
                  value={selectedModel}
                  onChange={setSelectedModel}
                />
              </PromptInputTools>
              <PromptInputSubmit />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </main>
  );
}

// Not found component
function ThreadNotFound() {
  return (
    <Centered>
      <div className="text-center">
        <h2 className="text-lg font-medium text-foreground">Thread not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The thread you&apos;re looking for doesn&apos;t exist.
        </p>
        <AppLink
          href={routeTarget("/playground")}
          className="mt-4 inline-block text-sm text-blue-500 hover:underline"
        >
          Back to playground
        </AppLink>
      </div>
    </Centered>
  );
}

export default function ThreadDemoPage() {
  const params = useRouteParams<{ threadId: string }>();

  const chat = useMemo(
    () => MOCK_THREADS.find((c) => c.id === params.threadId),
    [params.threadId]
  );

  if (!chat) {
    return (
      <ThreadNotFound />
    );
  }

  return (
    <div className="flex h-svh min-h-0">
      <ThreadSidebar
        threads={MOCK_THREADS}
        currentThreadId={params.threadId}
      />

      <ThreadContent chat={chat} />
    </div>
  );
}
