import { useCallback, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { DragStrip } from "@/components/drag-strip";
import { saveProfile, startAgent } from "@/lib/backend";
import { getCliBin } from "@/lib/cli-bin";
import { getVerboseLoggingPref } from "@/lib/verbose-logging";
import { StepConnect, type Credentials } from "./step-connect";
import { StepAgents } from "./step-agents";
import { StepWorkspace, type WorkspaceSelection } from "./step-workspace";
import { StepDone, type LaunchState } from "./step-done";

const STEP_COUNT = 4;

/** `onCancel` is set when re-entered from settings ("New profile") — first-run onboarding has no way out. */
export function Onboarding({ onComplete, onCancel }: { onComplete: () => void; onCancel?: () => void }) {
  const [step, setStep] = useState(1);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [readyAgents, setReadyAgents] = useState(0);
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [launch, setLaunch] = useState<LaunchState>({ phase: "saving" });

  const canContinue =
    step === 1 ? credentials !== null
    : step === 2 ? readyAgents > 0
    : step === 3 ? selection !== null
    : launch.phase === "online" || launch.phase === "cli-missing";

  const runLaunch = useCallback(
    async (workspace: WorkspaceSelection, creds: Credentials) => {
      setLaunch({ phase: "saving" });
      try {
        const saved = await saveProfile({
          name: workspace.project.name,
          url: creds.url,
          apiKey: creds.apiKey,
          projectId: workspace.project.id,
          paths: workspace.paths,
        });
        setLaunch({ phase: "starting" });
        const started = await startAgent(saved.key, getCliBin(), getVerboseLoggingPref());
        if (started.ok) {
          setLaunch({ phase: "online", profileKey: saved.key });
        } else if (started.error === "cli-not-found") {
          setLaunch({ phase: "cli-missing", profileKey: saved.key });
        } else {
          setLaunch({ phase: "error", message: started.error ?? "Could not start the agent." });
        }
      } catch (error) {
        setLaunch({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    []
  );

  function next() {
    if (step === 3 && selection && credentials) {
      setStep(4);
      void runLaunch(selection, credentials);
      return;
    }
    if (step === 4) {
      void getCurrentWindow().hide().catch(() => {});
      onComplete();
      return;
    }
    setStep((value) => Math.min(STEP_COUNT, value + 1));
  }

  return (
    <main className="flex h-screen flex-col">
      <DragStrip />

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-10 pt-2">
        {step === 1 ? <StepConnect credentials={credentials} onConnected={setCredentials} /> : null}
        {step === 2 ? <StepAgents onReadyCountChange={setReadyAgents} /> : null}
        {step === 3 && credentials ? (
          <StepWorkspace credentials={credentials} selection={selection} onSelectionChange={setSelection} />
        ) : null}
        {step === 4 ? (
          <StepDone
            launch={launch}
            onRetry={() => {
              if (selection && credentials) void runLaunch(selection, credentials);
            }}
          />
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-between px-6 pb-4.5 pt-4">
        {step === 1 && onCancel ? (
          <Button variant="quiet" size="pill" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="quiet"
            size="pill"
            className={step > 1 && step < 4 ? "" : "invisible"}
            onClick={() => setStep((value) => Math.max(1, value - 1))}
          >
            ‹&nbsp;&nbsp;Go back
          </Button>
        )}
        <div className="flex gap-1.5">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <span
              key={index}
              className={`size-1.5 rounded-full ${index < step ? "bg-foreground/70" : "bg-border-strong opacity-50"}`}
            />
          ))}
        </div>
        <Button size="pill" disabled={!canContinue} onClick={next}>
          {step === STEP_COUNT ? "Finish" : "Continue"}
        </Button>
      </footer>
    </main>
  );
}
