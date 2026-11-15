"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Terminal } from "lucide-react";
import { Centered } from "@/components/custom/centered";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { externalRoutes } from "@/lib/navigation";
import {
  buildNoProfileSetupCommands,
  INTERACTIVE_CONNECT_COMMAND,
} from "@/lib/threads/setup-commands";

interface NoProfilesStateProps {
  projectId?: string;
  projectName?: string;
  projectAlias?: string;
}

/** A copyable command that wraps inside its box instead of overflowing. */
export function CommandBlock({
  command,
  copyLabel = "Copy command",
}: {
  command: string;
  copyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== undefined) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command.trim());
      setCopied(true);
      if (resetTimeoutRef.current !== undefined) {
        clearTimeout(resetTimeoutRef.current);
      }
      resetTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard not available
    }
  }

  return (
    <pre className="mt-2 flex items-start gap-2 rounded-md bg-muted py-1 pl-4 pr-1 text-sm font-mono text-foreground">
      <code className="min-w-0 flex-1 py-2 whitespace-pre-wrap wrap-anywhere">
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 cursor-pointer"
        onClick={handleCopy}
        aria-label={copyLabel}
      >
        {copied ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <Copy className="size-3.5 text-muted-foreground" />
        )}
      </Button>
    </pre>
  );
}

/** This deployment's backend URL, which interactive connect asks for. */
export function BackendUrlBlock() {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">Backend URL</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Paste this when the CLI asks for the deployment URL.
      </p>
      <CommandBlock command={getBackendUrl()} copyLabel="Copy backend URL" />
    </div>
  );
}

function getBackendUrl(): string {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? "<convex_url>";
}

export function NoProfilesState({
  projectId,
  projectName,
  projectAlias,
}: NoProfilesStateProps) {
  const setupCommands = buildNoProfileSetupCommands({
    convexUrl: getBackendUrl(),
    projectId,
    projectName,
    projectAlias,
  });

  return (
    <Centered>
      <div className="w-full max-w-3xl px-6">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Terminal className="size-6 text-muted-foreground" />
        </div>
        <h2 className="text-center text-lg font-medium text-foreground">
          Connect your CLI
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Pick the fastest path to get your CLI online for this project.
        </p>

        <div className="mt-6 space-y-4 text-left">
          <div>
            <p className="text-sm font-medium text-foreground">
              Interactive mode
            </p>
            <CommandBlock command={INTERACTIVE_CONNECT_COMMAND} />
          </div>

          <BackendUrlBlock />

          <Collapsible>
            <CollapsibleTrigger className="group/other flex cursor-pointer items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]/other:rotate-90" />
              Other ways to connect
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Create profile
                </p>
                <CommandBlock
                  command={setupCommands.interactiveSetupCommand}
                />
              </div>

              <div>
                <p className="text-sm font-medium text-foreground">
                  Connect using the saved profile
                </p>
                <CommandBlock
                  command={setupCommands.connectCommand}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            <a
              href={externalRoutes.docsCliSetupAndConnect}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Read the full setup guide
            </a>
          </p>
        </div>
      </div>
    </Centered>
  );
}
