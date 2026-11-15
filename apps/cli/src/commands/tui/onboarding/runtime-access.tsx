import type { ProjectAccounts } from "../../project/validators.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Browser } from "../workflow.js";
import { Box, Text, useInput } from "ink";
import { ActionDialog } from "../actions/index.js";
import { palette, plain, wrapLines } from "../formatters.js";
import { MANAGED_RUNTIME_LABELS, type ManagedCredentialStatus } from "../../../lib/config/credentials/validators.js";
import type { WorkerState } from "../../service/validators.js";
import { runtimeAccessChoices } from "./workflow.js";

import type { AccessRuntime as Runtime, AccessState } from "./validators.js";
import { bindingRows, sameBinding } from "../credentials/index.js";

export function RuntimeAccess({ browser, profile, width, height, onDone }: {
  browser: Browser; profile: string; width: number; height: number; onDone(): void;
}) {
  const existing = browser.onboardingSession?.origin === "actions";
  const exitLabel = existing ? "Back" : "Skip";
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot);
  const target = browser.targets[state.scope.connection];
  const [loadedProject, setProject] = useState<WorkerState>();
  const project = state.observations[state.scope.connection].profiles.find(worker => worker.profile === profile
    && (!loadedProject?.identity || worker.identity === loadedProject.identity)) ?? loadedProject;
  const [status, setStatus] = useState<ManagedCredentialStatus>();
  const access = useRef<AccessState>(browser.onboardingSession?.access ?? { draft: {}, saved: {}, reloadPending: false }).current;
  const { draft, saved } = access;
  const native = { mode: "native" } as const;
  const value = (runtime: Runtime) => draft[runtime] ?? saved[runtime] ?? native;
  const label = (runtime: Runtime) => { const binding = value(runtime); return binding.mode === "managed" ? binding.name : binding.mode === "disabled" ? "Disabled" : "Native account"; };
  const [accounts, setAccounts] = useState<ProjectAccounts>();
  const [checking, setChecking] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const hasAction = Boolean(state.action);
  useEffect(() => {
    if (!project || hasAction) return;
    let current = true;
    setAccounts(undefined);
    if (!target.account || !project.identity) { setChecking(false); return; }
    setChecking(true);
    void target.account(profile, project.identity).then(result => { if (current) setAccounts(result); })
      .catch(() => {}).finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [target, profile, project?.identity, hasAction, refresh]);
  const accountLabel = (runtime: Runtime) => {
    if (checking) return "Checking account…";
    const account = accounts?.[runtime];
    if (account?.status === "signed-out") return "Not signed in";
    if (account?.status !== "signed-in") return "Couldn't check account";
    return account.account ? `Signed in as ${plain(account.account)}` : account.method ? `Signed in with ${account.method}` : "Signed in";
  };
  const [choosing, setChoosing] = useState<Runtime>();
  const [busy, setBusy] = useState<"loading" | "saving" | undefined>("loading");
  const [error, setError] = useState<string>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async () => {
    setBusy("loading"); setError(undefined);
    try {
      const [worker, credentials] = await Promise.all([browser.prepareOnboardingAccess(profile), target.credentials!.status()]);
      if (alive.current) {
        for (const row of bindingRows(credentials, [worker], ["codex", "claude-code"])) {
          if (row.runtime === "cursor") continue;
          const runtime = row.runtime;
          if (draft[runtime] && sameBinding(draft[runtime], row.saved)) delete draft[runtime];
          saved[runtime] = row.saved;
          if (row.project?.pending) access.reloadPending = true;
        }
        setProject(worker); setStatus(credentials);
      }
    } catch (cause) { if (alive.current) setError(plain(cause instanceof Error ? cause.message : "Cannot read runtime access.")); }
    finally { if (alive.current) setBusy(undefined); }
  };
  useEffect(() => { void load(); }, []);
  const runtimes = (project?.runtimes ?? []).filter((runtime): runtime is Runtime => runtime === "codex" || runtime === "claude-code");
  const save = async () => {
    setBusy("saving"); setError(undefined);
    try {
      for (const runtime of runtimes) {
        if (sameBinding(value(runtime), saved[runtime] ?? native)) continue;
        await browser.mutateCredentials({ action: "bind", profile, ...(runtime === "codex" ? {} : { runtime }),
          binding: value(runtime) });
        saved[runtime] = value(runtime);
        delete draft[runtime];
        access.reloadPending = true;
      }
      await browser.reloadProjects([profile]);
      access.reloadPending = false;
      if (alive.current) onDone();
    } catch (cause) { if (alive.current) setError(plain(cause instanceof Error ? cause.message : "Cannot save runtime access.")); }
    finally { if (alive.current) setBusy(undefined); }
  };
  const action = state.action;
  // The host renders the existing login confirmation and result while retaining this draft.
  if (action) return <ActionDialog inline state={state} browser={browser} width={width} height={height} />;
  if (choosing) {
    const runtime = choosing;
    return <AccessMenu key="choices" width={width} height={height} onCancel={() => setChoosing(undefined)}
      lines={[`${MANAGED_RUNTIME_LABELS[runtime]} access`, "Choose an enabled credential or keep this project's native login."]}
      buttons={[{ label: "Back", activate: () => setChoosing(undefined) },
        ...[{ name: undefined, label: "Native login" }, ...runtimeAccessChoices(runtime, status?.entries ?? []).map(entry => ({ name: entry.name, label: entry.name }))]
          .map(choice => ({ label: choice.label, activate: () => { draft[runtime] = choice.name ? { mode: "managed", name: choice.name } : native; setChoosing(undefined); } }))]} />;
  }
  const compatible = status?.service && status.compatible && !status.configurationError;
  const changed = access.reloadPending || runtimes.some(runtime => !sameBinding(value(runtime), saved[runtime] ?? native));
  const unknownAccount = !checking && runtimes.some(runtime => value(runtime).mode === "native" && (!accounts?.[runtime] || accounts[runtime].status === "unknown"));
  return <AccessMenu width={width} height={height} error={error} impact={changed ? "Save reloads this project and stops its active work." : undefined} onCancel={() => { if (busy !== "saving") onDone(); }}
    lines={[`Runtime access · ${plain(target.name)} / ${plain(profile)}`,
      ...(busy ? ["Loading or saving runtime access…"] : [
        ...(existing ? [] : ["Registration is complete."]),
        ...runtimes.flatMap(runtime => [
          "",
          { text: MANAGED_RUNTIME_LABELS[runtime], heading: true },
          { text: `  Authentication: ${label(runtime)}`, color: palette.muted },
          ...(value(runtime).mode === "native" ? [{ text: `  Account: ${accountLabel(runtime)}`,
            color: checking ? palette.muted : accounts?.[runtime]?.status === "signed-in" ? palette.success : palette.warning }] : []),
        ]),
        "",
        ...(unknownAccount ? [{ text: target.mode === "shared" ? "Refresh or update Codex and Claude Code to check accounts." : "Refresh or update the environment CLI and launcher to check accounts.", color: palette.warning }] : []),
        ...(!project ? ["Runtime detection is unavailable. Retry or use project Actions later."] : project.runtimes === undefined ? [!project.warning && ["connecting", "retrying"].includes(project.status)
          ? `Waiting for the project to detect runtimes. Choices appear automatically; you can ${existing ? "go back" : "Skip"}.`
          : "Runtimes are unknown. Reload the project from Actions to detect them."] : !runtimes.length ? ["No supported login runtimes detected."] : []),
        ...(!compatible && status ? ["Managed assignment unavailable. Start or update the service for credentials-v1 support, or fix its credential configuration."] : []),
      ])]}
    buttons={busy ? busy === "loading" ? [{ label: exitLabel, activate: onDone }] : [] : [
      { label: exitLabel, activate: onDone },
      ...runtimes.flatMap(runtime => [
        ...(compatible && (runtimeAccessChoices(runtime, status?.entries ?? []).length > 0 || value(runtime).mode !== "native") ? [{ label: `${MANAGED_RUNTIME_LABELS[runtime]} authentication: ${label(runtime)}`, activate: () => setChoosing(runtime) }] : []),
        ...(value(runtime).mode === "native" && (saved[runtime] ?? native).mode === "native" && !access.reloadPending && target.shell ? [{ label: `${accounts?.[runtime]?.status === "signed-in" ? "Sign in again to" : "Sign in to"} ${MANAGED_RUNTIME_LABELS[runtime]}`, activate: () => browser.beginAction(runtime === "codex" ? "login-codex" : "login-claude-code") }] : []),
      ]),
      ...(compatible && changed ? [{ label: "Save and reload", activate: () => void save() }] : []),
      { label: "Refresh", activate: () => { setRefresh(value => value + 1); void load(); } },
    ]} />;
}

type AccessLine = { text: string; heading?: boolean; color?: string };

function AccessMenu({ lines, error, impact, width, height, buttons, onCancel }: {
  lines: (string | AccessLine)[]; error?: string; impact?: string; width: number; height: number;
  buttons: { label: string; activate(): void }[]; onCancel(): void;
}) {
  const [focus, setFocus] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [error]);
  const details = lines.map(line => typeof line === "string" ? { text: line } : line);
  const title = wrapLines(plain(details[0].text), Math.max(1, width));
  const impactLines = impact ? wrapLines(impact, Math.max(1, width)) : [];
  const text = [...(error ? [{ text: "Attention", heading: true, color: palette.warning }, { text: error, color: palette.warning }, { text: "" }] : []), ...details.slice(1)]
    .flatMap(line => line.text ? wrapLines(plain(line.text), Math.max(1, width)).map(text => ({ ...line, text })) : [line]);
  const available = height - title.length - impactLines.length - 3;
  const small = width < 40 || available < 5;
  const textCapacity = Math.max(1, Math.min(text.length, available - Math.min(buttons.length, Math.max(3, Math.floor(available / 3)))));
  const capacity = Math.max(1, available - textCapacity);
  const start = Math.min(offset, Math.max(0, text.length - textCapacity));
  const selected = Math.min(focus, Math.max(0, buttons.length - 1));
  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (small || key.ctrl || key.meta) return;
    if (key.pageDown || key.pageUp) { setOffset(Math.max(0, Math.min(text.length - textCapacity, start + (key.pageDown ? textCapacity : -textCapacity)))); return; }
    if (!buttons.length) return;
    if (key.tab || key.downArrow || key.upArrow) setFocus((selected + (key.shift || key.upArrow ? buttons.length - 1 : 1)) % buttons.length);
    if (key.return || input === " ") buttons[selected]?.activate();
  });
  if (small) return <Text>Resize to read the target and impact. Esc goes back.</Text>;
  const first = Math.max(0, selected - capacity + 1);
  return <Box width={width} height={height} flexDirection="column">
    {title.map((line, i) => <Text key={i} bold>{line}</Text>)}
    {impactLines.map((line, i) => <Text key={i} color={palette.warning}>{line}</Text>)}
    {text.slice(start, start + textCapacity).map((line, i) => <Text key={i} bold={line.heading} color={line.color ?? palette.text}>{line.text || " "}</Text>)}
    <Box marginTop={1}><Text bold color={palette.muted}>{text.length > textCapacity ? `Actions · PgUp/PgDn details ${start + 1}-${Math.min(start + textCapacity, text.length)}/${text.length}` : "Actions"}</Text></Box>
    <Box flexDirection="column">
      {buttons.slice(first, first + capacity).map((button, i) => <Text key={button.label} wrap="truncate" color={first + i === selected ? palette.accent : palette.text}>{first + i === selected ? "> " : "  "}{plain(button.label)}</Text>)}
    </Box>
    <Text color={palette.muted}>Tab/↑/↓ focus · Enter choose · Esc back</Text>
  </Box>;
}
