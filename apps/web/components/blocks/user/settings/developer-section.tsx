"use client";

import { useQuery } from "convex/react";
import { Info } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { getFrontendAppVersion, type AppVersionInfo } from "@/lib/app-version";
import { DEV_SETTING_IDS, DEV_SETTINGS } from "@/lib/dev-mode/constants";
import { useDevSettingState } from "@/lib/dev-mode/use-dev-mode";
import type { DevSettingId } from "@/lib/dev-mode/use-dev-mode";

const frontendVersion = getFrontendAppVersion();

function shortBuildId(buildId: string): string {
  if (buildId === "development") return buildId;
  return buildId.length > 12 ? buildId.slice(0, 12) : buildId;
}

function VersionValue({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className="max-w-full min-w-0 truncate text-right font-mono text-[11px] text-foreground"
      title={title}
    >
      {children}
    </span>
  );
}

function VersionDetailsPopover({
  label,
  version,
}: {
  label: string;
  version: AppVersionInfo | undefined;
}) {
  if (!version) return null;

  const rows = [
    ["Commit", version.buildId],
    ["Branch", version.gitRef],
    ["Build time", version.buildTime],
    ["Vercel environment", version.vercelEnvironment],
  ] as const;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`${label} version details`}
          className="size-5 text-muted-foreground"
        >
          <Info className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">
          {label}
        </div>
        <table
          aria-label={`${label} version metadata`}
          className="w-full table-fixed text-xs"
        >
          <tbody>
            {rows.map(([rowLabel, value]) => (
              <tr key={rowLabel} className="border-b border-border/60 last:border-0">
                <th className="w-28 px-3 py-2 text-left font-normal text-muted-foreground">
                  {rowLabel}
                </th>
                <td className="px-3 py-2 text-right align-top">
                  {value ? (
                    <span
                      className="block truncate font-mono text-[11px] text-foreground"
                      title={value}
                    >
                      {value}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PopoverContent>
    </Popover>
  );
}

function VersionRow({
  label,
  version,
  loading,
}: {
  label: string;
  version: AppVersionInfo | undefined;
  loading?: boolean;
}) {
  const value = version
    ? shortBuildId(version.buildId)
    : loading
      ? "Loading…"
      : "Unavailable";

  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_24px] items-center gap-2 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <VersionValue title={version?.buildId}>{value}</VersionValue>
      <VersionDetailsPopover label={label} version={version} />
    </div>
  );
}

function BuildTimeRow({ value }: { value: string | null }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_24px] items-center gap-2 px-3 py-2">
      <span className="text-sm text-muted-foreground">Build time</span>
      <VersionValue title={value ?? undefined}>{value ?? "Unavailable"}</VersionValue>
      <span aria-hidden="true" />
    </div>
  );
}

function AppVersionSection() {
  const backendVersion = useQuery(api.appVersion.core.get, {});
  const buildTime = frontendVersion.buildTime ?? backendVersion?.buildTime ?? null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">App versions</h3>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        <VersionRow label="Frontend" version={frontendVersion} />
        <VersionRow
          label="Backend"
          version={backendVersion}
          loading={backendVersion === undefined}
        />
        <BuildTimeRow value={buildTime} />
      </div>
    </div>
  );
}

function DeveloperSettingRow({ settingId }: { settingId: DevSettingId }) {
  const [enabled, setEnabled] = useDevSettingState(settingId);
  const setting = DEV_SETTINGS[settingId];

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{setting.label}</h3>
        <p className="text-sm text-muted-foreground">{setting.description}</p>
      </div>
      <Switch
        aria-label={`Toggle ${setting.label}`}
        checked={enabled}
        onCheckedChange={setEnabled}
      />
    </div>
  );
}

export function DeveloperSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Developer</h2>
        <p className="text-sm text-muted-foreground">
          Turn individual in-progress controls on for this browser.
        </p>
      </div>

      <AppVersionSection />

      <div className="space-y-3">
        {DEV_SETTING_IDS.map((settingId) => (
          <DeveloperSettingRow key={settingId} settingId={settingId} />
        ))}
      </div>
    </div>
  );
}
