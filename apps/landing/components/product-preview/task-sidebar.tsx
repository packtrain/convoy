import type { Ref } from "react";
import { ChevronsUp, ChevronUp, Loader, CircleCheck, Bold, Bot, ListFilter, MessageSquare, Bug, Calendar, Check, ChevronDown, Circle, Code, Copy, CornerLeftUp, Eye, FileDiff, FileText, Heading, Italic, Layers3, Link, List, ListChecks, ListOrdered, Minus, MoreHorizontal, Paperclip, Plus, Redo2, Sparkles, SquareCheckBig, Strikethrough, Underline, Undo2, User, X } from "lucide-react";
import { TaskChecksPreview } from "./checks";
import { ListPicker } from "./list-picker";
import { PreviewComposer } from "./preview-composer";
import styles from "./task-sidebar.module.css";

interface TaskSidebarProps {
  thread: { id: string; title: string; type: "bug" | "epic" | "feature" | "task" };
  onClose: () => void;
  variant?: "thread" | "project";
  closeRef?: Ref<HTMLButtonElement>;
  details?: {
    list: string;
    listColor?: string;
    status: "To Do" | "In Progress" | "In Review" | "Done";
    priority: "High" | "Medium" | "Low";
    owner: string;
    description: string;
    parent?: { id: string; title: string; type?: TaskSidebarProps["thread"]["type"] };
    subtasks: { id: string; title: string; type: TaskSidebarProps["thread"]["type"]; status: string }[];
  };
}

const taskTypes = {
  task: { Icon: SquareCheckBig, label: "Task", color: "#64748b" },
  bug: { Icon: Bug, label: "Bug", color: "#ef4444" },
  epic: { Icon: Layers3, label: "Epic", color: "#8b5cf6" },
  feature: { Icon: Sparkles, label: "Feature", color: "#22c55e" },
};

// Presentation follows the product task-detail-sidebar and task type registry.
export function TaskSidebar({ thread, onClose, variant = "thread", closeRef, details }: TaskSidebarProps) {
  const { Icon, label, color } = taskTypes[thread.type];

  const parentType = taskTypes[details?.parent?.type ?? "task"];
  const ParentIcon = parentType.Icon;
  const status = details?.status ?? "In Review";
  const StatusIcon = status === "To Do" ? Circle : status === "In Progress" ? Loader : status === "Done" ? CircleCheck : Eye;
  const statusColor = { "To Do": "#929292", "In Progress": "#f59e0b", "In Review": "#3b82f6", Done: "#10b981" }[status];
  const PriorityIcon = details?.priority === "High" ? ChevronsUp : details?.priority === "Medium" ? ChevronUp : details?.priority === "Low" ? ChevronDown : Minus;
  const priorityColor = details?.priority === "High" ? "#dc2626" : details?.priority === "Medium" ? "#d97706" : details?.priority === "Low" ? "#3b82f6" : undefined;
  const subtasks = details?.subtasks ?? ["Define delivery behavior", "Implement the changes", "Verify delivery tests"].map((title, index) => ({ id: `NS-${151 + index}`, title, type: "feature" as const, status: "To Do" }));

  return (
    <aside className={styles.sidebar} aria-label="Task details">
      {variant === "thread" && <div className={styles.tabs}>
        <span><FileDiff /> Changes</span>
        <span><ListChecks /> Tasks</span>
        <span className={styles.activeTab}><Icon style={{ color }} />{thread.id}</span>
        <button type="button" aria-label="Close task details" onClick={onClose}><X /></button>
      </div>}
      <div className={`${styles.actions} ${variant === "project" ? styles.projectActions : ""}`}>
        {(variant === "thread" || details?.parent) && <CornerLeftUp aria-hidden="true" />}
        <span className={styles.complete}><Check /> {status === "Done" ? "Completed" : "Mark complete"}</span>
        <Bot aria-hidden="true" />
        <MoreHorizontal className={styles.pushRight} aria-hidden="true" />
        {variant === "project" && <button type="button" className={styles.close} aria-label="Close project task details" ref={closeRef} onClick={onClose}><X /></button>}
      </div>
      <div className={styles.scroll}>
        <div className={styles.metadata}>
          <p className={styles.reference}>{thread.id}</p>
          <h3>{thread.title}</h3>
          <dl>
            {(!details || details.parent) && <><dt>Parent</dt><dd className={styles.parent}><span className={styles.parentRef}><ParentIcon style={{ color: parentType.color }} /><span className={styles.muted}>{details?.parent?.id ?? "NS-120"}</span></span><span className={styles.parentTitle} title={details?.parent?.title ?? "Webhook delivery"}>{details?.parent?.title ?? "Webhook delivery"}</span></dd></>}
            <dt>List</dt><dd><ListPicker name={details?.list ?? "Now"} color={details?.listColor ?? "#3b82f6"} className={styles.listButton} /></dd>
            <dt>Type</dt><dd><span className={styles.badge}><Icon style={{ color }} />{label}</span></dd>
            <dt>Status</dt><dd><span className={styles.badge}><StatusIcon style={{ color: statusColor }} />{status}</span></dd>
            <dt>Priority</dt><dd><PriorityIcon style={{ color: priorityColor }} />{details?.priority ?? "None"}</dd>
            <dt>Label</dt><dd className={styles.muted}>Add label</dd>
            <dt>Assignee</dt><dd className={details ? undefined : styles.muted}>{details ? <><span className={styles.assigneeAvatar}>{details.owner.trim().slice(0, 1).toUpperCase()}</span>{details.owner}</> : <><User />No assignee</>}</dd>
            <dt>Threads</dt><dd><span className={styles.truncate}>{thread.title}</span><Bot /><Plus /></dd>
            <dt>Due date</dt><dd className={styles.muted}><Calendar />Set date</dd>
            <dt>Tags</dt><dd className={styles.muted}>Add a tag</dd>
            <dt>Links</dt><dd><Link className={styles.yellow} /><span className={styles.truncate}>Delivery implementation plan</span></dd>
            <dt>Created</dt><dd className={styles.muted}>by Alex Morgan about 1 month ago</dd>
          </dl>
        </div>
        <section className={styles.description} aria-label="Task description">
          <h4>Description</h4>
          <div className={styles.editor}>
            <div className={styles.toolbar} aria-hidden="true">
              <Undo2 /><Redo2 /><span /><Heading /><ChevronDown /><List /><ListOrdered /><Code /><span /><Bold /><Italic /><Strikethrough /><Underline /><Link /><Copy />
            </div>
            <p>{details?.description ?? "What is this task about?"}</p>
          </div>
        </section>
        <section className={styles.resources} aria-label="Task resources">
          <h4>Resources <Paperclip /></h4>
          <div className={styles.chips}>
            {["Plan", "Handoff", "Implementation"].map((name) => (
              <span className={styles.chip} key={name}><FileText /><span>{name}</span><small>MD</small></span>
            ))}
          </div>
        </section>
        <TaskChecksPreview key={thread.id} />
        <section className={styles.subtasks} aria-label="Subtasks">
          <h4>Subtasks <span>{subtasks.length}</span></h4>
          <ul>
            {subtasks.map(task => {
              const { Icon: TypeIcon, color: typeColor } = taskTypes[task.type];
              return <li key={task.id}>{task.status === "Done" ? <CircleCheck /> : <Circle />}<span className={styles.truncate}>{task.title}</span><TypeIcon style={{ color: typeColor }} /><small>{task.id}</small></li>;
            })}
          </ul>
          <p className={styles.addTask}><Plus />Add task...</p>
        </section>
        <section className={styles.activity} aria-label="Task activity">
          <div className={styles.activityHeader}><h4>Activity</h4><ListFilter /></div>
          <PreviewComposer task={{ id: thread.id, title: thread.title }} />
          <div className={styles.commentTrigger}><MessageSquare />Add comment...</div>
          <div className={styles.activityStream}>
            {[['handoff.md', '19 minutes ago'], ['plan.md', '24 minutes ago'], ['handoff.md', '39 minutes ago']].map(([file, time], i) => (
              <div className={styles.activityRow} key={i}><FileText /><p><span>Alex Morgan</span> updated artifact <span>&quot;{file}&quot;</span><small>· {time}</small></p></div>
            ))}
            <div className={styles.activityComment}>
              <div className={styles.activityAvatar}>A</div>
              <div><div className={styles.commentAuthor}>Alex Morgan <small>39 minutes ago</small></div><p>The implementation is ready for review. Retry limits and delivery history are covered by the tests. I&apos;ve attached the plan and handoff to this task.</p></div>
              <MoreHorizontal />
            </div>
            <div className={styles.activityRow}><FileText /><p><span>Alex Morgan</span> updated artifact <span>&quot;plan.md&quot;</span><small>· about 1 hour ago</small></p></div>
          </div>
        </section>
      </div>
    </aside>
  );
}
