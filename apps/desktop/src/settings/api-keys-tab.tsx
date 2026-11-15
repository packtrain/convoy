import { useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteProviderKey,
  saveProviderKey,
  type ConfigInfo,
  type ProviderKeyInfo,
} from "@/lib/backend";

export const PROVIDER_LABELS: Record<string, string> = {
  bedrock: "AWS Bedrock",
  mantle: "AWS Bedrock (Mantle)",
  anthropic: "Claude.ai subscription",
};

/** `anthropic` stores no credential — it pins this machine's Claude sign-in. */
const CREDENTIAL_FREE_PROVIDERS = new Set(["anthropic"]);

function requiresToken(provider: string): boolean {
  return !CREDENTIAL_FREE_PROVIDERS.has(provider);
}

function maskToken(token: string | null | undefined): string {
  if (!token) {
    return "no key";
  }
  return token.length > 10 ? `${token.slice(0, 6)}…${token.slice(-4)}` : "***";
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * API keys tab: one shared list of model providers. Claude Code takes any entry;
 * Codex takes Bedrock/Mantle keys with a Region (OS-2105). Entries live in
 * config.toml on this machine and are assigned per profile and runtime from the
 * Profiles tab.
 */
export function ApiKeysTab({ config, onReload }: { config: ConfigInfo; onReload: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <ClaudeCodeKeysCard config={config} onReload={onReload} />
      <div className="text-xs text-faint">
        Keys are stored in <span className="font-mono">~/.config/convoy/config.toml</span> on
        this machine only — they are never sent to the Convoy backend. Assign a key to a
        profile from the Profiles tab.
      </div>
    </div>
  );
}

function ClaudeCodeKeysCard({ config, onReload }: { config: ConfigInfo; onReload: () => void }) {
  const [adding, setAdding] = useState(false);
  /** Name of the key whose row is replaced by the edit form. */
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function removeKey(name: string) {
    setError(null);
    try {
      await deleteProviderKey(name);
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="text-[13px] font-semibold">Claude Code and Codex</div>
      <div className="mt-0.5 text-[12.5px] text-muted-foreground">
        Route Claude Code through AWS Bedrock or Mantle instead of this machine's Claude
        sign-in (e.g. your claude.ai subscription) — or add a "Claude.ai subscription" entry
        to pin the sign-in on a machine whose global config enables Bedrock. Codex can use a
        Bedrock or Mantle key that has a region.
      </div>

      {config.keys.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {config.keys.map((key) => {
            if (editing === key.name) {
              return (
                <ProviderKeyForm
                  key={key.name}
                  initial={key}
                  onDone={() => {
                    setEditing(null);
                    onReload();
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            }
            const usedBy = config.profiles.flatMap((profile) => [
              ...(profile.providerKey === key.name ? [profile.key] : []),
              ...(profile.codexProviderKey === key.name ? [`${profile.key} (Codex)`] : []),
            ]);
            return (
              <div
                key={key.name}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-[12.5px]"
              >
                <span className="font-mono font-medium">{key.name}</span>
                <Badge variant="secondary">{providerLabel(key.provider)}</Badge>
                {key.region ? <span className="text-muted-foreground">{key.region}</span> : null}
                <span className="min-w-0 flex-1 truncate text-right font-mono text-faint">
                  {maskToken(key.token)}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {usedBy.length > 0 ? `used by ${usedBy.join(", ")}` : "unused"}
                </span>
                <button
                  className="shrink-0 cursor-pointer text-faint hover:text-foreground"
                  title="Edit key"
                  onClick={() => {
                    setAdding(false);
                    setEditing(key.name);
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  className="shrink-0 cursor-pointer text-faint hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  title={usedBy.length > 0 ? "Unassign from profiles first" : "Delete key"}
                  disabled={usedBy.length > 0}
                  onClick={() => void removeKey(key.name)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 text-[12.5px] text-faint">
          No keys yet — Claude Code uses this machine's own Claude sign-in.
        </div>
      )}

      {adding ? (
        <ProviderKeyForm
          onDone={() => {
            setAdding(false);
            onReload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          variant="quiet"
          size="sm"
          className="mt-3"
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          + Add key
        </Button>
      )}

      {error ? <div className="mt-3 text-[12.5px] text-destructive">{error}</div> : null}
    </div>
  );
}

const PROVIDER_OPTIONS = ["bedrock", "mantle", "anthropic"] as const;

type ProviderOption = (typeof PROVIDER_OPTIONS)[number];

function isProviderOption(value: string | undefined): value is ProviderOption {
  return PROVIDER_OPTIONS.includes(value as ProviderOption);
}

/**
 * Add/edit form. `save_provider_key` overwrites by name, so editing keeps the
 * name fixed — renaming would silently orphan `provider_key` references.
 */
function ProviderKeyForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: ProviderKeyInfo;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [provider, setProvider] = useState<ProviderOption>(
    isProviderOption(initial?.provider) ? initial.provider : "bedrock"
  );
  const [token, setToken] = useState(initial?.token ?? "");
  const [region, setRegion] = useState(initial?.region ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const credentialFree = !requiresToken(provider);
      await saveProviderKey({
        name: name.trim(),
        provider,
        token: credentialFree ? "" : token.trim(),
        region: credentialFree ? null : region.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5 rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex items-center gap-2.5">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Key name (e.g. work-bedrock)"
          className="h-8 flex-1 font-mono text-[12.5px]"
          aria-label="Key name"
          disabled={initial !== undefined}
        />
        <Select
          value={provider}
          onValueChange={(value) => setProvider(isProviderOption(value) ? value : "bedrock")}
        >
          <SelectTrigger className="w-48 shrink-0" aria-label="Provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {PROVIDER_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {requiresToken(provider) ? (
        <>
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="API key / bearer token"
            className="h-8 font-mono text-[12.5px]"
            aria-label="API key or bearer token"
          />
          <Input
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            placeholder="AWS region (required for Codex, e.g. us-east-1)"
            className="h-8 font-mono text-[12.5px]"
            aria-label="AWS region"
          />
        </>
      ) : (
        <div className="text-[12.5px] text-faint">
          No credential needed — profiles using this entry run Claude Code on this machine's
          Claude sign-in, even when the global config enables Bedrock or Mantle.
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={saving || !name.trim() || (requiresToken(provider) && !token.trim())}
          onClick={() => void save()}
        >
          {initial ? "Save changes" : "Save key"}
        </Button>
        <Button variant="quiet" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error ? <div className="text-[12.5px] text-destructive">{error}</div> : null}
    </div>
  );
}
