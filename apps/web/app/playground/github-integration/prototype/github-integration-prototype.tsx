"use client";

import { useState } from "react";
import { ArrowLeft, Box, GitPullRequest, Link2, Settings2 } from "lucide-react";
import { AppLink, routeTarget } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Picker } from "./controls";
import {
  blockedBy,
  defaultFilters,
  filterPullRequests,
  initialStored,
  isOpen,
  pageSize,
  prKey,
  pullRequests,
  repositories,
  seedCommentsFor,
  type GithubAccess,
  defaultGuideSettings,
  seedGuidesFor,
  type Guide,
  type GuideSettings,
  type PrComment,
  type PrFilters,
  type PullRequest,
} from "./fixtures";
import { IntegrationsPage } from "./integrations-page";
import { PullRequestsPage } from "./pull-requests-page";
import { PullRequestReader } from "./pull-request-reader";

export function GithubIntegrationPrototype() {
  const [records, setRecords] = useState(pullRequests);
  const [connected, setConnected] = useState(repositories.slice(0, 2));
  const [retained, setRetained] = useState<string[]>([]);
  const [stored, setStored] = useState(() =>
    initialStored().filter((id) => !id.startsWith("contoso/desktop")),
  );
  const [view, setView] = useState("prs");
  const [selected, setSelected] = useState<PullRequest | null>(null);
  const [role, setRole] = useState("admin");
  const [access, setAccess] = useState<GithubAccess>("write");
  const [stale, setStale] = useState(false);
  const [incoming, setIncoming] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [filters, setFilters] = useState(defaultFilters);
  const [comments, setComments] = useState<Record<string, PrComment[]>>({});
  const [reviewed, setReviewed] = useState<Record<string, string[]>>({});
  const [guides, setGuides] = useState<Record<string, Guide[]>>({});
  const [guideSettings, setGuideSettings] = useState(defaultGuideSettings);
  // The user's GitHub login is only known once they connect their own account.
  const githubLogin = role === "admin" ? "robin" : "maya";
  // Stands in for the agent's CLI thread finishing; a reset in between drops the result.
  const generateGuide = (pr: PullRequest, settings: GuideSettings, revision: string, base?: Guide) => {
    const key = prKey(pr);
    const guide = { id: `${key}:${Date.now()}`, requester: githubLogin, model: settings.model, revision, createdAt: Date.now(), writing: true, base };
    setGuideSettings(settings);
    setGuides((current) => ({ ...current, [key]: [...(current[key] ?? seedGuidesFor(pr)), guide] }));
    setTimeout(() => setGuides((current) => (current[key] ? { ...current, [key]: current[key].map((item) => (item.id === guide.id ? { ...item, writing: false } : item)) } : current)), 3000);
  };
  const currentUser = access === "none" ? null : githubLogin;
  function changeAccess(next: GithubAccess) {
    setAccess(next);
    if (next !== "none") return;
    setFilters((current) => ({
      ...current,
      author: current.author === "me" ? "all" : current.author,
      assignee: current.assignee === "me" ? "all" : current.assignee,
    }));
  }
  const scoped = records.filter((pr) => connected.includes(pr.repo));
  function changeFilters(change: Partial<PrFilters>) {
    const next = { ...filters, page: 0, ...change };
    setFilters(next);
    if (next.query.trim() || next.tab !== "closed") return;
    const visited = filterPullRequests(scoped, next, currentUser)
      .slice(next.page * pageSize, (next.page + 1) * pageSize)
      .map(prKey);
    setStored((current) => [...new Set([...current, ...visited])]);
  }
  function navigate(next: string) {
    setView(next);
    setSelected(null);
  }
  function saveRepos(repos: string[]) {
    if (role !== "admin") return;
    setConnected(repos);
    setRetained((current) => current.filter((org) => !repos.some((repo) => repo.startsWith(`${org}/`))));
    setStale(false);
    setStored((current) => [
      ...new Set([
        ...current,
        ...pullRequests.filter((pr) => repos.includes(pr.repo) && isOpen(pr)).map(prKey),
      ]),
    ]);
    if (selected && !repos.includes(selected.repo)) setSelected(null);
  }
  function disconnect(organization: string) {
    if (role !== "admin") return;
    setConnected((current) => current.filter((repo) => !repo.startsWith(`${organization}/`)));
    setRetained((current) => [...new Set([...current, organization])]);
    setSelected(null);
  }
  function reset() {
    setRecords(pullRequests);
    setConnected(repositories.slice(0, 2));
    setRetained([]);
    setStored(initialStored().filter((id) => !id.startsWith("contoso/desktop")));
    setView("prs");
    setSelected(null);
    setRole("admin");
    setAccess("write");
    setStale(false);
    setIncoming([]);
    setNotice("");
    setFilters(defaultFilters);
    setComments({});
    setReviewed({});
    setGuides({});
    setGuideSettings(defaultGuideSettings);
    setResetKey((current) => current + 1);
  }
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:h-dvh">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs">
        <AppLink
          href={routeTarget("/playground")}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Playground
        </AppLink>
        <span className="font-medium">GitHub integration</span>
        <Badge variant="outline">Interactive prototype</Badge>
        <span className="text-muted-foreground">Mock data · Resets on reload</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Picker
            label="Demo role"
            value={role}
            onChange={setRole}
            options={[
              { value: "admin", label: "Project admin" },
              { value: "viewer", label: "Project viewer" },
            ]}
          />
          <Picker
            label="GitHub access"
            value={access}
            onChange={(value) => changeAccess(value as GithubAccess)}
            options={[
              { value: "none", label: "GitHub: not connected" },
              { value: "read", label: "GitHub: read" },
              { value: "triage", label: "GitHub: triage" },
              { value: "write", label: "GitHub: write" },
            ]}
          />
          <Button variant="outline" size="sm" onClick={() => setStale(!stale)}>
            {stale ? "Restore sync" : "Simulate sync failure"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!selected || (selected ? incoming.includes(prKey(selected)) : false)}
            onClick={() => {
              if (selected) setIncoming((current) => [...current, prKey(selected)]);
            }}
          >
            Simulate new commit
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset demo
          </Button>
        </div>
      </div>
      <div key={resetKey} className="flex flex-1 flex-col md:min-h-0 md:flex-row">
        <aside className="flex shrink-0 flex-col border-b bg-sidebar md:w-52 md:border-r md:border-b-0">
          <div className="flex items-center gap-2.5 px-4 py-5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Box className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">Convoy</p>
              <p className="text-xs text-muted-foreground">Contoso workspace</p>
            </div>
          </div>
          <nav aria-label="Project navigation" className="flex gap-1 px-2 pb-3 md:flex-col">
            <Button
              variant={view === "prs" ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => navigate("prs")}
            >
              <GitPullRequest />
              Pull requests
            </Button>
            <Button
              variant={view !== "prs" ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => navigate("integrations")}
            >
              <Settings2 />
              Integrations
            </Button>
          </nav>
          <div className="mt-auto hidden px-4 py-5 md:block">
            <p className="mb-3 text-xs text-muted-foreground">Linked from a task</p>
            <button
              className="flex cursor-pointer items-start gap-2 text-left text-xs hover:underline"
              onClick={() => {
                if (connected.includes(pullRequests[0].repo)) {
                  setSelected(records[0]);
                  setView("prs");
                } else
                  setNotice(
                    "This repository is disconnected. In Convoy, this task link would open on GitHub.",
                  );
              }}
            >
              <Link2 className="size-3.5 shrink-0" />
              <span>
                OS-1852<span className="mt-1 block text-muted-foreground">PR #482</span>
              </span>
            </button>
            <div className="mt-6 flex items-center gap-2 border-t pt-4">
              <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs">
                {role === "admin" ? "PT" : "MS"}
              </div>
              <div className="text-xs">
                {role === "admin" ? "Robin Hale" : "Maya Singh"}
                <p className="text-muted-foreground">
                  {role === "admin" ? "Project admin" : "Project viewer"}
                </p>
              </div>
            </div>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col md:min-h-0 md:overflow-y-auto" aria-label="Project content">
          {view !== "prs" ? (
            <IntegrationsPage
              page={view}
              onPageChange={navigate}
              connected={connected}
              retained={retained.length > 0}
              viewer={role === "viewer"}
              stale={stale}
              githubLogin={currentUser}
              onGithubAccount={(connect) => changeAccess(connect ? "write" : "none")}
              onSave={saveRepos}
              onDisconnect={disconnect}
            />
          ) : (
            <>
              <div className={selected ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
                <PullRequestsPage
                  records={records}
                  onRecordsChange={setRecords}
                  canManage={!blockedBy(access, "triage")}
                  connected={connected}
                  stored={stored}
                  stale={stale}
                  filters={filters}
                  onFiltersChange={changeFilters}
                  currentUser={currentUser}
                  onOpen={setSelected}
                  onSettings={() => navigate("github")}
                />
              </div>
              {selected && connected.includes(selected.repo) ? (
                <PullRequestReader
                  records={scoped}
                  filters={filters}
                  onFiltersChange={changeFilters}
                  currentUser={currentUser}
                  onSelect={setSelected}
                  pr={selected}
                  incoming={incoming.includes(prKey(selected))}
                  comments={comments[prKey(selected)] ?? seedCommentsFor(selected)}
                  onCommentsChange={(next) => setComments((current) => ({ ...current, [prKey(selected)]: next }))}
                  reviewed={reviewed[prKey(selected)] ?? []}
                  onReviewedChange={(next) => setReviewed((current) => ({ ...current, [prKey(selected)]: next }))}
                  guides={guides[prKey(selected)] ?? seedGuidesFor(selected)}
                  guideSettings={guideSettings}
                  onGenerateGuide={(settings, revision, base) => generateGuide(selected, settings, revision, base)}
                  access={access}
                  onConnect={() => changeAccess("write")}
                  onChange={(change, targets = [selected]) => {
                    const keys = targets.map(prKey);
                    setRecords((current) => current.map((pr) => (keys.includes(prKey(pr)) ? { ...pr, ...change } : pr)));
                    setSelected({ ...selected, ...change });
                  }}
                  onNotice={setNotice}
                  onBack={() => setSelected(null)}
                  onExternal={() =>
                    setNotice(
                      "These PRs are fictional. In the finished integration, this opens the selected PR on GitHub.",
                    )
                  }
                />
              ) : null}
            </>
          )}
        </section>
      </div>
      <footer
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"
        aria-label="Prototype inspector"
      >
        <span className="font-medium">Demo inspector</span>
        <span aria-live="polite">Metadata records: {stored.length}</span>
        <span>Connected repositories: {connected.length}</span>
        <span>
          {selected
            ? stored.includes(prKey(selected))
              ? "Reader: stored PR"
              : "Reader: live-only PR"
            : "Search and reading do not import records"}
        </span>
        <span>{retained.length ? "Deletion scheduled in 30 days" : "No scheduled deletion"}</span>
      </footer>
      <Dialog
        open={!!notice}
        onOpenChange={(open) => {
          if (!open) setNotice("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prototype preview</DialogTitle>
            <DialogDescription>{notice}</DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={() => setNotice("")}>
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
