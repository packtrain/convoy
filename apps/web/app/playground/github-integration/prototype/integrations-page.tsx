import { useState } from "react";
import { ArrowLeft, Check, ChevronRight, Github, Gitlab, Hash, LockKeyhole, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { repositories } from "./fixtures";

export function IntegrationsPage({
  page,
  onPageChange,
  connected,
  retained,
  viewer,
  stale,
  githubLogin,
  onGithubAccount,
  onSave,
  onDisconnect,
}: {
  page: string;
  onPageChange: (page: string) => void;
  connected: string[];
  retained: boolean;
  viewer: boolean;
  stale: boolean;
  githubLogin: string | null;
  onGithubAccount: (connect: boolean) => void;
  onSave: (repos: string[]) => void;
  onDisconnect: (organization: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  const [disconnect, setDisconnect] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [organization, setOrganization] = useState("contoso");
  const organizations = [...new Set(connected.map((repo) => repo.split("/")[0]))];
  const available = [...repositories, "acme/api", "acme/web"];
  const [selected, setSelected] = useState<string[]>([]);
  const [share, setShare] = useState(false);
  function openPicker(org: string) {
    if (viewer) return;
    setOrganization(org);
    const current = connected.filter((repo) => repo.startsWith(`${org}/`));
    setSelected(current.length ? current : available.filter((repo) => repo.startsWith(`${org}/`)).slice(0, 2));
    setAdding(false);
    setShare(false);
    setPicker(true);
  }
  const catalog = [
    { id: "github", name: "GitHub", description: "Pull requests and code", Icon: Github },
    { id: "gitlab", name: "GitLab", description: "Merge requests and code", Icon: Gitlab },
    { id: "slack", name: "Slack", description: "Project notifications", Icon: Hash },
  ];
  if (page !== "github") {
    const integration = catalog.find((item) => item.id === page);
    return (
      <div className="mx-auto w-full max-w-4xl px-5 py-8 md:px-10">
        {integration ? (
          <>
            <Button variant="ghost" size="sm" className="mb-6" onClick={() => onPageChange("integrations")} aria-label="Back to integrations"><ArrowLeft />Integrations</Button>
            <h1 className="flex items-center gap-3 text-2xl font-semibold"><integration.Icon className="size-7" />{integration.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{integration.description}</p>
            <div className="mt-8 rounded-lg border p-5"><Badge variant="outline">Coming soon</Badge><p className="mt-3 text-sm text-muted-foreground">This integration is planned. Connection settings will appear here when it is available.</p></div>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">Project settings</p>
            <h1 className="text-2xl font-semibold">Integrations</h1>
            <p className="mt-2 text-sm text-muted-foreground">Connect the tools your project works with.</p>
            <div className="mt-8 divide-y overflow-hidden rounded-lg border">
              {catalog.map(({ id, name, description, Icon }) => (
                <button key={id} aria-label={name} onClick={() => onPageChange(id)} className="flex w-full cursor-pointer items-center gap-4 p-5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-5" /></div>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{name}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></span>
                  <Badge variant="outline">{id === "github" ? organizations.length ? `${organizations.length} ${organizations.length === 1 ? "organization" : "organizations"} connected` : "Not connected" : "Coming soon"}</Badge>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 md:px-10">
      <Button variant="ghost" size="sm" onClick={() => onPageChange("integrations")} aria-label="Back to integrations"><ArrowLeft />Integrations</Button>
      <section aria-label="GitHub integration" className="mt-9 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
            <Github className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-medium">GitHub</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse pull requests and code from your connected repositories, right here in Convoy.
            </p>
          </div>
        </div>

        {/* Per person, so viewers see it too: reading needs no account, acting on GitHub does. */}
        <section aria-label="Your GitHub account" className="flex items-center gap-3 rounded-lg border px-4 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><Github className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Your GitHub account</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {githubLogin
                ? `Connected as @${githubLogin}. Your comments, reviews, and merges post as you.`
                : "Not connected. Connect it to comment, review, and merge as yourself."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onGithubAccount(!githubLogin)}>{githubLogin ? "Disconnect" : "Connect"}</Button>
        </section>

        <section aria-labelledby="connected-organizations-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="connected-organizations-heading" className="text-sm font-medium">Connected organizations</h3>
            <Button variant="ghost" size="icon-sm" aria-label="Add organization" title="Add organization" onClick={() => setAdding(true)} disabled={viewer}><Plus className="size-4" /></Button>
          </div>
          {connected.length ? (
            <div className="space-y-3">
            {organizations.map((org) => (
            <section key={org} aria-label={`${org} organization`} className="overflow-hidden rounded-lg border">
              <div className="flex items-center gap-3 px-4 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold">{org[0].toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{org}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`size-1.5 shrink-0 rounded-full ${stale ? "bg-amber-500" : "bg-green-600"}`} />
                    {stale ? "Sync interrupted" : "Pull requests synced"}
                    <span>· {connected.filter((repo) => repo.startsWith(`${org}/`)).length} repositories</span>
                  </p>
                </div>
                {!viewer ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={org === "contoso" ? "GitHub actions" : `${org} actions`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openPicker(org)}>Manage repositories</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDisconnect(org)} className="text-destructive">
                        Disconnect GitHub
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              <div className="mx-4 divide-y rounded-md border">
                {connected.filter((repo) => repo.startsWith(`${org}/`)).map((repo) => (
                  <div key={repo} className="flex items-center gap-3 px-3 py-3">
                    <LockKeyhole className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{repo}</span>
                    <Badge variant="outline" className="hidden sm:inline-flex">Private</Badge>
                    <Check className="size-3.5 text-muted-foreground" aria-label="Connected" />
                  </div>
                ))}
              </div>
              <p className="px-4 py-3 text-xs text-muted-foreground">
                {stale ? "Showing the last successful update. New changes will appear when sync resumes." : "PR metadata last synced just now"}
              </p>
            </section>
            ))}
            </div>
          ) : (
            <p className="px-4 py-5 text-sm text-muted-foreground">
              {retained
                ? "PRs are hidden. Reconnect within 30 days to keep the retained metadata and cancel deletion."
                : "Connect repositories to browse their pull requests here. Only project admins can manage connections."}
            </p>
          )}
          {!connected.length ? <Button className="mb-4 ml-4" variant="outline" size="settings" disabled={viewer} onClick={() => setAdding(true)}>{retained ? "Reconnect GitHub" : "Connect GitHub"}</Button> : null}
        </section>

        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Connected repositories are readable by every project member, including viewers.
            {viewer ? " Ask a project admin to manage this connection." : " Only project admins can manage this connection."}
          </p>
        </div>
      </section>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add organization</DialogTitle><DialogDescription>Demo GitHub App authorization. Choose an organization, then select repositories to share with this project.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {["contoso", "acme"].map((org) => <Button key={org} variant="outline" className="w-full justify-between" disabled={viewer || organizations.includes(org)} onClick={() => openPicker(org)} aria-label={org}>{org}<span className="text-xs text-muted-foreground">{organizations.includes(org) ? "Connected" : "Connect"}</span></Button>)}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{connected.length ? "Manage repositories" : "Connect GitHub"}</DialogTitle>
            <DialogDescription>
              Select repositories to share with the Convoy project. You must be a GitHub repository
              admin.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Demo authorization · Signed in as robin · {organization} installation
          </div>
          <div className="divide-y">
            {available.filter((repo) => repo.startsWith(`${organization}/`)).map((repo) => (
              <label key={repo} className="flex cursor-pointer items-center gap-3 py-4">
                <Checkbox
                  disabled={viewer}
                  checked={selected.includes(repo)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked ? [...current, repo] : current.filter((item) => item !== repo),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{repo}</span>
                  <span className="text-xs text-muted-foreground">Private · Repository admin</span>
                </span>
              </label>
            ))}
          </div>
          <label className="flex cursor-pointer items-start gap-3 border-t pt-4 text-sm">
            <Checkbox checked={share} onCheckedChange={(checked) => setShare(checked === true)} />
            <span>
              I understand that all project members can read the selected repositories&apos; PRs and
              code without their own GitHub account.
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicker(false)}>
              Cancel
            </Button>
            <Button
              disabled={viewer || !share || !selected.length}
              onClick={() => {
                onSave([...connected.filter((repo) => !repo.startsWith(`${organization}/`)), ...selected]);
                setPicker(false);
              }}
            >
              Save repositories
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!disconnect} onOpenChange={(open) => { if (!open) setDisconnect(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {disconnect}?</DialogTitle>
            <DialogDescription>
              Pull requests and code from {disconnect} will be hidden from this project immediately. Retained metadata
              will be deleted after 30 days. Reconnecting cancels deletion. Existing task links and
              other organizations and projects keep their access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnect(null)}>
              Keep connection
            </Button>
            <Button
              variant="destructive"
              disabled={viewer}
              onClick={() => {
                if (disconnect) onDisconnect(disconnect);
                setDisconnect(null);
              }}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
