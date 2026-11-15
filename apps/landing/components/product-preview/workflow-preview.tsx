import { ChevronDown, Hand, Terminal, Zap } from "lucide-react";
import { RuntimeIcon } from "./runtime-icons";
import styles from "./workflow-preview.module.css";

// Presentation follows workflow-grid.tsx and workflow-wait-card.tsx.
function PromptCard({ children, runtime }: { children: React.ReactNode; runtime?: "codex" | "claude-code" }) {
  return (
    <div className={styles.card} data-workflow-card="prompt">
      <div className={styles.cardBody}>
        <h4>{children}</h4>
        <div className={styles.pills}>
          {runtime && <span className={styles.runtime}><RuntimeIcon runtime={runtime} /><span>{runtime === "codex" ? "GPT-6 Astra" : "Claude Code"}</span></span>}
          <span className={styles.pill}>{runtime ? "Plan" : "Act"}</span>
        </div>
      </div>
    </div>
  );
}

function WorkflowGrid() {
  const stages = [
    {
      name: "Implement",
      engineering: <>
        <PromptCard>Add exponential backoff for failed webhook deliveries. Keep the delivery history on the task.</PromptCard>
        <div className={`${styles.card} ${styles.wait}`} data-workflow-card="wait"><Hand /><span>Review before continuing</span></div>
      </>,
      review: null,
    },
    {
      name: "Verify",
      engineering: <div className={`${styles.card} ${styles.bash}`} data-workflow-card="bash">
        <div className={styles.cardBody}>
          <div className={styles.script}><Terminal /><code>pnpm test:once</code></div>
          <div className={styles.pills}><span className={styles.bashPill}>Timeout: 10m</span><span className={styles.bashPill}>Stop on failure</span></div>
        </div>
      </div>,
      review: <>
        <PromptCard runtime="codex">Review retry limits, idempotency and delivery history. Leave findings on the task.</PromptCard>
        <PromptCard runtime="claude-code">Check webhook signatures and error handling for security issues.</PromptCard>
      </>,
    },
  ];
  return (
    <div className={styles.grid} role="table" aria-label="Webhook delivery workflow">
      <div className={styles.row} role="row">
        <div className={`${styles.header} ${styles.stage}`} role="columnheader">Stage</div>
        <div className={styles.header} role="columnheader"><span className={styles.laneName}>Engineering</span><span className={styles.selector}><RuntimeIcon runtime="codex" /><span>GPT-6 Astra</span><ChevronDown /></span></div>
        <div className={styles.header} role="columnheader"><span className={styles.laneName}>Review</span><span className={styles.selector}><Zap /><span>Parallel</span><ChevronDown /></span></div>
      </div>
      {stages.map((stage, index) => <div key={stage.name} role="rowgroup">
        <div className={`${styles.row} ${index % 2 ? styles.alternate : ""}`} role="row">
          <div className={`${styles.stage} ${styles.stageName}`} role="rowheader">{stage.name}</div>
          <div className={styles.cell} role="cell">{stage.engineering}</div>
          <div className={styles.cell} role="cell">{stage.review}</div>
        </div>
      </div>)}
      <div className={styles.spacer} aria-hidden="true"><span /><span /><span /></div>
    </div>
  );
}

export function WorkflowPreview({ reference = false }: { reference?: boolean }) {
  return (
    <div className={`${styles.scene} ${reference ? styles.reference : ""}`}>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Workflow grid. Scroll horizontally to see both lanes.">
        <WorkflowGrid />
      </div>
    </div>
  );
}
