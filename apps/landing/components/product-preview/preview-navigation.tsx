"use client";

import { Bell, BotMessageSquare, Bug, Check, ChevronDown, ChevronRight, ChevronsUpDown, Circle, GitPullRequest, Hash, Keyboard, Layers3, PanelLeft, Plus, Settings, Sparkles, SquareCheckBig, TowerControl } from "lucide-react";
import { threads } from "./fixtures";
import { LogoText, RuntimeIcon, type PreviewRuntime } from "./runtime-icons";
import styles from "./preview-navigation.module.css";

type ThreadRow = { id: string; title: string; type: "bug" | "epic" | "feature" | "task"; cli: PreviewRuntime; age: string; group: "Pinned" | "Active" | "Done"; unread: boolean };
export const threadRows: ThreadRow[] = [
  { id: "NS-145", title: "Plan the delivery dashboard", type: "epic", cli: "claude-code", age: "1h", group: "Pinned", unread: false },
  ...threads.map((thread, i): ThreadRow => ({ id: thread.id, title: thread.title, type: thread.type, cli: i === 1 ? "claude-code" : "codex", age: thread.age, group: "Active", unread: i === 1 })),
  { id: "NS-135", title: "Add event payload previews", type: "feature", cli: "codex", age: "2h", group: "Active", unread: true },
  { id: "NS-133", title: "Handle expired signing secrets", type: "bug", cli: "claude-code", age: "3h", group: "Active", unread: false },
  { id: "NS-132", title: "Show delivery response headers", type: "feature", cli: "cursor", age: "4h", group: "Active", unread: true },
  { id: "NS-130", title: "Document webhook setup", type: "task", cli: "codex", age: "6h", group: "Active", unread: false },
  { id: "NS-129", title: "Improve endpoint validation", type: "task", cli: "opencode", age: "1d", group: "Active", unread: false },
  { id: "NS-126", title: "Add delivery search", type: "feature", cli: "codex", age: "1d", group: "Active", unread: true },
  { id: "NS-124", title: "Review the event schema", type: "task", cli: "claude-code", age: "2d", group: "Active", unread: false },
  { id: "NS-121", title: "Group endpoints by environment", type: "epic", cli: "codex", age: "3d", group: "Active", unread: false },
  { id: "NS-119", title: "Fix duplicate event timestamps", type: "bug", cli: "claude-code", age: "3d", group: "Done", unread: false },
  { id: "NS-117", title: "Add webhook signing", type: "feature", cli: "codex", age: "4d", group: "Done", unread: false },
  { id: "NS-114", title: "Connect the delivery worker", type: "task", cli: "codex", age: "5d", group: "Done", unread: false },
];

const icons = { bug: Bug, epic: Layers3, feature: Sparkles, task: SquareCheckBig };
function RowIcon({ type }: { type: ThreadRow["type"] }) {
  const Icon = icons[type];
  return <Icon data-task-type={type} className={styles[type]} aria-label={type} />;
}

export function WorkspaceNavigation({ className = "", destination = "threads", onNavigate, selectedList = "Milestone 1", onSelectList }: { selectedList?: string; onSelectList?: (name: string) => void; className?: string; destination?: "threads" | "watch-tower" | "project"; onNavigate?: (destination: "threads" | "watch-tower" | "project") => void }) {
  return <aside className={`${className} ${styles.workspace}`} aria-label="Example workspace navigation">
    <div className={styles.brand}><LogoText /><PanelLeft /></div>
    <div className={styles.mainNav}>
      <div><Plus /><strong>Add task</strong></div><button type="button" aria-current={destination === "watch-tower" ? "page" : undefined} onClick={() => onNavigate?.("watch-tower")}><TowerControl />Watch Tower</button><div><Bell />Notifications</div>
    </div>
    <div className={styles.projectLabel}>Projects<Plus /></div>
    <button type="button" className={styles.project} aria-current={destination === "project" ? "page" : undefined} onClick={() => onNavigate?.("project")}><Hash />Northstar</button>
    <div className={styles.projectChildren}>
      <button type="button" className={destination === "threads" ? styles.activeProjectThread : ""} onClick={() => onNavigate?.("threads")}><BotMessageSquare />Threads</button>
      <div><GitPullRequest />Pull Requests</div>
      {[["Backlog", "#898989"], ["Inbox", "#898989"], ["Milestone 1", "#93c5fd"], ["Milestone 2", "#3b82f6"], ["Ideas", "#eab308"]].map(([name, color]) => <button type="button" key={name} className={destination === "project" && selectedList === name ? styles.activeProjectThread : ""} aria-current={destination === "project" && selectedList === name ? "page" : undefined} onClick={() => onSelectList?.(name)}><Circle style={{ color }} />{name}</button>)}
    </div>
    {["Documentation", "Website", "Mobile app"].map((name) => <details className={styles.collapsedProject} key={name}><summary><Hash /><span>{name}</span><ChevronRight /></summary><div className={styles.projectChildren}><div><BotMessageSquare />Threads</div><div><GitPullRequest />Pull Requests</div><div><Circle />Backlog</div></div></details>)}
    <div className={styles.footer}><div><Settings />Organization Settings</div><div className={styles.shortcuts}><Keyboard />Keyboard shortcuts</div><div className={styles.profile}><span className={styles.avatar}>A</span><span>Alex Morgan<small>Northstar</small></span><ChevronsUpDown /></div></div>
  </aside>;
}

export function ThreadNavigation({ selectedId, onSelect, className = "", project = "Northstar", rows = threadRows }: { selectedId: string; onSelect: (id: string) => void; className?: string; project?: string; rows?: ThreadRow[] }) {
  return <aside className={`${className} ${styles.threads}`} aria-label="Example threads">
    <div className={styles.header}>{project}<ChevronRight /><BotMessageSquare /><Settings /></div>
    <div className={styles.newThread}><Plus />New thread<kbd>N</kbd></div>
    <div className={styles.scroll}>
      <details open className={styles.group}><summary>Connected CLIs<ChevronDown /></summary><div className={styles.machine}><span className={styles.machineAvatar}>A<i /></span><div className={styles.machineText}><span>Local Dev <code>devcontainer</code></span><small>/workspace · northstar/app</small></div><div className={styles.machineMeta}><div>{(["claude-code", "opencode", "cursor", "codex"] as const).map((runtime) => <RuntimeIcon key={runtime} runtime={runtime} />)}</div><small>Just now</small></div></div></details>
      {(["Pinned", "Active", "Done"] as const).map((group) => <details open key={group} className={styles.group}><summary>{group}<ChevronDown /></summary>{rows.filter((row) => row.group === group).map((row) => <button key={row.id} type="button" aria-pressed={row.id === selectedId} onClick={() => onSelect(row.id)} className={`${styles.row} ${group === "Done" ? styles.done : ""}`}><span className={styles.status}>{group === "Done" ? <Check /> : row.unread ? <i /> : null}</span><span className={styles.rowTitle}><span className={styles.taskRef}><RowIcon type={row.type} /><span className={styles.reference}>{row.id}</span></span><span className={styles.title}>{row.title}</span></span><span className={styles.metadata}><span>{row.age}</span><RuntimeIcon runtime={row.cli} /></span></button>)}</details>)}
    </div>
  </aside>;
}
