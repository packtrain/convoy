import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  runningAgents,
  saveProfile,
  setDefaultProfile,
  setProfileProviderKey,
  startAgent,
  stopAgent,
  type ConfigInfo,
  type ProfileInfo,
  type ProviderKeyInfo,
} from "@/lib/backend";
import { getCliBin } from "@/lib/cli-bin";
import { getVerboseLoggingPref } from "@/lib/verbose-logging";
import { providerLabel } from "./api-keys-tab";

/**
 * Radix Select items can't have an empty value; this maps to `provider_key`
 * unset. Key items are prefixed so a key literally named like the sentinel
 * cannot collide with it.
 */
const MACHINE_CONFIG = "machine-config";
/** Codex takes only AWS keys with a region (OS-2105). */
const CODEX_PROVIDERS: string[] = ["bedrock", "mantle"];
const KEY_VALUE_PREFIX = "key:";
const DEFAULT_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 50;

/**
 * GUI over the config.toml profile schema. Every change writes immediately —
 * config.toml is the source of truth and the CLI reads it fresh per start.
 * URL / project / API key are read-only: changing the deployment or account
 * is a re-login, which is what "New profile" (onboarding) is for.
 */
export function ProfilesTab({
  config,
  defaultProfileKey,
  onReload,
  onAddProfile,
}: {
  config: ConfigInfo;
  defaultProfileKey?: string;
  onReload: () => void;
  onAddProfile: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {config.profiles.map((profile) => (
        <ProfileCard
          key={profile.key}
          profile={profile}
          providerKeys={config.keys}
          isDefault={profile.key === defaultProfileKey}
          showMakeDefault={config.profiles.length > 1}
          onReload={onReload}
        />
      ))}
      <div className="flex items-center gap-3">
        <Button variant="quiet" size="sm" onClick={onAddProfile}>
          + New profile
        </Button>
        <span className="text-[12.5px] text-muted-foreground">
          Connects another project or server via onboarding.
        </span>
      </div>
      <div className="text-xs text-faint">
        Folder and runtime-setting changes reconnect a running agent to apply right away. Stored
        in <span className="font-mono">~/.config/convoy/config.toml</span>, shared with the{" "}
        <span className="font-mono">convoy</span> CLI.
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  providerKeys,
  isDefault,
  showMakeDefault,
  onReload,
}: {
  profile: ProfileInfo;
  providerKeys: ProviderKeyInfo[];
  isDefault: boolean;
  showMakeDefault: boolean;
  onReload: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const effectiveConcurrency = profile.concurrency ?? DEFAULT_CONCURRENCY;
  const [concurrencyInput, setConcurrencyInput] = useState(
    String(effectiveConcurrency)
  );

  useEffect(() => {
    setConcurrencyInput(String(profile.concurrency ?? DEFAULT_CONCURRENCY));
  }, [profile.concurrency]);

  async function persist(
    changes: Partial<
      Pick<ProfileInfo, "name" | "paths" | "streaming" | "isolated" | "concurrency">
    >
  ): Promise<boolean> {
    setError(null);
    try {
      await saveProfile({
        name: changes.name ?? name,
        url: profile.url,
        apiKey: profile.apiKey,
        projectId: profile.projectId,
        paths: changes.paths ?? profile.paths,
        streaming: changes.streaming ?? profile.streaming,
        isolated: changes.isolated ?? profile.isolated,
        concurrency: changes.concurrency ?? profile.concurrency,
        profileKey: profile.key,
      });
      onReload();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  // The CLI only reads config.toml at startup, so a live connection keeps the
  // old settings. Bounce it after a runtime-affecting change (isolation,
  // streaming, concurrency, folders, provider) so the change takes effect
  // without an app restart.
  async function restartIfRunning() {
    if (!(await runningAgents()).includes(profile.key)) return;
    setRestarting(true);
    try {
      await stopAgent(profile.key);
      const result = await startAgent(profile.key, getCliBin(), getVerboseLoggingPref());
      if (!result.ok) setError(result.error ?? "Could not restart the agent with the new setting.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestarting(false);
    }
  }

  async function persistAndRestart(
    changes: Partial<
      Pick<ProfileInfo, "paths" | "streaming" | "isolated" | "concurrency">
    >
  ) {
    const saved = await persist(changes);
    if (!saved) return;
    await restartIfRunning();
  }

  async function saveConcurrency() {
    const parsed = Number(concurrencyInput.trim());
    if (
      !Number.isInteger(parsed) ||
      parsed < MIN_CONCURRENCY ||
      parsed > MAX_CONCURRENCY
    ) {
      setError(
        `Max parallel workers must be an integer from ${MIN_CONCURRENCY} to ${MAX_CONCURRENCY}.`
      );
      setConcurrencyInput(String(effectiveConcurrency));
      return;
    }

    setError(null);
    if (parsed === effectiveConcurrency) {
      setConcurrencyInput(String(effectiveConcurrency));
      return;
    }
    const saved = await persist({ concurrency: parsed });
    if (!saved) {
      setConcurrencyInput(String(effectiveConcurrency));
      return;
    }
    await restartIfRunning();
  }

  async function changeProviderKey(keyName: string | null, runtime: "claude-code" | "codex") {
    setError(null);
    try {
      await setProfileProviderKey(profile.key, keyName, runtime);
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    await restartIfRunning();
  }

  async function makeDefault() {
    setError(null);
    try {
      await setDefaultProfile(profile.key);
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addFolder() {
    const picked = await openDialog({ directory: true, multiple: false, title: "Choose a repository folder" });
    if (typeof picked === "string" && !profile.paths.includes(picked)) {
      await persistAndRestart({ paths: [...profile.paths, picked] });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex items-center gap-3">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed) {
              setName(profile.name);
              return;
            }
            if (trimmed !== profile.name) void persist({ name: trimmed });
          }}
          className="h-8 max-w-[220px] font-semibold"
          aria-label="Profile name"
        />
        <span className="font-mono text-xs text-muted-foreground">{profile.key}</span>
        <div className="ml-auto shrink-0">
          {isDefault ? (
            <Badge variant="secondary">Default</Badge>
          ) : showMakeDefault ? (
            <Button variant="quiet" size="sm" onClick={() => void makeDefault()}>
              Make default
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3.5 flex flex-col gap-2.5">
        <ReadOnlyField label="Server" value={profile.url} />
        <ReadOnlyField label="Project ID" value={profile.projectId} />
        <ApiKeyField apiKey={profile.apiKey} />
      </div>

      <div className="mt-4">
        <Label>Folders</Label>
        <div className="flex flex-col gap-2">
          {profile.paths.map((path) => (
            <div
              key={path}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12.5px] text-foreground/80"
            >
              <span className="min-w-0 flex-1 truncate" title={path}>{path}</span>
              {profile.paths.length > 1 ? (
                <button
                  className="shrink-0 cursor-pointer text-faint hover:text-foreground"
                  title="Remove"
                  onClick={() =>
                    void persistAndRestart({
                      paths: profile.paths.filter((candidate) => candidate !== path),
                    })
                  }
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          <Button variant="quiet" size="sm" className="self-start" onClick={() => void addFolder()}>
            + Add folder
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-6 border-t border-border pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Max parallel workers</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            Maximum agent threads this profile can process at once (1–50).
          </div>
        </div>
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={concurrencyInput}
          disabled={restarting}
          aria-label="Max parallel workers"
          aria-invalid={error?.startsWith("Max parallel workers") || undefined}
          className="h-8 w-20 shrink-0 text-right font-mono"
          onChange={(event) => setConcurrencyInput(event.target.value)}
          onBlur={() => void saveConcurrency()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>

      <div className="mt-3.5 flex items-center gap-6 border-t border-border pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Stream partial output</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            Send delta events while the agent is still typing, instead of whole chunks.
          </div>
        </div>
        {/* Omitted in config.toml means on — the CLI default since OS-1659
            (`--buffered` opts out per run). */}
        <Switch
          checked={profile.streaming ?? true}
          disabled={restarting}
          onCheckedChange={(next) => void persistAndRestart({ streaming: next })}
        />
      </div>

      <div className="mt-3.5 flex items-center gap-6 border-t border-border pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Isolate agents</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            Sandbox agents to this profile's folders so they can't write elsewhere on your
            machine. Claude Code and Codex only.
          </div>
        </div>
        <Switch
          checked={profile.isolated ?? false}
          disabled={restarting}
          onCheckedChange={(next) => void persistAndRestart({ isolated: next })}
        />
      </div>

      <ProviderKeySelect
        label="Claude Code provider"
        description={
          'Follow this machine\'s Claude config, or pick an entry from the API keys tab — a Bedrock/Mantle key, or a "Claude.ai subscription" entry that pins the sign-in.'
        }
        machineLabel="This machine's Claude config"
        assigned={profile.providerKey}
        keys={providerKeys}
        disabled={restarting}
        onChange={(keyName) => void changeProviderKey(keyName, "claude-code")}
      />

      <ProviderKeySelect
        label="Codex provider"
        description="Follow this machine's Codex config, or run Codex through a Bedrock/Mantle key that has a region. Independent of the Claude Code provider."
        machineLabel="This machine's Codex config"
        assigned={profile.codexProviderKey}
        keys={providerKeys.filter((key) => CODEX_PROVIDERS.includes(key.provider) && key.region)}
        disabled={restarting}
        onChange={(keyName) => void changeProviderKey(keyName, "codex")}
      />

      {restarting ? (
        <div className="mt-3 text-[12.5px] text-muted-foreground">
          Reconnecting the agent to apply the change…
        </div>
      ) : null}
      {error ? <div className="mt-3 text-[12.5px] text-destructive">{error}</div> : null}
    </div>
  );
}

function ProviderKeySelect({
  label,
  description,
  machineLabel,
  assigned,
  keys,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  machineLabel: string;
  assigned?: string | null;
  keys: ProviderKeyInfo[];
  disabled: boolean;
  onChange: (keyName: string | null) => void;
}) {
  return (
    <div className="mt-3.5 flex items-center gap-6 border-t border-border pt-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</div>
      </div>
      <Select
        value={assigned ? `${KEY_VALUE_PREFIX}${assigned}` : MACHINE_CONFIG}
        disabled={disabled}
        onValueChange={(value) =>
          onChange(value === MACHINE_CONFIG ? null : value.slice(KEY_VALUE_PREFIX.length))
        }
      >
        <SelectTrigger className="shrink-0" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value={MACHINE_CONFIG}>{machineLabel}</SelectItem>
          {assigned && !keys.some((key) => key.name === assigned) ? (
            // Hand-edited config can reference a missing (or, for Codex, unusable) key;
            // surface it so the fix (pick another option) is obvious — connect refuses it.
            <SelectItem value={`${KEY_VALUE_PREFIX}${assigned}`}>
              {assigned} — missing key
            </SelectItem>
          ) : null}
          {keys.map((key) => (
            <SelectItem key={key.name} value={`${KEY_VALUE_PREFIX}${key.name}`}>
              {key.name} — {providerLabel(key.provider)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-20 shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground/80 select-text" title={value}>
        {value}
      </span>
    </div>
  );
}

function ApiKeyField({ apiKey }: { apiKey: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[12.5px] text-muted-foreground">API key</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground/80 select-text">
        {revealed ? apiKey : "•".repeat(24)}
      </span>
      <button
        className="shrink-0 cursor-pointer text-faint hover:text-foreground"
        title={revealed ? "Hide API key" : "Reveal API key"}
        onClick={() => setRevealed((value) => !value)}
      >
        {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}
