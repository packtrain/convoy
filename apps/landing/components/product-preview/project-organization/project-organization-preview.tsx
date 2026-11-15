"use client";

import { useEffect, useRef, useState } from "react";
import { Bug, Layers3, Sparkles, SquareCheckBig, Circle, CircleCheck, Loader, Eye, ChevronRight, Plus, List, LayoutGrid, ListFilter, Search, ChevronsUp, ChevronUp, ChevronDown } from "lucide-react";
import { TaskSidebar } from "../task-sidebar";
import { RuntimeIcon } from "../runtime-icons";
import { ListPicker } from "../list-picker";
import { projectLists, type ProjectTask } from "./fixtures";
import styles from "./project-organization-preview.module.css";

const types = { bug: { Icon: Bug, color: "#ef4444" }, epic: { Icon: Layers3, color: "#8b5cf6" }, feature: { Icon: Sparkles, color: "#22c55e" }, task: { Icon: SquareCheckBig, color: "#64748b" } };
const statuses = { "To Do": { Icon: Circle, color: "#898989" }, "In Progress": { Icon: Loader, color: "#f59e0b" }, "In Review": { Icon: Eye, color: "#3b82f6" }, Done: { Icon: CircleCheck, color: "#10b981" } };
function TaskRef({ task }: { task: ProjectTask }) {
  const { Icon, color } = types[task.type];
  return <span className={styles.reference}><Icon style={{ color }} aria-label={task.type} />{task.id}</span>;
}
function Status({ task }: { task: ProjectTask }) {
  const { Icon, color } = statuses[task.status];
  return <span className={styles.badge}><Icon style={{ color }} />{task.status}</span>;
}
function Priority({ task, compact = false }: { task: ProjectTask; compact?: boolean }) {
  const Icon = task.priority === "High" ? ChevronsUp : task.priority === "Low" ? ChevronDown : ChevronUp;
  return <span className={styles.priority} title={`${task.priority} priority`}><Icon style={{ color: task.priority === "High" ? "#dc2626" : task.priority === "Low" ? "#3b82f6" : "#d97706" }} />{!compact && task.priority}</span>;
}
function Avatar({ name }: { name: string }) {
  return <span className={styles.avatar} title={name} aria-label={name}>{name.trim().slice(0, 1).toUpperCase()}</span>;
}
function Progress() {
  return <span className={styles.progress}><svg viewBox="0 0 14 14" aria-label="1 of 2 subtasks complete" style={{ transform: "rotate(-90deg)" }}><circle cx="7" cy="7" r="5" fill="none" stroke="#9292924d" strokeWidth="2" /><circle cx="7" cy="7" r="5" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeDasharray={10 * Math.PI} strokeDashoffset={5 * Math.PI} /></svg>1/2</span>;
}
function Run({ task }: { task: ProjectTask }) {
  return task.runtime ? <span className={styles.run}><RuntimeIcon runtime={task.runtime} /><i aria-label="Active run" /></span> : <span className={styles.muted}>—</span>;
}

// Product table, KanbanCard and task-detail-sidebar references: landing-hero.md.
export function ProjectOrganizationPreview({ listName = "Milestone 1", initialMode = "table", onModeChange }: { listName?: string; initialMode?: "table" | "board"; onModeChange?: (mode: "table" | "board") => void }) {
  const list = projectLists.find(item => item.name === listName) ?? projectLists[2];
  const tasks = list.tasks;
  const [mode, setMode] = useState<"table" | "board">(initialMode);
  const changeMode = (next: "table" | "board") => { setMode(next); onModeChange?.(next); };
  const [expanded, setExpanded] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProjectTask | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selected) closeRef.current?.focus();
    else trigger.current?.focus();
  }, [selected]);
  const visible = tasks.filter(task => (mode === "board" ? !task.parent : !task.parent || expanded) && `${task.title} ${task.id}`.toLowerCase().includes(query.toLowerCase()));
  const tableTasks = visible.toSorted((a, b) => {
    const order = (task: ProjectTask) => tasks.findIndex(item => item.id === (task.parent ?? task.id)) + (task.parent ? .1 + tasks.indexOf(task) / 100 : 0);
    return order(a) - order(b);
  });
  const open = (task: ProjectTask, button: HTMLButtonElement) => { trigger.current = button; setSelected(task); };
  const close = () => setSelected(null);
  const children = selected ? tasks.filter(task => task.parent === selected.id) : [];

  return <section className={styles.preview} aria-label="Project organization preview" data-project-view={mode}>
    <div className={styles.surface} inert={selected ? true : undefined}>
      <header className={styles.toolbar}>
        <h2>Northstar</h2>
        <div className={styles.viewToggle} aria-label="Project view">
          <button type="button" aria-label="Table view" aria-pressed={mode === "table"} onClick={() => changeMode("table")}><List /></button>
          <button type="button" aria-label="Kanban view" aria-pressed={mode === "board"} onClick={() => changeMode("board")}><LayoutGrid /></button>
        </div>
        <ListPicker name={list.name} color={list.color} className={styles.listPill} />
        <span className={styles.filter}><ListFilter />All</span>
        <label className={styles.search}><Search /><input aria-label="Search project tasks" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <Avatar name="Alex Morgan" />
      </header>
      <div className={styles.viewport} tabIndex={0} aria-label={mode === "table" ? "Project task table" : "Project kanban board"}>
        {mode === "table" ? <table className={styles.table}>
          <thead><tr>{["Task", "Status", "Runs", "Priority", "Assignee"].map(name => <th key={name}>{name}</th>)}</tr></thead>
          <tbody>{tableTasks.map(task => <tr key={task.id} data-done={task.status === "Done"}>
            <td><div className={styles.nameCell} style={task.parent ? { paddingLeft: 24 } : undefined}>
              {task.id === "NS-139" ? <button type="button" className={styles.expand} aria-label="Toggle delivery plan subtasks" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronRight style={{ transform: expanded ? "rotate(90deg)" : undefined }} /></button> : <span className={styles.expandSpace} />}
              {task.status === "Done" ? <CircleCheck className={styles.completion} /> : <Circle className={styles.completion} />}
              <button type="button" className={styles.taskTitle} onClick={event => open(task, event.currentTarget)}>{task.title}</button>
              {task.id === "NS-139" && <Progress />}
              <TaskRef task={task} />
            </div></td>
            <td><Status task={task} /></td><td><Run task={task} /></td><td><Priority task={task} compact /></td><td><span className={styles.assignee}><Avatar name={task.owner} /><span className={styles.assigneeName}>{task.owner}</span></span></td>
          </tr>)}</tbody>
        </table> : <div className={styles.board}>{(Object.keys(statuses) as ProjectTask["status"][]).map(status => <section className={styles.column} key={status}>
          <header><i style={{ background: statuses[status].color }} /><h3>{status}</h3><span>{visible.filter(task => task.status === status).length}</span><Plus /></header>
          {visible.filter(task => task.status === status).map(task => <button type="button" className={styles.card} data-done={task.status === "Done"} key={task.id} onClick={event => open(task, event.currentTarget)} aria-label={`Open ${task.id}: ${task.title}`}>
            <h4>{task.title}</h4><p>{task.description}</p>
            <div className={styles.cardFooter}><TaskRef task={task} /><span className={styles.cardMeta}>{task.runtime && <Run task={task} />}{task.id === "NS-139" && <Progress />}<Priority task={task} compact /><Avatar name={task.owner} /></span></div>
          </button>)}
        </section>)}</div>}
        {visible.length === 0 && <p className={styles.empty}>No tasks found</p>}
      </div>
    </div>
    {selected && <section role="dialog" aria-modal="true" aria-label={`Task details: ${selected.id}`} className={styles.details} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),[tabindex="0"]'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <TaskSidebar thread={selected} variant="project" onClose={close} closeRef={closeRef} details={{
        list: list.name, listColor: list.color, status: selected.status, priority: selected.priority, owner: selected.owner,
        description: selected.description, subtasks: children, parent: tasks.find(task => task.id === selected.parent),
      }} />
    </section>}
  </section>;
}
