"use client";

import { useId, useState } from "react";
import { FileText, MessageSquareText } from "lucide-react";
import styles from "./artifact-review-preview.module.css";

const passage = "Retry failed deliveries up to three times with exponential backoff.";

export function ArtifactReviewPreview() {
  const [open, setOpen] = useState(true);
  const commentsId = useId();
  return (
    <section className={styles.preview} aria-label="Artifact review preview">
      <header className={styles.header}>
        <FileText aria-hidden="true" />
        <span>Implementation plan</span>
        <button type="button" aria-label={open ? "Hide comments" : "Show comments"} aria-expanded={open} aria-controls={commentsId} onClick={() => setOpen(!open)} className={open ? styles.selected : undefined}>
          <MessageSquareText aria-hidden="true" /><span className={styles.count}>1</span>
        </button>
      </header>
      <div className={styles.body}>
        <article className={styles.document}>
          <h4>Webhook delivery retries</h4>
          <p>Keep deliveries reliable when an endpoint is temporarily unavailable.</p>
          <h5>Retry policy</h5>
          <p>{/* An inline mark, not a button: buttons render inline-block, so the highlight would be one box. */}
          <mark role="button" tabIndex={0} className={styles.passage} data-active={open} aria-label="Open comment on retry policy" aria-expanded={open} aria-controls={commentsId} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}>{passage}</mark> Keep the delivery ID unchanged across attempts.</p>
          <ul>
            <li>Retry timeouts and 5xx responses.</li>
            <li>Record each attempt with its response status.</li>
            <li>Stop after a successful delivery.</li>
          </ul>
          <h5>Verification</h5>
          <p>Test a failed attempt followed by a successful retry. Confirm the receiver processes the event once.</p>
        </article>
        {open && <aside id={commentsId} className={styles.rail} aria-label="Comments">
          <div className={styles.railHeader}>Comments</div>
          <div className={styles.thread}>
            <Comment name="Maya Chen" time="5 minutes ago" quote={passage}>Can we be explicit about 429 responses? Respect Retry-After so we do not retry while the endpoint is rate limited.</Comment>
            <Comment name="Alex Morgan" time="2 minutes ago">Agreed. I’ll add 429 handling and a test that checks the Retry-After delay.</Comment>
          </div>
        </aside>}
      </div>
    </section>
  );
}

function Comment({ name, time, quote, children }: { name: string; time: string; quote?: string; children: React.ReactNode }) {
  return <div className={styles.comment}>
    <div className={styles.author}><span className={styles.avatar} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span><span className={styles.name}>{name}</span><span className={styles.time}>{time}</span></div>
    <div className={styles.commentBody}>{quote && <blockquote>{quote}</blockquote>}<p>{children}</p></div>
  </div>;
}
