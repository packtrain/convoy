import { useEffect, useId, useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, CircleDashed, CircleX, Ellipsis, Github, GitMerge, GitPullRequestClosed, GitPullRequestDraft, Layers, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonGroup } from "@/components/ui/button-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckList, StackMap } from "./controls";
import { blockedBy, branchFor, checksSummary, layersBelow, mergeStatusFor, reviewsFor, type GithubAccess, type PullRequest } from "./fixtures";

type Method = "merge" | "squash" | "rebase";
const methods: Record<Method, { label: string; option: string; confirm: string; body: (commits: number) => string }> = {
  merge: { label: "Merge pull request", option: "Create a merge commit", confirm: "Confirm merge", body: (n) => `Adds all ${n} commits to main with a merge commit.` },
  squash: { label: "Squash and merge", option: "Squash and merge", confirm: "Confirm squash and merge", body: (n) => `Combines the ${n} commits into one commit on main.` },
  rebase: { label: "Rebase and merge", option: "Rebase and merge", confirm: "Confirm rebase and merge", body: (n) => `Adds the ${n} commits on top of main, without a merge commit.` },
};

// GitHub's state actions; each one runs on GitHub as the user, within their repository role.
export function PrActions({ pr, layers, onSelect, commits, incoming, access, onConnect, onChange, onExternal }: {
  pr: PullRequest;
  layers: PullRequest[];
  onSelect: (pr: PullRequest) => void;
  commits: number;
  incoming: boolean;
  access: GithubAccess;
  onConnect: () => void;
  onChange: (change: Partial<PullRequest>, targets?: PullRequest[]) => void;
  onExternal: () => void;
}) {
  const triage = blockedBy(access, "triage");
  const write = blockedBy(access, "write");
  const onStateChange = (state: PullRequest["state"]) => onChange({ state });
  // GitHub merges the open layers below along with this PR.
  const below = layersBelow(layers, pr);
  // An archived PR is locked; it has to be unarchived before anything else.
  if (pr.archived) return <BlockedButton reason={triage} onClick={() => onChange({ archived: false })}>Unarchive</BlockedButton>;
  if (pr.state === "merged") return null;
  if (pr.state === "closed") return <BlockedButton reason={triage} onClick={() => onStateChange("open")}>Reopen</BlockedButton>;
  return (
    <>
      {pr.state === "draft" ? (
        <BlockedButton reason={write} onClick={() => onStateChange("open")}>Ready for review</BlockedButton>
      ) : (
        <MergeStatus pr={pr} layers={layers} below={below} onSelect={onSelect} commits={commits} incoming={incoming} access={access} onConnect={onConnect} onMerge={() => onChange({ state: "merged" }, [...below, pr])} onUpdateBranch={() => onChange({ behind: false })} onExternal={onExternal} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More actions"><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max">
          {pr.state === "open" ? <DropdownMenuItem disabled={!!write} onSelect={() => onStateChange("draft")}><GitPullRequestDraft />Convert to draft<Reason text={write} /></DropdownMenuItem> : null}
          <DropdownMenuItem disabled={!!triage} onSelect={() => onStateChange("closed")}><GitPullRequestClosed />Close pull request<Reason text={triage} /></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Like GitHub's Merge status panel: what blocks or allows the merge. Confirming opens a popup.
function MergeStatus({ pr, layers, below, onSelect, commits, incoming, access, onConnect, onMerge, onUpdateBranch, onExternal }: {
  pr: PullRequest;
  layers: PullRequest[];
  below: PullRequest[];
  onSelect: (pr: PullRequest) => void;
  commits: number;
  incoming: boolean;
  access: GithubAccess;
  onConnect: () => void;
  onMerge: () => void;
  onUpdateBranch: () => void;
  onExternal: () => void;
}) {
  const [method, setMethod] = useState<Method>("squash");
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState("");
  const messageId = useId();
  // GitHub reports mergeable as UNKNOWN until it has checked a new head, so each push rechecks.
  const [updates, setUpdates] = useState(0);
  const pushes = updates + (incoming ? 1 : 0);
  const [checked, setChecked] = useState(0);
  const checking = checked < pushes;
  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => setChecked(pushes), 2000);
    return () => clearTimeout(timer);
  }, [checking, pushes]);
  // The async merge API answers 202, then Convoy polls until the PR is merged.
  const merge = () => {
    setMerging(true);
    setTimeout(onMerge, 1500);
  };
  const { checks, conflicts } = mergeStatusFor(pr);
  const checkStatus = checksSummary(checks);
  const reviews = reviewsFor(pr);
  const pending = reviews.filter((review) => review.state === "requested");
  const selected = methods[method];
  const label = below.length ? `${method === "merge" ? "Merge" : selected.label} ${below.length + 1} pull requests` : selected.label;
  // GitHub merges a stack bottom up, so a layer below that can't merge blocks this one.
  const layerBlocker = below.find((layer) => layer.state === "draft" || mergeStatusFor(layer).conflicts);
  const blocked = conflicts || !!layerBlocker;
  const confirm = () => {
    setMessage(method === "squash" ? `${pr.title} (#${pr.number})` : `Merge pull request #${pr.number} from ${branchFor(pr)}`);
    setOpen(false);
    setConfirming(true);
  };
  // What doesn't block the merge but is worth a second look before confirming.
  const warnings = [
    pending.length ? `${pending.length} review is still pending.` : null,
    checkStatus.failing ? `${checkStatus.failing} check failed.` : null,
    checkStatus.state === "pending" ? "Checks are still running." : null,
    pr.behind ? "This branch is out-of-date with main." : null,
  ].filter(Boolean);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {blocked ? (
            <Button variant="outline" size="sm"><CircleX className="text-destructive" />Merge blocked</Button>
          ) : (
            <Button size="sm"><GitMerge />Merge</Button>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Merge status" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
          <p className="border-b px-4 py-3 text-sm font-medium">Merge status</p>
          {layers.length ? (
            <div className="border-b p-2">
              <p className="px-2 py-1 text-xs text-muted-foreground">Stack #{pr.stack}</p>
              <StackMap pr={pr} layers={layers} onSelect={onSelect} />
            </div>
          ) : null}
          <StatusRow
            ok
            pending={!!pending.length}
            title={pending.length ? "Review requested" : "Changes approved"}
            body={pending.length ? "Reviews aren't required to merge this pull request." : `Approved by ${reviews.map((review) => review.reviewer).join(", ")}.`}
          >
            {pending.length ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="size-3.5" /><span>{pending.length} pending review</span>
                <span>· {pending.map((review) => review.reviewer).join(", ")}</span>
              </p>
            ) : null}
          </StatusRow>
          <StatusRow ok={checkStatus.state !== "failure"} pending={checkStatus.state === "pending"} title={checkStatus.title} body={checkStatus.body}>
            <div className="mt-2"><CheckList checks={checks} onDetails={onExternal} /></div>
          </StatusRow>
          {below.length ? (
            <StatusRow
              ok={!layerBlocker}
              title={layerBlocker ? `#${layerBlocker.number} ${layerBlocker.state === "draft" ? "is a draft" : "has conflicts"}` : `Merges ${below.map((layer) => `#${layer.number}`).join(", ")} first`}
              body={layerBlocker ? "Every layer below has to be mergeable first." : "GitHub merges a stack from the bottom up."}
            />
          ) : null}
          {pr.behind ? (
            <StatusRow ok pending title="This branch is out-of-date with the base branch" body="Merge the latest changes from main into this branch.">
              <div className="mt-3">
                <BlockedButton reason={blockedBy(access, "write")} onClick={() => { onUpdateBranch(); setUpdates(updates + 1); }}>Update branch</BlockedButton>
              </div>
            </StatusRow>
          ) : null}
          {checking ? (
            <StatusRow ok pending title="Checking mergeability…" body="GitHub is checking the latest commit for conflicts with main." />
          ) : (
            <StatusRow
              ok={!conflicts}
              title={conflicts ? "This branch has conflicts that must be resolved" : "No conflicts with base branch"}
              body={conflicts ? "Resolve them on GitHub or locally, then push." : "Merging can be performed automatically."}
            >
              {conflicts ? <Button variant="outline" size="sm" className="mt-3" onClick={onExternal}>Resolve on GitHub</Button> : null}
            </StatusRow>
          )}
          <div className="space-y-3 p-4">
            {access === "none" ? (
              <>
                <p className="text-xs text-muted-foreground">Connect your GitHub account to merge as yourself.</p>
                <Button size="sm" onClick={onConnect}><Github />Connect GitHub</Button>
              </>
            ) : blockedBy(access, "write") ? (
              <p className="text-xs text-muted-foreground">You need write access to merge.</p>
            ) : (
              <ButtonGroup>
                <Button size="sm" disabled={blocked || checking} onClick={confirm}>{label}</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" aria-label="Merge options" disabled={blocked || checking} className="border-l border-primary-foreground/20"><ChevronDown /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-80">
                    <DropdownMenuRadioGroup value={method} onValueChange={(value) => setMethod(value as Method)}>
                      {(Object.keys(methods) as Method[]).map((value) => (
                        <DropdownMenuRadioItem key={value} value={value} className="items-start py-2">
                          <span>
                            <span className="block font-medium">{methods[value].option}</span>
                            <span className="block text-xs text-muted-foreground">{methods[value].body(commits)}</span>
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={confirming} onOpenChange={(next) => setConfirming(next || merging)}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!merging}>
          <DialogHeader>
            <DialogTitle>{below.length ? label : `${label} #${pr.number}`}</DialogTitle>
            <DialogDescription>Into main from <span className="font-mono text-xs">{branchFor(pr)}</span></DialogDescription>
          </DialogHeader>
          {warnings.map((warning) => (
            <p key={warning} className="flex items-center gap-2 text-muted-foreground"><CircleAlert className="size-4 shrink-0 text-amber-600" />{warning}</p>
          ))}
          {below.length ? (
            <div className="space-y-2">
              <ol className="divide-y rounded-lg border">
                {[...below, pr].map((layer) => (
                  <li key={layer.number} className="flex min-w-0 items-center gap-2 px-3 py-2">
                    <Layers className="size-4 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 text-muted-foreground">#{layer.number}</span>
                    <span className="min-w-0 truncate">{layer.title}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">Bottom first. Each pull request keeps its default commit message.</p>
            </div>
          ) : method === "rebase" ? (
            <p className="text-muted-foreground">{selected.body(commits)}</p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={messageId} className="text-xs">Commit message</Label>
              <Input id={messageId} value={message} disabled={merging} onChange={(event) => setMessage(event.target.value)} />
            </div>
          )}
          <DialogFooter>
            {merging ? null : <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>}
            <Button size="sm" disabled={merging || (!below.length && method !== "rebase" && !message.trim())} onClick={merge}>
              {merging ? <><Loader2 className="animate-spin" />Merging…</> : selected.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Disabled with the reason as a tooltip; the span keeps hover working on a disabled button.
function BlockedButton({ reason, onClick, children }: { reason?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <span title={reason}>
      <Button variant="outline" size="sm" disabled={!!reason} onClick={onClick}>{children}</Button>
    </span>
  );
}

const Reason = ({ text }: { text?: string }) => (text ? <span className="ml-auto pl-4 text-xs text-muted-foreground">{text}</span> : null);

function StatusRow({ ok, pending = false, title, body, children }: { ok: boolean; pending?: boolean; title: string; body: string; children?: React.ReactNode }) {
  const Icon = pending ? CircleDashed : ok ? CircleCheck : CircleX;
  return (
    <div className="flex gap-3 border-b px-4 py-3">
      <Icon className={`mt-0.5 size-5 shrink-0 ${pending ? "text-muted-foreground" : ok ? "text-green-600" : "text-destructive"}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
        {children}
      </div>
    </div>
  );
}
