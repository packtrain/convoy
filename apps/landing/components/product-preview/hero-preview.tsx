"use client";

import { useRef, useState } from "react";
import { Plus, MoreHorizontal, Bug, Layers3, Sparkles, SquareCheckBig, PanelLeft, PanelRight, Wrench, FileText } from "lucide-react";
import { ProjectOrganizationPreview } from "./project-organization";
import { WatchTowerPreview, watchThreads } from "./watch-tower";
import { TaskSidebar } from "./task-sidebar";
import { PreviewComposer } from "./preview-composer";
import { WorkspaceNavigation, ThreadNavigation, threadRows } from "./preview-navigation";
import { threads } from "./fixtures";
import styles from "./hero-preview.module.css";

const taskTypes = {
  task: { icon: SquareCheckBig, color: "#64748b" },
  bug: { icon: Bug, color: "#ef4444" },
  epic: { icon: Layers3, color: "#8b5cf6" },
  feature: { icon: Sparkles, color: "#22c55e" },
};

function TaskIcon({ type }: { type: keyof typeof taskTypes }) {
  const { icon: Icon, color } = taskTypes[type];
  return <Icon style={{ color }} aria-label={type} />;
}

// Product source references and deliberate crops: docs/specs/landing-hero.md.
export function HeroPreview() {
  const [destination, setDestination] = useState<"threads" | "watch-tower" | "project">("threads");
  const [selectedList, setSelectedList] = useState("Milestone 1");
  const [projectMode, setProjectMode] = useState<"table" | "board">("table");
  const [watchMode, setWatchMode] = useState<"list" | "board">("board");
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(threads[0].id);
  const selectedWatchThread = watchThreads.find((thread) => thread.id === selectedId);
  const project = selectedWatchThread?.project ?? "Northstar";
  const visibleRows = project === "Northstar" ? threadRows : watchThreads.filter((thread) => thread.project === project).map((thread) => ({ ...thread, group: "Active" as const, unread: true }));
  const selectedRow = threadRows.find((thread) => thread.id === selectedId) ?? threadRows[0];
  const body = selectedWatchThread ?? threads.find((thread) => thread.id === selectedId);
  const selected = body ?? {
    ...selectedRow,
    prompt: `Please work on ${selectedRow.title.toLowerCase()}.`,
    intro: "I'll read the related code and check the existing tests first.",
    tools: [{ label: "Read project files", detail: "src/" }],
    result: "I've reviewed the implementation and recorded the findings in the task plan.",
    checks: ["Reviewed the related code", "Updated the task plan"],
  };

  return (
    <><nav className={styles.compactNavigation} aria-label="Preview navigation"><button type="button" aria-pressed={destination === "threads"} onClick={() => setDestination("threads")}>Threads preview</button><button type="button" aria-pressed={destination === "watch-tower"} onClick={() => setDestination("watch-tower")}>Watch Tower preview</button><button type="button" aria-pressed={destination === "project"} onClick={() => setDestination("project")}>Project preview</button></nav><section className={`${styles.preview} ${destination !== "threads" ? styles.watchTower : sidebarOpen && project === "Northstar" ? styles.withDetails : ""} ${mobileSidebarOpen ? styles.mobileDetailsOpen : ""}`} aria-label="Convoy interactive product preview">
      <WorkspaceNavigation selectedList={selectedList} onSelectList={(name) => { setSelectedList(name); setDestination("project"); }} className={styles.sidebar} destination={destination} onNavigate={(next) => { setDestination(next); if (next === "threads" && project !== "Northstar") setSelectedId(threads[0].id); }} />
      {destination === "project" ? <ProjectOrganizationPreview key={selectedList} listName={selectedList} initialMode={projectMode} onModeChange={setProjectMode} /> : destination === "watch-tower" ? <WatchTowerPreview mode={watchMode} onModeChange={setWatchMode} onOpen={(id) => { setSelectedId(id); setDestination("threads"); }} /> : <>
      <ThreadNavigation className={`${styles.threadList} ${mobileThreadsOpen ? styles.mobileThreadsOpen : ""}`} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setMobileThreadsOpen(false); }} project={project} rows={visibleRows} />
      {mobileThreadsOpen && <button type="button" className={styles.scrim} aria-label="Close threads" onClick={() => setMobileThreadsOpen(false)} />}

      <div className={styles.conversation}>
        <header className={styles.threadHeader}><button type="button" className={`${styles.sidebarToggle} ${styles.threadsToggle}`} aria-label="Show threads" aria-expanded={mobileThreadsOpen} onClick={() => setMobileThreadsOpen(true)}><PanelLeft /></button><TaskIcon type={selected.type} /><span className={styles.reference}>{selected.id}</span><h2>{selected.title}</h2><Plus className={styles.headerPlus} /><span className={styles.headerDone}>Mark as done</span><MoreHorizontal />{project === "Northstar" && <button type="button" ref={sidebarToggleRef} className={styles.sidebarToggle} aria-label="Toggle task details" onClick={() => { if (window.matchMedia("(max-width: 1100px)").matches) { setMobileSidebarOpen((open) => !open); } else { setSidebarOpen((open) => !open); } }}><PanelRight /></button>}</header>
        <div className={styles.transcript} key={selected.id}>
          <div className={styles.messageWidth}>
            <div className={styles.userMessage}>{selected.prompt}</div>
            <p>{selected.intro}</p>
            <details className={styles.toolGroup}>
              <summary><Wrench /> {selected.tools.length} tool calls</summary>
              <div className={styles.toolRows}>
                {selected.tools.map((tool) => <div key={tool.label}><FileText /><span>{tool.label}<code>{tool.detail}</code></span></div>)}
              </div>
            </details>
            <p>{selected.result}</p>
            <ul className={styles.checks}>
              {selected.checks.map((check) => <li key={check}>{check}</li>)}
            </ul>
          </div>
        </div>
        <PreviewComposer />
      </div>
      {project === "Northstar" && <div className={styles.detailsPane}>
        <TaskSidebar thread={selected} onClose={() => { setSidebarOpen(false); setMobileSidebarOpen(false); sidebarToggleRef.current?.focus(); }} />
      </div>}
      </>}
    </section></>
  );
}
