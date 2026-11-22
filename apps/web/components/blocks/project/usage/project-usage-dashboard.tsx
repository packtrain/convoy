"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROJECT_USAGE_INFO_SLOT_ID } from "@/components/blocks/project/settings/project-settings-config";
import { useQuery } from "convex/react";
import { Coins } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { CostTotal } from "@/convex/costs/lib/validators";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyState } from "@/components/custom/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CompositionBar } from "@/components/custom/charts/composition-bar";
import { ShareBarList } from "@/components/custom/charts/share-bar-list";
import { Sparkline } from "@/components/custom/charts/sparkline";
import { StackedBarChart } from "@/components/custom/charts/stacked-bar-chart";
import type { ChartSeries } from "@/components/custom/charts/types";
import { CLI_TYPE_MAP, type CliTypeSlug } from "@/lib/cli-runtime-ui/registry";
import { formatContextWindowTokens } from "@/lib/cli-stream-ui";
import {
  assignModelColors,
  formatModelLabel,
  formatUsd,
  describeCost,
  canCompareCosts,
  sumCostTotals,
  modelTokenShares,
} from "@/lib/costs/cost-summary";
import { DAY_MS, utcDayStartMs } from "@/convex/costs/lib/dayBucket";
import { AppLink, appRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = [30, 90, 180] as const;
const MODEL_ROWS_COLLAPSED = 4;

// Fixed CLI → categorical slot assignment (known, stable set).
const CLI_COLORS: Record<string, string> = {
  "claude-code": "var(--chart-1)",
  opencode: "var(--chart-2)",
  cursor: "var(--chart-3)",
  codex: "var(--chart-4)",
  antigravity: "var(--chart-5)",
};

function formatDay(dayStartMs: number): string {
  return new Date(dayStartMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function CostValue({ cost }: { cost: CostTotal }) {
  const { label, description } = describeCost(cost);
  return (
    <span title={description} aria-label={`${label}. ${description}`}>
      {label}
    </span>
  );
}

const noSubscription = () => () => {};

/** The (i) beside the page description; the settings shell renders the slot. */
function CostDetails({ description }: { description: string }) {
  const slot = useSyncExternalStore(
    noSubscription,
    () => document.getElementById(PROJECT_USAGE_INFO_SLOT_ID),
    () => null
  );
  if (!slot || !description) return null;
  return createPortal(
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Cost details"
          className="flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs leading-relaxed text-muted-foreground">
        {description}
      </PopoverContent>
    </Popover>,
    slot
  );
}

function StatTile({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
      {note ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
      ) : null}
      {children}
    </div>
  );
}

function SectionCard({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {hint ? (
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {children}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
      <div className="grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-44 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function ProjectUsageDashboard({
  projectId,
  organizationSlug,
  projectAlias,
}: {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
}) {
  const [rangeDays, setRangeDays] =
    useState<(typeof RANGE_OPTIONS)[number]>(90);
  // Stable "today": recomputing Date.now() per render would resubscribe the query.
  const [today] = useState(() => utcDayStartMs(Date.now()));
  const [showAllModels, setShowAllModels] = useState(false);

  const dashboard = useQuery(api.costs.core.getProjectUsageDashboard, {
    projectId,
    fromDayStartMs: today - (rangeDays - 1) * DAY_MS,
    toDayStartMs: today,
  });

  const modelColors = useMemo(
    () =>
      assignModelColors(dashboard?.byModel.map((entry) => entry.model) ?? []),
    [dashboard?.byModel]
  );

  const allocationIncomplete =
    !!dashboard?.costMetadata?.modelAllocationIncomplete;
  const dailySeries: ChartSeries[] = useMemo(
    () =>
      allocationIncomplete
        ? [{ key: "__total", label: "Daily total", color: "var(--chart-1)" }]
        : (dashboard?.byModel ?? []).map((entry) => ({
            key: entry.model,
            label: formatModelLabel(entry.model),
            color: modelColors.get(entry.model) ?? "var(--chart-5)",
          })),
    [dashboard?.byModel, modelColors, allocationIncomplete]
  );

  if (dashboard === undefined) {
    return <DashboardSkeleton />;
  }

  const hasUsage = dashboard.byDay.length > 0 || dashboard.totalRuns > 0;
  if (!hasUsage && !dashboard.costMetadata?.hasDataGap) {
    return (
      <EmptyState
        fill
        icon={Coins}
        title="No usage recorded yet"
        description="Costs appear here after agent threads run in this project."
      />
    );
  }

  // Fill missing days with zeros so the x-axis is continuous.
  const byDayMap = new Map(dashboard.byDay.map((day) => [day.dayStartMs, day]));
  const dailyData = Array.from({ length: rangeDays }, (_, i) => {
    const dayStartMs = today - (rangeDays - 1 - i) * DAY_MS;
    const day = byDayMap.get(dayStartMs);
    const cost = day
      ? describeCost(day)
      : { label: "No usage", description: "" };
    return {
      x: dayStartMs,
      values: allocationIncomplete
        ? { __total: day?.costUsd ?? 0 }
        : Object.fromEntries(
            (day?.byModel ?? []).map((entry) => [entry.model, entry.costUsd])
          ),
      valueLabels: allocationIncomplete
        ? { __total: cost.label }
        : Object.fromEntries(
            dailySeries.map((series) => {
              const entry = day?.byModel.find(
                (model) => model.model === series.key
              );
              return [
                series.key,
                entry ? describeCost(entry).label : "No usage",
              ];
            })
          ),
      totalLabel: cost.label,
      description: cost.description,
    };
  });

  const { totalCostUsd, prevTotalCostUsd } = dashboard;
  const comparable = canCompareCosts(
    dashboard.costMetadata,
    dashboard.prevCostMetadata
  );
  const total = { costUsd: totalCostUsd, costMetadata: dashboard.costMetadata };
  const deltaPct =
    comparable && prevTotalCostUsd > 0
      ? ((totalCostUsd - prevTotalCostUsd) / prevTotalCostUsd) * 100
      : null;
  const monthStart = Date.UTC(
    new Date(today).getUTCFullYear(),
    new Date(today).getUTCMonth(),
    1
  );
  const thisMonth = sumCostTotals(
    dashboard.byDay.filter((day) => day.dayStartMs >= monthStart)
  );
  const activeDays = dashboard.byDay.length;

  const modelShares = modelTokenShares(dashboard.byModel);
  const hiddenModelCount = modelShares.length - MODEL_ROWS_COLLAPSED;

  const totalInput = dashboard.byModel.reduce(
    (sum, entry) => sum + entry.inputTokens,
    0
  );
  const totalCached = dashboard.byModel.reduce(
    (sum, entry) => sum + entry.cachedInputTokens,
    0
  );
  // Floored so a small uncached remainder never reads as 100%.
  const cacheShare =
    totalInput + totalCached > 0
      ? Math.floor((totalCached / (totalInput + totalCached)) * 1000) / 10
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div
          role="group"
          aria-label="Date range"
          className="flex gap-0.5 rounded-lg border bg-card p-0.5"
        >
          {RANGE_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={rangeDays === days}
              onClick={() => setRangeDays(days)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 text-xs text-muted-foreground",
                rangeDays === days && "bg-accent text-foreground"
              )}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={`Total spend · ${rangeDays}d`}
          value={<CostValue cost={total} />}
          note={
            !comparable ? undefined : deltaPct !== null ? (
              <>
                <span
                  className={
                    deltaPct >= 0 ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(0)}%
                </span>{" "}
                vs prior {rangeDays}d
                {dashboard.costMetadata?.hasEstimated ||
                dashboard.prevCostMetadata?.hasEstimated ? (
                  <span className="block">Comparison includes estimates.</span>
                ) : null}
              </>
            ) : (
              `no spend in the prior ${rangeDays}d`
            )
          }
        >
          <div
            className="mt-2.5"
            role="img"
            aria-label={`Daily known cost trend. ${describeCost(total).description}`}
          >
            <Sparkline
              data={dailyData.map((d) => byDayMap.get(d.x)?.costUsd ?? 0)}
            />
          </div>
        </StatTile>
        <StatTile
          label="This month"
          value={<CostValue cost={thisMonth} />}
          note={
            new Date(today).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }) + " to date"
          }
        />
        <StatTile
          label="Avg per active day"
          value={
            <CostValue
              cost={{
                ...total,
                costUsd: activeDays > 0 ? totalCostUsd / activeDays : 0,
              }}
            />
          }
          note={`${activeDays} active days`}
        />
        <StatTile
          label="Agent runs"
          value={`${dashboard.totalRuns}`}
          note={
            dashboard.totalRuns > 0
              ? `${describeCost({ ...total, costUsd: totalCostUsd / dashboard.totalRuns }).label} avg per run`
              : undefined
          }
        />
      </div>

      {dashboard.costMetadata?.hasDataGap ? (
        <p className="text-xs text-muted-foreground">
          Historical usage was excluded. Totals, tokens and run counts have a
          data gap.
        </p>
      ) : null}
      <CostDetails description={describeCost(total).description} />

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard
          title="Daily spend"
          hint={
            allocationIncomplete
              ? "Daily totals · UTC days · Model breakdown is incomplete"
              : "Costs stacked by model · UTC days"
          }
          className="lg:col-span-2"
        >
          <StackedBarChart
            series={dailySeries}
            data={dailyData}
            formatX={formatDay}
            formatValue={formatUsd}
            formatAxisValue={(value) =>
              value >= 1 ? `$${value.toFixed(0)}` : `$${value.toFixed(1)}`
            }
            ariaLabel={`Daily known costs${allocationIncomplete ? "" : " stacked by model"}. ${describeCost(total).description}`}
          />
        </SectionCard>
        <SectionCard title="Tokens by model" hint="Share of all tokens · cost">
          <ShareBarList
            showSwatches
            rows={(showAllModels
              ? modelShares
              : modelShares.slice(0, MODEL_ROWS_COLLAPSED)
            ).map((share) => ({
              key: share.model,
              label: formatModelLabel(share.model),
              detail: `${formatContextWindowTokens(share.tokens)} tokens · ${Math.round(share.shareOfTokens)}%`,
              valueText: <CostValue cost={share} />,
              value: share.tokens,
              color: modelColors.get(share.model),
            }))}
          />
          {hiddenModelCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 cursor-pointer text-muted-foreground"
              onClick={() => setShowAllModels((shown) => !shown)}
            >
              {showAllModels ? "Show less" : `Show ${hiddenModelCount} more`}
            </Button>
          ) : null}
        </SectionCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Spend by member" hint="User running the Convoy CLI">
          <ShareBarList
            rows={dashboard.byMember.map((member) => ({
              key: member.userId,
              label: member.name,
              valueText: <CostValue cost={member} />,
              value: member.costUsd,
            }))}
          />
        </SectionCard>
        <SectionCard
          title="Spend by CLI"
          hint="Runtime attribution · share of cost"
        >
          <CompositionBar
            segments={dashboard.byCli.map((entry) => ({
              key: entry.cliType,
              label:
                CLI_TYPE_MAP[entry.cliType as CliTypeSlug] ?? entry.cliType,
              value: entry.costUsd,
              valueText: <CostValue cost={entry} />,
              color: CLI_COLORS[entry.cliType] ?? "var(--chart-5)",
            }))}
          />
        </SectionCard>
        <SectionCard
          title="Cache efficiency"
          hint="Cached share of input tokens"
        >
          <div className="flex items-center gap-4">
            <div className="text-3xl font-semibold tabular-nums">
              {cacheShare}%
            </div>
            <p className="max-w-[30ch] text-xs text-muted-foreground">
              of {formatContextWindowTokens(totalCached + totalInput)} input
              tokens came from prompt cache;{" "}
              {formatContextWindowTokens(totalInput)} were uncached.
            </p>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Most expensive tasks"
        hint="Spend attributed via thread → task association"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Task</th>
                <th className="px-2 py-1.5 text-right font-semibold">Tokens</th>
                <th className="px-2 py-1.5 text-right font-semibold">Runs</th>
                <th className="w-64 px-2 py-1.5 text-right font-semibold">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {dashboard.topTasks.map((task) => {
                const maxCost = Math.max(
                  ...dashboard.topTasks.map((t) => t.costUsd),
                  Number.EPSILON
                );
                return (
                  <tr
                    key={task.taskId ?? "no-task"}
                    className="border-b last:border-b-0"
                  >
                    <td className="w-full max-w-0 px-2 py-2">
                      <div className="flex items-center">
                        {task.ref ? (
                          <AppLink
                            href={appRoute.projectTask(
                              organizationSlug,
                              projectAlias,
                              task.ref
                            )}
                            className="mr-2 inline-flex shrink-0 cursor-pointer rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {task.ref}
                          </AppLink>
                        ) : null}
                        <span className="truncate" title={task.name}>
                          {task.name ?? "No task (unattached threads)"}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {formatContextWindowTokens(task.tokens)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {task.runCount}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div className="flex w-[120px] justify-end">
                          <div
                            aria-hidden="true"
                            className="h-1.5 rounded-l-[3px] opacity-80"
                            style={{
                              width: `${(task.costUsd / maxCost) * 100}%`,
                              backgroundColor: "var(--chart-1)",
                            }}
                          />
                        </div>
                        <span className="w-28 shrink-0 text-right tabular-nums">
                          <CostValue cost={task} />
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
