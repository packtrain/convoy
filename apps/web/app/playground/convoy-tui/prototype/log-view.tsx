import { useEffect, useRef, useState } from "react";
import { OperationPanel } from "./operation-panel";
import styles from "./terminal.module.css";

export function LogView({ entries, onBusyChange }: { entries: readonly unknown[]; onBusyChange?: (busy: boolean) => void }) {
  const [view, setView] = useState<"logs" | "export" | "progress">("logs");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (view === "logs") panel.current?.focus(); }, [view]);
  const [path, setPath] = useState("~/Downloads/convoy-run.jsonl");
  useEffect(() => { onBusyChange?.(view !== "logs"); return () => onBusyChange?.(false); }, [view, onBusyChange]);
  const [result, setResult] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [exists, setExists] = useState(false);
  const compact = entries.map(entry => JSON.stringify(entry)).join("\n");
  return <div ref={panel} tabIndex={-1} className={styles.logPanel} onKeyDown={event => { if (view !== "logs") { event.stopPropagation(); if (event.key === "Escape" && view === "export") setView("logs"); } }}>
    <div className={styles.jsonTools} role="toolbar" aria-label="Log actions">
      <strong>Raw JSON logs</strong>
      {view === "logs" && <button className={styles.exportButton} onClick={() => setView("export")}>Export complete logs</button>}
    </div>
    <p className={styles.muted}>One event per line · select text and use your terminal’s copy shortcut</p>
    {view === "progress" ? <OperationPanel title="Export complete logs" steps={["Open local destination", "Stream all history pages", "Finish file"]} failure="Could not write the next page. Check destination permissions or free space. Partial file retained as .partial; retry resumes the same export." onBack={() => setView("export")} onDone={() => { setResult(`Export preview complete: ${path}. No file was written by the playground.`); setView("logs"); }} /> : view === "export" ? <form className={styles.setupForm} onSubmit={event => { event.preventDefault(); if (path.trim() && (!exists || overwrite)) setView("progress"); }}>
      <h2>Export complete logs</h2><p>All stored events, including unloaded history. JSON Lines. Destination is on this client machine.</p>
      <label>Destination path<input autoFocus required value={path} onChange={event => setPath(event.target.value)} /></label>
      <label><input type="checkbox" checked={exists} onChange={event => { setExists(event.target.checked); setOverwrite(false); }} />Demo: destination already exists</label>
      {exists && <label><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />Replace existing file after export completes</label>}
      <div><button type="submit" disabled={exists && !overwrite}>Start export preview</button><button type="button" onClick={() => setView("logs")}>Back to logs</button></div>
    </form> : <>
      <p role="status">{result}</p>
      <pre className={styles.json} aria-label="Raw JSON logs">{compact}</pre>
    </>}
  </div>;
}
