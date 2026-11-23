"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Plus, Key, Check, Copy, MonitorSmartphone } from "lucide-react";
import { EmptyState } from "@/components/custom/empty-state";
import { ApiKeyRow } from "./api-key-row";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { NewKeyDisplay } from "./new-key-display";
import { AppLink, useRouteParams } from "@/lib/navigation";
import {
  buildCodexApprovalConfig,
  buildCodexRequiredConfig,
  buildOpencodeMcpConfig,
  buildAntigravityMcpCommand,
  buildGenericMcpConfig,
  buildMcpJsonConfig,
  buildProjectScopedMcpUrl,
} from "@/lib/mcp/config-snippets";

function getRouteParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function CodeBlock({ code, label = "configuration" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative w-full min-w-0 overflow-hidden">
      <pre className="block w-full min-w-0 overflow-x-auto rounded-md bg-muted p-3 text-xs">
        <code className="inline-block min-w-max pr-8">{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 size-6 cursor-pointer"
        aria-label={`Copy ${label}`}
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="size-3 text-green-600" />
        ) : (
          <Copy className="size-3" />
        )}
      </Button>
    </div>
  );
}

const API_KEYS_PAGE_SIZE = 100;

export function ApiKeysSection() {
  const { results: apiKeys, status, loadMore } = usePaginatedQuery(
    api.apiKeys.core.list,
    {},
    { initialNumItems: API_KEYS_PAGE_SIZE }
  );
  const params = useRouteParams<{
    organizationSlug?: string | string[];
    projectAlias?: string | string[];
  }>();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const organizationSlug = getRouteParam(params.organizationSlug);
  const projectAlias = getRouteParam(params.projectAlias);
  const siteUrl = useQuery(api.appVersion.core.siteUrl);
  const mcpUrl = buildProjectScopedMcpUrl({ organizationSlug, projectAlias, siteUrl });
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  const hasNoKeys = status !== "LoadingFirstPage" && apiKeys.length === 0;

  const handleKeyCreated = (key: string) => {
    setIsCreateOpen(false);
    setNewKey(key);
  };

  const handleNewKeyDismiss = () => {
    setNewKey(null);
  };

  const mcpJsonConfig = buildMcpJsonConfig(mcpUrl);
  const codexRequiredConfig = buildCodexRequiredConfig(mcpUrl);
  const codexApprovalConfig = buildCodexApprovalConfig();
  const opencodeConfig = buildOpencodeMcpConfig(mcpUrl);
  const antigravityCommand = buildAntigravityMcpCommand(mcpUrl);
  const genericConfig = buildGenericMcpConfig(mcpUrl);

  return (
    <div className="min-w-0 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">API keys</h2>
        <p className="text-sm text-muted-foreground">
          Manage API keys for CLI and MCP access to your projects
        </p>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">
          {hasNoKeys ? null : (
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="size-4" />
              Create key
            </Button>
          )}
          <Button variant="outline" size="sm" className="cursor-pointer" asChild>
            <AppLink href="/device">
              <MonitorSmartphone className="size-4" />
              Authorize device via code
            </AppLink>
          </Button>
        </div>

        {/* One-time key display */}
        {newKey && (
          <NewKeyDisplay apiKey={newKey} onDismiss={handleNewKeyDismiss} />
        )}

        {/* Key list */}
        {status === "LoadingFirstPage" ? (
          <ApiKeyListSkeleton />
        ) : hasNoKeys ? (
          <EmptyState
            icon={Key}
            title="No API keys yet"
            description="Create one for CLI and MCP access."
            action={
              <Button variant="secondary" className="cursor-pointer" onClick={() => setIsCreateOpen(true)}>
                <Plus className="size-4" />
                Create key
              </Button>
            }
          />
        ) : (
          <div className="min-w-0 overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-40 max-w-40">Key</TableHead>
                  <TableHead className="w-20">Expires</TableHead>
                  <TableHead className="w-20">Used</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <ApiKeyRow key={key._id} apiKey={key} />
                ))}
              </TableBody>
            </Table>
            {(status === "CanLoadMore" || status === "LoadingMore") && (
              <button
                type="button"
                disabled={status === "LoadingMore"}
                onClick={() => loadMore(API_KEYS_PAGE_SIZE)}
                className="flex w-full cursor-pointer items-center justify-center border-t px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {status === "LoadingMore" ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}

        <div className="min-w-0 space-y-3">
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-medium">CLI / Convex URL</h3>
            <p className="text-xs text-muted-foreground">
              Use when the Convoy CLI asks for a Convex URL.
            </p>
            {convexUrl ? (
              <CodeBlock code={convexUrl} label="CLI / Convex URL" />
            ) : (
              <p className="text-sm text-muted-foreground">Deployment URL is unavailable.</p>
            )}
          </div>
          {convexUrl && (
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-medium">MCP endpoint</h3>
              <p className="text-xs text-muted-foreground">
                Use as the server URL in your MCP client. Authenticate with your API key.
              </p>
              <CodeBlock code={mcpUrl} label="MCP endpoint" />
            </div>
          )}
        </div>

        {/* MCP Setup Instructions */}
        <Accordion type="single" collapsible className="w-full min-w-0">
          <AccordionItem value="setup" className="min-w-0 overflow-hidden rounded-lg border px-4">
            <AccordionTrigger className="hover:no-underline">
              How to configure MCP
            </AccordionTrigger>
            <AccordionContent className="min-w-0">
              <div className="min-w-0 space-y-4 pb-2">
                <p className="text-sm text-muted-foreground">
                  Replace <code className="bg-muted px-1 rounded text-xs">&lt;YOUR_API_KEY&gt;</code> with your API key from above. When opened from a project, the MCP URL is scoped to that project automatically.
                </p>

                {/* Claude Code / Claude Desktop */}
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium text-sm">
                    Claude Code / Claude Desktop
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    Add to <code className="bg-muted px-1 rounded">.mcp.json</code> in your project folder (or run <code className="bg-muted px-1 rounded">convoy init mcp --cli claude</code>). Claude Desktop uses the same block in <code className="bg-muted px-1 rounded">claude_desktop_config.json</code>:
                  </p>
                  <CodeBlock code={mcpJsonConfig} />
                </div>

                {/* Codex */}
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium text-sm">
                    Codex
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    Create <code className="bg-muted px-1 rounded">.codex/config.toml</code> in your project folder:
                  </p>
                  <CodeBlock code={codexRequiredConfig} />
                  <p className="text-xs text-muted-foreground">
                    Optional: add these blocks underneath if you want Codex to run these Convoy tools without asking each time.
                  </p>
                  <CodeBlock code={codexApprovalConfig} />
                </div>

                {/* OpenCode */}
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium text-sm">
                    OpenCode
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    Add to <code className="bg-muted px-1 rounded">opencode.json</code> in your project folder (or run <code className="bg-muted px-1 rounded">convoy init mcp --cli opencode</code>):
                  </p>
                  <CodeBlock code={opencodeConfig} />
                </div>

                {/* Antigravity */}
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium text-sm">
                    Antigravity
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    Run in a terminal (or run <code className="bg-muted px-1 rounded">convoy init mcp --cli antigravity</code>). agy keeps MCP servers per user in <code className="bg-muted px-1 rounded">~/.gemini/config/mcp_config.json</code>, so every agy session uses this project:
                  </p>
                  <CodeBlock code={antigravityCommand} />
                </div>

                {/* Cursor */}
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium text-sm">
                    Cursor
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    Add to your Cursor MCP settings (<code className="bg-muted px-1 rounded">~/.cursor/mcp.json</code>):
                  </p>
                  <CodeBlock code={mcpJsonConfig} />
                </div>

                {/* Generic */}
                <div className="min-w-0 space-y-2">
                  <h5 className="font-medium text-sm">
                    Other MCP clients
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    Use these values for any MCP-compatible client:
                  </p>
                  <CodeBlock code={genericConfig} />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Create dialog */}
      <CreateApiKeyDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onKeyCreated={handleKeyCreated}
      />
    </div>
  );
}

/** Key table placeholder: the header row over three key rows. */
function ApiKeyListSkeleton() {
  return (
    <div aria-label="Loading API keys" className="min-w-0 overflow-hidden rounded-lg border">
      <div className="flex h-10 items-center border-b px-2">
        <Skeleton className="h-3.5 w-16 rounded-sm" />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex h-12 items-center gap-4 border-b px-2 last:border-b-0">
          <Skeleton className="h-4 flex-1 rounded-sm" />
          <Skeleton className="h-4 w-32 rounded-sm" />
          <Skeleton className="h-4 w-12 rounded-sm" />
          <Skeleton className="h-4 w-12 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
