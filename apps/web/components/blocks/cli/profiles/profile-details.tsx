import { format, formatDistanceToNow } from "date-fns";
import { Bot, CalendarDays, Clock3, FolderGit2, GitBranch, KeyRound, Monitor, SquareTerminal } from "lucide-react";
import { folderRepos, isConfiguredPath, toRuntimeSummaries, type CliProfilePathEntry, type CliRuntimeSummary } from "@/convex/lib/contracts/validators";
import { isCliType } from "@/lib/cli-runtime-ui/registry";
import { CLI_TYPE_MAP, type AvailableCliInfo } from "@/lib/threads/types";
import { cn } from "@/lib/utils";

export type ProfileDetailsData = {
  name: string;
  profileKey?: string;
  hostname?: string;
  isOnline: boolean;
  createdAt?: number;
  lastConnectedAt?: number;
  sessionStartedAt?: number;
  appVersion?: string;
  runtimes: CliRuntimeSummary[];
  paths: Array<{
    id: string;
    path: string;
    label: string;
    kind?: CliProfilePathEntry["kind"];
    parentPathId?: string;
  }>;
};

/** Build hover-card data from a profile item (`cli.profiles.listByProject` shape). */
export function toProfileDetails(profile: {
  name: string;
  profileKey?: string;
  hostname?: string;
  isOnline: boolean;
  createdAt?: number;
  lastConnectedAt?: number;
  sessionStartedAt?: number;
  appVersion?: string;
  availableClis?: AvailableCliInfo[];
  paths: ProfileDetailsData["paths"];
}): ProfileDetailsData {
  return {
    name: profile.name,
    profileKey: profile.profileKey,
    hostname: profile.hostname,
    isOnline: profile.isOnline,
    createdAt: profile.createdAt,
    lastConnectedAt: profile.lastConnectedAt,
    sessionStartedAt: profile.sessionStartedAt,
    appVersion: profile.appVersion,
    runtimes: toRuntimeSummaries(profile.availableClis ?? []),
    paths: profile.paths,
  };
}

export function formatProfileConnectionStatus(
  profile: Pick<ProfileDetailsData, "isOnline" | "lastConnectedAt" | "sessionStartedAt">
) {
  if (profile.isOnline) {
    return profile.sessionStartedAt
      ? `Connected ${formatDistanceToNow(profile.sessionStartedAt, { addSuffix: true })}`
      : "Connected now";
  }

  return profile.lastConnectedAt
    ? `Last seen ${formatDistanceToNow(profile.lastConnectedAt, { addSuffix: true })}`
    : "Never connected";
}

export function getProfileRuntimeLabel(type: string) {
  return isCliType(type) ? CLI_TYPE_MAP[type] : type;
}

/** Human-readable connection labels for runtime `provider` metadata. */
const RUNTIME_PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude.ai",
  bedrock: "AWS Bedrock",
  mantle: "AWS Bedrock (Mantle)",
  gemini: "Gemini API key",
};

export function getRuntimeProviderLabel(provider: string) {
  return RUNTIME_PROVIDER_LABELS[provider] ?? provider;
}

/** Version, connection and catalog size; Antigravity's catalog size is not shown. */
export function formatRuntimeDetail(runtime: CliRuntimeSummary) {
  const count = runtime.type === "antigravity" ? undefined : runtime.modelCount;
  return [
    runtime.version,
    runtime.provider ? getRuntimeProviderLabel(runtime.provider) : undefined,
    count !== undefined ? `${count} ${count === 1 ? "model" : "models"}` : undefined,
  ].filter(Boolean).join(" · ");
}

function DetailLine({ icon: Icon, label, value }: { icon: typeof Monitor; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[14px_82px_minmax(0,1fr)] items-start gap-2 text-xs">
      <Icon className="mt-0.5 size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground" title={value}>{value}</span>
    </div>
  );
}

/** A folder's repos, indented under it by relative path, each with its worktrees (cli-multi-repo-projects.md#picking-a-repo). */
function FolderRepoList({ paths, folder }: { paths: ProfileDetailsData["paths"]; folder: { id: string; label: string } }) {
  const repos = folderRepos(paths, folder.id);
  if (repos.length === 0) return null;
  return (
    <ul aria-label={`Repos in ${folder.label}`} className="mt-1 space-y-0.5 border-l border-border pl-2">
      {repos.map((repo) => {
        const worktrees = paths.filter((path) => path.kind === "worktree" && path.parentPathId === repo.id);
        return (
          <li key={repo.id} className="min-w-0 text-xs text-foreground">
            <span className="flex min-w-0 items-center gap-1.5" title={repo.path}>
              <FolderGit2 className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{repo.label}</span>
            </span>
            {worktrees.length > 0 && (
              <ul aria-label={`Worktrees of ${repo.label}`} className="ml-[18px] space-y-0.5">
                {worktrees.map((worktree) => (
                  <li key={worktree.id} className="flex min-w-0 items-center gap-1.5 text-muted-foreground" title={worktree.path}>
                    <GitBranch className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{worktree.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ProfileDetails({ profile, className }: { profile: ProfileDetailsData; className?: string }) {
  const regularPaths = profile.paths.filter(isConfiguredPath);
  const worktreeCount = profile.paths.filter((path) => path.kind === "worktree").length;
  const connectionValue = formatProfileConnectionStatus(profile);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <DetailLine icon={Monitor} label="Machine" value={profile.hostname ?? "Unknown"} />
        <DetailLine icon={KeyRound} label="Profile key" value={profile.profileKey ?? "Default"} />
        {profile.appVersion ? (
          <DetailLine icon={SquareTerminal} label="CLI version" value={`v${profile.appVersion}`} />
        ) : null}
        <DetailLine icon={Clock3} label="Connection" value={connectionValue} />
        {profile.createdAt ? (
          <DetailLine icon={CalendarDays} label="Created" value={format(profile.createdAt, "d MMM yyyy, HH:mm")} />
        ) : null}
      </div>

      <div className="border-t border-border pt-2.5">
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Bot className="size-3.5" />
          {profile.isOnline ? "Available agents" : "Last detected agents"}
        </div>
        {profile.runtimes.length > 0 ? (
          <div className="space-y-1">
            {profile.runtimes.map((runtime, index) => (
              <div key={`${runtime.type}-${runtime.version}-${index}`} className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-foreground">{getProfileRuntimeLabel(runtime.type)}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {formatRuntimeDetail(runtime)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No CLI runtime data reported.</p>
        )}
      </div>

      <div className="border-t border-border pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="flex items-center gap-2"><FolderGit2 className="size-3.5" />Working directories</span>
          <span>{regularPaths.length}{worktreeCount > 0 ? ` + ${worktreeCount} ${worktreeCount === 1 ? "worktree" : "worktrees"}` : ""}</span>
        </div>
        {regularPaths.length > 0 ? (
          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {regularPaths.map((path) => (
              <div key={path.id} className="min-w-0 text-xs">
                <div className="truncate font-medium text-foreground">{path.label}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={path.path}>{path.path}</div>
                <FolderRepoList paths={profile.paths} folder={path} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No working directories configured.</p>
        )}
      </div>
    </div>
  );
}
