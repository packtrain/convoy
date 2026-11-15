"use client";

import { useId, useState } from "react";
import { Bug, Plus, Sparkles, SquareCheckBig } from "lucide-react";
import { PreviewComposer } from "../preview-composer";
import styles from "./thread-groups-preview.module.css";

const threads = [
  { title: "Add webhook retries", taskRef: "NS-142", icon: Bug, color: "#ef4444", prompt: "Add retries for webhook deliveries. Keep the delivery ID stable across attempts.", response: "The retry path now preserves the delivery ID and records each attempt. Timeouts and 5xx responses use exponential backoff.", detail: "The retry tests pass, including a failed attempt followed by a successful delivery." },
  { title: "Review retry handling", taskRef: "NS-145", icon: Sparkles, color: "#22c55e", prompt: "Review the webhook retry changes for duplicate deliveries and error handling.", response: "The delivery ID stays stable across retries, so receivers can deduplicate the event.", detail: "One case needs a change: honor Retry-After on 429 responses before scheduling the next attempt." },
  { title: "Test retry limits", taskRef: "NS-146", icon: SquareCheckBig, color: "#64748b", prompt: "Verify retry limits and rate-limit handling for webhook deliveries.", response: "Added tests for the maximum attempt count and 429 responses with Retry-After.", detail: "All retry tests pass. No delivery retries before the requested delay or after the attempt limit." },
] as const;

export function ThreadGroupsPreview() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const thread = threads[selected];
  return <section className={styles.preview} aria-label="Thread group preview">
        <div className={styles.tabs} role="tablist" aria-label="Group threads">
          {threads.map((item, index) => <button key={item.title} id={id + index} type="button" role="tab" aria-label={item.title} aria-selected={selected === index} aria-controls={id + "-panel"} tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % threads.length;
            else if (event.key === "ArrowLeft") next = (index + threads.length - 1) % threads.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = threads.length - 1;
            else return;
            event.preventDefault();
            setSelected(next);
            document.getElementById(id + next)?.focus();
          }}><span className={styles.taskRef}><item.icon aria-hidden="true" style={{ color: item.color }} /><span>{item.taskRef}</span></span><span className={styles.tabTitle}>{item.title}</span></button>)}
          <span className={styles.add} aria-label="Add thread"><Plus aria-hidden="true" /></span>
        </div>
        <div role="tabpanel" id={id + "-panel"} aria-labelledby={id + selected} tabIndex={0} className={styles.transcript}>
          <div className={styles.userMessage}>{thread.prompt}</div>
          <div className={styles.response}><p>{thread.response}</p><p>{thread.detail}</p></div>
        </div>
        <PreviewComposer />
  </section>;
}
