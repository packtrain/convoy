"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { getAppUrlBase } from "@/convex/lib/shared/appUrl";
import { AppLink, routeTarget } from "@/lib/navigation";

const PROJECT_URL = `${getAppUrlBase()}/o/contoso/OS`;

const SAMPLE = `I created the follow-up as [Project default views](${PROJECT_URL}?task=OS-2148 "type=feature; status=To Do").

It builds on three tasks from this week:

- [Add optional board rows by a second dimension](${PROJECT_URL}?task=OS-2138 "type=feature; status=Done")
- [Add List-scoped sections to task lists and boards](${PROJECT_URL}?task=OS-2137 "type=feature; status=In Review")
- [Add task-list grouping and Owner grouping](${PROJECT_URL}?task=OS-2136 "type=feature; status=Done")

The drag-start fix in [OS-2120](${PROJECT_URL}?task=OS-2120 "type=bug; status=Done") touches the same board file, so I left it alone.

[Kanban card flickers while dragging between rows](${PROJECT_URL}?task=OS-2141 "type=bug; status=Blocked")

I wrote the [Implementation plan](${PROJECT_URL}?task=OS-2148&artifact=kd71plan "type=md") as an artifact on OS-2148. Both artifacts on that task:

- [Implementation plan](${PROJECT_URL}?task=OS-2148&artifact=kd71plan "type=md")
- [Default view settings mockup](${PROJECT_URL}?task=OS-2148&artifact=kd72mock "type=html")

A list with other text keeps its bullets and uses chips:

- [Clean up sample fixtures](${PROJECT_URL}?task=OS-1001 "type=chore; status=Done")
- [Investigate preview rendering](${PROJECT_URL}?task=OS-1002 "type=investigation; status=To Do") was created in To Do.

A link without a snapshot falls back to its text: [Board grouping cleanup](${PROJECT_URL}?task=OS-2099). A bare URL shows only the ref: ${PROJECT_URL}?task=OS-2100

External links keep the confirm dialog: [Streamdown docs](https://streamdown.ai).`;

export default function TaskLinksPlaygroundPage() {
  const [markdown, setMarkdown] = useState(SAMPLE);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-8 sm:py-12">
        <header className="space-y-4">
          <AppLink href={routeTarget("/playground")} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
          </AppLink>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Task and artifact links in agent replies</h1>
            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">OS-2149</span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            The agent writes a normal task URL and puts a snapshot in the link title:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">[Title](url &quot;type=bug; status=In Progress&quot;)</code>.
            Artifact links add <code className="rounded bg-muted px-1 py-0.5 text-xs">&amp;artifact=ID</code> to the URL and{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">&quot;type=md&quot;</code> (or <code className="rounded bg-muted px-1 py-0.5 text-xs">html</code>) to the title.
            The preview shows that snapshot as written, with no query. Edit the markdown to try your own.
          </p>
        </header>

        <section aria-label="Task link preview" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3 text-xs">
              <span className="font-medium">Plan project default views</span>
              <span className="text-muted-foreground">Claude Code</span>
            </div>
            <div className="space-y-6 px-5 py-6 sm:px-7">
              <div className="ml-auto max-w-[90%] rounded-lg bg-muted px-3 py-2 text-sm leading-6">
                File a follow-up for the default views and tell me what it depends on.
              </div>
              <MessageResponse>{markdown}</MessageResponse>
            </div>
          </div>

          <aside className="space-y-5">
            <p className="text-xs leading-5 text-muted-foreground">
              A link on its own line becomes a block, a list of task or artifact links becomes one table, and a link inside a sentence becomes a chip.
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Markdown</h2>
                <Button size="sm" variant="ghost" onClick={() => setMarkdown(SAMPLE)}>Reset</Button>
              </div>
              <textarea
                aria-label="Markdown"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                className="h-80 w-full resize-y rounded-md border border-border bg-muted/20 p-2 font-mono text-xs leading-5"
              />
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
