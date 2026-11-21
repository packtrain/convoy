"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ServerCog } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  buildCodexFullConfig,
  buildCodexRequiredConfig,
  buildOpencodeMcpConfig,
  buildAntigravityMcpCommand,
  buildMcpJsonConfig,
  buildProjectScopedMcpUrl,
} from "@/lib/mcp/config-snippets";

interface ProjectMcpConfigurationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationSlug: string;
  projectAlias: string;
}

interface CopyableConfigBlockProps {
  title: string;
  code: string;
  rows?: number;
}

function CopyableConfigBlock({ title, code, rows = 8 }: CopyableConfigBlockProps) {
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

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard is not available");
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`${title} copied`);
      if (resetTimeoutRef.current !== undefined) {
        clearTimeout(resetTimeoutRef.current);
      }
      resetTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Failed to copy configuration");
    }
  }, [code, title]);

  return (
    <div className="min-w-0 space-y-2">
      <InputGroup className="h-auto overflow-hidden rounded-md bg-muted/30 shadow-none">
        <InputGroupTextarea
          readOnly
          aria-label={`${title} configuration`}
          value={code}
          rows={rows}
          className="max-h-80 min-h-28 overflow-auto whitespace-pre font-mono text-xs leading-5"
        />
        <InputGroupAddon
          align="block-start"
          className="justify-between border-b bg-background/70 py-1.5"
        >
          <InputGroupText className="font-mono text-xs text-foreground">
            {title}
          </InputGroupText>
          <TooltipExt content={`Copy ${title}`} delayDuration={500}>
            <InputGroupButton
              type="button"
              size="icon-xs"
              aria-label={`Copy ${title}`}
              className="cursor-pointer"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="size-3 text-success" />
              ) : (
                <Copy className="size-3" />
              )}
            </InputGroupButton>
          </TooltipExt>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

export function ProjectMcpConfigurationDialog({
  open,
  onOpenChange,
  organizationSlug,
  projectAlias,
}: ProjectMcpConfigurationDialogProps) {
  const mcpUrl = useMemo(
    () => buildProjectScopedMcpUrl({ organizationSlug, projectAlias }),
    [organizationSlug, projectAlias]
  );
  const mcpJsonConfig = useMemo(() => buildMcpJsonConfig(mcpUrl), [mcpUrl]);
  const codexMinimalConfig = useMemo(
    () => buildCodexRequiredConfig(mcpUrl),
    [mcpUrl]
  );
  const codexFullConfig = useMemo(() => buildCodexFullConfig(mcpUrl), [mcpUrl]);
  const opencodeConfig = useMemo(() => buildOpencodeMcpConfig(mcpUrl), [mcpUrl]);
  const antigravityCommand = useMemo(() => buildAntigravityMcpCommand(mcpUrl), [mcpUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="p-5">
          <div className="flex items-center gap-2">
            <ServerCog className="size-4 text-muted-foreground" />
            <DialogTitle>Configure MCP</DialogTitle>
          </div>
          <DialogDescription>
            Project-scoped snippets for{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {organizationSlug}/{projectAlias}
            </code>
            . Replace{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              &lt;YOUR_API_KEY&gt;
            </code>{" "}
            with a personal API key.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(min(760px,100vh-2rem)-6rem)] space-y-5 overflow-y-auto px-5 pb-5 pt-0">
          <section className="min-w-0 space-y-2">
            <div>
              <h3 className="text-sm font-medium">.mcp.json</h3>
              <p className="text-xs text-muted-foreground">
                Use this for MCP clients that read repository-level JSON config.
              </p>
            </div>
            <CopyableConfigBlock title=".mcp.json" code={mcpJsonConfig} rows={10} />
          </section>

          <section className="min-w-0 space-y-3">
            <div>
              <h3 className="text-sm font-medium">.codex/config.toml</h3>
              <p className="text-xs text-muted-foreground">
                Start with the minimal config, or use the full version to
                pre-approve Convoy tools.
              </p>
            </div>
            <CopyableConfigBlock
              title=".codex/config.toml minimal"
              code={codexMinimalConfig}
              rows={5}
            />
            <CopyableConfigBlock
              title=".codex/config.toml full"
              code={codexFullConfig}
              rows={14}
            />
          </section>

          <section className="min-w-0 space-y-2">
            <div>
              <h3 className="text-sm font-medium">opencode.json</h3>
              <p className="text-xs text-muted-foreground">
                For OpenCode; or run{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  convoy init mcp --cli opencode
                </code>
                .
              </p>
            </div>
            <CopyableConfigBlock
              title="opencode.json"
              code={opencodeConfig}
              rows={12}
            />
          </section>

          <section className="min-w-0 space-y-2">
            <div>
              <h3 className="text-sm font-medium">Antigravity</h3>
              <p className="text-xs text-muted-foreground">
                Run in a terminal, or run{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  convoy init mcp --cli antigravity
                </code>
                . agy keeps MCP servers per user, so every agy session uses
                this project.
              </p>
            </div>
            <CopyableConfigBlock
              title="agy mcp add"
              code={antigravityCommand}
              rows={3}
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
