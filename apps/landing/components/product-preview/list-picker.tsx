"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Circle, CircleDashed, Search } from "lucide-react";
import styles from "./list-picker.module.css";

// Mock of the product List selector (task-lists.md "List Selector"): it opens and searches, but picking a List changes nothing.
const LISTS = [["Inbox", "#898989"], ["Milestone 1", "#93c5fd"], ["Milestone 2", "#3b82f6"], ["Milestone 3", "#1d4ed8"], ["Desktop App", "#0f766e"], ["Ideas", "#eab308"], ["Refactoring", "#898989"], ["References", "#3b82f6"], ["Followups", "#e11d48"]];

export function ListPicker({ name, color, className = "" }: { name: string; color: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const item = (list: string, icon: ReactNode) => <button type="button" role="menuitemradio" aria-checked={list === name} key={list} onClick={close}>{icon}{list}</button>;
  const matches = (list: string) => list.toLowerCase().includes(query.trim().toLowerCase());

  return <span ref={root} className={styles.picker} onKeyDown={event => { if (open && event.key === "Escape") { event.stopPropagation(); close(); } }}>
    <button ref={trigger} type="button" className={className} aria-label="Open Lists" aria-haspopup="menu" aria-expanded={open} onClick={() => { setQuery(""); setOpen(value => !value); }}>
      <Circle style={{ color }} />{name}
    </button>
    {open && <div role="menu" aria-label="Lists" className={styles.menu}>
      <label className={styles.search}><Search /><input aria-label="Search lists" placeholder="Search lists..." value={query} onChange={event => setQuery(event.target.value)} /></label>
      {matches("Backlog") && item("Backlog", <CircleDashed className={styles.muted} />)}
      {matches("Archived") && item("Archived", <Archive className={styles.muted} />)}
      <hr />
      <div className={styles.lists}>{LISTS.filter(([list]) => matches(list)).map(([list, listColor]) => item(list, <Circle style={{ color: listColor }} />))}</div>
    </div>}
  </span>;
}
