"use client";

import { useState } from "react";
import { Download, FileText, Maximize2, MessageSquareText, Paperclip, Plus, SquareCheckBig, UnfoldHorizontal, X } from "lucide-react";
import styles from "./task-artifacts-preview.module.css";

// Follows product task-artifacts-section pills and task-artifact-panel header.
const artifacts = [
  { id: "plan", name: "Implementation plan", type: "md", body: <>
    <h4>Webhook delivery retries</h4>
    <p>Keep deliveries reliable when an endpoint is temporarily unavailable.</p>
    <h5>Retry policy</h5>
    <p>Retry failed deliveries up to three times with exponential backoff. Keep the delivery ID unchanged across attempts.</p>
    <ul><li>Retry timeouts and 5xx responses.</li><li>Respect Retry-After on 429 responses.</li><li>Stop after a successful delivery.</li></ul>
  </> },
  { id: "report", name: "Test report", type: "html", body: <>
    <h4>Retry test report</h4>
    <p>12 passed, 0 failed in 4.2s on the delivery worker suite.</p>
    <table><tbody>
      <tr><th scope="row">Retries after a 503</th><td>Passed</td></tr>
      <tr><th scope="row">Honors Retry-After</th><td>Passed</td></tr>
      <tr><th scope="row">Delivers each event once</th><td>Passed</td></tr>
    </tbody></table>
  </> },
  { id: "handoff", name: "Handoff", type: "md", body: <>
    <h4>Handoff</h4>
    <p>Retries and delivery history are ready for review.</p>
    <h5>Changed</h5>
    <ul><li>Delivery worker schedules retries with backoff.</li><li>Each attempt is stored with its response status.</li></ul>
    <h5>Next</h5>
    <p>Confirm the retry limit with the receiving team before release.</p>
  </> },
] as const;

export function TaskArtifactsPreview() {
  const [selectedId, setSelectedId] = useState<string>("plan");
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0];
  return (
    <section className={styles.preview} aria-label="Task artifacts preview">
      <div className={styles.body}>
        <div className={styles.task}>
          <p className={styles.reference}><SquareCheckBig aria-hidden="true" />NS-142</p>
          <h3>Retry failed webhook deliveries</h3>
          <h4>Resources <Paperclip aria-hidden="true" /></h4>
          <ul className={styles.pills} aria-label="Resources">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button type="button" className={styles.pill} aria-pressed={artifact.id === selected.id} onClick={() => setSelectedId(artifact.id)}>
                  <FileText aria-hidden="true" /><span>{artifact.name}</span><small>{artifact.type}</small>
                </button>
              </li>
            ))}
            <li className={styles.create} aria-hidden="true"><Plus /></li>
          </ul>
        </div>
        <section className={styles.panel} aria-label="Open artifact">
          <header className={styles.header}>
            <FileText aria-hidden="true" />
            <span className={styles.name}>{selected.name}</span>
            <span className={styles.status}>{selected.type === "html" ? "HTML" : "Saved"}</span>
            <span className={styles.actions} aria-hidden="true">
              {selected.type === "md" && <UnfoldHorizontal />}<Maximize2 /><Download /><MessageSquareText /><X />
            </span>
          </header>
          <article className={styles.document}>{selected.body}</article>
        </section>
      </div>
    </section>
  );
}
