import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandLine } from "@/components/command-line";
import { StatusCircle } from "@/components/status-circle";
import { getCliBin } from "@/lib/cli-bin";

export type LaunchState =
  | { phase: "saving" }
  | { phase: "starting" }
  | { phase: "online"; profileKey: string }
  | { phase: "cli-missing"; profileKey: string }
  | { phase: "error"; message: string };

export function StepDone({ launch, onRetry }: { launch: LaunchState; onRetry: () => void }) {
  return (
    <div className="flex w-full max-w-[360px] flex-1 flex-col items-center justify-center pb-8 text-center">
      {launch.phase === "saving" || launch.phase === "starting" ? (
        <>
          <Loader2 className="mb-4 size-7 animate-spin text-muted-foreground" />
          <h2 className="mb-1.5 text-[19px] font-semibold tracking-tight">
            {launch.phase === "saving" ? "Saving your profile…" : "Starting your agent…"}
          </h2>
        </>
      ) : launch.phase === "online" ? (
        <>
          <StatusCircle tone="success" className="mb-4">✓</StatusCircle>
          <h2 className="mb-1.5 text-[19px] font-semibold tracking-tight">Your agent is online</h2>
          <p className="mb-5 text-[13.5px] leading-relaxed text-muted-foreground">
            Profile <span className="font-mono text-foreground/80">{launch.profileKey}</span> is connected. Send a
            message to any thread in Convoy and it runs here.
          </p>
          <TrayHint />
        </>
      ) : launch.phase === "cli-missing" ? (
        <>
          <StatusCircle tone="warning" className="mb-4">!</StatusCircle>
          <h2 className="mb-1.5 text-[19px] font-semibold tracking-tight">Profile saved — CLI missing</h2>
          <p className="mb-4 text-[13.5px] leading-relaxed text-muted-foreground">
            Your profile <span className="font-mono text-foreground/80">{launch.profileKey}</span> is ready, but{" "}
            <span className="font-mono text-foreground/80">{getCliBin()}</span> isn't resolvable in your shell, so the
            agent can't start yet.{" "}
            {getCliBin() === "convoy-dev" ? "Check the alias/PATH entry and retry:" : "Install it and retry:"}
          </p>
          <CommandLine
            className="mb-4 w-full"
            command={getCliBin() === "convoy-dev" ? "command -v convoy-dev" : "npm install -g @useconvoy/cli"}
          />
          <Button variant="quiet" size="pill" onClick={onRetry}>
            Retry start
          </Button>
        </>
      ) : (
        <>
          <StatusCircle tone="destructive" className="mb-4">✕</StatusCircle>
          <h2 className="mb-1.5 text-[19px] font-semibold tracking-tight">Something went wrong</h2>
          <p className="mb-4 break-words text-[13px] text-muted-foreground">{launch.message}</p>
          <Button variant="quiet" size="pill" onClick={onRetry}>
            Try again
          </Button>
        </>
      )}
    </div>
  );
}

function TrayHint() {
  return (
    <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5 text-left text-[12.5px] text-muted-foreground">
      <span className="font-semibold text-foreground">Where did the window go?</span> Convoy lives in your menu bar
      and Dock. Closing this window keeps agents running.
      <div className="mt-2.5 flex items-center justify-end gap-3.5 rounded-md border border-border bg-code px-3 py-1.5 text-[11.5px] text-faint">
        <span>◐</span>
        <span>▲</span>
        <span className="text-foreground">◎</span>
        <span>Wed 13:42</span>
      </div>
    </div>
  );
}
