"use client";

import { useState } from "react";
import { ArrowLeft, ArrowUp, Bell, Bot, Key, Palette, Server, Settings, Wrench, Container } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLink, routeTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { EnvironmentPicker, EnvironmentsSection, SetupDialog, type Selection } from "./environment-views";
import { INITIAL_ENVIRONMENTS, INITIAL_REGISTRATIONS, PROJECTS, type PlaygroundEnvironment, type Registration, type SetupInput } from "./fixtures";

const SETUP_DELAY_MS = 2500;

const SETTINGS_NAV = [
  { label: "General", icon: Settings },
  { label: "Appearance", icon: Palette },
  { label: "Agents", icon: Bot },
  { label: "CLI profiles", icon: Server },
  { label: "Environments", icon: Container },
  { label: "API keys", icon: Key },
  { label: "Notifications", icon: Bell },
  { label: "Developer", icon: Wrench },
];

/** User environments offered in every project, set up on first use (OS-2241), on local state. */
export default function UserEnvironmentsPlaygroundPage() {
  const [projectId, setProjectId] = useState("web");
  const [environments, setEnvironments] = useState<PlaygroundEnvironment[]>(INITIAL_ENVIRONMENTS);
  const [registrations, setRegistrations] = useState<Registration[]>(INITIAL_REGISTRATIONS);
  const [selection, setSelection] = useState<Record<string, Selection>>({ os: { environmentId: "devbox" } });
  const [setupId, setSetupId] = useState<string | null>(null);
  const [failNext, setFailNext] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const project = PROJECTS.find((candidate) => candidate.id === projectId)!;
  const setupEnvironment = environments.find((environment) => environment.id === setupId) ?? null;
  const findRegistration = (environmentId: string, forProjectId: string) =>
    registrations.find((registration) => registration.environmentId === environmentId && registration.projectId === forProjectId);
  const docker = environments.find((environment) => environment.id === "docker");

  const updateEnvironment = (id: string, patch: Partial<PlaygroundEnvironment>) =>
    setEnvironments((current) => current.map((environment) => (environment.id === id ? { ...environment, ...patch } : environment)));

  const startSetup = (environmentId: string, input: SetupInput) => {
    const forProjectId = projectId;
    const fail = failNext;
    const environment = environments.find((candidate) => candidate.id === environmentId)!;
    setSetupId(null);
    setRegistrations((current) => [
      ...current.filter((registration) => !(registration.environmentId === environmentId && registration.projectId === forProjectId)),
      { environmentId, projectId: forProjectId, status: "pending", ...input },
    ]);
    setLog(`Wrote a pending registration. ${environment.name}'s service picks it up and runs project add.`);
    // ponytail: an offline environment would stay pending until it reconnects; the prototype resolves it anyway.
    setTimeout(() => {
      setRegistrations((current) =>
        current.map((registration) =>
          registration.environmentId === environmentId && registration.projectId === forProjectId
            ? fail
              ? { ...registration, status: "failed", error: `${input.folder} isn't empty. Pick another folder, then retry.` }
              : { ...registration, status: "ready", error: undefined }
            : registration
        )
      );
      if (!fail) setSelection((current) => ({ ...current, [forProjectId]: { environmentId } }));
      setLog(fail ? "Setup failed. Open the dropdown to read the error and retry." : `${environment.name} is ready in this project and selected.`);
    }, SETUP_DELAY_MS);
  };

  const changeAvailability = (environmentId: string, availability: PlaygroundEnvironment["availability"], selectedProjectIds: string[]) => {
    updateEnvironment(environmentId, { availability, selectedProjectIds });
    if (availability === "selected") {
      // Deselected projects stop and lose their setup (slices 7 and 8).
      setRegistrations((current) =>
        current.filter((registration) => registration.environmentId !== environmentId || selectedProjectIds.includes(registration.projectId))
      );
    }
  };

  const current = selection[projectId];
  const selectedRegistration = current ? findRegistration(current.environmentId, projectId) : undefined;
  const canSend = selectedRegistration?.status === "ready" || selectedRegistration?.status === "idle";

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AppLink href={routeTarget("/playground")} className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
        </AppLink>
        <span className="font-medium">User environments</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">OS-2241 · UX prototype</span>
        <span className="mx-2 h-4 w-px bg-border" />
        {PROJECTS.map((candidate) => (
          <Button key={candidate.id} size="xs" variant={candidate.id === projectId ? "default" : "outline"} onClick={() => setProjectId(candidate.id)}>
            {candidate.name}
            {candidate.canUpdate ? null : <span className="opacity-60"> · view only</span>}
          </Button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <Button size="xs" variant={failNext ? "default" : "outline"} onClick={() => setFailNext((value) => !value)}>
          {failNext ? "Next setup fails" : "Next setup succeeds"}
        </Button>
        {docker ? (
          <Button size="xs" variant={docker.hasGitToken ? "default" : "outline"} onClick={() => updateEnvironment("docker", { hasGitToken: !docker.hasGitToken })}>
            {docker.hasGitToken ? "Office Docker has a GitHub token" : "Office Docker has no GitHub token"}
          </Button>
        ) : null}
        <Button size="xs" variant="outline" onClick={() => { setEnvironments(INITIAL_ENVIRONMENTS); setRegistrations(INITIAL_REGISTRATIONS); setLog(null); }}>
          Reset
        </Button>
        <span className="ml-auto truncate text-muted-foreground">{log ?? "Pick an environment under \"Not set up\" in the composer to set it up."}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto bg-muted/20 p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,48rem)]">
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Composer in {project.name}</h2>
          {/* Composer stub: only the working-directory dropdown is real. */}
          <div className="rounded-xl border border-border bg-background shadow-xs">
            <div className="min-h-[88px] p-3 text-sm text-muted-foreground">Start a new thread...</div>
            <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
              <EnvironmentPicker
                project={project}
                environments={environments}
                registrations={registrations}
                selection={current ?? null}
                onSelect={(environmentId) => setSelection((previous) => ({ ...previous, [projectId]: { environmentId } }))}
                onSetUp={setSetupId}
              />
              <Button size="icon-sm" className="ml-auto cursor-pointer" disabled={!canSend} aria-label="Send" onClick={() =>
                setLog(selectedRegistration?.status === "idle" ? "Sent. The service starts this project's worker, then the thread runs." : "Sent.")
              }>
                <ArrowUp />
              </Button>
            </div>
          </div>
          {!project.canUpdate ? (
            <p className="text-xs text-muted-foreground">You can view {project.name} but not update it, so your environments aren&apos;t offered here.</p>
          ) : null}
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">User settings → Environments</h2>
          {/* The user settings dialog's frame, inline so it sits beside the composer. */}
          <div className="flex h-[560px] min-w-0 overflow-hidden rounded-lg border border-border bg-background shadow-xs">
            <nav className="flex w-44 shrink-0 flex-col gap-1 bg-muted/30 p-2">
              {SETTINGS_NAV.map((item) => (
                <Button key={item.label} variant="ghost" className={cn("h-8 justify-start gap-2", item.label === "Environments" && "bg-accent")}>
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </Button>
              ))}
            </nav>
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
              <EnvironmentsSection
                environments={environments}
                registrations={registrations}
                onRename={(id, name) => updateEnvironment(id, { name })}
                onDelete={(id) => {
                  setEnvironments((list) => list.filter((environment) => environment.id !== id));
                  setRegistrations((list) => list.filter((registration) => registration.environmentId !== id));
                  setLog("Deleted. Its key and worker keys stop working; files stay on the machine.");
                }}
                onAvailabilityChange={changeAvailability}
              />
            </div>
          </div>
        </section>
      </div>

      <SetupDialog
        environment={setupEnvironment}
        project={project}
        previous={setupEnvironment ? findRegistration(setupEnvironment.id, projectId) : undefined}
        onClose={() => setSetupId(null)}
        onSubmit={(input) => setupId && startSetup(setupId, input)}
      />
    </main>
  );
}
