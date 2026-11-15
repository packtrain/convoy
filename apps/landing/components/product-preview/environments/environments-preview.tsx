import styles from "./environments-preview.module.css";

// Mirrors the TUI's detailLines(); text up to the first colon renders muted.
const details = [
  "Connection: connected",
  "Mode: shared (one account for all projects)",
  "Client: 0.138.0   Service: 0.138.0",
  "Service: running   PID: 10444",
  "Configuration: valid",
  "Service endpoint: docker exec convoy-sandbox /home/node/.convoy/service/control.sock",
  "Service Node: v22.3.0",
  "Project configuration was captured when attached.",
  "web: online, active 0",
  "  Project: Web app",
  "  Concurrency: default   OS sandbox: default   Streaming: default",
  "api: online, active 0",
  "  Project: API",
  "  Concurrency: default   OS sandbox: default   Streaming: default",
];

const shortcuts = [["[←/→]", "panes"], ["[↑/↓]", "select"], ["[Enter]", "activate"], ["[Esc]", "back"], ["[n/p]", "page"], ["[f]", "retry"], ["[E]", "add environment"], ["[+]", "add project"], ["[q]", "detach"]];

export function EnvironmentsPreview() {
  return (
    <figure className={styles.root} aria-label="Convoy TUI preview showing a connected Docker environment and two projects">
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Terminal preview, scroll horizontally to see more">
        <div className={styles.terminal}>
          <div className={styles.header}>
            <span><span className={styles.accent}>convoy</span> &nbsp; sandbox / docker</span>
            <span className={styles.muted}>client 0.138.0 · service 0.138.0</span>
          </div>
          <div className={styles.endpoint}>docker exec convoy-sandbox /home/node/.convoy/service/control.sock &nbsp; 2 registered projects</div>
          <div className={styles.workspace}>
            <div className={styles.sidebar}>
              <div className={styles.muted}>ENVIRONMENTS</div>
              <div className={styles.muted}>+ Add environment</div>
              <div className={`${styles.row} ${styles.environment}`}><b>▸ Local</b><span className={styles.muted}>unix <span className={styles.dot}>●</span></span></div>
              <div className={`${styles.row} ${styles.environment} ${styles.selected}`}><b>▾ sandbox</b><span>docker <span className={styles.dot}>●</span></span></div>
              <div className={styles.indent}>Actions</div>
              <div className={styles.indent}>Credentials</div>
              <div className={`${styles.indent} ${styles.muted}`}>+ Add project</div>
              <div className={`${styles.row} ${styles.indent} ${styles.projects}`}>Web app (web)<span className={styles.dot}>●</span></div>
              <div className={`${styles.row} ${styles.indent}`}>API (api)<span className={styles.dot}>●</span></div>
            </div>
            <div className={styles.main}>
              <div className={styles.title}><b>Details</b><span className={styles.muted}>sandbox</span></div>
              <div className={styles.muted}>Host lifecycle is not managed here. Service controls are in Actions.</div>
              <div className={styles.actions}><span>[s]</span> Inspect status &nbsp;<span>[f]</span> Retry connection &nbsp;<span>[+]</span> Add project</div>
              <div className={styles.details}>
                {details.map((line, index) => {
                  const [, label = "", value = line] = /^(\s*[^:]{1,40}:)( .*)$/.exec(line) ?? [];
                  return <div key={index}><span className={styles.muted}>{label}</span>{value}</div>;
                })}
              </div>
              <div className={styles.shortcuts}>{shortcuts.map(([key, label]) => <span key={key}><span className={styles.accent}>{key}</span> {label}</span>)}</div>
            </div>
          </div>
          <div className={styles.status}><span><span className={styles.dot}>●</span> connected</span><span>sandbox · docker</span><span>0 observed active · queued count unknown</span></div>
        </div>
      </div>
    </figure>
  );
}
