import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/section-header";
import { StatusCircle } from "@/components/status-circle";
import {
  normalizeConvexUrl,
  pollBrowserLogin,
  startBrowserLogin,
  type LoginStart,
} from "@/lib/backend";

export interface Credentials {
  url: string;
  apiKey: string;
  email: string;
}

const LAST_URL_KEY = "convoy.lastServerUrl";

type Phase = "idle" | "starting" | "waiting" | "connected";

export function StepConnect({
  credentials,
  onConnected,
}: {
  credentials: Credentials | null;
  onConnected: (credentials: Credentials) => void;
}) {
  const [url, setUrl] = useState(() => localStorage.getItem(LAST_URL_KEY) ?? "");
  const [phase, setPhase] = useState<Phase>(credentials ? "connected" : "idle");
  const [start, setStart] = useState<LoginStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [manualKey, setManualKey] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const normalizedUrl = normalizeConvexUrl(url);
  const urlValid = /^https?:\/\/.+/.test(normalizedUrl);

  async function connectWithBrowser() {
    setError(null);
    setPhase("starting");
    localStorage.setItem(LAST_URL_KEY, normalizedUrl);
    try {
      const started = await startBrowserLogin(normalizedUrl);
      setStart(started);
      setPhase("waiting");
      void openUrl(started.loginUrl);

      const controller = new AbortController();
      abortRef.current = controller;
      const outcome = await pollBrowserLogin(normalizedUrl, started, controller.signal);
      if (controller.signal.aborted) return;

      if (outcome.status === "approved") {
        setPhase("connected");
        onConnected({ url: normalizedUrl, apiKey: outcome.apiKey, email: outcome.email });
        return;
      }
      setPhase("idle");
      setError(outcome.status === "denied" ? "Login was denied in the browser." : "Login request expired. Try again.");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function cancelWaiting() {
    abortRef.current?.abort();
    setStart(null);
    setPhase("idle");
  }

  function useManualKey() {
    if (!manualKey.trim()) return;
    localStorage.setItem(LAST_URL_KEY, normalizedUrl);
    setPhase("connected");
    onConnected({ url: normalizedUrl, apiKey: manualKey.trim(), email: "" });
  }

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center text-center">
      <SectionHeader
        align="center"
        title="Connect to Convoy"
        description="Approve this Mac in your browser to link it to your workspace. No keys to copy."
      />

      {phase === "connected" ? (
        <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-success/50 bg-card px-4 py-5">
          <StatusCircle tone="success" className="mb-1 size-8 text-sm">✓</StatusCircle>
          <div className="text-sm font-semibold">Connected</div>
          <div className="text-[12.5px] text-muted-foreground">
            {credentials?.email ? credentials.email : "API key accepted"}
          </div>
        </div>
      ) : phase === "waiting" && start ? (
        <div className="w-full">
          <div className="flex w-full flex-col items-center gap-1 rounded-lg border border-border bg-card px-4 py-5">
            <Loader2 className="mb-1.5 size-5 animate-spin text-muted-foreground" />
            <div className="text-sm font-semibold">Waiting for approval…</div>
            <div className="text-[12.5px] text-muted-foreground">
              Click <span className="font-medium text-foreground">Approve</span> in the browser tab we opened.
            </div>
          </div>
          <div className="mt-3.5 rounded-lg border border-border bg-card px-4 py-3 text-left">
            <div className="text-[12.5px] text-muted-foreground">
              No browser? Go to <span className="font-mono text-foreground/80">{start.deviceUrl}</span> and enter:
            </div>
            <div className="mt-1 font-mono text-lg font-semibold tracking-[0.3em]">{start.userCode}</div>
          </div>
          <div className="mt-3.5 flex justify-center gap-5">
            <Button variant="link" size="sm" onClick={() => void openUrl(start.loginUrl)}>
              Open the link again
            </Button>
            <Button variant="link" size="sm" onClick={cancelWaiting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="w-full text-left">
          <Label htmlFor="server-url">Server URL</Label>
          <Input
            id="server-url"
            placeholder="https://your-deployment.convex.cloud"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="font-mono text-[13px]"
          />

          <Button
            size="block"
            className="mt-4"
            disabled={!urlValid || phase === "starting"}
            onClick={() => void connectWithBrowser()}
          >
            {phase === "starting" ? <Loader2 className="animate-spin" /> : null}
            Continue with browser
          </Button>

          <div className="my-4 flex items-center gap-3 text-[11px] tracking-[0.08em] text-faint">
            <span className="h-px flex-1 bg-border" />OR<span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="quiet" size="block" onClick={() => setShowKeyInput((value) => !value)}>
            Paste an API key
          </Button>

          {showKeyInput ? (
            <div className="mt-3 rounded-lg border border-border bg-card p-3.5">
              <div className="text-[13px] font-semibold">API key</div>
              <div className="text-[12.5px] text-muted-foreground">
                Created under <span className="font-mono">Settings → API keys</span>.
              </div>
              <div className="mt-2.5 flex gap-2">
                <Input
                  placeholder="osk_..."
                  value={manualKey}
                  onChange={(event) => setManualKey(event.target.value)}
                  className="h-8 font-mono text-[12.5px]"
                />
                <Button size="sm" disabled={!urlValid || !manualKey.trim()} onClick={useManualKey}>
                  Connect
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <div className="mt-3 text-[12.5px] text-destructive">{error}</div> : null}
        </div>
      )}
    </div>
  );
}
