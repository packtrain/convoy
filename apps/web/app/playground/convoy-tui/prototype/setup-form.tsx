import { useEffect, useRef, useState } from "react";
import { OperationPanel } from "./operation-panel";
import styles from "./terminal.module.css";

export type SetupResult = { name: string; mode: string; location: string; profileKey: string; projectKey: string; endpoint: string; existing: string; runtimes: string[] };
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function SetupForm({ environment, workspaceRoot, existingNames, onClose, onSave }: {
  environment: string | null; workspaceRoot: string; existingNames: string[]; onClose: () => void;
  onSave: (result: SetupResult) => void;
}) {
  const [mode, setMode] = useState("");
  const [profileName, setProfileName] = useState("");
  const [name, setName] = useState("");
  const [profileKey, setProfileKey] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [location, setLocation] = useState("");
  const [endpoint, setEndpoint] = useState("https://example-deployment.convex.cloud");
  const [existing, setExisting] = useState("sample-isolation-a");
  const [repo, setRepo] = useState("");
  const [workspace, setWorkspace] = useState("Create workspace");
  const [runtimes, setRuntimes] = useState(["codex"]);
  const panel = useRef<HTMLElement>(null);
  const [screen, setScreen] = useState<"form" | "review" | "progress">("form");
  const [error, setError] = useState("");
  const project = environment !== null;
  const resolvedName = name.trim() || profileName.trim();
  const resolvedProfileKey = profileKey.trim() || slug(profileName);
  const resolvedProjectKey = projectKey.trim() || slug(resolvedName).replace(/-/g, "").slice(0, 8).toUpperCase();
  const resolvedLocation = location || (project && resolvedProfileKey ? `${workspaceRoot}/${resolvedProfileKey}` : "");
  useEffect(() => { panel.current?.focus(); }, [mode, screen]);
  const result = { name: resolvedName, mode, location: resolvedLocation.trim(), profileKey: resolvedProfileKey, projectKey: resolvedProjectKey, endpoint, existing, runtimes };
  function review() {
    if (!resolvedName || !resolvedLocation.trim() || (project && !resolvedProfileKey)) { setError("Provide a name, profile and location."); return; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(project ? resolvedProfileKey : resolvedName)) { setError("Use lowercase letters, digits and hyphens for the profile key or environment name."); return; }
    if (existingNames.includes(project ? resolvedProfileKey : resolvedName)) { setError("That registration already exists. Choose another key or open it from the sidebar."); return; }
    if (project && !resolvedLocation.startsWith("/")) { setError("Use an absolute workspace path."); return; }
    if (project && mode === "Create new project" && !/^[A-Z][A-Z0-9]*$/.test(resolvedProjectKey)) { setError("Project key must start with a letter and contain uppercase letters or digits."); return; }
    if (project && !/^https:\/\/[^/]+\.convex\.cloud\/?$/.test(endpoint)) { setError("Use the HTTPS Convex cloud URL for this deployment."); return; }
    if (repo && !repo.startsWith("https://")) { setError("Use an HTTPS repository URL."); return; }
    if (mode === "Remote SSH" && !location.includes("@")) { setError("Use an SSH target such as ubuntu@my-vm."); return; }
    if (!project && runtimes.length === 0) { setError("Select at least one runtime."); return; }
    setError(""); setScreen("review");
  }
  function back() { if (screen === "review") setScreen("form"); else if (mode) setMode(""); else onClose(); }
  return <section ref={panel} tabIndex={-1} className={styles.connection} aria-label={project ? "Add project" : "Add environment"} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && screen !== "progress") { event.preventDefault(); back(); } }}>
    <div className={styles.panelHeading}><strong>{project ? `Add project to ${environment}` : "Add environment"}</strong>{screen !== "progress" && <button onClick={onClose}>Cancel setup</button>}</div>
    <p className={styles.muted}>Design preview only. Sample values; no credentials, network calls or files written.</p>
    {screen === "progress" ? <OperationPanel title={project ? "Prepare project" : "Prepare environment"} steps={project ? ["Validate access and registration", mode === "Create new project" ? "Create project once and retain its ID" : "Link existing project ID", "Reuse saved project key or create a scoped key", workspace === "Reuse existing workspace" ? "Check existing workspace" : repo ? "Clone repository" : "Create private workspace", "Register profile and check worker readiness"] : mode === "Remote SSH" ? ["Check SSH identity and host trust", "Inspect remote service and version", "Connect to private service socket", "Verify project isolation"] : ["Check Docker availability", "Pull managed image", "Create persistent environment", "Start service", "Verify runtime and project isolation"]} failure={project ? "Preparation failed: sample repository access denied. Project ID and private files retained. Fix access, then retry this step without creating another project." : "Readiness check failed. Registration and volumes retained. Check Docker or SSH access and inspect saved service logs before retrying."} onBack={() => setScreen("form")} onDone={() => onSave(result)} /> : screen === "review" ? <div className={styles.setupForm}>
      <h2>Review {project ? "project" : "environment"}</h2>
      <dl className={styles.reviewGrid}><dt>Mode</dt><dd>{mode}</dd><dt>Name</dt><dd>{resolvedName}</dd><dt>Location</dt><dd>{resolvedLocation}</dd>{project ? <><dt>Profile key</dt><dd>{resolvedProfileKey}</dd><dt>Project</dt><dd>{mode === "Create new project" ? `${resolvedName} / ${resolvedProjectKey}` : existing}</dd><dt>Endpoint</dt><dd>{endpoint}</dd><dt>Workspace</dt><dd>{workspace} · {repo || "No clone"}</dd><dt>Authentication</dt><dd>Sample saved Convoy credential; reusable project key checked during registration.</dd></> : <><dt>Runtimes</dt><dd>{runtimes.join(", ")}</dd><dt>Trust</dt><dd>{mode === "Remote SSH" ? "New host fingerprint requires explicit verification in the real flow." : "Managed image, persistent storage and deployment allowlist."}</dd></>}</dl>
      <p>Target stays locked until this flow finishes. Existing files are retained on failure.</p>
      <div><button onClick={() => setScreen("progress")}>Confirm setup</button><button onClick={() => setScreen("form")}>Edit configuration</button></div>
    </div> : !mode ? <div className={styles.targets}>
      {(project ? ["Connect existing project", "Create new project"] : ["Local Docker", "Remote SSH"]).map(value => <button key={value} className={styles.target} onClick={() => setMode(value)}>{value}</button>)}
    </div> : <form className={styles.setupForm} onSubmit={event => { event.preventDefault(); review(); }}>
      <strong>{mode}</strong>
      {project ? <>
        <label>Convex URL<input required value={endpoint} onChange={event => setEndpoint(event.target.value)} /></label>
        <label>Convoy authentication<select><option>Saved sample credential</option><option>Enter API key privately in the real CLI</option></select></label>
        <label>Organization<select><option>Contoso · sample organization</option></select></label>
        {mode === "Connect existing project" && <label>Existing project<select value={existing} onChange={event => setExisting(event.target.value)}><option value="sample-isolation-a">Isolation Project A · IPA</option><option value="sample-isolation-b">Isolation Project B · IPB</option></select></label>}
        <label>Profile name<input autoFocus required value={profileName} onChange={event => setProfileName(event.target.value)} placeholder="My project" /></label>
        <label>Profile key<input value={profileKey} onChange={event => setProfileKey(event.target.value)} placeholder={slug(profileName) || "Generated from profile name"} /></label>
        {mode === "Create new project" && <><label>Project name<input value={name} onChange={event => setName(event.target.value)} placeholder={profileName || "Defaults to profile name"} /></label><label>Project key<input value={projectKey} onChange={event => setProjectKey(event.target.value)} placeholder={resolvedProjectKey || "Generated from project name"} /></label></>}
        <label>Workspace preparation<select value={workspace} onChange={event => setWorkspace(event.target.value)}><option>Create workspace</option><option>Reuse existing workspace</option></select></label>
        <label>Repository URL, optional<input value={repo} onChange={event => setRepo(event.target.value)} placeholder="https://github.com/example/repo" /></label>
      </> : <label>Environment name<input autoFocus required value={name} onChange={event => setName(event.target.value)} placeholder="dev-machine" /></label>}
      <label>{project ? "Workspace path" : mode === "Remote SSH" ? "SSH target" : "Allowed Convex deployment"}<input required value={resolvedLocation} onChange={event => setLocation(event.target.value)} placeholder={project ? "/workspace/sample" : mode === "Remote SSH" ? "ubuntu@my-vm" : "example-deployment"} /></label>
      {project && <p className={styles.muted}>Inside {environment}&apos;s container or VM, not on your computer. Generated from the profile key; you can edit it.</p>}
      {!project && <fieldset><legend>Runtimes · select one or more</legend>{["codex", "claude-code", "opencode", "cursor"].map(runtime => <label key={runtime}><input type="checkbox" checked={runtimes.includes(runtime)} onChange={event => setRuntimes(items => event.target.checked ? [...items, runtime] : items.filter(item => item !== runtime))} />{runtime}</label>)}</fieldset>}
      {mode === "Remote SSH" && <p>Uses the host’s SSH configuration. No private key is entered here. Unknown-host and authentication failures appear during connection.</p>}
      <p role="alert">{error}</p>
      <div><button type="button" onClick={back}>← Back</button><button type="submit">Review setup</button></div>
    </form>}
  </section>;
}
