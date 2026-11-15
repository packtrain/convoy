import type { ReactNode } from "react";
import { Bug, CornerDownLeft, MessagesSquare } from "lucide-react";
import { RuntimeIcon, type PreviewRuntime } from "../runtime-icons";
import styles from "./agent-threads-preview.module.css";

/* Agents start threads (MCP create_thread) and message them (send_thread_message).
   Messages from another thread's agent follow OS-1631: foreign tint, icon-only badge. */

type Agent = { name: string; color: string; thread: string; status: string; runtime: PreviewRuntime };

const LEFT: Agent[] = [
  { name: "Planner", color: "#14b8a6", thread: "Plan retry handling", status: "Sent the plan", runtime: "claude-code" },
  { name: "Docs Writer", color: "#0ea5e9", thread: "Document retry behavior", status: "Writing", runtime: "codex" },
];

const RIGHT: Agent[] = [
  { name: "Reviewer", color: "#8b5cf6", thread: "Review retry handling", status: "Sent 2 issues", runtime: "claude-code" },
  { name: "Tester", color: "#f59e0b", thread: "Test retry limits", status: "Tests pass", runtime: "codex" },
];

function AgentList({ agents, side }: { agents: Agent[]; side: "left" | "right" }) {
  return (
    <ul className={styles.agents} data-side={side} aria-label="Agent threads">
      {agents.map((agent) => (
        <li key={agent.name} className={styles.agent}>
          <span className={styles.agentHead}>
            <span className={styles.avatar} style={{ background: agent.color }} aria-hidden="true">{agent.name[0]}</span>
            <span data-agent-name className={styles.agentName}>{agent.name}</span>
          </span>
          <span className={styles.agentThread}>{agent.thread}</span>
          <span className={styles.agentFoot}>
            <span>{agent.status}</span>
            <RuntimeIcon runtime={agent.runtime} />
          </span>
          <span data-flow className={styles.link} aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
}

function ForeignMessage({ age, children }: { age: string; children: ReactNode }) {
  return (
    <div data-sent-by className={styles.sent}>
      <div data-bubble className={`${styles.bubble} ${styles.foreign}`}>{children}</div>
      <div className={styles.footer}>
        <span>{age}</span>
        <span role="img" aria-label="Sent by another thread's agent" title="Sent by another thread's agent"><CornerDownLeft aria-hidden="true" /></span>
      </div>
    </div>
  );
}

function StartedThread({ title }: { title: string }) {
  return <div className={styles.tool}><MessagesSquare aria-hidden="true" /><span>Started thread</span><span className={styles.toolTitle}>{title}</span></div>;
}

export function AgentThreadsPreview() {
  return (
    <figure className={styles.scene} aria-label="Agent threads messaging each other">
      <div className={styles.layout}>
        <AgentList agents={LEFT} side="left" />
        <section className={styles.thread} aria-label="Lead thread">
          <header className={styles.header}>
            <Bug aria-hidden="true" style={{ color: "#ef4444" }} />
            <span className={styles.reference}>NS-142</span>
            <h3>Add retry handling for failed deliveries</h3>
          </header>
          <div className={styles.transcript}>
            <div data-person className={styles.sent}>
              <div data-bubble className={styles.bubble}>Add retries for failed webhook deliveries. Get the plan and the change reviewed.</div>
            </div>
            <div className={styles.tools}>
              <StartedThread title="Plan retry handling" />
              <StartedThread title="Review retry handling" />
            </div>
            <ForeignMessage age="6m">Plan: retry timeouts and 5xx responses with exponential backoff, keep the delivery ID stable and honor Retry-After on 429.</ForeignMessage>
            <p>Implemented the plan and sent the diff for review.</p>
            <ForeignMessage age="2m">Two issues: the backoff has no jitter, and the attempt count resets when the worker restarts.</ForeignMessage>
            <p>Fixed both and asked the reviewer to check again.</p>
          </div>
        </section>
        <AgentList agents={RIGHT} side="right" />
      </div>
    </figure>
  );
}
