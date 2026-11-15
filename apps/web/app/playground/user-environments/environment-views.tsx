"use client";

import { useState } from "react";
import { ChevronDown, MoreHorizontal, Pencil, RotateCw, Server, Trash2 } from "lucide-react";
import {
  ModelSelectorDropdown,
  ModelSelectorDropdownContent,
  ModelSelectorDropdownEmpty,
  ModelSelectorDropdownGroup,
  ModelSelectorDropdownInput,
  ModelSelectorDropdownItem,
  ModelSelectorDropdownList,
  ModelSelectorDropdownName,
  ModelSelectorDropdownTrigger,
} from "@/components/ai-elements/model-selector-dropdown";
import { CommandBlock } from "@/components/blocks/thread/no-profiles-state";
import { EmptyState } from "@/components/custom/empty-state";
import { Spinner } from "@/components/custom/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, DialogFooter, TitledDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MODE_COPY,
  PROJECTS,
  STATUS_COPY,
  defaultSetup,
  formatLastSeen,
  isOffered,
  needsGitToken,
  type PlaygroundEnvironment,
  type PlaygroundProject,
  type Registration,
  type RegistrationStatus,
  type SetupInput,
} from "./fixtures";

const ENROLL_COMMAND = "convoy environment enroll";

function StatusDot({ on, className }: { on: boolean; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-success" : "bg-muted-foreground/40", className)} />;
}

function ModeBadge({ mode }: { mode: PlaygroundEnvironment["mode"] }) {
  return <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">{MODE_COPY[mode].label}</Badge>;
}

function RegistrationState({ registration }: { registration: Registration | undefined }) {
  if (!registration) return <span className="text-muted-foreground">Not set up</span>;
  const tone: Record<RegistrationStatus, string> = { pending: "text-info", ready: "text-success", idle: "text-muted-foreground", failed: "text-destructive" };
  return <span className={tone[registration.status]}>{STATUS_COPY[registration.status]}</span>;
}

// ── Composer dropdown ──────────────────────────────────────────────

export type Selection = { environmentId: string } | null;

interface EnvironmentPickerProps {
  project: PlaygroundProject;
  environments: PlaygroundEnvironment[];
  registrations: Registration[];
  selection: Selection;
  onSelect: (environmentId: string) => void;
  onSetUp: (environmentId: string) => void;
}

/** The composer's working-directory dropdown, with unregistered environments below the registered ones. */
export function EnvironmentPicker({ project, environments, registrations, selection, onSelect, onSetUp }: EnvironmentPickerProps) {
  const [open, setOpen] = useState(false);
  const offered = environments.filter((environment) => isOffered(environment, project));
  const registrationOf = (environment: PlaygroundEnvironment) =>
    registrations.find((registration) => registration.environmentId === environment.id && registration.projectId === project.id);
  const registered = offered.filter((environment) => {
    const status = registrationOf(environment)?.status;
    return status === "ready" || status === "idle";
  });
  const notSetUp = offered.filter((environment) => !registered.includes(environment));
  const current = registered.find((environment) => environment.id === selection?.environmentId);
  const currentRegistration = current ? registrationOf(current) : undefined;

  return (
    <ModelSelectorDropdown modal={false} open={open} onOpenChange={setOpen}>
      <ModelSelectorDropdownTrigger asChild>
        <Button variant="ghost" size="sm" className="min-w-0 shrink cursor-pointer gap-2">
          {/* An idle worker still counts as available: the service starts it on send. */}
          <StatusDot on={current?.isOnline ?? false} />
          <span className="flex min-w-0">
            <span className="min-w-0 truncate">{current?.name ?? "Select working directory"}</span>
            {currentRegistration ? <span className="truncate text-muted-foreground/60">{` / ${currentRegistration.profileKey}`}</span> : null}
          </span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </ModelSelectorDropdownTrigger>
      <ModelSelectorDropdownContent className="w-[340px]">
        <ModelSelectorDropdownInput placeholder="Search working directories..." />
        <ModelSelectorDropdownList>
          <ModelSelectorDropdownEmpty>No working directories found.</ModelSelectorDropdownEmpty>
          {registered.map((environment) => {
            const registration = registrationOf(environment)!;
            return (
              <ModelSelectorDropdownGroup
                key={environment.id}
                heading={
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot on={environment.isOnline} />
                    <span>{environment.name}</span>
                    <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">{registration.profileKey}</span>
                    {registration.status === "idle" ? <span className="text-[10px] font-normal text-muted-foreground">idle</span> : null}
                  </span>
                }
              >
                <ModelSelectorDropdownItem
                  value={`${environment.name} ${registration.folder}`}
                  onSelect={() => {
                    onSelect(environment.id);
                    setOpen(false);
                  }}
                  data-checked={selection?.environmentId === environment.id ? true : undefined}
                >
                  <ModelSelectorDropdownName>
                    <span className="flex flex-col gap-0.5">
                      <span>{registration.folder.split("/").at(-1)}</span>
                      <span className="text-[10px] text-muted-foreground/60">{registration.folder}</span>
                    </span>
                  </ModelSelectorDropdownName>
                </ModelSelectorDropdownItem>
              </ModelSelectorDropdownGroup>
            );
          })}
          {notSetUp.length > 0 ? (
            <ModelSelectorDropdownGroup heading={`Not set up in ${project.name}`}>
              {notSetUp.map((environment) => {
                const registration = registrationOf(environment);
                const pending = registration?.status === "pending";
                return (
                  <ModelSelectorDropdownItem
                    key={environment.id}
                    value={`${environment.name} set up`}
                    disabled={pending}
                    onSelect={() => {
                      setOpen(false);
                      onSetUp(environment.id);
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <StatusDot on={environment.isOnline} />
                        <span className="truncate">{environment.name}</span>
                        <ModeBadge mode={environment.mode} />
                      </span>
                      {registration?.status === "failed" ? (
                        <span className="text-[11px] whitespace-normal text-destructive">{registration.error}</span>
                      ) : !environment.isOnline ? (
                        <span className="text-[11px] text-muted-foreground">Offline. Setup starts when it reconnects.</span>
                      ) : null}
                    </span>
                    <span className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {pending ? (
                        <Spinner text="Setting up…" textPlacement="inline" />
                      ) : registration?.status === "failed" ? (
                        <><RotateCw className="size-3" />Retry</>
                      ) : (
                        "Set up"
                      )}
                    </span>
                  </ModelSelectorDropdownItem>
                );
              })}
            </ModelSelectorDropdownGroup>
          ) : null}
        </ModelSelectorDropdownList>
      </ModelSelectorDropdownContent>
    </ModelSelectorDropdown>
  );
}

// ── First-use setup dialog ─────────────────────────────────────────

interface SetupDialogProps {
  environment: PlaygroundEnvironment | null;
  project: PlaygroundProject;
  previous?: Registration;
  onClose: () => void;
  onSubmit: (input: SetupInput) => void;
}

export function SetupDialog({ environment, project, previous, onClose, onSubmit }: SetupDialogProps) {
  return (
    <TitledDialog
      open={environment !== null}
      onClose={onClose}
      size="md"
      title={environment ? `Set up ${environment.name} in ${project.name}` : ""}
      description={environment ? `${environment.name} creates the folder and connects it to ${project.name}. You don't need to touch the machine.` : ""}
    >
      {/* Remount per environment so the defaults reset. */}
      {environment ? <SetupForm key={environment.id} environment={environment} project={project} previous={previous} onClose={onClose} onSubmit={onSubmit} /> : null}
    </TitledDialog>
  );
}

function SetupForm({ environment, project, previous, onClose, onSubmit }: SetupDialogProps & { environment: PlaygroundEnvironment }) {
  const [input, setInput] = useState<SetupInput>(() => previous ?? defaultSetup(environment, project));
  const blocked = needsGitToken(environment, project, input.source);
  const isolated = environment.mode === "isolated";

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) onSubmit(input);
      }}
    >
      {previous?.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{previous.error}</p>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="setup-source">Source</Label>
        <Select value={input.source} onValueChange={(source) => setInput({ ...input, source: source as SetupInput["source"] })}>
          <SelectTrigger id="setup-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {project.linkedRepo ? <SelectItem value="clone">Clone {project.linkedRepo.fullName}</SelectItem> : null}
            <SelectItem value="empty">Empty folder</SelectItem>
          </SelectContent>
        </Select>
        {blocked ? (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
            {project.linkedRepo?.fullName} is private. Isolated environments need a GitHub token to clone it: run <code>convoy keys</code> on {environment.hostname}, or start with an empty folder.
          </p>
        ) : input.source === "clone" && !isolated ? (
          <p className="text-xs text-muted-foreground">Clones over HTTPS with the gh login on {environment.hostname}.</p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="grid gap-2 self-start sm:col-span-2">
          <Label htmlFor="setup-folder">Folder</Label>
          {isolated ? (
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>/workspace/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput id="setup-folder" value={input.folder} onChange={(event) => setInput({ ...input, folder: event.target.value })} />
            </InputGroup>
          ) : (
            <Input id="setup-folder" value={input.folder} onChange={(event) => setInput({ ...input, folder: event.target.value })} />
          )}
          <p className="text-xs text-muted-foreground">Must be missing or empty.</p>
        </div>
        <div className="grid gap-2 self-start">
          <Label htmlFor="setup-profile-key">Profile key</Label>
          <Input id="setup-profile-key" value={input.profileKey} onChange={(event) => setInput({ ...input, profileKey: event.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={blocked}>{previous ? "Retry setup" : "Set up"}</Button>
      </DialogFooter>
    </form>
  );
}

// ── Settings → Environments ────────────────────────────────────────

interface EnvironmentsSectionProps {
  environments: PlaygroundEnvironment[];
  registrations: Registration[];
  onRename: (environmentId: string, name: string) => void;
  onDelete: (environmentId: string) => void;
  onAvailabilityChange: (environmentId: string, availability: PlaygroundEnvironment["availability"], selectedProjectIds: string[]) => void;
}

/** A section of the user settings dialog: environments are the user's, not an organization's. */
export function EnvironmentsSection({ environments, registrations, onRename, onDelete, onAvailabilityChange }: EnvironmentsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(environments[0]?.id ?? null);
  const [toRename, setToRename] = useState<PlaygroundEnvironment | null>(null);
  const [toDelete, setToDelete] = useState<PlaygroundEnvironment | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Environments</h2>
          <p className="text-sm text-muted-foreground">Machines you enrolled. Each one is offered in every project you can update, and sets the project up the first time you pick it.</p>
        </div>
        {environments.length > 0 ? <Button size="sm" variant="outline" className="shrink-0 cursor-pointer" onClick={() => setAdding(true)}>Add environment</Button> : null}
      </div>

      {environments.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No environments"
          description="Enroll a machine once and use it in all your projects. Run this on the machine:"
          actionClassName="w-full max-w-md text-left"
          action={<CommandBlock command={ENROLL_COMMAND} />}
        />
      ) : (
        <div className="space-y-2">
          {environments.map((environment) => (
            <EnvironmentRow
              key={environment.id}
              environment={environment}
              registrations={registrations.filter((registration) => registration.environmentId === environment.id)}
              expanded={expandedId === environment.id}
              onExpand={() => setExpandedId((current) => (current === environment.id ? null : environment.id))}
              onRename={() => {
                setName(environment.name);
                setToRename(environment);
              }}
              onDelete={() => setToDelete(environment)}
              onAvailabilityChange={(availability, selectedProjectIds) => onAvailabilityChange(environment.id, availability, selectedProjectIds)}
            />
          ))}
        </div>
      )}

      {/* The web can't reach a machine, so adding one means enrolling it from that machine. */}
      <TitledDialog open={adding} onClose={() => setAdding(false)} size="md" title="Add environment" description="Run this on the machine you want to add:">
        <div className="space-y-3">
          <CommandBlock command={ENROLL_COMMAND} />
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>The command opens this browser to approve the machine.</li>
            <li>It uses the machine&apos;s mode: shared, or isolated for managed Docker and VMs.</li>
            <li>The environment appears here and in all your projects.</li>
          </ol>
        </div>
      </TitledDialog>
      <ConfirmDialog
        open={toRename !== null}
        onClose={() => setToRename(null)}
        size="sm"
        title="Rename environment"
        description={toRename ? `${toRename.hostname} · ${MODE_COPY[toRename.mode].label}` : ""}
        confirm={{ label: "Save", onClick: () => toRename && onRename(toRename.id, name.trim() || toRename.name) }}
      >
        <Input aria-label="Environment name" value={name} onChange={(event) => setName(event.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        size="md"
        title={toDelete ? `Delete ${toDelete.name}?` : ""}
        text={toDelete ? `Its key stops working right away, and threads running on ${toDelete.hostname} stop within about 30 seconds. Files stay on the machine. To use it again, run ${ENROLL_COMMAND} there.` : undefined}
        confirm={{ label: "Delete environment", variant: "destructive", onClick: () => toDelete && onDelete(toDelete.id) }}
      />
    </div>
  );
}

interface EnvironmentRowProps {
  environment: PlaygroundEnvironment;
  registrations: Registration[];
  expanded: boolean;
  onExpand: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAvailabilityChange: (availability: PlaygroundEnvironment["availability"], selectedProjectIds: string[]) => void;
}

function EnvironmentRow({ environment, registrations, expanded, onExpand, onRename, onDelete, onAvailabilityChange }: EnvironmentRowProps) {
  const updatable = PROJECTS.filter((project) => project.canUpdate);
  const listed = updatable.filter((project) => isOffered(environment, project));

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={onExpand} aria-expanded={expanded}>
          <span className="flex min-w-0 items-center gap-2">
            <StatusDot on={environment.isOnline} />
            <span className="truncate text-sm font-medium">{environment.name}</span>
            <ModeBadge mode={environment.mode} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {environment.hostname} · {formatLastSeen(environment)} · {formatSetUpCount(registrations)}
          </span>
        </button>
        <Button variant="ghost" size="icon-sm" className="shrink-0 cursor-pointer" onClick={onExpand} aria-label={`${expanded ? "Hide" : "Show"} details for ${environment.name}`}>
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0 cursor-pointer" aria-label={`Environment options for ${environment.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onSelect={onRename}><Pencil className="size-3.5" />Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 className="size-3.5" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded ? (
        <div className="space-y-4 border-t border-border bg-muted/20 px-4 py-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-medium">{MODE_COPY[environment.mode].label} mode</p>
            <p className="text-xs text-muted-foreground">
              {MODE_COPY[environment.mode].description} To switch modes, delete the environment and enroll it again.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Available in</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select
                value={environment.availability}
                onValueChange={(value) => onAvailabilityChange(value as PlaygroundEnvironment["availability"], environment.selectedProjectIds)}
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All my projects</SelectItem>
                  <SelectItem value="selected">Selected projects</SelectItem>
                </SelectContent>
              </Select>
              {environment.availability === "selected" ? (
                <ProjectPicker
                  projects={updatable}
                  selectedIds={environment.selectedProjectIds}
                  onChange={(ids) => onAvailabilityChange("selected", ids)}
                />
              ) : null}
            </div>
            {environment.availability === "selected" ? (
              <p className="text-xs text-muted-foreground">Removing a project stops its work here and removes the setup. Files stay on the machine.</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Projects</p>
            {listed.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border bg-background">
                {listed.map((project) => {
                  const registration = registrations.find((candidate) => candidate.projectId === project.id);
                  return (
                    <li key={project.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="min-w-0 truncate font-medium">{project.name}</span>
                      <span className="text-muted-foreground">{project.organization}</span>
                      {registration && registration.status !== "failed" ? <span className="truncate text-muted-foreground/70">{registration.folder}</span> : null}
                      <span className="ml-auto shrink-0">
                        <RegistrationState registration={registration} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatSetUpCount(registrations: Registration[]) {
  const count = registrations.filter((registration) => registration.status === "ready" || registration.status === "idle").length;
  return `${count} ${count === 1 ? "project" : "projects"} set up`;
}

function ProjectPicker({ projects, selectedIds, onChange }: { projects: PlaygroundProject[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  const selected = projects.filter((project) => selectedIds.includes(project.id));
  const label = selected.length === 0 ? "Choose projects" : selected.length === 1 ? selected[0].name : `${selected.length} projects`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full cursor-pointer justify-between font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        {projects.map((project) => (
          <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
            <Checkbox
              checked={selectedIds.includes(project.id)}
              onCheckedChange={(checked) => onChange(checked === true ? [...selectedIds, project.id] : selectedIds.filter((id) => id !== project.id))}
            />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="text-xs text-muted-foreground">{project.alias}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
