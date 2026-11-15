"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight, Circle, CircleCheck, CircleHelp, CircleMinus, CircleX, File, FileDiff, FileText, ListChecks, ListTodo, PanelRightClose, PanelTop, SquareCheckBig, TriangleAlert, Wrench, X } from "lucide-react";
import { PreviewComposer } from "../preview-composer";
import threadStyles from "../hero-preview.module.css";
import { checks, type PreviewCheck } from "./fixtures";
import styles from "./checks-preview.module.css";

const statuses = {
  passed: { Icon: CircleCheck, label: "Passed" },
  warning: { Icon: TriangleAlert, label: "Warning" },
  failed: { Icon: CircleX, label: "Failed" },
  pending: { Icon: Circle, label: "Pending" },
  not_performed: { Icon: CircleMinus, label: "Not performed" },
};

function CheckRow({ check, compact = false }: { check: PreviewCheck; compact?: boolean }) {
  const { Icon, label } = statuses[check.status];
  return <details className={styles.row}>
    <summary><Icon aria-label={label} className={styles[check.status]} /><span title={check.label} className={check.status === "pending" ? styles.muted : undefined}>{check.label}</span>
      {!compact && check.added && <small className={styles.added}>Added</small>}
      {!compact && <small className={styles.time}>{check.status === "pending" ? "Pending" : "11h ago"}</small>}
      {check.status !== "pending" && <ChevronRight aria-hidden className={styles.chevron} />}
    </summary>
    <div className={styles.result}>
      <p>{check.note}</p>
      {check.file && <details className={styles.file}><summary><FileText /><span>{check.file}</span><ChevronDown /></summary><pre>{check.evidence}</pre></details>}
      {check.status !== "pending" && <p className={styles.provenance}>Reported by Alex in Webhook delivery</p>}
    </div>
  </details>;
}

function rowsFor(checklist: string) {
  return checks.filter(check => check.status !== "pending" || checklist === "Feature");
}

function ChecklistSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <select aria-label="Checklist" value={value} onChange={event => onChange(event.target.value)}><option>Feature</option><option>Bug fix</option><option>No checks</option></select>;
}

export function TaskChecksPreview() {
  const [checklist, setChecklist] = useState("Feature");
  const rows = rowsFor(checklist);
  return <section className={styles.taskChecks} aria-label="Task checks">
    <div className={styles.heading}><h4>Checks <small>3/{rows.length}</small></h4><ChecklistSelect value={checklist} onChange={setChecklist} /></div>
    {rows.map(check => <CheckRow key={check.key} check={check} compact />)}
  </section>;
}

function ThreadCrop() {
  return <div className={styles.threadCrop} data-thread-crop aria-hidden="true" inert>
    <div className={styles.thread}>
      <header className={threadStyles.threadHeader}><SquareCheckBig /><h2>Verify webhook delivery</h2></header>
      <div className={threadStyles.messageWidth}>
        <div className={threadStyles.userMessage}>Run the checks and attach the results.</div>
        <p>I&apos;ll run the tests, check the layout, and review the changes.</p>
        <div className={styles.tool}><Wrench /> 6 tool calls <ChevronRight /></div>
        <p>The retry regression passes with the fix. Mobile layout is verified. The type check found an issue in the delivery worker.</p>
        <div className={styles.replyChecks}><ListChecks /> Checks <span>3/6</span></div>
        <p>I&apos;ve attached the results for review.</p>
      </div>
      <PreviewComposer />
    </div>
  </div>;
}

export function ChecksPreview() {
  const [checklist, setChecklist] = useState("Feature");
  const menu = useRef<HTMLDetailsElement>(null);
  const rows = rowsFor(checklist);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && menu.current && !menu.current.contains(event.target)) menu.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  function closeMenu() {
    if (!menu.current) return;
    menu.current.open = false;
    menu.current.querySelector("summary")?.focus();
  }
  function handleMenuKey(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !menu.current) return;
    event.preventDefault();
    menu.current.open = true;
    const items = Array.from(menu.current.querySelectorAll<HTMLButtonElement>("button"));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1;
    items[next]?.focus();
  }
  return <section className={styles.preview} aria-label="Checks and evidence preview">
    <ThreadCrop />
    <div className={styles.panel}>
      <div className={styles.tabs}><span><FileDiff />Changes</span><span><ListTodo />Tasks</span><span className={styles.active}><ListChecks />Checks</span><span className={styles.taskTab}><SquareCheckBig />NS-142<X /></span><span className={styles.panelActions} aria-hidden><PanelTop /><PanelRightClose /></span></div>
      <div className={styles.content}>
        <div className={styles.heading}>
          <h4>Checks <a href="https://docs.convoy.build/docs/using/checks" aria-label="About checks"><CircleHelp /></a></h4>
          <span className={styles.count} aria-label={`${3} of ${rows.length} checks passed`}>3/{rows.length}</span>
          <details ref={menu} className={styles.menu} onKeyDown={handleMenuKey}>
            <summary aria-haspopup="menu"><ListChecks />Run checks<ChevronDown /></summary>
            <div className={styles.options} role="menu" aria-label="Run checks options">
              <button type="button" role="menuitem" onClick={closeMenu}>Pending and failed</button>
              <button type="button" role="menuitem" onClick={closeMenu}>All checks</button>
              <div className={styles.menuSeparator} role="separator" />
              <p className={styles.menuLabel}>Switch checklist</p>
              {["No checks", "Bug fix", "Chore", "Feature", "Investigation"].map(name => <button type="button" role="menuitemradio" aria-checked={checklist === name} key={name} onClick={() => { setChecklist(name); closeMenu(); }}>
                <span>{name}</span>{name === "Feature" && <small>Default</small>}{checklist === name ? <Check aria-hidden /> : <span className={styles.checkSpace} aria-hidden />}
              </button>)}
            </div>
          </details>
        </div>
        {rows.map(check => <CheckRow key={check.key} check={check} />)}
      </div>
      <section className={styles.otherFiles} aria-label="Other files">
        <h4>Other files</h4><p>11h ago</p>
        <details className={styles.attachment}><summary><span className={styles.fileIcon}><File /></span><span>simulated-checks.md<small>583 B</small></span></summary><pre>Checks reported for the webhook delivery task. See each result above for its note and evidence.</pre></details>
      </section>
    </div>
  </section>;
}
