import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CommandLine } from "@/components/command-line";
import { InsetPanel } from "@/components/inset-panel";
import { StatusChip } from "@/components/status-chip";
import { detectAgents, installAgent, type AgentKind, type AgentStatus } from "@/lib/backend";
import { AGENT_CATALOG, type AgentMeta } from "@/lib/agent-catalog";

/**
 * Detect/install/sign-in rows for the agent CLI catalog, shared by onboarding and
 * settings.
 *
 * Per-row lifecycle: missing → installing → (signin | failed) → ready. "signin" trusts
 * the user's word via "Check again" — most CLIs have no reliable auth-status probe, so the
 * first run surfaces auth errors instead.
 */
type RowPhase = "missing" | "installing" | "signin" | "failed" | "ready";

interface RowState {
  phase: RowPhase;
  version?: string | null;
  error?: string | null;
}

export function AgentsManager({ onReadyCountChange }: { onReadyCountChange?: (count: number) => void }) {
  const [rows, setRows] = useState<Record<AgentKind, RowState> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const applyDetection = useCallback((statuses: AgentStatus[], previous: Record<AgentKind, RowState> | null) => {
    const next = {} as Record<AgentKind, RowState>;
    for (const meta of AGENT_CATALOG) {
      const status = statuses.find((entry) => entry.kind === meta.kind);
      const prior = previous?.[meta.kind];
      if (status?.installed) {
        // Keep an explicit sign-in gate if we were the ones who just installed it.
        next[meta.kind] =
          prior?.phase === "signin"
            ? { phase: "signin", version: status.version }
            : { phase: "ready", version: status.version };
      } else {
        next[meta.kind] = prior?.phase === "failed" ? prior : { phase: "missing" };
      }
    }
    return next;
  }, []);

  const scan = useCallback(
    async (announce: boolean) => {
      setScanning(true);
      if (announce) setScanMessage("Scanning…");
      try {
        const statuses = await detectAgents();
        setRows((previous) => applyDetection(statuses, previous));
        if (announce) setScanMessage(null);
      } catch (error) {
        setScanMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setScanning(false);
      }
    },
    [applyDetection]
  );

  useEffect(() => {
    void scan(false);
  }, [scan]);

  useEffect(() => {
    if (!rows) return;
    onReadyCountChange?.(Object.values(rows).filter((row) => row.phase === "ready").length);
  }, [rows, onReadyCountChange]);

  function setRow(kind: AgentKind, state: RowState) {
    setRows((previous) => (previous ? { ...previous, [kind]: state } : previous));
  }

  async function install(meta: AgentMeta) {
    setRow(meta.kind, { phase: "installing" });
    try {
      const result = await installAgent(meta.kind);
      if (result.ok) {
        setRow(meta.kind, { phase: "signin" });
      } else {
        setRow(meta.kind, { phase: "failed", error: result.error ?? "Install failed" });
      }
    } catch (error) {
      setRow(meta.kind, { phase: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="flex w-full flex-col">
      {!rows ? (
        <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
          <Spinner /> Scanning for installed agents…
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {AGENT_CATALOG.map((meta) => (
            <AgentRow
              key={meta.kind}
              meta={meta}
              row={rows[meta.kind]}
              onInstall={() => void install(meta)}
              onSignedIn={() => setRow(meta.kind, { phase: "ready", version: rows[meta.kind].version })}
            />
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button variant="quiet" size="sm" disabled={scanning} onClick={() => void scan(true)}>
          Scan again
        </Button>
        <span className="text-[12.5px] text-muted-foreground">
          {scanMessage ?? (
            <>
              Agents must be installed <i>and</i> signed in before they can take work.
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function AgentRow({
  meta,
  row,
  onInstall,
  onSignedIn,
}: {
  meta: AgentMeta;
  row: RowState;
  onInstall: () => void;
  onSignedIn: () => void;
}) {
  return (
    <div className="rounded-lg border border-border transition-colors hover:border-border-strong">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-[11.5px] font-bold text-muted-foreground">
          {meta.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">{meta.title}</div>
          <div className="text-xs text-muted-foreground">
            {row.version ? row.version : row.phase === "missing" ? "Not installed" : null}
          </div>
        </div>
        {row.phase === "ready" ? (
          <StatusChip tone="success" label="Ready" />
        ) : row.phase === "signin" ? (
          <StatusChip tone="warning" label="Sign-in required" />
        ) : row.phase === "installing" ? (
          <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Spinner className="size-3" /> Installing…
          </span>
        ) : (
          <Button variant="quiet" size="sm" onClick={onInstall}>
            {row.phase === "failed" ? "Retry" : "Install"}
          </Button>
        )}
      </div>

      {row.phase === "signin" ? (
        <InsetPanel className={PANEL_INSET}>
          <div className="text-[12.5px] font-semibold text-warning">Sign in to {meta.title}</div>
          <div className="text-[12.5px] text-muted-foreground">
            Agents use your own account. {meta.loginHint}
          </div>
          <CommandLine command={meta.loginCommand} />
          <Button variant="quiet" size="sm" onClick={onSignedIn}>
            Check again
          </Button>
        </InsetPanel>
      ) : null}

      {row.phase === "failed" ? (
        <InsetPanel className={PANEL_INSET}>
          <div className="text-[12.5px] font-semibold text-destructive">Automatic install failed</div>
          {row.error ? (
            <div className="max-h-16 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
              {row.error}
            </div>
          ) : null}
          <div className="text-[12.5px] text-muted-foreground">Do it manually:</div>
          <CommandLine command={meta.installCommand} />
          <ol className="list-decimal space-y-1 pl-4.5 text-[12.5px] text-muted-foreground">
            <li>
              Open <span className="font-medium text-foreground">Terminal</span> and paste the command above.
            </li>
            <li>
              When it finishes, sign in: <span className="font-mono text-foreground/80">{meta.loginCommand}</span>
            </li>
            <li>
              Come back and hit <span className="font-medium text-foreground">Scan again</span>.
            </li>
          </ol>
        </InsetPanel>
      ) : null}
    </div>
  );
}

/** Aligns the detail panel under the row's text column (past the initials tile). */
const PANEL_INSET = "mx-4 mb-3 ml-[60px]";
