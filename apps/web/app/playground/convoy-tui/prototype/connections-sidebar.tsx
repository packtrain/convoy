import { useState, type RefObject } from "react";
import type { Environment } from "./fixtures";
import styles from "./terminal.module.css";

export function ConnectionsSidebar({ environments, active, profile, status, locked, sidebarRef, onSelect, onAdd, onRuns, onActivate }: {
  environments: Environment[]; active: string; profile: string; status: "Connected" | "Reconnecting" | "Unavailable" | "Unknown";
  locked?: boolean; sidebarRef: RefObject<HTMLElement | null>;
  onSelect: (environment: string, profile: string) => void;
  onAdd: (environment: string | null) => void; onRuns: () => void; onActivate: () => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>(["build-vm"]);
  return <nav ref={sidebarRef} tabIndex={-1} onFocus={event => {
    onActivate();
    if (event.target === event.currentTarget) {
      if (profile !== "connection") setCollapsed(items => items.filter(id => id !== active));
      requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.focus());
    }
  }} aria-label="Connections" className={styles.sidebar} onKeyDown={event => {
    if (locked) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); return; }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-project], button[data-connection]"));
      const index = buttons.findIndex(button => button.getAttribute("aria-current") === "page");
      const next = buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next?.dataset.connection) onSelect(next.dataset.connection, "connection");
      else next?.click();
    }
    if (event.key === "Tab") { event.stopPropagation(); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onRuns(); }
  }}>
    <div className={styles.sidebarHeading}>CONNECTIONS</div>
    {environments.map(environment => <div key={environment.id} className={styles.sidebarGroup}>
      <div className={styles.connectionRow} data-selected={active === environment.id && profile === "connection" ? "true" : undefined}>
        <button disabled={locked} className={styles.disclosure} aria-label={`${collapsed.includes(environment.id) ? "Expand" : "Collapse"} ${environment.id}`} aria-expanded={!collapsed.includes(environment.id)} onClick={() => setCollapsed(items => items.includes(environment.id) ? items.filter(id => id !== environment.id) : [...items, environment.id])}>{collapsed.includes(environment.id) ? "▸" : "▾"}</button>
        <button disabled={locked} data-connection={environment.id} className={styles.environmentRow} title={active === environment.id ? status : "Unknown"} aria-description={`Connection status: ${active === environment.id ? status : "Unknown"}`} aria-current={active === environment.id && profile === "connection" ? "page" : undefined} onClick={() => { setCollapsed(items => items.includes(environment.id) ? items.filter(id => id !== environment.id) : [...items, environment.id]); onSelect(environment.id, "connection"); }}>{environment.id}<i aria-hidden="true" className={styles.connectionDot} data-status={active === environment.id ? status : "Unknown"} />{" "}<span>{environment.transport}</span></button>
      </div>
      {!collapsed.includes(environment.id) && <div className={styles.projectRows}>
        <button disabled={locked} data-project="true" aria-current={active === environment.id && profile === "all" ? "page" : undefined} onClick={() => onSelect(environment.id, "all")}>All projects</button>
        {environment.profiles.map(item => <button disabled={locked} data-project="true" key={item.id} title={item.key} aria-current={active === environment.id && profile === item.id ? "page" : undefined} onClick={() => onSelect(environment.id, item.id)}>{item.name}</button>)}
        <button disabled={locked} className={styles.addRow} onClick={() => onAdd(environment.id)}>+ Add project</button>
      </div>}
    </div>)}
    <button disabled={locked} className={styles.addRow} onClick={() => onAdd(null)}>+ Add environment</button>
    <p className={styles.sidebarHint}>→ details / runs · Tab controls<br />↑ ↓ select connection / project</p>
  </nav>;
}
