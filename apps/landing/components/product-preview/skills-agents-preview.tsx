import { Bold, Code, FilePenLine, FileText, Italic, List, ListOrdered, Maximize2, MoreHorizontal, Pilcrow, SquareCode, Strikethrough, Underline } from "lucide-react";
import styles from "./skills-agents-preview.module.css";

// Product references: skill-readonly-detail, agent-form and mdx-editor.
function SkillDetail() {
  return (
    <section className={`${styles.panel} ${styles.skill}`} aria-label="Skill detail preview">
      <header className={styles.skillHeader}>
        <h2>/review-webhooks</h2>
        <span>Engineering</span>
        <p>Review webhook changes for safe retries and verified deliveries.</p>
      </header>
      <div className={styles.document}>
        <div className={`${styles.markdown} ${styles.readonly}`}>
          <p>Before approving a webhook change:</p>
          <ol>
            <li>Verify signatures before processing a delivery.</li>
            <li>Check retry limits and exponential backoff.</li>
            <li>Confirm duplicate deliveries are handled safely.</li>
          </ol>
          <p>Record concrete findings on the task, with file references.</p>
        </div>
      </div>
      <section className={styles.files} aria-label="Skill supporting files">
        <h3>Files</h3>
        <div className={styles.file}><FileText /><span>references/review-checklist.md</span></div>
      </section>
    </section>
  );
}

function AgentDetail() {
  return (
    <section className={`${styles.panel} ${styles.agent}`} aria-label="Project agent configuration preview">
      <div className={styles.field}>
        <label>Agent name
          <span className={styles.nameRow}><span className={styles.color} aria-hidden="true"><span /></span><input readOnly value="Code Reviewer" /></span>
        </label>
      </div>
      <div className={styles.field}>
        <label>Category<input readOnly value="Engineering" /></label>
      </div>
      <div className={styles.field}>
        <label>Description<textarea readOnly value="Reviews code changes and calls out risks." /></label>
      </div>
      <div className={styles.field}>
        <div className={styles.contentLabel}><span>Content</span><Maximize2 aria-hidden="true" /></div>
        <div className={styles.editor}>
          <div className={styles.toolbar} aria-hidden="true">
            <span className={styles.paragraph}><Pilcrow /></span>
            <div>{[Bold, Italic, Strikethrough, Underline, Code, List, ListOrdered].map((Icon, index) => <span key={index}><Icon /></span>)}</div>
            <span><SquareCode /></span><span><MoreHorizontal /></span><span><FilePenLine /></span>
          </div>
          <div className={`${styles.markdown} ${styles.prompt}`}>
            <p>Review changes against the task’s acceptance criteria.</p>
            <p>Report concrete findings with file references. Explain what needs to change and why.</p>
            <p>Use the review-webhooks Skill when reviewing webhook changes.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SkillsAgentsPreview() {
  return (
    <div className={styles.scene}>
      <div className={styles.frames}>
        <SkillDetail />
        <AgentDetail />
      </div>
    </div>
  );
}
