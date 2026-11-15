import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Credential, Environment, Run } from "./fixtures";
import { OperationPanel } from "./operation-panel";
import { LogView } from "./log-view";
import styles from "./terminal.module.css";

type Section = "Environment" | "Service" | "Project" | "Run" | "Credentials";

export function ActionsPanel({ environment, keys, setKeys, profile, run, online, focusOnOpen, onBusyChange, onSidebar, onActivate, onClose, onAction }: {
  environment: Environment; keys: Credential[]; setKeys: (update: (items: Credential[]) => Credential[]) => void; profile: string; run?: Run; online: boolean;
  focusOnOpen: boolean; onBusyChange: (busy: boolean) => void; onSidebar: () => void; onActivate: () => void; onClose: () => void; onAction: (action: string, version?: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [section, setSection] = useState<Section>("Environment");
  const [view, setView] = useState<"menu" | "logs" | "shell" | "add" | "operation">("menu");
  const [pending, setPending] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [result, setResult] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("OpenAI");
  const [auth, setAuth] = useState("API key");
  const [login, setLogin] = useState<"form" | "waiting" | "expired" | "denied">("form");
  const [selectedName, setSelectedName] = useState("work-openai");
  const [shellState, setShellState] = useState<"entering" | "active" | "failed" | "restoring" | "restored">("entering");
  const [operation, setOperation] = useState("");
  const [targetVersion, setTargetVersion] = useState(environment.clientVersion);

  const [draft, setDraft] = useState<string[] | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const selectedKey = keys.find(item => item.name === selectedName) ?? keys[0];
  const desired = draft ?? selectedKey.assigned;
  const dirty = desired.length !== selectedKey.assigned.length || desired.some(name => !selectedKey.assigned.includes(name));
  function saveAssignments(next = desired) {
    setKeys(items => items.map(item => {
      if (item.name === selectedKey.name) {
        const changed = environment.profiles.filter(project => item.assigned.includes(project.name) !== next.includes(project.name));
        return { ...item, assigned: next, delivery: { ...item.delivery, ...Object.fromEntries(changed.map(project => [project.name, "pending reconnect" as const])) } };
      }
      if (item.provider !== selectedKey.provider || item.auth !== selectedKey.auth) return item;
      const replaced = item.assigned.filter(name => next.includes(name));
      return { ...item, assigned: item.assigned.filter(name => !next.includes(name)), delivery: { ...item.delivery, ...Object.fromEntries(replaced.map(name => [name, "pending reconnect" as const])) } };
    }));
    setDraft(null);
    setResult("Assignment changes saved in this preview. Pending reconnect; active agents were not restarted.");
  }
  function leave(save: boolean) {
    if (save) saveAssignments(); else setDraft(null);
    if (leaveTarget === "__back") onClose(); else if (leaveTarget) setSelectedName(leaveTarget);
    setLeaveTarget(null);
  }
  function delivery(projectName: string, status: "applied" | "pending reconnect" | "failed") {
    setKeys(items => items.map(item => item.name === selectedKey.name ? { ...item, delivery: { ...item.delivery, [projectName]: status } } : item));
  }
  useEffect(() => {
    if (focusOnOpen || pending || leaveTarget || view !== "menu") panel.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus();
  }, [view, pending, focusOnOpen, shellState, login, leaveTarget]);
  useEffect(() => { onBusyChange(dirty || !!leaveTarget || logBusy || !!pending || view === "add" || view === "shell" || view === "operation"); return () => onBusyChange(false); }, [dirty, leaveTarget, pending, view, logBusy, onBusyChange]);
  const project = environment.profiles.find(item => item.id === profile);
  const sections: Section[] = profile === "credentials" ? ["Credentials"] : profile === "connection" ? ["Environment", "Service"] : project ? ["Project", "Credentials", "Run"] : ["Service", "Run"];
  const actions: Record<Section, string[]> = {
    Environment: ["Show environment status", "Start environment", "Stop environment", "Restart environment", "Update environment", "Verify isolation"],
    Service: ["Show service status", "Past service logs", "Start service", "Stop service"],
    Project: ["Pause project", "Reload project", "Open private shell", "Remove registration"],
    Run: ["Open run logs", "Cancel selected run"],
    Credentials: project ? ["Assign key to project", "Unassign key"] : ["Add sample key", "Rotate key", "Rollback key", "Disable key"],
  };
  function back() {
    if (leaveTarget) { setLeaveTarget(null); return; }
    if (dirty) { setLeaveTarget("__back"); return; }
    if (view === "shell" && ["failed", "restored"].includes(shellState)) { setView("menu"); return; }
    if (view === "operation" || view === "shell" || logBusy) return;
    if (pending) setPending(null);
    else if (view !== "menu") setView("menu");
    else onClose();
  }
  function apply(action: string) {
    setPending(null);
    if (action === "Open private shell") { setShellState("entering"); setView("shell"); onAction(action); return; }
    if (["Update environment", "Restart environment", "Start environment", "Verify isolation"].includes(action)) { setOperation(action); setView("operation"); onAction("Environment maintenance started"); return; }
    if (action === "Unassign key") { saveAssignments(selectedKey.assigned.filter(name => name !== project?.name)); return; }
    if (action === "Rollback key") setKeys(items => items.map(item => item.name === selectedKey.name ? { ...item, revision: Math.max(1, item.revision - 1) } : item));
    if (action === "Rotate key") setKeys(items => items.map(item => item.name === selectedKey.name ? { ...item, revision: item.revision + 1 } : item));
    if (action === "Disable key") setKeys(items => items.map(item => item.name === selectedKey.name ? { ...item, disabled: true } : item));
    if (action === "Assign key to project") { saveAssignments([...new Set([...selectedKey.assigned, project!.name])]); return; }
    const message = action === "Show environment status" ? `${environment.transport} target ${environment.id}; service ${online ? "running" : "unavailable"}.`
      : action === "Show service status" ? `Service ${online ? "running" : "stopped or unavailable"}; version ${environment.serviceVersion}.`
      : action === "Verify isolation" ? "Sample boundary probes passed. Real A/B runtime acceptance is still required."
      : `${action} completed in this preview.`;
    setResult(message);
    onAction(action);
  }
  function choose(action: string, group: Section) {
    setSection(group);
    setResult("");
    if (action === "Past service logs") { setView("logs"); return; }
    if (action === "Add sample key") { setLogin("form"); setView("add"); return; }
    if (action === "Assign key to project" && keys.some(item => item.name !== selectedKey.name && item.provider === selectedKey.provider && item.auth === selectedKey.auth && item.assigned.includes(project!.name))) { setPending(action); return; }
    if (/Stop|Restart|Update|Pause|Remove|Cancel|Disable|Rotate|Rollback|Unassign|Open private shell|Reload/.test(action)) setPending(action);
    else apply(action);
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); back(); return; }
    if (event.key === "ArrowLeft" && !pending && view === "menu") { event.preventDefault(); onSidebar(); return; }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.ctrlKey || event.metaKey || event.altKey) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  }
  return <section ref={panel} className={styles.connection} aria-label="Context actions" onFocus={onActivate} onKeyDown={keyboard}>
    <div className={styles.panelHeading}><strong>{profile === "credentials" ? "Credentials" : "Actions"} · {environment.id}{project ? ` / ${project.name}` : profile === "credentials" ? "" : " / all projects"}</strong><button disabled={view === "operation" || (view === "shell" && !["failed", "restored"].includes(shellState)) || logBusy} onClick={back}>[Esc] Back</button></div>
    <p className={styles.muted}>Sample actions only · no commands executed</p>
    {leaveTarget ? <div role="alertdialog" aria-label="Unsaved assignments" className={styles.confirm}><h3>Save assignment changes?</h3><p>Changes to {selectedKey.name} have not been saved.</p><button disabled={!online} onClick={() => leave(true)}>Save and continue</button><button onClick={() => leave(false)}>Discard and continue</button><button onClick={() => setLeaveTarget(null)}>Keep editing</button></div> : pending ? <div role="alertdialog" aria-label="Confirm action" className={styles.confirm}>
      <strong>{pending}?</strong>
      <p>Target: {environment.id}{section === "Project" ? ` / ${project?.name}` : section === "Run" ? ` / ${run?.id}` : section === "Credentials" ? ` / ${selectedKey.name}` : " / all projects"}.</p>
      <p>{pending === "Remove registration" ? "Unregister this project locally. Private files remain. Its connection and active work stop." : section === "Credentials" ? `Affected assignment: ${selectedKey.assigned.join(", ") || "none"}. No secret is shown or collected in this preview.` : "Active work in this scope may stop. Other attached clients will see the change."}</p>
      {pending === "Update environment" && <label>Target version<input value={targetVersion} onChange={event => setTargetVersion(event.target.value)} /><span>Current service: {environment.serviceVersion}. All projects in {environment.id} may disconnect. Persistent volumes remain.</span></label>}
      {pending === "Assign key to project" && <p>Replace the current {selectedKey.provider} credential for {project?.name} with {selectedKey.name}.</p>}
      {section === "Credentials" && <p>{selectedKey.name} · {selectedKey.provider} · {selectedKey.auth} · revision {selectedKey.revision}</p>}
      <button autoFocus onClick={() => apply(pending)}>Confirm {pending.toLowerCase()}</button><button onClick={() => setPending(null)}>Keep unchanged</button>
    </div> : view === "logs" ? <>
      <h2>Past service logs</h2><p className={styles.muted}>Saved operational events · not following · available while service is stopped</p>
      <LogView onBusyChange={setLogBusy} entries={[
        { time: "10:04:00", type: "service.started", environment: environment.id },
        { time: "10:04:01", type: "project.connected", profile: project?.key ?? environment.profiles[0]?.key },
        { time: "10:12:06", type: "worker.exited", reason: "authentication_required", runtime: "codex", exitCode: 1 },
      ]} />
    </> : view === "operation" ? <OperationPanel title={operation} steps={operation === "Update environment" ? [`Prepare version ${targetVersion}`, "Stop service and preserve volumes", "Replace image and start service", "Reconnect and check version", "Verify isolation"] : ["Check environment", "Apply operation", "Reconnect and verify readiness"]} failure="Service readiness failed. Recovery pending; projects remain paused and volumes are retained. Inspect past service logs, repair configuration, then retry the failed step." onBack={() => { onAction("Environment recovery pending"); setView("menu"); setResult("Recovery pending. Inspect Past service logs before retrying the environment operation."); }} onDone={() => { onAction(operation, targetVersion); setView("menu"); setResult(`${operation} completed; reconnected to ${environment.id}.`); }} /> : view === "shell" ? <>
      <h2>Private shell · {project?.name}</h2>
      <p className={styles.muted}>This is a static preview. The real TUI releases the terminal to the private shell.</p>
      <p role="status">{shellState === "entering" ? "Pausing worker and handing terminal input to the shell…" : shellState === "active" ? "Shell owns terminal input. Type exit to return." : shellState === "failed" ? "Shell launch failed. Worker remains paused; terminal input restored." : shellState === "restoring" ? "Shell exited with code 0. Restoring terminal and previous selection…" : "Terminal restored. Project worker remains paused until you reload it."}</p>
      {shellState === "entering" && <><button onClick={() => setShellState("active")}>Simulate shell ready</button><button onClick={() => setShellState("failed")}>Simulate shell launch failure</button></>}
      {shellState === "active" && <><pre className={styles.json}>{`convoy-project:~$ pwd\n/home/convoy\nconvoy-project:~$ _`}</pre><button onClick={() => setShellState("restoring")}>Exit shell and return</button></>}
      {shellState === "restoring" && <button onClick={() => setShellState("restored")}>Simulate terminal restored</button>}
      {shellState === "failed" && <button onClick={() => setShellState("entering")}>Retry shell entry</button>}
      {["failed", "restored"].includes(shellState) && <><button onClick={() => { setView("menu"); setResult("Returned from shell. Use Reload project to reconnect."); }}>Return to actions</button><button onClick={() => { onAction("Reload project"); setView("menu"); setResult("Project reloaded after shell exit."); }}>Reload project and return</button></>}
    </> : view === "add" ? <form className={styles.setupForm} onSubmit={event => {
      event.preventDefault();
      const value = name.trim();
      if (!value || keys.some(item => item.name === value)) { setResult("Choose a unique sample name."); return; }
      if (auth !== "API key" && login === "form") { setLogin("waiting"); return; }
      setKeys(items => [...items, { name: value, provider, auth, revision: 1, disabled: false, assigned: [] }]); setSelectedName(value); setName(""); setView("menu"); setResult("Sample credential entry added. No credential was collected.");
    }}>
      {login === "form" ? <>
        <label>Sample key name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="personal-openai" required /></label>
        <label>Provider / runtime<select value={provider} onChange={event => { setProvider(event.target.value); setAuth("API key"); }}><option>OpenAI</option><option>Anthropic</option><option>OpenCode</option><option>Cursor</option></select></label>
        <label>Authentication method<select value={auth} onChange={event => setAuth(event.target.value)}><option>API key</option><option>Subscription login</option></select></label>
        <p>{auth === "API key" ? "API usage billing. Secret input is masked in the real CLI; this preview collects no key." : "Subscription support depends on the installed runtime. Native login stays inside the project’s private HOME."}</p>
        {auth === "API key" && <label>API key preview<input type="password" disabled value="sample-only" readOnly /></label>}
        <button type="submit">{auth === "API key" ? "Add sample entry" : "Preview subscription login"}</button>
      </> : <>
        <h3>{provider} subscription login</h3>
        {provider === "OpenAI" ? <><p>Demo verification URL: https://example.invalid/device</p><p>Sample code: CONVOY-DEMO</p><p>{login === "expired" ? "Code expired. Request a new code." : login === "denied" ? "Login was denied. Retry or choose a different method." : "Waiting for browser authorization…"}</p><div><button type="submit" disabled={login !== "waiting"}>Simulate login success</button><button type="button" onClick={() => setLogin("expired")}>Simulate code expired</button><button type="button" onClick={() => setLogin("denied")}>Simulate login denied</button><button type="button" onClick={() => setLogin("waiting")}>Request new code</button></div></> : <><p>No device flow assumed for this runtime. Use native login in the project’s private shell.</p><button type="button" disabled={!project} onClick={() => { setLogin("form"); setView("menu"); setSection("Project"); setPending("Open private shell"); }}>Open private shell for login</button><p>{!project ? "Select a project before opening its private shell." : "After login, return here to check authentication status."}</p></>}
        <button type="button" onClick={() => setLogin("form")}>Change authentication method</button>
      </>}
    </form> : <>
      {sections.map(section => <section key={section} className={styles.profileConfig}><h3>{section === "Run" ? "Selected run" : section}</h3>
      {section === "Project" && !project && <p>Select a project in the left column first.</p>}
      {section === "Run" && <p>{run ? `${run.task} / ${run.id} · ${run.status}` : "No run selected."}</p>}
      {section === "Environment" && environment.transport === "SSH" && <p>Docker lifecycle controls apply to local managed environments. Remote host maintenance stays in SSH.</p>}
      {section === "Credentials" && <div className={styles.profileConfig}><label>Selected credential<select value={selectedKey.name} onChange={event => { if (dirty) setLeaveTarget(event.target.value); else { setSelectedName(event.target.value); setDraft(null); } }}>{keys.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>{keys.map(item => <p key={item.name}>{item.name} · {item.provider} {item.auth} · {item.disabled ? "disabled" : "available"} · revision {item.revision} · {item.assigned.join(", ") || "unassigned"}</p>)}<p className={styles.muted}>Actions apply to {selectedKey.name}. {project ? "Manage entries from the environment’s Credentials tab." : "Entries belong to this environment. Edit the project checklist below, then save."} Subscription login is never copied between private project homes.</p></div>}
      {section === "Credentials" && !project && (selectedKey.auth !== "API key" ? <p>Native subscription login is project-local and cannot be shared with this checklist.</p> : <fieldset className={styles.assignments}><legend>Assigned projects</legend>
        {environment.profiles.length === 0 && <p>No projects in this environment yet.</p>}
        {environment.profiles.map(item => {
          const replacement = keys.find(key => key.name !== selectedKey.name && key.provider === selectedKey.provider && key.auth === selectedKey.auth && key.assigned.includes(item.name));
          const status = selectedKey.delivery?.[item.name];
          return <div key={item.id} className={styles.assignmentRow}>
            <label><input aria-label={`Assign ${item.name}`} type="checkbox" checked={desired.includes(item.name)} disabled={selectedKey.disabled && !desired.includes(item.name)} onChange={event => setDraft(event.target.checked ? [...desired, item.name] : desired.filter(name => name !== item.name))} />{item.name}</label>
            {desired.includes(item.name) && replacement && <span className={styles.notice}>Replaces {replacement.name} for {selectedKey.provider}</span>}
            <span>{desired.includes(item.name) !== selectedKey.assigned.includes(item.name) ? "Unsaved change" : status ?? (selectedKey.assigned.includes(item.name) ? "Status unknown" : "Unassigned")}</span>
            {status && !dirty && <span className={styles.assignmentControls}>{status === "failed" ? <button onClick={() => delivery(item.name, "pending reconnect")}>Retry {item.name}</button> : <><button onClick={() => delivery(item.name, "applied")}>Simulate applied: {item.name}</button><button onClick={() => delivery(item.name, "failed")}>Simulate failure: {item.name}</button></>}</span>}
          </div>;
        })}
        <div className={styles.assignmentActions}><button disabled={!dirty || !online} onClick={() => saveAssignments()}>Save changes</button><button disabled={!dirty} onClick={() => { setDraft(null); setResult("Draft discarded. Saved assignments unchanged."); }}>Discard</button></div>
        {!online && <p>Reconnect to save assignment changes.</p>}
      </fieldset>)}
      <div className={styles.actionList}>{actions[section].map(action => <button key={action} disabled={
        dirty ||
        (section === "Project" && (!project || !online)) ||
        (section === "Run" && (!run || (action === "Cancel selected run" && (!online || !["running", "waiting", "queued"].includes(run.status))))) ||
        (section === "Environment" && environment.transport === "SSH" && action !== "Show environment status") ||
        (action === "Assign key to project" && (!project || selectedKey.disabled || selectedKey.auth !== "API key")) ||
        (action === "Unassign key" && !selectedKey.assigned.includes(project?.name ?? "")) ||
        (action === "Rollback key" && (selectedKey.revision < 2 || selectedKey.auth !== "API key")) ||
        (action === "Rotate key" && selectedKey.auth !== "API key") ||
        (action === "Disable key" && selectedKey.disabled)
      } onClick={() => choose(action, section)}>{action}</button>)}</div></section>)}
    </>}
    <p role="status" className={styles.notice}>{result || "↑ ↓ actions · Enter select · Esc back"}</p>
  </section>;
}
