import type { UIMessage } from "ai";
import { isRecord } from "@/lib/type-guards";
import {
  getCliEffortOptions,
  getCliIcon,
  getCliModelOption,
  renderCliIcon,
  CLI_TYPE_MAP,
  type CliTypeSlug,
} from "@/lib/cli-runtime-ui/registry";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatUsd } from "@/lib/costs/cost-summary";
import {
  MessageFooterPopover,
  MessageFooterRow,
  MessageFooterTrigger,
} from "./message-footer";

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function getRecord(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function buildLegacySystemInit(
  metadata: Record<string, unknown>
): Record<string, unknown> | undefined {
  const systemInit: Record<string, unknown> = {};
  const model = getString(metadata, "model");
  const claudeCodeVersion = getString(metadata, "claudeCodeVersion");
  const permissionMode = getString(metadata, "permissionMode");
  const tools = metadata.tools;

  if (model) {
    systemInit.model = model;
  }
  if (claudeCodeVersion) {
    systemInit.claudeCodeVersion = claudeCodeVersion;
  }
  if (permissionMode) {
    systemInit.permissionMode = permissionMode;
  }
  if (Array.isArray(tools)) {
    systemInit.tools = tools;
  }

  return Object.keys(systemInit).length > 0 ? systemInit : undefined;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function JsonAccordionSection({
  value,
  title,
}: {
  value: Record<string, unknown>;
  title: string;
}) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={title} className="border-b-0 px-3 py-1">
        <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
          {title}
        </AccordionTrigger>
        <AccordionContent className="pb-2">
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-xs text-foreground">
            <code>{stringifyJson(value)}</code>
          </pre>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

interface RunStatsProps {
  metadata: UIMessage["metadata"];
  cliType?: CliTypeSlug;
  cliModel?: string;
  resolvedCliModel?: string;
  cliEffort?: string;
  timestamp?: number;
}

export function RunStats({
  metadata,
  cliType,
  cliModel,
  resolvedCliModel,
  cliEffort,
  timestamp,
}: RunStatsProps) {
  if (!isRecord(metadata)) {
    return null;
  }

  const sessionId = getString(metadata, "sessionId");
  const resultSubtype =
    getString(metadata, "resultSubtype") ?? getString(metadata, "subtype");
  const totalCostUsd = getNumber(metadata, "totalCostUsd");
  const durationMs = getNumber(metadata, "durationMs");
  const usage = getRecord(metadata, "usage");
  const modelUsage = getRecord(metadata, "modelUsage");
  const rawSystemInit = getRecord(metadata, "systemInit") ?? buildLegacySystemInit(metadata);
  const systemInit = rawSystemInit && Object.keys(rawSystemInit).length > 0 ? rawSystemInit : undefined;

  const hasSummary =
    Boolean(cliType) || durationMs !== undefined || timestamp !== undefined;

  const hasDetails =
    sessionId !== undefined ||
    resultSubtype !== undefined ||
    totalCostUsd !== undefined ||
    usage !== undefined ||
    modelUsage !== undefined ||
    systemInit !== undefined ||
    hasSummary;

  if (!hasSummary || !hasDetails) {
    return null;
  }

  const cliLabel = cliType ? CLI_TYPE_MAP[cliType] : undefined;
  const reportedModel = getString(metadata, "model") || (systemInit && getString(systemInit, "model"));
  const model = resolvedCliModel || reportedModel || cliModel;
  const modelLabel = model
    ? (cliType ? getCliModelOption(cliType, model)?.label : undefined) ?? model
    : "Not reported";
  const effortModel = cliModel && cliModel !== "default" ? cliModel : model;
  const effortLabel =
    cliType && cliEffort
      ? (getCliEffortOptions(cliType, { cliModel: effortModel }).find(
          (option) => option.value === cliEffort,
        )?.label ?? cliEffort)
      : cliEffort || "Not reported";

  const trigger = (
    <MessageFooterTrigger aria-label="Run details">
      {cliType ? renderCliIcon(cliType as CliTypeSlug, "size-3.5") : null}
      {durationMs !== undefined && <span>{formatDuration(durationMs)}</span>}
      {timestamp !== undefined && <span>{formatDate(timestamp)}</span>}
    </MessageFooterTrigger>
  );

  return (
    <MessageFooterPopover
      trigger={trigger}
      align="start"
      contentClassName="w-[min(90vw,26rem)] max-w-[calc(100vw-1rem)]"
    >
      {cliLabel && (
        <MessageFooterRow
          label="CLI"
          value={cliLabel}
          icon={cliType ? getCliIcon(cliType as CliTypeSlug) : undefined}
        />
      )}
      <MessageFooterRow label="Model" value={modelLabel} truncate />
      <MessageFooterRow label="Reasoning" value={effortLabel} truncate />
      {durationMs !== undefined && (
        <MessageFooterRow label="Duration" value={formatDuration(durationMs)} />
      )}
      {totalCostUsd !== undefined && (
        <MessageFooterRow label="Cost" value={formatUsd(totalCostUsd)} />
      )}
      {timestamp !== undefined && (
        <MessageFooterRow label="Date" value={formatDate(timestamp)} />
      )}
      {resultSubtype && <MessageFooterRow label="Result" value={resultSubtype} />}
      {sessionId && <MessageFooterRow label="Session" value={sessionId} truncate />}

      {usage && <JsonAccordionSection title="Usage" value={usage} />}
      {modelUsage && <JsonAccordionSection title="Model usage" value={modelUsage} />}
      {systemInit && <JsonAccordionSection title="System init" value={systemInit} />}
    </MessageFooterPopover>
  );
}
