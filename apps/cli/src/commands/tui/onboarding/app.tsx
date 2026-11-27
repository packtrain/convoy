import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Browser } from "../workflow.js";
import { masked, palette, plain, rich, wrapLines } from "../formatters.js";
import { suggestProjectAlias } from "../../setup/resolution.js";
import { toProfileKey } from "../../setup/prompts.js";
import type { ProjectAddOptions } from "../../project/workflow.js";
import { savedDeploymentUrls, loadChoices, validateForm } from "./workflow.js";

import { RuntimeAccess } from "./runtime-access.js";
import { resultMessage } from "./formatters.js";
import { repoLines } from "../../project/formatters.js";
import { Caret, Clickable, Dialog, editText } from "../dialog/index.js";
import { useLeave, useWheel, type LeaveRef } from "../mouse.js";
import { MODE_COPY, prerequisiteFailure, prerequisiteLines } from "../../environment/formatters.js";
import type { Prerequisite } from "../../environment/validators.js";

const workspaceModes = [
  { label: "Empty directory", description: "Start without repository files. Create a new directory on this target." },
  { label: "Reuse existing directory", description: "Keep the files in an existing directory on this target. Requires private ownership." },
  { label: "Clone repository", description: "Download a Git repository into a new target directory. Enter its HTTPS URL next." },
];
const names = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
/** Both auth values live on one web settings page (CLI / Convex URL block plus the keys). */
const AUTH_HINT = "Find both in Convoy under Profile settings → API keys.";

type Field = { label: string; value: string; secret?: boolean; select?: boolean; set(value: string): void };
export function Onboarding({ browser, leave, width: columns, height: rows, load = loadChoices }: { browser: Browser; leave?: LeaveRef; width: number; height: number; load?: typeof loadChoices }) {
  const session = browser.onboardingSession;
  const target = browser.targets[browser.getSnapshot().scope.connection];
  const [compatible, setCompatible] = useState<boolean | undefined>(!session && target.checkProject ? undefined : true);
  const [probe, setProbe] = useState(0);
  const [compatibilityError, setCompatibilityError] = useState("");
  const updating = Boolean(browser.getSnapshot().environment);
  useEffect(() => {
    if (session || updating || !target.checkProject) return;
    let canceled = false;
    setCompatible(undefined); setCompatibilityError("");
    void target.checkProject().then(value => { if (!canceled) setCompatible(value); }, () => { if (!canceled) setCompatibilityError("Target support unknown. Start the environment and retry."); });
    return () => { canceled = true; };
  }, [target, updating, probe]);
  // Spec: docs/specs/cli-tui.md#environment-mode-cli-01270-os-2242
  const modeOpen = () => { try { return Boolean(target.chooseMode?.open()); } catch { return false; } };
  const [notice] = useState(() => { const value = browser.notice; browser.notice = undefined; return value; });
  const [checks, setChecks] = useState<Prerequisite[]>([]);
  const [step, setStep] = useState<"mode" | "prerequisites" | "notice" | "auth" | "choice" | "project" | "organization" | "details" | "confirm" | "access" | "result">(session?.step ?? (notice ? "notice" : modeOpen() ? "mode" : "auth"));
  const [url, setUrl] = useState(process.env.CONVOY_URL ?? "");
  const [secret, setSecret] = useState("");
  const [deployments] = useState(() => {
    const { observations, scope } = browser.getSnapshot();
    return savedDeploymentUrls([observations[scope.connection], ...observations.filter((_, i) => i !== scope.connection)]
      .flatMap(observation => observation.inspection?.profiles.map(profile => profile.endpoint) ?? []));
  });
  const [dropdown, setDropdown] = useState<number>();
  const changeUrl = (value: string) => { if (value !== url) setSecret(""); setUrl(value); };
  const [choices, setChoices] = useState<Awaited<ReturnType<typeof loadChoices>>>({ projects: [], organizations: [] });
  const [options, setOptions] = useState<ProjectAddOptions>(session ? { profileKey: session.profile } : {});
  const [directory, setDirectory] = useState("");
  const [mode, setMode] = useState(0);
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState<number>();
  const [message, setMessage] = useState(session?.message ?? "");
  const [busy, setBusy] = useState(false);
  const [retrySafe, setRetrySafe] = useState(true);
  const [applied, setApplied] = useState(Boolean(session));
  const [done, setDone] = useState(Boolean(session));
  const [retained, setRetained] = useState(false);
  const [discard, setDiscard] = useState(false);
  // The reused folder's repos, keyed by the path they were read for. Spec: docs/specs/cli-multi-repo-projects.md#when-it-runs
  const [repos, setRepos] = useState<{ directory: string; lines: string[] }>();
  const reposRequested = useRef<string | undefined>(undefined); // Only the latest request's answer is shown.
  const leaving = useRef<() => void>(undefined); // The sidebar click to run after Discard.
  const mounted = useRef(true);
  const discovery = useRef<AbortController | undefined>(undefined);
  const edited = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; discovery.current?.abort(); }; }, []);
  const update = (key: keyof ProjectAddOptions, value: string) => { edited.current.add(key); setOptions(old => ({ ...old, [key]: value })); };
  const fields: Field[] = step === "auth" ? [
    ...(deployments.length ? [{ label: "Saved deployment", value: deployments.includes(url) ? url : "Choose a saved deployment", select: true, set: () => {} }] : []),
    { label: "Deployment HTTPS URL", value: url, set: changeUrl },
    { label: "Convoy API key (masked)", value: secret, set: setSecret, secret: true },
  ] : [
    ...(options.create ? [
      { label: "Project name", value: options.projectName ?? "", set: (value: string) => {
        const profileKey = toProfileKey(value).slice(0, 80) || "project";
        setOptions(old => ({ ...old, projectName: value,
          ...(!edited.current.has("projectAlias") ? { projectAlias: suggestProjectAlias(value) } : {}),
          ...(!edited.current.has("profileName") ? { profileName: value } : {}),
          ...(!edited.current.has("profileKey") ? { profileKey } : {}) }));
        if (!edited.current.has("directory")) setDirectory(profileKey);
      } },
      { label: "Project alias", value: options.projectAlias ?? "", set: (value: string) => update("projectAlias", value) },
    ] : []),
    { label: "Profile name", value: options.profileName ?? "", set: value => update("profileName", value) },
    { label: "Profile key", value: options.profileKey ?? "", set: value => update("profileKey", value) },
    { label: "Workspace path (target)", value: directory, set: value => { edited.current.add("directory"); setDirectory(value); } },
    { label: "Workspace mode", value: workspaceModes[mode].label, select: true, set: () => {} },
    ...(mode === 2 ? [{ label: "Git repository URL (HTTPS)", value: options.clone ?? "", set: (value: string) => update("clone", value) }] : []),
  ];
  const width = Math.max(24, columns);
  const height = Math.max(1, Math.min(rows, dropdown !== undefined ? step === "auth" ? Math.min(22, deployments.length + 11) : 19 : step === "auth" ? (message ? 18 : 16) + (deployments.length ? 3 : 0) : step === "details" ? fields.length * 3 + 10 + (message ? 2 : 0) : 26));
  const hint = step === "auth" ? 1 : 0;
  const fieldRows = height < fields.length * 3 + 7 + hint + (message ? 2 : 0) ? 2 : 3;
  const count = Math.max(1, Math.floor((height - 8 - hint - (width < 50 ? 1 : 0) - (message ? 2 : 0)) / fieldRows));
  const payload = () => ({ ...options, url, apiKey: secret, reuse: mode === 1, clone: mode === 2 ? options.clone : undefined });
  const move = (next: typeof step) => { setStep(next); setIndex(0); setCursor(undefined); setMessage(""); };
  // The sidebar leaves the form, but not during an operation, the repair flow or Runtime access.
  useLeave(leave, !busy && !updating && !discard && step !== "access" ? then => close(then) : undefined);
  const finish = () => { setSecret(""); browser.closeOnboarding(done && applied ? options.profileKey : undefined, done && !applied); };
  const close = (then?: () => void) => { leaving.current = then; if (!done && (url !== (process.env.CONVOY_URL ?? "") || secret || Object.keys(options).length || directory)) setDiscard(true); else { finish(); then?.(); } };
  const authenticate = async () => {
    if (!url.trim() || !secret.trim()) { setMessage("Enter the deployment URL and API key."); return; }
    const abort = new AbortController(); discovery.current = abort;
    setBusy(true); setMessage("Loading accessible projects and organizations… Esc cancels.");
    try {
      const result = await load(url, secret, abort.signal);
      if (mounted.current && !abort.signal.aborted) { setChoices({
        projects: [...result.projects].sort((a, b) => names.compare(a.organizationName, b.organizationName) || names.compare(a.organizationId, b.organizationId) || names.compare(a.name, b.name) || names.compare(a.alias, b.alias) || names.compare(a._id, b._id)),
        organizations: [...result.organizations].sort((a, b) => names.compare(a.name, b.name) || names.compare(a.slug, b.slug)),
      }); move("choice"); }
    } catch { if (mounted.current && !abort.signal.aborted) setMessage("Cannot load choices. Check HTTPS deployment, API key and access. Inputs are retained."); }
    finally { if (discovery.current === abort) { discovery.current = undefined; if (mounted.current) setBusy(false); } }
  };
  const submit = async () => {
    if (!target.addProject || busy) return;
    setBusy(true); setMessage("Registering, preparing workspace and reconciling service… Wait for the result before leaving.");
    try {
      const result = await target.addProject(directory, payload());
      if (!mounted.current) return;
      if (options.create && result.projectId) {
        setRetained(true);
        setOptions(old => ({ ...old, project: result.projectId, create: undefined, org: undefined, projectName: undefined, projectAlias: undefined }));
      }
      if (result.reason === "target-incompatible" && target.checkProject) setCompatible(false);
      if (result.ok && result.applied && target.credentials) browser.onboardingSession = {
        profile: options.profileKey!, message: resultMessage(result), step: "access",
        access: { draft: {}, saved: {}, reloadPending: false },
      };
      setRetrySafe(result.retrySafe); setDone(result.ok); setApplied(result.applied); setMessage(resultMessage(result, retained || Boolean(options.create && result.projectId))); setStep(result.ok && result.applied && target.credentials ? "access" : "result");
      if (result.ok) setSecret("");
    } catch {
      if (mounted.current) { setRetrySafe(false); setMessage("Outcome unknown.\nInspect target projects.\nInspect Convoy API Keys.\nRemote data and workspace files may be retained. Update the target CLI if guided setup is unsupported."); setStep("result"); }
    } finally { if (mounted.current) { setBusy(false); setIndex(0); } }
  };
  const chooseShared = async () => {
    try { await target.chooseMode!.apply("shared", () => {}); move("auth"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Cannot save the mode."); }
  };
  const checkIsolated = async () => {
    setBusy(true);
    try { const result = await target.chooseMode!.checks(); if (mounted.current) { setChecks(result); move("prerequisites"); } }
    catch { if (mounted.current) setMessage("Cannot check the isolated mode prerequisites."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const install = () => void browser.handOff(async () => {
    const lines: string[] = [];
    try { await target.chooseMode!.apply("isolated", line => lines.push(line)); target.mode = "isolated"; lines.push("Isolated mode is set up. Continue to add the first project."); }
    catch (error) { lines.push(error instanceof Error ? error.message : "Setup failed."); }
    return lines.join("\n");
  }).catch(() => { if (mounted.current) setMessage("Cannot hand over the terminal. Run convoy project add in a terminal to choose isolated mode."); });
  const wrap = (lines: string[]) => lines.flatMap(line => wrapLines(plain(line), Math.max(1, width - 6)));
  const reviewHead = wrap([
    `${options.create ? "Create" : "Link"} ${options.projectName ?? options.project}`,
    `Profile: ${options.profileName} / ${options.profileKey}`, `Target workspace child: ${directory}`,
    `Workspace: ${workspaceModes[mode].label}`,
  ]);
  const reviewTail = wrap(["Remote data and prepared files remain after failure."]);
  // One row per repo line, cut to the rows left, so Register always fits.
  const repoRows = (mode === 1 && target.repos ? repos?.directory === directory ? repos.lines : ["Looking for git repositories…"] : [])
    .map(line => plain(line).slice(0, Math.max(1, width - 6)));
  const repoBudget = Math.max(0, height - 7 - reviewHead.length - reviewTail.length);
  const shownRepoRows = repoRows.length <= repoBudget ? repoRows
    : repoBudget > 0 ? [...repoRows.slice(0, repoBudget - 1), `… and ${repoRows.length - repoBudget + 1} more`] : [];
  const confirmation = [...reviewHead, ...shownRepoRows, ...reviewTail];
  const dropdownOptions = step === "auth" ? [...deployments, "Enter a new URL"] : workspaceModes.map(option => option.label);
  const explanation = dropdown !== undefined && step === "details" ? wrapLines(workspaceModes[dropdown].description, width - 6) : [];
  const small = columns < 36 || height < 12 || (explanation.length > 0 && height < 14 + explanation.length) || (step === "confirm" && confirmation.length > height - 7);
  const lists = step === "choice" ? ["Link existing project", "Create new project"]
    : step === "project" ? choices.projects.map(p => `${p.organizationName} / ${p.name} (${p.alias})`)
    : step === "organization" ? choices.organizations.map(o => `${o.name} (${o.slug})`) : [];
  // Enter on a form or confirmation button; a click on one lands here too.
  const pressForm = (at: number) => {
    if (at < fields.length) return;
    if (at === fields.length) { close(); return; }
    if (step === "auth") { void authenticate(); return; }
    try {
      validateForm(directory, payload(), mode === 2); move("confirm");
      if (mode === 1 && target.repos && repos?.directory !== directory && reposRequested.current !== directory) {
        const requested = directory;
        reposRequested.current = requested;
        void target.repos(requested).then(found => repoLines(found), () => []).then(lines => {
          if (mounted.current && reposRequested.current === requested) setRepos({ directory: requested, lines });
        });
      }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check inputs."); }
  };
  const pressConfirm = (at: number) => { if (at === 0) move("details"); else void submit(); };
  // Enter or a click on a list row, dropdown option or select field.
  const chooseItem = (at: number) => {
    if (step === "choice") { move(at === 0 ? "project" : "organization"); return; }
    edited.current.clear();
    if (step === "project") {
      const p = choices.projects[at]; const profileKey = toProfileKey(p.alias) || "project";
      setOptions({ project: p._id, profileName: p.name, profileKey }); setDirectory(profileKey);
    } else {
      setOptions({ create: true, org: choices.organizations[at]._id, projectName: "New project", projectAlias: suggestProjectAlias("New project"), profileName: "New project", profileKey: "new-project" }); setDirectory("new-project");
    }
    move("details");
  };
  const pick = (at: number) => {
    if (step === "auth") { changeUrl(deployments[at] ?? ""); setIndex(1); }
    else setMode(at);
    setDropdown(undefined); setCursor(undefined);
  };
  const openDropdown = () => setDropdown(step === "auth" ? Math.max(0, deployments.indexOf(url)) : mode);
  useInput((input, key) => {
    if (discard || updating || compatible !== true) return;
    if (["result", "access", "mode", "prerequisites", "notice"].includes(step)) return;
    if (busy) {
      if (key.escape && discovery.current) { discovery.current.abort(); discovery.current = undefined; setBusy(false); setMessage("Discovery canceled. Inputs retained."); }
      return;
    }
    if (dropdown !== undefined) {
      if (key.escape || key.tab) { setDropdown(undefined); return; }
      if (small) return;
      if (key.upArrow) setDropdown(value => Math.max(0, (value ?? 0) - 1));
      if (key.downArrow) setDropdown(value => Math.min(dropdownOptions.length - 1, (value ?? 0) + 1));
      if (key.return) pick(dropdown);
      return;
    }
    if (key.escape) {
      if (step === "auth" || (retained && step !== "confirm")) { close(); return; }
      move(step === "choice" ? "auth" : step === "confirm" ? "details" : step === "details" ? options.create ? "organization" : "project" : "choice"); return;
    }
    if (small || !target.addProject || key.ctrl || key.meta) return;
    if (step === "confirm") {
      if (key.tab) setIndex(value => 1 - value);
      if (key.leftArrow || key.rightArrow) setIndex(key.leftArrow ? 0 : 1);
      if (key.return) pressConfirm(index);
      return;
    }
    if (["choice", "project", "organization"].includes(step)) {
      if (key.upArrow) setIndex(value => Math.max(0, value - 1));
      if (key.downArrow) setIndex(value => Math.min(lists.length - 1, value + 1));
      if (key.return && lists.length) chooseItem(index);
      return;
    }
    if (fields[index]?.select && (key.return || input === " ")) { openDropdown(); return; }
    if (key.pageUp || key.pageDown) {
      setIndex(value => Math.max(0, Math.min(fields.length - 1, Math.min(value, fields.length - 1) + (key.pageUp ? -count : count)))); setCursor(undefined); return;
    }
    if (key.tab || key.downArrow || key.upArrow) {
      setIndex(value => (value + (key.upArrow || key.shift ? fields.length + 1 : 1)) % (fields.length + 2)); setCursor(undefined); return;
    }
    if (index >= fields.length && (key.leftArrow || key.rightArrow)) {
      setIndex(key.leftArrow ? fields.length : fields.length + 1); return;
    }
    if (key.return) { pressForm(index); return; }
    const field = fields[index];
    if (!field || field.select) return;
    // A masked field shows no position, so its cursor stays at the end.
    const edit = editText(field.value, field.secret ? undefined : cursor, input, key, field.secret ? 4096 : 256);
    if (!edit) return;
    if (edit.value !== field.value) field.set(edit.value);
    setCursor(edit.cursor);
  });
  // The wheel moves the highlight or focus as ↑/↓ do, so rows past the visible window scroll in.
  const clamp = (value: number, length: number) => Math.max(0, Math.min(length - 1, value));
  const form = step === "auth" || step === "details";
  useWheel(discard || updating || compatible !== true || busy || small ? undefined
    : dropdown !== undefined ? delta => setDropdown(value => clamp((value ?? 0) + delta, dropdownOptions.length))
    : lists.length ? delta => setIndex(value => clamp(value + delta, lists.length))
    : form ? delta => { setIndex(value => clamp(Math.min(value, fields.length - 1) + delta, fields.length)); setCursor(undefined); } : undefined);
  if (updating) return null;
  if (discard) return <Dialog width={columns} height={rows} lines={["Discard project draft?", "Entered fields and the credential will be cleared. Prepared files and remote data remain."]} onCancel={() => setDiscard(false)} buttons={[{ label: "Keep editing", activate: () => setDiscard(false) }, { label: "Discard", activate: () => { finish(); leaving.current?.(); } }]} />;
  if (compatible !== true) return <Dialog inline key={`compatibility:${probe}`} width={columns} height={rows} onCancel={close}
    lines={[compatible === false ? "Remote update required" : compatibilityError || "Checking target setup support…",
      `Target: ${target.name}`, "Guided project registration requires target setup support. A version difference alone does not block supported targets.",
      ...(compatible === false && !target.maintenance && target.addProjectUnavailable ? [target.addProjectUnavailable] : [])]}
    buttons={[{ label: "Close", activate: close }, ...(compatibilityError ? [{ label: "Retry", activate: () => setProbe(value => value + 1) }, ...(target.maintenance ? [{ label: "Start", activate: () => browser.openEnvironment("start") }] : [])] : []), ...(compatible === false && target.maintenance ? [{ label: "Update CLI", activate: () => browser.openEnvironment("update") }] : [])]} />;
    if (step === "result") return <Dialog inline key="result" lines={["Add project · result", ...message.split("\n"), "↑/↓ scroll · Esc closes"]} width={columns} height={rows} scrollable onCancel={close}
    buttons={[{ label: done ? applied ? "Runs" : "Actions" : retrySafe ? "Retry" : "Close", activate: () => { if (!done && retrySafe) move("details"); else close(); } }]} />;
  if (step === "mode") return <Dialog inline key="mode" width={columns} height={rows} onCancel={close} error={message || undefined}
    lines={busy ? ["Checking isolated mode prerequisites…"] : [`Project separation · ${plain(target.name)}`, "Choose once for this machine. It can't change after the first project.", MODE_COPY.shared, MODE_COPY.isolated]}
    buttons={busy ? [] : [{ label: "Shared", activate: () => void chooseShared() }, { label: "Isolated", activate: () => void checkIsolated() }]} />;
  if (step === "prerequisites") {
    const ready = checks.every(check => !check.fix);
    return <Dialog inline key="prerequisites" width={columns} height={rows} scrollable onCancel={() => move("mode")} error={message || undefined}
      lines={busy ? ["Checking isolated mode prerequisites…"] : ["Isolated mode prerequisites", ...prerequisiteLines(checks), ready ? "Install asks for your sudo password in this terminal, then returns here." : prerequisiteFailure("choose Check again")]}
      buttons={busy ? [] : [{ label: "Back", activate: () => move("mode") }, ready ? { label: "Install with sudo", activate: install } : { label: "Check again", activate: () => void checkIsolated() }]} />;
  }
  if (step === "notice") return <Dialog inline key="notice" width={columns} height={rows} scrollable onCancel={close}
    lines={["Project separation · result", ...(notice ?? "").split("\n")]} buttons={[{ label: "Continue", activate: () => move(modeOpen() ? "mode" : "auth") }]} />;
  if (step === "access") return <RuntimeAccess browser={browser} profile={options.profileKey!} width={columns} height={rows} onDone={() => { if (session?.origin === "actions") { browser.closeOnboarding(); return; } if (browser.onboardingSession) browser.onboardingSession.step = "result"; setStep("result"); }} />;
  const first = Math.max(0, Math.min(index - count + 1, fields.length - count));
  const visible = fields.slice(first, first + count);
  const title = { auth: "Connect to Convoy", choice: "Add project", project: "Link existing project", organization: "Choose organization", details: "Project details", confirm: "Review registration" }[step];
  const button = (label: string, at: number, press: (at: number) => void) => {
    const selected = index === at;
    return <Clickable flexShrink={0} width={label.length + 6} onClick={() => { if (busy || small) return; setIndex(at); press(at); }}><Text bold color={selected ? rich ? palette.selectedText : "black" : rich ? palette.accent : "white"} backgroundColor={selected ? rich ? palette.selected : "cyan" : rich ? undefined : "black"}>{`${selected ? ">" : " "} [ ${label} ]`}</Text></Clickable>;
  };
  return <Box flexDirection="column" width={width} height={height} backgroundColor={palette.base ?? "black"} paddingX={2} paddingY={1}>
    {small ? <Text wrap="truncate">Resize to continue.</Text> : <>
      <Text bold color={palette.text ?? "white"}>{title} · {plain(target.name)}</Text>
      <Text color={palette.muted} wrap="truncate">{dropdown !== undefined ? (step === "auth" ? "Choose a deployment or enter a new URL." : "Choose how to prepare files on this target.") : step === "details" && mode === 2 ? "Clone copies a Git repository into this workspace." : form ? "Type to edit · ↑/↓ or Tab moves between controls." : "↑/↓ select · Enter choose · Esc back"}</Text>
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {!target.addProject ? <Text>{target.addProjectUnavailable ?? "Add project requires a configured Linux project environment or saved Docker target."} Esc closes.</Text>
          : busy ? <Text>{message}</Text>
          : step === "confirm" ? confirmation.map((line, i) => <Text key={i}>{line}</Text>)
          : dropdown !== undefined ? <>
            <Text bold>{step === "auth" ? "Saved deployments" : "Workspace mode"}</Text>
            {dropdownOptions.slice(Math.max(0, dropdown - height + 11), Math.max(0, dropdown - height + 11) + height - 10).map((value, offset) =>
              <Clickable key={value} onClick={() => pick(offset + Math.max(0, dropdown - height + 11))}><Text wrap="truncate" color={offset + Math.max(0, dropdown - height + 11) === dropdown ? palette.accent : palette.text ?? "white"}>{offset + Math.max(0, dropdown - height + 11) === dropdown ? "> " : "  "}{plain(value)}</Text></Clickable>)}
            {explanation.length > 0 && <Box flexDirection="column" marginTop={1}><Text>{workspaceModes[dropdown].description}</Text></Box>}
          </> : form ? <>
            {visible.map((field, offset) => {
              const active = first + offset === index;
              const value = field.secret ? masked(field.value) : plain(field.value);
              const placeholder = step === "auth" ? field.secret ? "Paste your Convoy API key" : "https://your-deployment.convex.cloud" : field.label.startsWith("Git repository") ? "https://github.com/owner/repo.git" : "Enter a value";
              return <Clickable key={field.label} flexDirection="column" marginBottom={fieldRows - 2} onClick={() => { setIndex(first + offset); setCursor(undefined); if (field.select) openDropdown(); }}>
                <Text color={active ? palette.accent : palette.text ?? "white"} wrap="truncate">{active ? "> " : "  "}{field.label}</Text>
                <Text wrap="truncate" backgroundColor={rich ? active ? palette.idle : palette.surface : active ? "gray" : "black"} color={palette.text ?? "white"}>[ {field.select ? `${value} ▾` : active ? <Caret value={value} cursor={field.secret ? undefined : cursor} width={width - 12} placeholder={<Text color={palette.muted}>{placeholder}</Text>} /> : value || <Text color={palette.muted}>{placeholder}</Text>} ]</Text>
              </Clickable>;
            })}
            {hint > 0 && <Text color={palette.muted} wrap="truncate">{AUTH_HINT}</Text>}
            {fields.length > count && <Text color={palette.muted}>Inputs {first + 1}-{Math.min(fields.length, first + count)} of {fields.length} · PgUp/PgDn scroll</Text>}
          </> : (lists.length ? lists.slice(Math.max(0, index - height + 11), Math.max(0, index - height + 11) + height - 10).map((line, i) => <Clickable key={line} onClick={() => chooseItem(i + Math.max(0, index - height + 11))}><Text wrap="truncate">{i + Math.max(0, index - height + 11) === index ? ">" : " "} {plain(line)}</Text></Clickable>) : <Text>No accessible entries. Esc to go back.</Text>)}
      </Box>
      {!busy && message && <Text color={palette.warning}>{message}</Text>}
      {form && dropdown === undefined && !busy && target.addProject && <Box gap={width < 50 ? 0 : 2} flexDirection={width < 50 ? "column" : "row"}>{button("Cancel", fields.length, pressForm)}{button(step === "auth" ? "Load choices" : "Review registration", fields.length + 1, pressForm)}</Box>}
      {step === "confirm" && !busy && <Box gap={2}>{button("Back", 0, pressConfirm)}{button("Register", 1, pressConfirm)}</Box>}
      <Text color={palette.muted} wrap="truncate">{dropdown !== undefined ? "↑/↓ select · Enter choose · Esc cancel" : form || step === "confirm" ? "Tab focus · ←/→ buttons · Enter select · Esc back" : "Esc back / cancel"}</Text>
    </>}
  </Box>;
}
