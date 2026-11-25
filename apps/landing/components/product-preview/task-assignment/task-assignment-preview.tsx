"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Calendar, Circle, List, Plus, Search, SignalHigh, Sparkles, User, X } from "lucide-react";
import { RuntimeIcon } from "../runtime-icons";
import styles from "./task-assignment-preview.module.css";

const agents = [{ name: "Docs Writer", color: "#0ea5e9" }, { name: "Implementer", color: "#6366f1" }, { name: "Planner", color: "#14b8a6" }, { name: "Reviewer", color: "#8b5cf6" }];
const people = [{ name: "Alex Morgan", color: "#343434" }, { name: "Maya Chen", color: "#343434" }, { name: "Priya Shah", color: "#343434" }, { name: "Sam Rivera", color: "#343434" }];
type Person = (typeof people)[number];

function Avatar({ person }: { person: Person }) {
  return <span className={styles.avatar} style={{ backgroundColor: person.color }} aria-hidden="true">{person.name.trim().slice(0, 1).toUpperCase()}</span>;
}

export function TaskAssignmentPreview() {
  const [owner, setOwner] = useState<Person | null>(people[0]);
  const [agent, setAgent] = useState<Person | null>(null);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const matches = (person: Person) => person.name.toLowerCase().includes(query.trim().toLowerCase());
  const visibleAgents = agents.filter(matches);
  const visiblePeople = people.filter(matches);
  const showUnassigned = "unassigned".includes(query.trim().toLowerCase());
  const showClear = agent !== null && `Clear delegation (${agent.name})`.toLowerCase().includes(query.trim().toLowerCase());
  const label = [agent?.name, owner?.name].filter(Boolean).join(" · ") || "No assignee";

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); trigger.current?.focus(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input, button[data-option]"));
    const current = controls.indexOf(document.activeElement as HTMLElement);
    controls[(current + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length]?.focus();
  }

  return (
    <div className={styles.scene}>
    <section className={styles.frame} aria-label="Task assignment preview">
      <header className={styles.header}><Sparkles aria-hidden="true" /><span>NS-145</span></header>
      <div className={styles.content}>
        <h2>Add webhook retries</h2>
        <div className={styles.metadata}>
          <div className={styles.row}><span>List</span><span><List />Backlog</span></div>
          <div className={styles.row}><span>Type</span><span><Sparkles className={styles.feature} />Feature</span></div>
          <div className={styles.row}><span>Status</span><span><Circle />To Do</span></div>
          <div className={styles.row}><span>Priority</span><span><SignalHigh />High</span></div>
          <div className={styles.assignment}>
            <div className={styles.row}>
              <span>Assignee</span>
              <button ref={trigger} className={styles.trigger} aria-label={`Assignee: ${label}`} aria-controls={menuId} onClick={() => input.current?.focus()}>
                <span className={styles.avatars}>{owner ? <Avatar person={owner} /> : null}{agent ? <Avatar person={agent} /> : null}{!owner && !agent ? <User /> : null}</span>
                <span>{label}</span>
              </button>
            </div>
            {/* Always open: the picker is what this scene is about. */}
            <div id={menuId} role="group" aria-label="Choose assignee" className={styles.menu} onKeyDown={onKeyDown}>
              <div className={styles.search}><Search aria-hidden="true" /><input ref={input} aria-label="Search assignees" placeholder="Search assignees..." value={query} onChange={event => setQuery(event.target.value)} />{query ? <button aria-label="Clear assignee search" onClick={() => { setQuery(""); input.current?.focus(); }}><X /></button> : null}</div>
              <div className={styles.options}>
                {showUnassigned ? <button data-option onClick={() => { setOwner(null); setQuery(""); }}><User /><span>Unassigned</span></button> : null}
                {showClear ? <button data-option onClick={() => { setAgent(null); setQuery(""); }}><X /><span>Clear delegation ({agent?.name})</span></button> : null}
                {([{ title: "AI Agents", items: visibleAgents, isAgent: true }, { title: "People", items: visiblePeople, isAgent: false }]).map(group => group.items.length ? <div key={group.title} className={styles.group}>
                  <div className={styles.groupLabel}><span>{group.title}</span><button type="button" aria-label={group.isAgent ? "Add an agent" : "Invite teammates"} aria-disabled="true"><Plus /></button></div>
                  {group.items.map(person => <button key={person.name} data-option aria-label={person.name} onClick={() => {
                    if (group.isAgent) setAgent(agent?.name === person.name ? null : person);
                    else setOwner(person);
                    setQuery("");
                  }}><Avatar person={person} /><span>{person.name}</span>{!group.isAgent && person.name === "Alex Morgan" ? <small>(you)</small> : null}<span className={styles.srOnly}>{(group.isAgent ? agent : owner)?.name === person.name ? "Selected" : ""}</span></button>)}
                </div> : null)}
                {!showUnassigned && !showClear && !visibleAgents.length && !visiblePeople.length ? <p className={styles.empty}>No assignees found</p> : null}
              </div>
            </div>
          </div>
          <div className={`${styles.row} ${styles.threads}`}>
            <span>Threads</span>
            <div className={styles.threadBlock}>
            <ul className={styles.threadList} aria-label="Task threads">
              {([{ title: "Implement retries", runtime: "codex" }, { title: "Review retry limits", runtime: "claude-code" }] as const).map((thread) => <li key={thread.title}>
                <div className={styles.thread}>
                  <span className={styles.working} role="img" aria-label="Streaming response" title="Streaming response">
                    <span className={styles.snake}>{[[0,0],[3,0],[6,0],[6,3],[6,6],[6,9],[3,9],[0,9],[0,6],[0,3]].map(([x,y], pixel) => <i key={pixel} style={{ left:x, top:y, animationDelay:`${pixel * .08}s` }} />)}</span>
                  </span>
                  <span className={styles.threadTitle} title={thread.title}>{thread.title}</span>
                  <span className={styles.threadMeta}><span>now</span><RuntimeIcon runtime={thread.runtime} /></span>
                </div>

              </li>)}
            </ul>
            <button type="button" aria-label="Open threads composer" aria-disabled="true" className={styles.addThread}><Plus /></button>
            </div>
          </div>
          <div className={styles.row}><span>Due date</span><span><Calendar aria-hidden="true" />Oct 16, 2026</span></div>
          <div className={styles.row}><span>Tags</span><span><span className={styles.tag}>webhooks</span></span></div>
          <div className={styles.row}><span>Created</span><span className={styles.muted}>by Alex Morgan 2 days ago</span></div>
        </div>
        <div className={styles.description}>
          <h3>Description</h3>
          <p>Retry failed webhook deliveries with exponential backoff. Keep the delivery ID stable and stop after three attempts.</p>
        </div>
      </div>
    </section>
    </div>
  );
}
