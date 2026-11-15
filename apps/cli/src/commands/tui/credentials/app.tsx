import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Browser } from "../workflow.js";
import type { BrowseState } from "../validators.js";
import type { Connection } from "../resolution.js";
import { Dialog } from "../dialog/index.js";
import { masked, palette, plain, printable, wrapLines } from "../formatters.js";
import { codexAwsHost } from "../../../agent/runtimes/codex/auth.js";
import { MANAGED_RUNTIME_LABELS, awsRegionSchema, entryProviderSchema, keyNameSchema, secretSchema, type CredentialMutation, type ManagedCredentialStatus, type ManagedRuntime } from "../../../lib/config/credentials/validators.js";
import { assignedRows, bindingRows, choices, draftMutations, entryRuntimes, pendingProfiles, rollbackRevision, sameBinding } from "./workflow.js";
import type { Draft, Entry } from "./validators.js";
import { assignmentNames, bindingLabel, delivery, draftNote, entryLine, providerLabel } from "./formatters.js";
import type { Action } from "../actions/validators.js";

/** Each runtime's TUI login action; one without names the CLI login instead. */
const LOGIN_ACTIONS: Record<ManagedRuntime, Action | undefined> = { codex: "login-codex", "claude-code": "login-claude-code", cursor: undefined };

const failure = (error: unknown) => plain(error instanceof Error ? error.message : "Operation failed.");
type Tone = "ok" | "error" | "warn" | "busy";
type Notice = { tone: Tone; lines: string[] };
const note = (tone: Tone, ...lines: string[]): Notice => ({ tone, lines });
const MARK: Record<Tone, string> = { ok: "✓ ", error: "✗ ", warn: "! ", busy: "" };
const TONE = { ok: "success", error: "danger", warn: "warning", busy: "accent" } as const;
type Popup = { kind: "rotate" | "rollback" | "disable" | "remove"; entry: Entry } | { kind: "leave" } | { kind: "reload"; profiles: string[]; saved?: number; then?: () => void };

/** Environment Credentials tab, or one project's runtime assignments. Spec: docs/specs/cli-tui.md#runtime-credentials-cli-01070 */
export function Credentials({ browser, state, active, width, height }: { browser: Browser; state: BrowseState; active: boolean; width: number; height: number }) {
  const target = browser.targets[state.scope.connection];
  const shared = target.mode === "shared";
  const project = state.scope.details ? undefined : state.scope.profile;
  const [status, setStatus] = useState<ManagedCredentialStatus>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>();
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<Draft>({});
  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState<number>(); // Highlighted choice of the project editor's dropdown.
  const [popup, setPopup] = useState<Popup>();
  const [adding, setAdding] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const entries = status?.entries ?? [];
  const rows = status ? bindingRows(status, state.observations[state.scope.connection].profiles) : [];
  const entry = entries.find(value => value.name === editing);
  const editorRows = project ? rows.filter(row => row.profile === project) : entry && status ? bindingRows(status, state.observations[state.scope.connection].profiles, entryRuntimes(entry)) : undefined;
  const dirty = draftMutations(editorRows ?? [], draft).length > 0;
  const locked = Boolean(editorRows || popup || adding || busy);
  const small = width < 45 || height < 12;
  useEffect(() => { browser.editCredentials(locked); }, [locked]);
  const load = async () => {
    if (!target.credentials) return;
    setLoading(true);
    try { const value = await target.credentials.status(); if (alive.current) { setStatus(value); setError(undefined); setSelected(old => Math.min(old, value.entries.length)); } return value; }
    catch (cause) { if (alive.current) setError(`Cannot read credential status: ${failure(cause)} Press f to retry.`); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, []); // Explicit reads only: open, after a change and f.
  const close = () => { setDraft({}); setFocus(0); setOpen(undefined); setMessage(undefined); if (project) browser.showCredentials(false); else setEditing(undefined); };
  const save = async (then?: () => void) => {
    const changes = draftMutations(editorRows ?? [], draft);
    if (!changes.length || busy) return;
    setBusy(true); setMessage(note("busy", `Saving ${changes.length} assignment change${changes.length === 1 ? "" : "s"}…`));
    let done = 0;
    try {
      for (const { request } of changes) { await browser.mutateCredentials(request); done++; }
      const restored = changes.find(change => change.request.binding.mode === "native")?.row;
      // A shared account's native login is its own, so it only needs a reload. Spec: docs/specs/cli-shared-environments.md#credentials
      const native = shared ? undefined : restored?.runtime;
      const login = native && LOGIN_ACTIONS[native];
      // A project editor hands over to that runtime's login confirmation.
      if (project && login && !browser.unavailable(login)) { browser.showCredentials(false); browser.beginAction(login); return; }
      if (alive.current) {
        setDraft({});
        if (!native) { setPopup({ kind: "reload", profiles: [...new Set(changes.map(change => change.row.profile))], saved: done, then }); then = undefined; }
        else setMessage(note("ok", `Saved ${done} change${done === 1 ? "" : "s"}. Rows show service-reported delivery; pending rows apply after [u] Reload project. Running agents were not restarted.`,
          !login ? `Native login: run convoy project login ${restored!.profile} --runtime ${native} in a terminal.`
            : "Native login: select the project, then choose [i] Log in to Codex or [o] Log in to Claude Code from its Actions."));
      }
    } catch (cause) {
      const row = changes[done].row;
      if (alive.current) setMessage(note("error", `Saved ${done} of ${changes.length}. ${row.profile} (${MANAGED_RUNTIME_LABELS[row.runtime]}): ${failure(cause)}`, "Unsaved rows stay in the draft. Fix the cause, then Save changes again."));
      then = undefined;
    }
    await load();
    if (alive.current) { setBusy(false); then?.(); }
  };
  const operate = async (request: CredentialMutation, done: string) => {
    setPopup(undefined); setBusy(true); setMessage(note("busy", `Working: ${request.action} ${"name" in request ? request.name : ""}…`));
    try { await browser.mutateCredentials(request); if (alive.current) setMessage(note("ok", done)); }
    catch (cause) { if (alive.current) setMessage(note("error", `Not changed: ${failure(cause)}`)); }
    await load();
    if (alive.current) setBusy(false);
  };
  useInput((input, key) => {
    if (popup || adding || busy || (!locked && !active)) return;
    if (open !== undefined && editorRows?.[focus]) {
      const row = editorRows[focus], options = choices(row, entries);
      if (key.escape || key.tab) { setOpen(undefined); return; }
      if (key.ctrl || key.meta || small) return;
      if (key.upArrow || input === "k") setOpen(Math.max(0, open - 1));
      if (key.downArrow || input === "j") setOpen(Math.min(options.length - 1, open + 1));
      if (key.return) { setDraft(old => ({ ...old, [row.key]: options[open] })); setOpen(undefined); }
      return;
    }
    if (editorRows && key.escape) { if (dirty) setPopup({ kind: "leave" }); else close(); return; }
    if (key.ctrl || key.meta || small) return;
    if (input === "f") { void load(); return; }
    if (input === "u") {
      const chosen = entries[selected - 1];
      const profiles = pendingProfiles(editorRows ?? (chosen ? assignedRows(rows, chosen.name) : rows));
      if (dirty) setMessage(note("warn", "Save or discard the draft before [u] Reload project."));
      else if (profiles.length) setPopup({ kind: "reload", profiles });
      else setMessage(note("warn", `No project ${editorRows || !chosen ? "here" : `using ${chosen.name}`} has pending credential changes.`));
      return;
    }
    if (editorRows) {
      const count = editorRows.length + 2;
      if (key.tab || key.upArrow || key.downArrow || input === "j" || input === "k") { setFocus(old => (old + (key.upArrow || input === "k" || key.shift ? count - 1 : 1)) % count); return; }
      if (focus >= editorRows.length) {
        if (key.leftArrow || key.rightArrow) setFocus(editorRows.length + (key.rightArrow ? 1 : 0));
        else if (key.return && focus === editorRows.length) void save();
        else if (key.return) { setDraft({}); setMessage(note("ok", "Draft discarded. Saved assignments unchanged.")); }
        return;
      }
      if (input !== " " && !key.return) return;
      const row = editorRows[focus];
      const options = choices(row, entries, entry);
      const index = options.findIndex(option => sameBinding(option, draft[row.key] ?? row.saved));
      if (project) { setOpen(Math.max(0, index)); return; }
      if (options.length === 1) { setMessage(note("warn", `${entry?.name} is disabled and cannot gain assignments. Rotate it to re-enable.`)); return; }
      setDraft(old => ({ ...old, [row.key]: options[(index + 1) % options.length] }));
      return;
    }
    if (!status) return;
    if (key.upArrow || input === "k") { setSelected(old => Math.max(0, old - 1)); return; }
    if (key.downArrow || input === "j") { setSelected(old => Math.min(entries.length, old + 1)); return; }
    const chosen = entries[selected - 1];
    if (input === "n" || (key.return && !chosen)) { setMessage(undefined); setAdding(true); return; }
    if (!chosen) return;
    if (key.return) { setEditing(chosen.name); setDraft({}); setFocus(0); setMessage(undefined); return; }
    if (input === "o") setPopup({ kind: "rotate", entry: chosen });
    if (input === "b") { if (rollbackRevision(chosen)) setPopup({ kind: "rollback", entry: chosen }); else setMessage(note("warn", `${chosen.name} has no older retained revision.`)); }
    if (input === "x") { if (chosen.enabled) setPopup({ kind: "disable", entry: chosen }); else setMessage(note("warn", `${chosen.name} is already disabled. Rotate it to re-enable.`)); }
    if (key.delete || key.backspace) {
      const used = assignedRows(rows, chosen.name);
      if (used.length) setMessage(note("warn", `Unassign ${chosen.name} first: ${assignmentNames(used)}.`)); else setPopup({ kind: "remove", entry: chosen });
    }
  });
  if (!target.credentials) return <>{[
    "Runtime credentials are unavailable for this environment.",
    "Managed runtime credentials live in a shared environment, a managed Docker target or a Linux project VM run as its control account.",
    "Provider keys of ordinary profiles on this machine stay in convoy keys and the desktop settings. This TUI does not change them.",
  ].flatMap(line => wrapLines(line, width)).map((line, i) => <Text key={i} color={i ? palette.muted : palette.text}>{line}</Text>)}</>;
  if (adding) return <AddCredential browser={browser} target={target} entries={entries} width={width} height={height}
    onClose={(name, done) => { setAdding(false); if (done) { setMessage(note("ok", done)); void load().then(value => { const index = value?.entries.findIndex(item => item.name === name) ?? -1; if (alive.current && index >= 0) setSelected(index + 1); }); } }} />;
  if (popup?.kind === "reload") {
    const names = popup.profiles.join(", "), many = popup.profiles.length > 1;
    const runs = popup.profiles.reduce((sum, profile) => sum + (state.observations[state.scope.connection].profiles.find(value => value.profile === profile)?.activeRuns ?? 0), 0);
    const close = () => { setPopup(undefined); popup.then?.(); };
    const reload = async () => {
      close(); setBusy(true); setMessage(note("busy", `Reloading ${names}…`));
      try { await browser.reloadProjects(popup.profiles); if (alive.current) setMessage(note("ok", `Reload requested for ${names}. Rows show applied once ${many ? "each project reconnects" : "it reconnects"}; f refreshes.`)); }
      catch (cause) { if (alive.current) setMessage(note("error", `Not reloaded: ${failure(cause)}`)); }
      await load();
      if (alive.current) setBusy(false);
    };
    return <Dialog width={width} height={height} onCancel={close} buttons={[{ label: "Close", activate: close }, { label: many ? `Reload ${popup.profiles.length} projects` : "Reload project", activate: () => void reload() }]} lines={[
      popup.saved ? `Saved ${popup.saved} change${popup.saved === 1 ? "" : "s"} for ${names}.` : `Reload ${names}?`,
      "Running agents keep the previous credentials until their project reloads.",
      `Reload stops active work in ${names} (${runs} observed active runs) and reconnects with the saved credentials. Other projects stay connected.`]} />;
  }
  if (popup?.kind === "leave") return <Dialog width={width} height={height} lines={["Save assignment changes?", `${project ?? entry?.name} has unsaved assignment changes.`]} onCancel={() => setPopup(undefined)}
    buttons={[{ label: "Keep editing", activate: () => setPopup(undefined) }, { label: "Discard and continue", activate: () => { setPopup(undefined); close(); } },
      { label: "Save and continue", activate: () => { setPopup(undefined); void save(close); } }]} />;
  if (popup) {
    const affected = assignmentNames(assignedRows(rows, popup.entry.name));
    const heading = `${target.name} / ${popup.entry.name} · ${providerLabel(popup.entry)}`;
    const cancel = () => setPopup(undefined);
    if (popup.kind === "rotate") return <SecretDialog width={width} height={height} onCancel={cancel} label={`Rotate ${popup.entry.name}`}
      lines={[heading, `Stores a new revision after revision ${popup.entry.revision}${popup.entry.enabled ? "" : " and re-enables this entry"}.`, `Affected assignments: ${affected}.`, "They receive the new key after [u] Reload project; running agents keep the current key until then. Earlier revisions stay available for roll back."]}
      onSubmit={secret => void operate({ action: "rotate", name: popup.entry.name, secret }, `Rotated ${popup.entry.name}. Assigned projects receive the new revision after [u] Reload project: ${affected}.`)} />;
    const { name } = popup.entry, revision = rollbackRevision(popup.entry);
    const confirm = ({
      rollback: { lines: [`Select retained revision ${revision} instead of revision ${popup.entry.revision}. Enabled state is unchanged.`, `Affected assignments: ${affected}.`, "They use it after [u] Reload project."],
        label: `Roll back to revision ${revision}`, request: { action: "rollback", name, revision: revision! }, done: `${name} selects revision ${revision}. Assigned projects use it after [u] Reload project: ${affected}.` },
      disable: { lines: ["Prevents future grants of this key. Keys already delivered are not revoked at the provider.", `Affected assignments: ${affected}.`, "After reload their runtime is disabled until you rotate this key or assign another credential."],
        label: `Disable ${name}`, request: { action: "disable", name }, done: `${name} disabled. After [u] Reload project these runtimes are disabled until you rotate the key or assign another credential: ${affected}.` },
      remove: { lines: [`Delete ${name}?`, "Deletes every stored revision from this environment; this cannot be undone. Keys already delivered are not revoked at the provider."],
        label: `Delete ${name}`, request: { action: "remove", name }, done: `Deleted ${name}.` },
    } satisfies Record<string, { lines: string[]; label: string; request: CredentialMutation; done: string }>)[popup.kind];
    return <Dialog width={width} height={height} onCancel={cancel} lines={[heading, ...confirm.lines]}
      buttons={[{ label: "Cancel", activate: cancel }, { label: confirm.label, activate: () => void operate(confirm.request, confirm.done) }]} />;
  }
  // After the forms, which keep their input through resize and show their own notice.
  if (small) return <Text color={palette.text}>Resize to 45×12 to manage credentials.{dirty ? " Draft retained." : ""}</Text>;
  // Errors first, then the last result; each line keeps its tone's marker and color.
  const notices = [
    ...(error ? [note("error", error)] : []),
    ...(status && !status.compatible ? [note("error", shared ? "The service predates shared-environment credentials. Restart it with [t] Restart service in environment Actions." : "The service lacks managed credential support. Update its CLI from environment Actions.")] : []),
    ...(status?.configurationError ? [note("error", "Service configuration error: running workers kept their previous credentials.")] : []),
    ...(message ? [message] : []),
  ].flatMap(({ tone, lines }) => lines.flatMap((line, i) => wrapLines(plain(line), width - MARK[tone].length)
    .map((text, j) => ({ text: (i || j ? " ".repeat(MARK[tone].length) : MARK[tone]) + text, color: palette[TONE[tone]], bold: tone === "error" }))));
  const noticeBlock = notices.length > 0 && <Box flexDirection="column" marginTop={1}>{notices.map((line, i) => <Text key={i} bold={line.bold} color={line.color}>{line.text}</Text>)}</Box>;
  const hints = (text: string) => <Text wrap="truncate" color={palette.muted}>{text}</Text>;
  const fill = (on: boolean) => on ? { backgroundColor: active || locked ? palette.selected : palette.idle, color: active || locked ? palette.selectedText : palette.idleText } : {};
  if (editorRows) {
    const capacity = Math.max(1, height - 5 - (notices.length && notices.length + 1));
    const start = Math.max(0, Math.min(focus, editorRows.length - 1) - capacity + 1);
    const title = <Text bold wrap="truncate" color={palette.text}>{project ? `Credentials · ${plain(project)}` : `Assign ${plain(entry!.name)} · ${plain(providerLabel(entry!))} · revision ${entry!.revision}${entry!.enabled ? "" : " · disabled"}`}</Text>;
    const row = editorRows[focus];
    if (open !== undefined && row) {
      const options = choices(row, entries), first = Math.max(0, open - capacity + 1);
      return <>
        {title}
        {hints("↑/↓ select · Enter choose · Esc cancel")}
        <Text bold color={palette.text}>{MANAGED_RUNTIME_LABELS[row.runtime]} credential</Text>
        {options.slice(first, first + capacity).map((option, i) => <Text key={i} wrap="truncate" color={first + i === open ? palette.accent : palette.text}>{first + i === open ? "> " : "  "}{plain(bindingLabel(option, entries, shared))}</Text>)}
      </>;
    }
    return <>
      {title}
      {hints(project ? "Enter/Space choose · Tab/↑/↓ focus · Esc back" : "Space toggles · Tab/↑/↓ focus · Enter activate · Esc back")}
      {!editorRows.length && <Text color={palette.text}>{loading ? "Loading…" : "No registered projects observed. Connect, or add a project first."}</Text>}
      {editorRows.slice(start, start + capacity).map((row, i) => {
        const value = draft[row.key] ?? row.saved;
        const { color, ...rowFill } = fill(start + i === focus);
        const label = project ? `${MANAGED_RUNTIME_LABELS[row.runtime].padEnd(12)} [ ${bindingLabel(value, entries, shared)} ▾ ]` : `[${sameBinding(value, { mode: "managed", name: entry!.name }) ? "x" : " "}] ${plain(row.profile)} · ${MANAGED_RUNTIME_LABELS[row.runtime]}`;
        return <Box key={row.key} {...rowFill}><Text wrap="truncate" color={color ?? palette.text}>{start + i === focus ? ">" : " "} {label}  <Text color={color ?? palette.muted}>{plain(draftNote(row, value))}</Text></Text></Box>;
      })}
      <Box gap={2} marginTop={1}>{(["Save changes", "Discard"] as const).map((label, i) => <Text key={label} bold {...(focus === editorRows.length + i ? fill(true) : { color: dirty ? palette.accent : palette.muted })}>[ {label} ]</Text>)}</Box>
      {noticeBlock}
    </>;
  }
  const chosen = entries[selected - 1];
  const assigned = chosen ? assignedRows(rows, chosen.name) : [];
  const details = chosen ? assigned.length ? assigned.map(row => `  ${row.profile} (${MANAGED_RUNTIME_LABELS[row.runtime]}): ${delivery(row)}`) : ["  No assignments. Enter to assign projects."] : [];
  // Header, notices, keys, assignments and key hints are separated by one blank line each.
  const fixed = 5 + (chosen ? 2 + Math.min(details.length, 4) : status && !entries.length ? 1 : 0);
  const capacity = Math.max(1, height - fixed - (notices.length && notices.length + 1));
  const start = Math.max(0, selected - capacity + 1);
  return <>
    <Text bold color={palette.text}>Runtime credentials</Text>
    {hints(loading ? "Loading status…" : "Managed API keys stored in this environment. Values are never shown.")}
    {noticeBlock}
    <Box flexDirection="column" marginTop={1}>
      {(status ? ["+ Add credential", ...entries.map(value => entryLine(value, assignedRows(rows, value.name).length))] : []).slice(start, start + capacity).map((line, i) => {
        const { color, ...rowFill } = fill(start + i === selected);
        return <Box key={i} {...rowFill}><Text wrap="truncate" color={color ?? (start + i ? palette.text : palette.accent)}>{plain(line)}</Text></Box>;
      })}
      {status && !entries.length && <Text color={palette.muted}>No managed credentials yet. {shared ? "Projects use this account's own runtime logins." : "Native login stays in each project's private shell."}</Text>}
    </Box>
    {chosen && <Box flexDirection="column" marginTop={1}>
      <Text bold wrap="truncate" color={palette.text}>Assignments · {plain(chosen.name)}</Text>
      {details.slice(0, 4).map((line, i) => <Text key={i} wrap="truncate" color={palette.text}>{plain(line)}</Text>)}
    </Box>}
    {status && <Box marginTop={1}>{hints(chosen ? "[Enter] Assign projects  [o] Rotate  [b] Roll back  [x] Disable  [Del] Delete  [n] Add  [f] Refresh" : "[Enter/n] Add credential  [f] Refresh")}</Box>}
  </>;
}

function SecretDialog({ lines, label, width, height, onCancel, onSubmit }: { lines: string[]; label: string; width: number; height: number; onCancel(): void; onSubmit(secret: string): void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string>();
  const submit = () => { const parsed = secretSchema.safeParse(secret); if (parsed.success) onSubmit(parsed.data); else setError("Enter a single-line API key of at most 4096 characters."); };
  return <Dialog width={width} height={height} onCancel={onCancel} error={error} lines={[...lines, `New API key (masked): ${masked(secret)}▏`, "Tab to buttons · Enter activates"]}
    onText={(input, key) => { if (key.backspace || key.delete) setSecret(old => old.slice(0, -1)); else if (input) setSecret(old => (old + printable(input)).slice(0, 4096)); }}
    buttons={[{ label: "Cancel", activate: onCancel }, { label, activate: submit }]} />;
}

const providers = [
  { label: "OpenAI API", provider: "openai", runtimes: "Codex" },
  { label: "AWS Bedrock (Mantle)", provider: "mantle", runtimes: "Codex and Claude Code" }, { label: "AWS Bedrock", provider: "bedrock", runtimes: "Codex and Claude Code" },
  { label: "Anthropic API", provider: "anthropic", runtimes: "Claude Code" },
  { label: "Cursor account", provider: "cursor", runtimes: "Cursor" },
] as const;
function AddCredential({ browser, target, entries, width, height, onClose }: {
  browser: Browser; target: Connection; entries: Entry[]; width: number; height: number; onClose(name?: string, done?: string): void;
}) {
  const [form, setForm] = useState({ name: "", region: "", secret: "" });
  const [provider, setProvider] = useState(0);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<"form" | "review" | "busy">("form");
  const [error, setError] = useState<string>();
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const choice = providers[provider].provider;
  const entryProvider = entryProviderSchema.safeParse(choice).data;
  const aws = choice === "mantle" || choice === "bedrock" ? choice : undefined;
  const fields = aws ? ["name", "provider", "region", "secret"] as const : ["name", "provider", "secret"] as const;
  const labels = { name: "Name", provider: "Provider", region: "AWS Region (default us-east-1)", secret: "API key (masked)" };
  const region = form.region || "us-east-1";
  const request = (): CredentialMutation | string => {
    if (!keyNameSchema.safeParse(form.name).success) return "Name uses letters, digits, - and _, up to 80 characters.";
    if (entries.some(entry => entry.name === form.name)) return `${form.name} already exists. Rotate it instead.`;
    if (aws && !awsRegionSchema.safeParse(region).success) return "Region must look like us-east-1.";
    const secret = secretSchema.safeParse(form.secret);
    if (!secret.success) return "Enter a single-line API key of at most 4096 characters.";
    return { action: "add", name: form.name, secret: secret.data, ...(aws ? { aws: { provider: aws, region } } : {}), ...(entryProvider ? { provider: entryProvider } : {}) };
  };
  const close = () => { if (form.name || form.region || form.secret) setDiscard(true); else onClose(); };
  const submit = async () => {
    const value = request();
    if (typeof value === "string") { setError(value); setStep("form"); return; }
    setStep("busy");
    try { await browser.mutateCredentials(value); onClose(form.name, `Added ${form.name}. It has no assignments yet; select it and press Enter to assign projects.`); }
    catch (cause) { if (alive.current) { setError(`Not added: ${failure(cause)}`); setStep("review"); } }
  };
  const count = fields.length + 2;
  const minHeight = fields.length * 2 + 5;
  const small = width < 45 || height < minHeight;
  useInput((input, key) => {
    if (discard || step !== "form") return;
    if (key.escape) { close(); return; }
    if (key.ctrl || key.meta || small) return;
    const field = fields[index];
    if (field === "provider" && (key.leftArrow || key.rightArrow || input === " ")) { setProvider(old => (old + (key.leftArrow ? providers.length - 1 : 1)) % providers.length); return; }
    if (index >= fields.length && (key.leftArrow || key.rightArrow)) { setIndex(fields.length + (key.rightArrow ? 1 : 0)); return; }
    if (key.tab || key.upArrow || key.downArrow) { setIndex(old => (old + (key.upArrow || key.shift ? count - 1 : 1)) % count); return; }
    if (key.return) {
      if (index === fields.length) close();
      else if (index === fields.length + 1) { const value = request(); if (typeof value === "string") setError(value); else { setError(undefined); setStep("review"); } }
      return;
    }
    if (!field || field === "provider") return;
    if (key.backspace || key.delete) setForm(old => ({ ...old, [field]: old[field].slice(0, -1) }));
    else if (input && !key.leftArrow && !key.rightArrow) setForm(old => ({ ...old, [field]: (old[field] + printable(input)).slice(0, field === "secret" ? 4096 : 80) }));
  });
  if (discard) return <Dialog width={width} height={height} lines={["Discard credential draft?", "The entered name and key are cleared."]} onCancel={() => setDiscard(false)}
    buttons={[{ label: "Keep editing", activate: () => setDiscard(false) }, { label: "Discard", activate: () => onClose() }]} />;
  if (step !== "form") {
    const host = aws && codexAwsHost({ provider: aws, region });
    return <Dialog inline key={step} error={step === "review" ? error : undefined} width={width} height={height} onCancel={() => step === "review" && setStep("form")} buttons={step === "busy" ? [] : [{ label: "Back", activate: () => setStep("form") }, { label: "Add credential", activate: () => void submit() }]} lines={step === "busy" ? [`Adding ${form.name} to ${target.name}…`, ...(host && target.credentials?.allowDomain ? [`Allowing ${host} first.`] : [])] : [
      `Add credential to ${target.name}`, `Name: ${form.name}`, `Provider: ${providers[provider].label}${aws ? ` · Region ${region}` : ""}${choice === "cursor" ? " · billed to its Cursor account" : " · API key"}`,
      `Runtimes: ${providers[provider].runtimes} · Key: entered, hidden`,
      ...(host ? [target.credentials?.allowDomain ? `Allows ${host} in this environment's firewall first.` : `If outbound access is restricted, allow ${host} on this host.`] : []),
      "No project uses it until you assign it.",
    ]} />;
  }
  if (small) return <Text color={palette.text}>Resize to 45×{minHeight}. Esc cancels.</Text>;
  // Every choice when they fit, else only the selected one, so none is cut off unseen.
  const choiceRow = providers.map((value, at) => `${at === provider ? "(●)" : "( )"} ${value.label}`).join("  ");
  const providerRow = choiceRow.length + 2 <= width ? choiceRow : `◂ (●) ${providers[provider].label} ▸  ${provider + 1} of ${providers.length}`;
  return <Box flexDirection="column" width={width} height={height}>
    <Text bold color={palette.text}>Add credential · {plain(target.name)}</Text>
    {fields.map((field, i) => <Box key={field} flexDirection="column">
      <Text color={index === i ? palette.accent : palette.text}>{labels[field]}</Text>
      <Text wrap="truncate" color={palette.text}>{index === i ? ">" : " "} {field === "provider" ? providerRow
        : <Text backgroundColor={index === i ? palette.idle : palette.surface}>[ {(field === "secret" ? masked(form.secret) : plain(form[field])) || " "}{index === i ? "▏" : ""} ]</Text>}</Text>
    </Box>)}
    <Box gap={2} marginTop={1}>{(["Cancel", "Review"] as const).map((label, i) => <Text key={label} bold color={index === fields.length + i ? palette.selectedText : palette.accent} backgroundColor={index === fields.length + i ? palette.selected : undefined}>{index === fields.length + i ? ">" : " "} [ {label} ]</Text>)}</Box>
    {error && <Text color={palette.warning}>{error}</Text>}
    <Text color={palette.muted}>Tab/↑/↓ focus · ←/→ choose · Enter activate · Esc close</Text>
  </Box>;
}
