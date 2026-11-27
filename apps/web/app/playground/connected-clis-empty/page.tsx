"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, CircleHelp, Copy, SquareCheck, Terminal } from "lucide-react";
import { toast } from "sonner";
import { AgentAvatar } from "@/components/blocks/project/agent-list-item";
import { ThreadCollapsibleSection, ThreadListSectionLabel } from "@/components/blocks/thread/thread-list-sections";
import { ThreadListNewThreadLink } from "@/components/blocks/thread/thread-list-new-thread-link";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { AppLink, externalRoutes, routeTarget } from "@/lib/navigation";
import { INTERACTIVE_CONNECT_COMMAND } from "@/lib/threads/setup-commands";
import { cn } from "@/lib/utils";

const SETUP_COMMAND = "npx @useconvoy/cli setup --project OS";

const OFFLINE_PROFILES = [
  { key: "laptop", name: "MacBook Pro", userName: "Gecko Zero", lastSeen: "2h ago" },
  { key: "devbox", name: "devbox", userName: "Gecko Zero", lastSeen: "3d ago" },
];

type Profiles = "has profiles" | "no profiles";

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex rounded-md border border-border p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn("rounded px-2 py-0.5", option === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(text);
    toast.success("Command copied to clipboard");
    setTimeout(() => setCopied(null), 1200);
  };
  return { copied, copy };
}

function CopyIcon({ done }: { done: boolean }) {
  return done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />;
}

function DocsIcon() {
  return (
    <TooltipExt content="How to connect a CLI" delayDuration={300}>
      <a
        href={externalRoutes.docsCliSetupAndConnect}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
        aria-label="How to connect a CLI"
      >
        <CircleHelp className="size-3.5" />
      </a>
    </TooltipExt>
  );
}

/** The sidebar around the section, at its default width, so each variant is judged in place. */
function Sidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="w-[320px] overflow-hidden rounded-lg border border-border bg-card">
      <ThreadListNewThreadLink organizationSlug="playground" projectAlias="OS" />
      {children}
      <ThreadListSectionLabel compactLayout={false}>Pinned</ThreadListSectionLabel>
      <ThreadListSectionLabel compactLayout={false}>Active</ThreadListSectionLabel>
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm">
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        <SquareCheck className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-mono text-xs text-muted-foreground">OS-2579</span>
        <span className="min-w-0 flex-1 truncate">Move agentThreadWork off tasks into its own table</span>
        <span className="shrink-0 text-xs text-muted-foreground">now</span>
      </div>
    </aside>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ThreadCollapsibleSection label="Connected CLIs" storageKey={`playground.connected-clis-empty.${id}`} compactLayout={false}>
      {children}
    </ThreadCollapsibleSection>
  );
}

/** Today: sentence, link, boxed command. Copied from ConnectedClisEmptyState. */
function Today({ command }: { command: string }) {
  const { copied, copy } = useCopy();
  return (
    <Section id="today">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 px-3 pb-2 text-xs text-muted-foreground">
        <p>
          No connected CLIs.{" "}
          <a href={externalRoutes.docsCliSetupAndConnect} target="_blank" rel="noreferrer" className="text-primary underline">
            Learn how to connect
          </a>
          .
        </p>
        <InputGroup className="h-7 rounded-md border-border bg-muted shadow-none">
          <InputGroupText className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2.5 font-mono text-[11px] leading-4 text-foreground">
            {command}
          </InputGroupText>
          <InputGroupAddon align="inline-end" className="pr-1">
            <InputGroupButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className="bg-muted text-muted-foreground hover:!bg-muted-foreground/10 hover:text-foreground"
              aria-label="Copy command"
              onClick={() => copy(command)}
            >
              <CopyIcon done={copied === command} />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </Section>
  );
}

/** A: one row at a CLI row's height. The whole row copies the command. */
function EmptyRow({ command, label = "No CLI connected" }: { command: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="px-2 pb-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => copy(command)}
        onKeyDown={(event) => event.key === "Enter" && copy(command)}
        className="group/row flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pl-2.5 pr-1.5 text-left transition-colors hover:bg-accent"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
          <Terminal className="size-3" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-tight text-muted-foreground">{label}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground/70">{command}</span>
        </div>
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
          <DocsIcon />
          <span className="inline-flex size-6 items-center justify-center text-muted-foreground">
            <CopyIcon done={copied === command} />
          </span>
        </span>
      </div>
    </div>
  );
}

/** B: the project's profiles, dimmed, each copying its own connect command. */
function OfflineProfiles({ hasProfiles }: { hasProfiles: boolean }) {
  const { copied, copy } = useCopy();
  if (!hasProfiles) return <EmptyRow command={SETUP_COMMAND} label="No CLI set up" />;
  return (
    <div className="px-2 pb-1">
      {OFFLINE_PROFILES.map((profile) => {
        const command = `${INTERACTIVE_CONNECT_COMMAND} --profile ${profile.key}`;
        return (
          <TooltipExt key={profile.key} content={`Copy ${command}`} delayDuration={500}>
            <button
              type="button"
              onClick={() => copy(command)}
              className="group/row flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pl-2.5 pr-1.5 text-left transition-colors hover:bg-accent"
            >
              <AgentAvatar agent={{ userName: profile.userName, isOnline: false }} className="opacity-60" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium leading-tight text-muted-foreground">{profile.name}</span>
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{profile.key}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground/70">Offline · seen {profile.lastSeen}</span>
              </div>
              <span className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100">
                <CopyIcon done={copied === command} />
              </span>
            </button>
          </TooltipExt>
        );
      })}
    </div>
  );
}

/** C: today's layout without the box or the sentence. Docs link sits in the body's corner. */
function PlainCommand({ command }: { command: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="group/cmd flex items-center gap-1 pb-1.5 pl-3 pr-1.5">
      <button
        type="button"
        onClick={() => copy(command)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span className="text-muted-foreground/50">$</span>
        <span className="truncate">{command}</span>
        <span className="opacity-0 transition-opacity group-hover/cmd:opacity-100">
          <CopyIcon done={copied === command} />
        </span>
      </button>
      <DocsIcon />
    </div>
  );
}

/** D: nothing below the header. "none" and a copy button ride on the header line. */
function HeaderOnly({ command }: { command: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="group/section flex h-8 items-center gap-1 px-3 text-xs font-medium text-muted-foreground">
      <span>Connected CLIs</span>
      <span className="font-normal text-muted-foreground/60">· none</span>
      <span className="ml-auto flex items-center">
        <DocsIcon />
        <TooltipExt content={`Copy ${command}`} delayDuration={300}>
          <button
            type="button"
            onClick={() => copy(command)}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 font-normal hover:bg-muted-foreground/10 hover:text-foreground"
          >
            <CopyIcon done={copied === command} />
            Connect
          </button>
        </TooltipExt>
      </span>
    </div>
  );
}

const VARIANTS: { key: string; title: string; note: string; render: (command: string, hasProfiles: boolean) => ReactNode }[] = [
  {
    key: "a",
    title: "A · Empty row",
    note: "A CLI-shaped row with a dashed placeholder avatar. The command is the second line; click anywhere to copy. Docs and copy icons show on hover.",
    render: (command) => (
      <Section id="a">
        <EmptyRow command={command} />
      </Section>
    ),
  },
  {
    key: "b",
    title: "B · Offline profiles",
    note: "With profiles, list them dimmed and say when each was last seen; clicking one copies its connect --profile command. With none, fall back to A with the setup command.",
    render: (_command, hasProfiles) => (
      <Section id="b">
        <OfflineProfiles hasProfiles={hasProfiles} />
      </Section>
    ),
  },
  {
    key: "c",
    title: "C · Plain command",
    note: "Smallest change: drop the sentence and the box. The command is plain monospace text that copies on click.",
    render: (command) => (
      <Section id="c">
        <PlainCommand command={command} />
      </Section>
    ),
  },
  {
    key: "d",
    title: "D · Header only",
    note: "No body at all. The header says none and carries a Connect button that copies the command. Takes no extra height.",
    render: (command) => <HeaderOnly command={command} />,
  },
];

export default function ConnectedClisEmptyPlaygroundPage() {
  const [profiles, setProfiles] = useState<Profiles>("has profiles");
  const hasProfiles = profiles === "has profiles";
  const command = hasProfiles ? INTERACTIVE_CONNECT_COMMAND : SETUP_COMMAND;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-8 sm:py-12">
        <header className="space-y-4">
          <AppLink href={routeTarget("/playground")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
          </AppLink>
          <h1 className="text-2xl font-semibold">Connected CLIs empty state</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            What the thread sidebar&apos;s Connected CLIs section shows when none of your CLIs are online. Each option sits in the real
            sidebar pieces (New thread link, section header, Pinned and Active).
          </p>
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/20 px-3 py-2">
            <Toggle label="project" value={profiles} options={["has profiles", "no profiles"] as const} onChange={setProfiles} />
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Today</h2>
            <p className="text-sm text-muted-foreground">A sentence that repeats the header, a link, and a filled box that reads as an input.</p>
            <Sidebar>
              <Today command={command} />
            </Sidebar>
          </section>
          {VARIANTS.map((variant) => (
            <section key={variant.key} className="space-y-3">
              <h2 className="text-sm font-medium">{variant.title}</h2>
              <p className="text-sm text-muted-foreground">{variant.note}</p>
              <Sidebar>{variant.render(command, hasProfiles)}</Sidebar>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
