import { Bug, ChevronLeft, MoreHorizontal, Plus, Terminal, Wrench } from "lucide-react";
import { HeroPreview } from "../hero-preview";
import { PreviewComposer } from "../preview-composer";
import styles from "./remote-thread-preview.module.css";

export function RemoteThreadPreview() {
  return (
    <div className={styles.stage}>
      {/* The same thread on a laptop, behind the phone. */}
      <div className={styles.desktop} data-desktop-backdrop aria-hidden="true" inert>
        <div className={styles.screen}><HeroPreview /></div>
      </div>
    <section className={styles.phone} aria-label="Mobile remote thread preview">
      <header className={styles.header}>
        <button type="button" aria-label="Back to threads" aria-disabled="true"><ChevronLeft /></button>
        <span className={styles.reference}><Bug aria-hidden="true" /><span>NS-142</span></span>
        <h2 title="Add webhook retries">Add webhook retries</h2>
        <button type="button" aria-label="Add thread to group" aria-disabled="true"><Plus /></button>
        <button type="button" aria-label="Thread actions" aria-disabled="true"><MoreHorizontal /></button>
      </header>
      <div className={styles.conversation} role="region" aria-label="Thread conversation" tabIndex={0}>
        <div className={styles.messages}>
          <div className={styles.user}>Add retries for failed webhook deliveries.</div>
          <p>I added exponential backoff for failed deliveries. Each retry keeps the same delivery ID so receivers can ignore duplicates.</p>
          <div className={styles.user}>Cap retries at three attempts.</div>
          <p>I’ll cap each delivery at three attempts and test the limit.</p>
          <details className={styles.tool}>
            <summary><Wrench aria-hidden="true" />1 tool call</summary>
            <div className={styles.result}>
              <div><Terminal aria-hidden="true" /><span>Run command</span></div>
              <pre>pnpm test webhooks{`\n\n`}✓ retries failed deliveries{`\n`}✓ stops after three attempts{`\n`}✓ preserves the delivery ID{`\n\n`}3 tests passed</pre>
            </div>
          </details>
          <p>Done. Deliveries stop after the third attempt. All three retry tests pass.</p>
        </div>
      </div>
      <PreviewComposer />
    </section>
    </div>
  );
}
