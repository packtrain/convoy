"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, Ellipsis, FileText, GitCommitHorizontal, GitPullRequest, ListChecks, ListFilter, MessageSquare, Pencil, Plus, RefreshCw, SquareCheck, TriangleAlert } from "lucide-react";
import { PreviewComposer } from "../preview-composer";
import { RuntimeIcon } from "../runtime-icons";
import { chapters, commits, files, githubChecks, prChecks, pullRequest as pr, threads, type PreviewFile } from "./fixtures";
import styles from "./pull-request-preview.module.css";

const TABS = ["Overview", "Guide", "Diff"] as const;
type Tab = (typeof TABS)[number];

const checkIcons = {
  passed: { Icon: CircleCheck, label: "Passed" },
  warning: { Icon: TriangleAlert, label: "Warning" },
  pending: { Icon: Circle, label: "Pending" },
};

const count = (file: PreviewFile, sign: string) => file.lines.filter(line => line[0] === sign).length;

function Avatar({ name }: { name: string }) {
  return <span className={styles.avatar} aria-hidden>{name[0].toUpperCase()}</span>;
}

function Card({ icon, title, subtitle, action, children }: { icon: ReactNode; title: string; subtitle: string; action?: ReactNode; children?: ReactNode }) {
  return <details className={styles.card}>
    <summary>
      <span className={styles.cardIcon}>{icon}</span>
      <span className={styles.cardText}><span>{title}</span><small>{subtitle}</small></span>
      {action}
      <ChevronRight aria-hidden className={styles.chevron} />
    </summary>
    {children}
  </details>;
}

function Overview() {
  const passed = prChecks.filter(check => check.status !== "pending").length;
  return <div className={styles.overview}>
    <div className={styles.main}>
      <h3 className={styles.title}>{pr.title} <span>#{pr.number}</span></h3>
      <p className={styles.branches}><b>{pr.author}</b> · <code>{pr.base} ← {pr.head}</code></p>
      <p className={styles.description}>{pr.description}</p>

      <div className={styles.checksCard}>
        <Card icon={<TriangleAlert className={styles.warning} />} title={`Pull request checks: ${passed}/${prChecks.length}`} subtitle="Pull Request Checks · 1 warning · 1 pending · Outdated" action={<span className={styles.run}><ListChecks />Run checks</span>} />
        {prChecks.map(check => {
          const { Icon, label } = checkIcons[check.status];
          return <details key={check.label} className={styles.checkRow}>
            <summary><Icon aria-label={label} className={styles[check.status]} /><span>{check.label}</span>{"outdated" in check && <small className={styles.outdated}>Outdated</small>}<ChevronRight aria-hidden className={styles.chevron} /></summary>
            <p>{check.note}</p>
          </details>;
        })}
      </div>

      <Card icon={<CircleCheck className={styles.passed} />} title={`GitHub checks: ${githubChecks.length}/${githubChecks.length}`} subtitle="build, lint and test passed on the head commit.">
        <ol className={styles.list}>{githubChecks.map(check => <li key={check.name}><CircleCheck className={styles.passed} /><span>{check.name}</span><small>{check.time}</small></li>)}</ol>
      </Card>
      <Card icon={<GitCommitHorizontal />} title={`Commits: ${commits.length}`} subtitle={`Latest: ${commits[0].message} · ${commits[0].ago}`}>
        <ol className={styles.list}>{commits.map(commit => <li key={commit.sha}><span>{commit.message}</span><small>{commit.ago}</small><code>{commit.sha}</code></li>)}</ol>
      </Card>

      <section aria-label="Activity" className={styles.activity}>
        <div className={styles.activityHeading}><h4>Activity</h4><ListFilter aria-hidden /></div>
        <PreviewComposer task={{ id: `#${pr.number}`, title: pr.title, icon: GitPullRequest }} />
        <p className={styles.addComment}><MessageSquare aria-hidden />Add comment...</p>
        <div className={styles.comment}>
          <Avatar name="sam" />
          <div><p><b>sam</b> · 3 hours ago</p><p>Can the retry cap come from the project settings later?</p></div>
        </div>
        <ul className={styles.threadGroup}>
          {threads.slice(0, 2).map(thread => <li key={thread.title}>{thread.unread && <span className={styles.unread} />}<span>{thread.title}</span><RuntimeIcon runtime={thread.runtime} /><small>Done {thread.ago}</small></li>)}
        </ul>
        <p className={styles.event}><GitCommitHorizontal aria-hidden /><span>alex committed <b>{commits[0].message}</b> · {commits[0].ago}</span></p>
        <p className={styles.event}><Check aria-hidden className={styles.passed} /><span>sam approved these changes · 1 hour ago</span></p>
      </section>
    </div>

    <aside className={styles.sidebar} aria-label="Pull request details">
      <h5>Status</h5><p className={styles.open}><GitPullRequest />Open</p>
      <h5>Threads <Plus aria-hidden /></h5>
      <ul className={styles.threads}>{threads.map(thread => <li key={thread.title}><GitPullRequest aria-hidden /><small>#{pr.number}</small><span>{thread.title}</span><RuntimeIcon runtime={thread.runtime} /><small>{thread.ago}</small></li>)}</ul>
      <h5>Tasks</h5><p><SquareCheck className={styles.taskIcon} /><small>{pr.task.id}</small><span>{pr.task.title}</span></p>
      <h5>Reviewers <Pencil aria-hidden /></h5><p><Avatar name="sam" />sam<Check aria-label="Approved" className={styles.passed} /></p>
      <h5>Assignees <Pencil aria-hidden /></h5><p><Avatar name="alex" />alex</p>
      <h5>Branch</h5><p><CircleCheck className={styles.passed} />Up to date with {pr.base}</p>
    </aside>
  </div>;
}

function FileDiff({ file, reviewed, onReviewed }: { file: PreviewFile; reviewed: boolean; onReviewed: (value: boolean) => void }) {
  const slash = file.path.lastIndexOf("/") + 1;
  let line = file.start;
  return <details open className={styles.diff}>
    <summary>
      <ChevronDown aria-hidden className={styles.diffChevron} />
      <span className={styles.path}><span>{file.path.slice(0, slash)}</span>{file.path.slice(slash)}</span>
      <span className={styles.added}>+{count(file, "+")}</span><span className={styles.removed}>-{count(file, "-")}</span>
      <label onClick={event => event.stopPropagation()}><input type="checkbox" checked={reviewed} onChange={event => onReviewed(event.target.checked)} />Reviewed</label>
    </summary>
    <pre>{file.lines.map((text, index) => {
      const kind = text[0] === "+" ? styles.add : text[0] === "-" ? styles.del : "";
      return <span key={index} className={`${styles.line} ${kind}`}><i>{text[0] === "-" ? "" : line++}</i>{text.slice(1) || " "}</span>;
    })}</pre>
  </details>;
}

type ReviewState = { reviewed: Set<string>; setReviewed: (path: string, value: boolean) => void };

function Guide({ reviewed, setReviewed }: ReviewState) {
  return <div className={styles.guide}>
    {chapters.map((chapter, index) => <section key={chapter.title} className={styles.chapter} aria-label={chapter.title}>
      <div className={styles.notes}>
        <small>{String(index + 1).padStart(2, "0")} / {String(chapters.length).padStart(2, "0")}</small>
        <h4>{chapter.title}</h4>
        <p>{chapter.body}</p>
        {chapter.callout && <p className={styles.callout}><CircleAlert aria-hidden /><span><b>Product:</b> {chapter.callout}</span></p>}
        {chapter.files.map(file => {
          const slash = file.path.lastIndexOf("/");
          return <div key={file.path}>
            <p className={styles.fileRow}><FileText aria-hidden /><span>{file.path.slice(slash + 1)}</span><small>{file.path.slice(0, slash)}</small>{reviewed.has(file.path) && <Check aria-label="Reviewed" />}<b>+{count(file, "+")}</b></p>
            {file.note && <p className={styles.fileNote}>{file.note}</p>}
          </div>;
        })}
        {chapter.question && <p className={styles.question}>Question: {chapter.question}</p>}
      </div>
      <div className={styles.diffs}>{chapter.files.map(file => <FileDiff key={file.path} file={file} reviewed={reviewed.has(file.path)} onReviewed={value => setReviewed(file.path, value)} />)}</div>
    </section>)}
  </div>;
}

export function PullRequestPreview() {
  const [tab, setTab] = useState<Tab>("Guide");
  const [reviewed, setReviewedPaths] = useState(() => new Set<string>());
  function setReviewed(path: string, value: boolean) {
    setReviewedPaths(current => {
      const next = new Set(current);
      if (value) next.add(path); else next.delete(path);
      return next;
    });
  }
  return <section className={styles.preview} aria-label="Pull request review preview">
    <header className={styles.header}>
      <GitPullRequest className={styles.open} aria-hidden />
      <h2>{pr.title}</h2>
      <span className={styles.actions} aria-hidden>
        <span className={styles.pill}><CircleCheck className={styles.passed} />Merge status</span>
        <span className={styles.pill}>Submit review<b>2</b></span>
        <Ellipsis /><RefreshCw /><ArrowUpRight />
      </span>
    </header>
    <div className={styles.tabs} role="tablist" aria-label="Pull request views">
      {TABS.map(name => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
      <span className={styles.meta}>{tab === "Guide"
        ? <><RuntimeIcon runtime="claude-code" />Sonnet 5.5 <code>{pr.sha}</code> 2h</>
        : <code>{pr.base} <ArrowRight aria-hidden /> {pr.sha}</code>}</span>
    </div>
    <div className={styles.body} role="tabpanel" aria-label={tab}>
      {tab === "Overview" && <Overview />}
      {tab === "Guide" && <Guide reviewed={reviewed} setReviewed={setReviewed} />}
      {tab === "Diff" && <div className={styles.diffs}>{files.map(file => <FileDiff key={file.path} file={file} reviewed={reviewed.has(file.path)} onReviewed={value => setReviewed(file.path, value)} />)}</div>}
    </div>
  </section>;
}
