import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Browser } from "../workflow.js";
import type { BrowseState } from "../validators.js";
import { Dialog, Spinner } from "../dialog/index.js";
import { palette, plain } from "../formatters.js";
import type { RuntimeVersion } from "../../environment/validators.js";
import type { LoginRuntime } from "../../project/validators.js";
import { IMPACT, STATUS, actionable, plural, versions } from "./formatters.js";

type Step = { row: RuntimeVersion; mark: "·" | "●" | "✓" | "✗"; detail?: string };
const failure = (error: unknown) => plain(error instanceof Error ? error.message : "Operation failed.");

/** Environment Runtimes row: check runtimes, then install them as one batch. Spec: docs/specs/cli-tui.md#agent-runtimes-cli-01240-os-2236 */
export function Runtimes({ browser, state, active, onSidebar, width, height }: { browser: Browser; state: BrowseState; active: boolean; onSidebar(): void; width: number; height: number }) {
  const target = browser.targets[state.scope.connection];
  const maintenance = target.maintenance!;
  const [rows, setRows] = useState<RuntimeVersion[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<LoginRuntime>>(new Set());
  const [focus, setFocus] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [popup, setPopup] = useState<"confirm" | "busy" | "result">();
  const [steps, setSteps] = useState<Step[]>([]);
  const [output, setOutput] = useState<string[]>([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { browser.editRuntimes(Boolean(popup)); }, [popup]);
  const chosen = rows.filter(row => checked.has(row.runtime) && actionable(row));
  const load = async () => {
    setLoading(true);
    try {
      const value = await maintenance.runtimes!();
      if (!alive.current) return;
      setRows(value); setError(undefined);
      setChecked(old => new Set([...old].filter(runtime => value.some(row => row.runtime === runtime && actionable(row)))));
    } catch (cause) { if (alive.current) setError(`Cannot read runtime versions: ${failure(cause)}`); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, []); // Explicit reads only: open, f/Refresh and after a batch.
  const progress = (text: string) => {
    if (alive.current) setOutput(old => [...old, ...plain(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.slice(0, 200))].slice(-8));
  };
  const install = async () => {
    const batch: Step[] = chosen.map(row => ({ row, mark: "·" }));
    setSteps(batch); setOutput([]); setPopup("busy"); browser.environmentBusy = true;
    try {
      for (const step of batch) {
        step.mark = "●"; setSteps([...batch]);
        try { step.detail = await maintenance.installRuntime!(step.row.runtime, step.row.offered!, progress); step.mark = "✓"; }
        catch (cause) { step.detail = failure(cause); step.mark = "✗"; }
        if (alive.current) setSteps([...batch]);
      }
    } finally { browser.environmentBusy = false; }
    if (!alive.current) return;
    setChecked(new Set(batch.filter(step => step.mark === "✗").map(step => step.row.runtime)));
    setPopup("result");
  };
  const toggle = (row?: RuntimeVersion) => {
    if (!row) return;
    if (!actionable(row)) { setNotice(`${row.label}: ${row.error ?? STATUS[row.state].text}. Nothing to install.`); return; }
    setNotice(undefined);
    setChecked(old => { const next = new Set(old); if (next.has(row.runtime)) next.delete(row.runtime); else next.add(row.runtime); return next; });
  };
  const count = rows.length + 2;
  const activate = () => {
    if (focus < rows.length) { toggle(rows[focus]); return; }
    if (focus === rows.length + 1) { void load(); return; }
    if (!chosen.length) setNotice("Check at least one runtime to install or update.");
    else { setNotice(undefined); setPopup("confirm"); }
  };
  useInput((input, key) => {
    if (popup || !active || key.ctrl || key.meta || key.escape) return;
    if (input === "f") { void load(); return; }
    // Tab switches panes in the App, so ↑/↓ also reach the buttons; ←/→ move along the button row.
    if (key.leftArrow) { if (focus > rows.length) setFocus(focus - 1); else if (focus < rows.length) onSidebar(); return; }
    if (key.rightArrow) { if (focus >= rows.length) setFocus(Math.min(count - 1, focus + 1)); return; }
    if (key.upArrow || input === "k") { setFocus(old => Math.max(0, old - 1)); return; }
    if (key.downArrow || input === "j") { setFocus(old => Math.min(count - 1, old + 1)); return; }
    if (input === " " && focus < rows.length) { toggle(rows[focus]); return; }
    if (key.return) activate();
  });
  const close = () => { setPopup(undefined); setSteps([]); void load(); };
  if (popup === "confirm") return <Dialog width={width} height={height} onCancel={() => setPopup(undefined)}
    lines={[`Install or update ${plural(chosen.length)}`, `Environment: ${plain(target.name)}`, ...chosen.map(row => `${row.label} ${row.installed ?? "not installed"} → ${row.offered}`), "", ...IMPACT, "Cancel leaves the environment unchanged."]}
    buttons={[{ label: "Cancel", activate: () => setPopup(undefined) }, { label: `Install ${plural(chosen.length)}`, activate: () => { void install(); } }]} />;
  if (popup) {
    const failed = steps.filter(step => step.mark === "✗").length;
    const done = popup === "result";
    return <Dialog key={popup} scrollable width={width} height={height} onCancel={() => { if (done) close(); }}
      error={done && failed ? `${failed} of ${plural(steps.length)} failed` : undefined}
      lines={[
        done ? failed ? "Fix the cause, then install the checked runtimes again." : `${plural(steps.length)} installed.` : `Installing ${plural(steps.length)} in ${plain(target.name)}…`,
        ...steps.map(({ row, mark, detail }) => mark === "✗" ? `✗ ${row.label}: ${detail}` : mark === "✓" ? `✓ ${row.label} ${detail}` : mark === "●" ? `● ${row.label} installing ${row.offered}…` : `· ${row.label} waiting`),
        ...(done && failed < steps.length ? ["", IMPACT[2]] : []),
        ...(output.length ? ["", "Installer output:", ...output] : []),
        ...(done ? [] : ["", "Detaching does not stop an install already running in the container."]),
      ]}
      buttons={done ? [{ label: "Close", activate: close }] : []} />;
  }
  const label = Math.max(...rows.map(row => row.label.length), 7) + 2;
  return <Box flexDirection="column" width={width} height={height}>
    <Text color={palette.muted} wrap="truncate">Space checks a runtime · ↓ then ←/→ for buttons · f refreshes · Esc back to Actions</Text>
    {error && <Text color={palette.danger} wrap="wrap">✗ {error} Press f to retry.</Text>}
    {loading && <Box flexDirection="column" marginTop={1}>
      <Text bold color={palette.accent}><Spinner color={palette.accent} /> {rows.length ? "Refreshing runtime versions…" : `Checking installed runtimes in ${plain(target.name)}…`}</Text>
      {!rows.length && <Text color={palette.muted}>  Reads each runtime's version in the container and the latest npm release.</Text>}
    </Box>}
    <Box flexDirection="column" marginTop={1}>
      {rows.map((row, index) => {
        const selected = active && focus === index;
        const status = STATUS[row.state];
        // The row Box carries the selection background: nested Text inherits a Box background, not its parent Text's.
        return <Box key={row.runtime} backgroundColor={selected ? palette.selected : undefined}><Text wrap="truncate" color={selected ? palette.selectedText : palette.text}>
          {selected ? "›" : " "} {actionable(row) ? checked.has(row.runtime) ? "[x]" : "[ ]" : "   "} {row.label.padEnd(label)}
          <Text color={selected ? palette.selectedText : palette[status.tone]}>{status.text.padEnd(22)}</Text>{versions(row)}{row.error ? ` · ${plain(row.error)}` : ""}
        </Text></Box>;
      })}
    </Box>
    <Box marginTop={1} gap={2}>
      {[`Install / update${chosen.length ? ` ${chosen.length}` : ""}`, "Refresh"].map((text, i) => {
        const selected = active && focus === rows.length + i;
        return <Text key={text} bold color={selected ? palette.selectedText : palette.accent} backgroundColor={selected ? palette.selected : undefined}>{selected ? ">" : " "} [ {text} ]</Text>;
      })}
    </Box>
    {notice && <Text color={palette.warning} wrap="wrap">{notice}</Text>}
  </Box>;
}
