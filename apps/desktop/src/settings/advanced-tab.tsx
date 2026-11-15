import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AgentsManager } from "@/components/agents-manager";
import {
  listLocalAgents,
  openConfigFile,
  readAgentLog,
  stopLocalAgent,
  type LocalAgentInfo,
} from "@/lib/backend";
import { getCliBin, setCliBin, type CliBin } from "@/lib/cli-bin";
import { getVerboseLoggingPref, setVerboseLoggingPref } from "@/lib/verbose-logging";

export function AdvancedTab() {
  return (
    <div className="flex flex-col gap-6">
      <RunningLocalConnections />

      <div>
        <Label>Coding agents</Label>
        <AgentsManager />
      </div>

      <div>
        <Label>Agent log</Label>
        <VerboseLoggingRow />
        <AgentLog />
      </div>

      <div>
        <Label>Configuration</Label>
        <div className="flex items-center gap-3">
          <Button variant="quiet" size="sm" onClick={() => void openConfigFile().catch(() => {})}>
            Open config.toml
          </Button>
          {import.meta.env.DEV ? <DevCliSelector /> : null}
        </div>
        <div className="mt-2 text-xs text-faint">
          Everything on this screen is a view over{" "}
          <span className="font-mono">~/.config/convoy/config.toml</span> — edit it directly if you prefer.
        </div>
      </div>
    </div>
  );
}

function RunningLocalConnections() {
  const [agents, setAgents] = useState<LocalAgentInfo[] | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listLocalAgents()
      .then((next) => {
        setAgents(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  // list_local_agents forks `ps` plus one `lsof` per discovered connection
  // (working directory), so this is the most expensive poll in the app. The
  // inventory changes only when an agent starts or stops, and there is a
  // manual Refresh next to the heading.
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function stop(agent: LocalAgentInfo) {
    setStoppingId(agent.id);
    setError(null);
    try {
      await stopLocalAgent(agent);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (!message.includes("local-agent-not-found")) {
        setError(message);
      }
    } finally {
      setStoppingId(null);
      refresh();
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Running local connections</Label>
          <p className="mt-1 text-xs text-faint">
            Every <span className="font-mono">convoy connect</span> process visible on this Mac.
          </p>
        </div>
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label="Refresh running local connections"
          title="Refresh"
          onClick={refresh}
        >
          <RefreshCw />
        </Button>
      </div>

      <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-card px-4">
        {agents === null ? (
          <div className="py-4 text-xs text-faint">Finding local connections…</div>
        ) : agents.length === 0 ? (
          <div className="py-4 text-xs text-faint">No local connections are running.</div>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {agent.profileKey ?? "Auto-resolved profile"}
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {agent.managed ? "Desktop managed" : "Discovered locally"}
                  </span>
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                  title={agent.workingDirectory ?? undefined}
                >
                  {agent.workingDirectory ?? "Working directory unavailable"}
                </div>
                <div className="mt-1 text-[11px] text-faint">
                  PID {agent.pid}
                  {agent.processCount > 1 ? ` · ${agent.processCount} processes` : ""}
                  {" · "}
                  started {formatStartedAt(agent.startedAt)}
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                disabled={stoppingId !== null}
                onClick={() => void stop(agent)}
              >
                {stoppingId === agent.id ? "Stopping…" : "Stop"}
              </Button>
            </div>
          ))
        )}
      </div>
      {error ? <div className="mt-2 text-[12.5px] text-destructive">{error}</div> : null}
    </section>
  );
}

function formatStartedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

/** Per-chunk CLI debug logging. Off by default — it is what makes the daily
 * log grow without bound; applies to agents started after the change. */
function VerboseLoggingRow() {
  const [enabled, setEnabled] = useState(getVerboseLoggingPref);

  return (
    <div className="mb-3 flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px]">Verbose agent logging</div>
        <div className="mt-0.5 text-[11px] text-faint">
          Logs every agent stream chunk. Useful for debugging, but it makes the log file grow fast. Takes effect
          the next time an agent starts.
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(next) => {
          setEnabled(next);
          setVerboseLoggingPref(next);
        }}
      />
    </div>
  );
}

/** Debug tail of the spawned CLI's output (file: ~/.config/convoy/logs/desktop-agent-YYYY-MM-DD.log). */
function AgentLog() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState("");

  useEffect(() => {
    if (!open) return;
    // One read at a time: without this guard a slow read (large log, busy
    // main thread) lets 2s polls stack up and overlap.
    let inFlight = false;
    let cancelled = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      void readAgentLog()
        .then((next) => {
          if (!cancelled) setLog(next);
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open]);

  return (
    <div className="w-full">
      <button
        className="cursor-pointer text-xs text-faint underline decoration-border-strong underline-offset-4 hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide agent log" : "Show agent log"}
      </button>
      {open ? (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-code p-3 font-mono text-[10.5px] leading-relaxed text-muted-foreground select-text">
          {log || "(log is empty — start the agent)"}
        </pre>
      ) : null}
    </div>
  );
}

/** Dev only: which CLI binary the supervisor spawns. */
function DevCliSelector() {
  const [cliBin, setCliBinState] = useState<CliBin>(getCliBin);
  return (
    <select
      value={cliBin}
      onChange={(event) => {
        const bin = event.target.value as CliBin;
        setCliBin(bin);
        setCliBinState(bin);
      }}
      title="Dev only: which CLI binary the supervisor spawns"
      className="h-8 cursor-pointer appearance-none rounded-md border border-border bg-card px-2 font-mono text-xs text-muted-foreground focus-visible:border-border-strong focus-visible:outline-none"
    >
      <option value="convoy">convoy</option>
      <option value="convoy-dev">convoy-dev</option>
    </select>
  );
}
