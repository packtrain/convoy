import { Bot, ChevronDown, CornerDownLeft, GitBranch, Laptop, MousePointerClick, Plus, SquareCheck, Workflow } from "lucide-react";
import OpenAIIcon from "./openai";
import styles from "./preview-composer.module.css";

// Geometry and spacing mirror thread-composer.tsx and context-window-meter.tsx.
export function PreviewComposer({ task }: { task?: { id: string; title: string } }) {
  const circumference = 2 * Math.PI * 7.5;
  return (
    <section className={`${styles.area} ${task ? styles.embedded : ""}`} aria-label={task ? "Activity composer" : "Thread composer"}>
      <div className={styles.content}>
        <div className={styles.context} data-composer-context>
          <button type="button" className={`${styles.control} ${styles.directory}`} aria-disabled="true" title="Local Dev / workspace">
            <span className={styles.online} />
            <span className={styles.directoryLabel}>Local Dev{!task && <span className={styles.path}> / workspace</span>}</span>
            <ChevronDown className={styles.chevron} />
          </button>
          <span className={`${styles.workspace} ${task ? styles.environment : ""}`}><Laptop /><span>Work locally</span>{task && <ChevronDown className={styles.chevron} />}</span>
          <span className={styles.workspace}><GitBranch /><span>main</span></span>
          {task ? <>
            <button type="button" className={`${styles.control} ${styles.agent}`} aria-disabled="true"><Bot /><span>Default</span><ChevronDown className={styles.chevron} /></button>
            <button type="button" className={`${styles.control} ${styles.workflow}`} aria-disabled="true"><Workflow /><span>Workflow</span><ChevronDown className={styles.chevron} /></button>
          </> : <div className={styles.meters}>
            <span className={styles.cost}>$4.71</span>
            <button type="button" className={styles.meter} aria-label="Context window 28% used" title="Context window: 28% used (72% left)">
              <span><svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r={7.5} fill="none" stroke="color-mix(in oklab, currentColor 35%, transparent)" strokeWidth="2.5" />
                <circle cx="12" cy="12" r={7.5} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * .72} />
              </svg></span>
            </button>
          </div>}
        </div>
        <div className={styles.input}>
          {task && <div className={styles.attachments}><span className={styles.task}><SquareCheck /><span>{task.id}</span><span className={styles.taskTitle}>{task.title}</span></span></div>}
          <textarea readOnly aria-label={task ? "Start a new thread" : "Follow-up message"} placeholder={task ? "Start a new thread..." : "Ask a follow-up question..."} className={styles.textarea} />
          <div className={styles.footer}>
            <div className={styles.tools}>
              <button type="button" className={styles.add} aria-label="Add attachment" aria-disabled="true"><Plus /></button>
              <button type="button" className={styles.control} aria-disabled="true"><OpenAIIcon /><span>GPT-6 Astra</span><ChevronDown className={styles.chevron} /></button>
              <button type="button" className={styles.control} aria-label="Agent mode: Act" aria-disabled="true"><MousePointerClick /><span>Act</span><ChevronDown className={styles.chevron} /></button>
            </div>
            <button type="button" className={styles.send} aria-label="Send message" aria-disabled="true"><CornerDownLeft /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
