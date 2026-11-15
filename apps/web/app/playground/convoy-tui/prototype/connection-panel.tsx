import { type Environment } from "./fixtures";
import styles from "./terminal.module.css";

export function ConnectionPanel({ environment, profile, stale, onClose }: {
  environment: Environment; profile: string; stale: boolean; onClose?: () => void;
}) {
  const profiles = environment.profiles.filter(item => profile === "all" || item.id === profile);
  return <section className={styles.connection} aria-label="Connection details">
    <div className={styles.panelHeading}><strong>Connection details</strong>{onClose && <button onClick={onClose}>[Esc] close</button>}</div>
    <p className={styles.muted}>Sample values · {stale ? "last known snapshot, not live" : "active environment"}</p>
    <dl className={styles.config}>
      <dt>Environment</dt><dd>{environment.id} · {environment.transport}</dd>
      <dt>Service target</dt><dd>{environment.address}</dd>
      <dt>Versions</dt><dd>client {environment.clientVersion} / service {environment.serviceVersion}</dd>
      <dt>Instance</dt><dd>{environment.instance} · registered · subscribed to pending threads</dd>
      <dt>Health</dt><dd>uptime {environment.uptime} · round-trip {environment.latency}{stale ? " · stale" : ""}</dd>
      <dt>Execution</dt><dd>concurrency={environment.concurrency} · mode=runtime · streaming=on</dd>
      <dt>Isolation</dt><dd className={environment.isolated ? styles.completed : styles.waiting}>{environment.isolated ? "on · per-project boundary" : "off · shared environment"}</dd>
      <dt>Codex mode</dt><dd>app-server</dd>
      <dt>Installed CLIs</dt><dd>{environment.runtimes}</dd>
    </dl>
    {profiles.map(item => <section key={item.key} className={styles.profileConfig}>
      <strong>{item.name}</strong>
      <dl className={styles.config}>
        <dt>Profile key</dt><dd>{item.key} · list label: {item.id}</dd>
        <dt>Convex endpoint</dt><dd>{item.endpoint}</dd>
        <dt>Project ID</dt><dd>{item.project}</dd>
        <dt>Workspace</dt><dd>{item.path}</dd>
        <dt>API credential</dt><dd>configured · value hidden</dd>
        <dt>Task skill</dt><dd className={item.skill ? styles.muted : styles.waiting}>{item.skill ? "installed" : "not installed · optional"}</dd>
      </dl>
      {!item.skill && <p className={styles.muted}>In this project&apos;s shell: convoy init skill --scope project</p>}
    </section>)}
  </section>;
}
