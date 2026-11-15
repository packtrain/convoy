import { useEffect, useRef, useState } from "react";
import styles from "./terminal.module.css";

// Deterministic review controls; no command execution. See the playground spec.
export function OperationPanel({ title, steps, failure, onDone, onBack }: {
  title: string; steps: string[]; failure: string; onDone: () => void; onBack: () => void;
}) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<"running" | "failed" | "canceled" | "complete">("running");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus(); }, [state]);
  return <section ref={panel} tabIndex={-1} onKeyDown={event => { if (event.key !== "Escape") return; event.preventDefault(); event.stopPropagation(); if (state === "running") setState("canceled"); else if (state === "complete") onDone(); else onBack(); }} aria-label={title} className={styles.setupForm}>
    <h2>{title}</h2><p className={styles.muted}>Esc {state === "running" ? "cancel operation" : state === "complete" ? "done" : "back to configuration"}</p>
    <ol className={styles.progressSteps}>{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}>{index < step || state === "complete" ? "✓" : index === step ? "→" : "·"} {label}</li>)}</ol>
    <p role="status">{state === "running" ? `Working: ${steps[step]}` : state === "complete" ? "Completed in this preview." : state === "failed" ? failure : "Canceled. Completed steps and inputs retained."}</p>
    {state === "running" ? <>
      <p className={styles.muted}>Demo controls · advance or fail the current step</p>
      <div><button onClick={() => step === steps.length - 1 ? setState("complete") : setStep(value => value + 1)}>Simulate step success</button><button onClick={() => setState("failed")}>Simulate failure</button><button onClick={() => setState("canceled")}>Cancel operation</button></div>
    </> : state === "complete" ? <button onClick={onDone}>Done</button> : <div><button onClick={() => setState("running")}>{state === "failed" ? "Retry failed step" : "Resume operation"}</button><button onClick={onBack}>Back to configuration</button></div>}
  </section>;
}
