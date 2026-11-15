"use client";

import { useRef, useState } from "react";
import { Bug, Check, Circle, CircleAlert, GitBranch, LayoutGrid, List, ListFilter, LoaderCircle, Layers3, Sparkles, SquareCheckBig } from "lucide-react";
import { RuntimeIcon } from "../runtime-icons";
import { sections, watchThreads } from "./fixtures";
import styles from "./watch-tower-preview.module.css";

type Mode = "list" | "board";
type Thread = typeof watchThreads[number];
const taskIcons = { bug: Bug, task: SquareCheckBig, epic: Layers3, feature: Sparkles };
const taskColors = { bug: "#ef4444", task: "#64748b", epic: "#8b5cf6", feature: "#22c55e" };

function Status({ status, board = false }: { status: Thread["status"]; board?: boolean }) {
  const Icon = status === "running" ? LoaderCircle : status === "failed" ? (board ? Circle : CircleAlert) : status === "done" ? Check : Circle;
  return <span className={`${styles.status} ${board ? styles.boardStatus : ""}`}><Icon className={styles[status]} />{board ? ({running:"Working", waiting_input:"Waiting",failed:"Failed",needs_review:"",done:""}[status]) : sections.find((section) => section.id === status)?.label}</span>;
}

function Changes({ thread }: { thread: Thread }) {
  return <span className={styles.changes}><span>+{thread.added}</span><span>−{thread.removed}</span></span>;
}

// Source geometry: watch-tower/{page,thread-list,thread-card}.tsx and BoardColumn.
export function WatchTowerPreview({ crop = false, mode: controlledMode, onModeChange, onOpen }: {
  crop?: boolean; mode?: Mode; onModeChange?: (mode: Mode) => void; onOpen?: (id: string) => void;
}) {
  const [localMode, setLocalMode] = useState<Mode>("list");
  const [hidden, setHidden] = useState<string[]>([]);
  const menu = useRef<HTMLDetailsElement>(null);
  const mode = controlledMode ?? localMode;
  const visible = sections.filter((section) => !hidden.includes(section.id) && (!crop || !["running", "done"].includes(section.id)));
  function selectMode(next: Mode) { setLocalMode(next); onModeChange?.(next); if (menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }
  const settings = <details className={styles.settings} ref={menu} onKeyDown={(event) => { if (event.key === "Escape" && menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }}>
    <summary aria-label="View settings"><ListFilter /></summary>
    <div className={styles.menu}>
      <strong>Layout</strong>
      <div role="group" aria-label="Layout">{(["list", "board"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => selectMode(value)}>{mode === value ? <Circle className={styles.radio} /> : <span className={styles.radio} />}{value === "list" ? <List /> : <LayoutGrid />}{value === "list" ? "List" : "Board"}</button>)}</div>
      <hr /><strong>Sections</strong>
      {sections.filter((section) => !crop || !["running", "done"].includes(section.id)).map((section) => <label key={section.id}><input type="checkbox" checked={!hidden.includes(section.id)} onChange={() => setHidden((current) => current.includes(section.id) ? current.filter((id) => id !== section.id) : [...current, section.id])} />{section.title}</label>)}
    </div>
  </details>;
  function row(thread: Thread) {
    const TaskIcon = taskIcons[thread.type];
    const content = mode === "list" ? <>
      <span className={styles.identity}><RuntimeIcon runtime={thread.cli} /><span className={styles.text}><strong>{thread.title}</strong><span className={styles.meta}><span>{thread.project}</span><span>·</span><span className={styles.branch}><GitBranch />{thread.branch}</span><span>·</span><span className={styles.taskRef}><TaskIcon style={{ color: taskColors[thread.type] }} />{thread.id}</span></span></span></span>
      <Status status={thread.status} /><Changes thread={thread} /><span className={styles.age}>{thread.age}</span>
    </> : <>
      <span className={styles.cardTitle}><span className={styles.taskRef}><TaskIcon style={{ color: taskColors[thread.type] }} />{thread.id}</span><strong>{thread.title}</strong><Status status={thread.status} board /></span>
      <span className={styles.cardMeta}><span className={styles.cardProject}><span>{thread.project}</span><span className={styles.branch}><GitBranch />{thread.branch}</span></span><span className={styles.cardEnd}><Changes thread={thread} /><RuntimeIcon runtime={thread.cli} />{thread.age}</span></span>
    </>;
    return onOpen ? <button type="button" key={thread.id} className={mode === "list" ? styles.row : styles.card} aria-label={`Open thread ${thread.title}`} onClick={() => onOpen(thread.id)}>{content}</button> : <div key={thread.id} className={mode === "list" ? styles.row : styles.card}>{content}</div>;
  }
  return <div className={`${styles.preview} ${mode === "board" ? styles.boardView : ""} ${crop ? styles.crop : ""}`} data-watch-tower={mode}>
    <div className={styles.pageHeader}><h2>Watch Tower</h2>{settings}</div>
    <div className={mode === "board" ? styles.board : styles.list} tabIndex={mode === "board" ? 0 : undefined} role={mode === "board" ? "region" : undefined} aria-label={mode === "board" ? "Watch Tower board" : undefined}>
      {visible.map((section) => <section className={mode === "board" ? styles.column : styles.section} key={section.id}>
        <header>{mode === "board" && <svg aria-hidden="true" viewBox="0 0 8 8" className={`${styles.columnDot} ${styles[section.id]}`}><circle cx="4" cy="4" r="4" /></svg>}<h3>{section.title}</h3>{mode === "list" && <span>{section.description}</span>}</header>
        <div className={mode === "list" ? styles.table : styles.cards}>
          {mode === "list" && <div className={styles.tableHeader}><span>Thread</span><span>Status</span><span>Changes</span><span>Updated</span></div>}
          {watchThreads.filter((thread) => thread.status === section.id).map(row)}
        </div>
      </section>)}
      {visible.length === 0 && <p className={styles.empty}>Nothing to watch yet</p>}
    </div>
  </div>;
}
