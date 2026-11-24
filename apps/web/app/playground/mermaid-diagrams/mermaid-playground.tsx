"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { AppLink, appRoute } from "@/lib/navigation";

const MdxEditor = dynamic(
  () => import("@/components/mdx-editor").then((mod) => mod.MdxEditor),
  { ssr: false, loading: () => <p className="p-6 text-muted-foreground">Loading the editor…</p> }
);

const fence = (code: string) => `\`\`\`mermaid\n${code.trim()}\n\`\`\``;

const SAMPLE_ARTIFACT = `# Plan: artifact sync

Mermaid fences render as diagrams in artifacts. Hover a diagram for its toolbar: edit the source (it re-renders as you type and folds back when focus leaves), download SVG or PNG, zoom, or open fullscreen. Drag to pan; ctrl/⌘+scroll zooms.

## Flowchart

${fence(`
flowchart LR
  Agent[CLI agent] -->|writes plan| Artifact[(Task artifact)]
  Artifact --> Review{Human review}
  Review -->|approve| Build[Implement]
  Review -->|comment| Agent
`)}

## Large flowchart

Taller than the inline cap, so it clips: drag, zoom out, or open fullscreen.

${fence(`
flowchart TD
  Start([Task created]) --> Triage{Needs triage?}
  Triage -->|yes| Label[Apply triage label]
  Triage -->|no| Plan[Planning]
  Label --> Plan
  Plan --> Spec[Write or update spec]
  Spec --> Review{Plan approved?}
  Review -->|changes| Plan
  Review -->|yes| Slice1[Slice 1: end to end]
  Slice1 --> Tests1[Failing test first]
  Tests1 --> Impl1[Implement]
  Impl1 --> Verify1{Checks pass?}
  Verify1 -->|no| Impl1
  Verify1 -->|yes| Commit1[Commit slice 1]
  Commit1 --> Slice2[Slice 2: widen]
  Slice2 --> Tests2[Failing test first]
  Tests2 --> Impl2[Implement]
  Impl2 --> Verify2{Checks pass?}
  Verify2 -->|no| Impl2
  Verify2 -->|yes| Commit2[Commit slice 2]
  Commit2 --> UI{Visual check OK?}
  UI -->|no| Impl2
  UI -->|yes| InReview[In Review]
  InReview --> Merge{Approved?}
  Merge -->|changes| Slice2
  Merge -->|yes| Done([Done])
`)}

## Sequence diagram

${fence(`
sequenceDiagram
  participant U as User
  participant W as Web app
  participant C as Convex
  participant A as Agent
  U->>W: Send message
  W->>C: threads.send
  C-->>A: Op queued
  A->>C: Stream reply
  C-->>W: Live update
`)}

## State diagram

${fence(`
stateDiagram-v2
  [*] --> ToDo
  ToDo --> InProgress
  InProgress --> InReview
  InReview --> InProgress: changes requested
  InReview --> Done
  Done --> [*]
`)}

## Entity relationships

${fence(`
erDiagram
  ORGANIZATION ||--o{ PROJECT : owns
  PROJECT ||--o{ TASK : contains
  TASK ||--o{ ARTIFACT : has
  TASK ||--o{ THREAD : "worked in"
`)}

## Class diagram

${fence(`
classDiagram
  class Task {
    +string ref
    +Status status
    +assign(user)
  }
  class Artifact {
    +string name
    +string content
  }
  Task "1" --> "*" Artifact
`)}

## Gantt chart

${fence(`
gantt
  title Milestone 2
  dateFormat YYYY-MM-DD
  section Editor
    Mermaid preview   :done, m1, 2026-11-24, 1d
    Playground        :active, m2, after m1, 1d
  section Rollout
    Artifacts         :m3, after m2, 2d
`)}

## Pie chart

${fence(`
pie title Thread outcomes
  "Merged" : 62
  "Needs follow-up" : 25
  "Abandoned" : 13
`)}

## Invalid diagram

A syntax error shows the parser message and the source instead of breaking the document.

${fence(`
flowchart TD
  A --> 
`)}

## Plain code block

Other languages keep the regular code editor.

\`\`\`ts
const answer = 42;
\`\`\`
`;

export function MermaidPlayground() {
  const [content, setContent] = useState(SAMPLE_ARTIFACT);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8">
        <AppLink href={appRoute.playground()} className="text-sm text-muted-foreground hover:text-foreground">
          ← Playground
        </AppLink>
        <div>
          <h1 className="text-2xl font-semibold">Mermaid diagrams</h1>
          <p className="text-sm text-muted-foreground">
            The shared MDX editor with the artifact panel&apos;s settings, seeded with one diagram of each common type.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <MdxEditor
            value={content}
            onChange={setContent}
            showDiffMode={false}
            stickyToolbar
            density="compact"
            contentPadding="spacious"
            contentWidth="narrow"
          />
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Stored markdown</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-xs">{content}</pre>
        </details>
      </div>
    </main>
  );
}
