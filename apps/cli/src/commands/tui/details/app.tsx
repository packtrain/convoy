import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Browser } from "../workflow.js";
import type { BrowseState } from "../validators.js";
import { Clickable } from "../dialog/index.js";
import { useWheel } from "../mouse.js";
import { palette, wrapLines, type DetailLine, type DetailRow } from "../formatters.js";
import { loginAction } from "../actions/validators.js";
import { ACTION_KEYS, ACTION_LABELS, hintLines, rowActions, type RuntimeAction } from "./workflow.js";

/** Environment Details: its lines, with runtime rows to select and the selected row's actions below it. Spec: docs/specs/cli-tui.md#runtimes-in-details-cli-01690-os-2502 */
export function Details({ browser, state, lines, focused, locked, width, height, onContent, onCredentials }: {
  browser: Browser; state: BrowseState; lines: DetailLine[]; focused: boolean; locked: boolean; width: number; height: number; onContent(): void; onCredentials(): void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [offset, setOffset] = useState(0);
  const rows = lines.flatMap(line => line.row ? [line.row] : []);
  const selected = rows.find(row => row.id === selectedId) ?? rows[0];
  const { actions, notes } = selected ? rowActions(selected, browser.targets[state.scope.connection]) : { actions: [], notes: [] };
  const indent = selected?.profile === undefined ? 4 : 6;
  const hints = hintLines<{ text: string; action?: RuntimeAction }>([...actions.map(action => ({ text: `[${ACTION_KEYS[action]}] ${ACTION_LABELS[action]}`, action })),
    ...notes.flatMap(note => wrapLines(note, width - indent).map(text => ({ text })))], width - indent);
  const items: (DetailLine | number)[] = lines.flatMap(line => line.row && line.row === selected ? [line, ...hints.map((_, index) => index)] : [line]);
  const max = Math.max(0, items.length - height);
  const start = Math.min(offset, max);
  // An updater, so several wheel reports in one stdin chunk each move a line.
  const scroll = (delta: number) => setOffset(old => Math.max(0, Math.min(max, Math.min(old, max) + delta)));
  useWheel(locked ? undefined : scroll);
  // Keeps the row and its action lines below it in view; their count here is the old row's, close enough for one step.
  const select = (row: DetailRow) => {
    const at = lines.findIndex(line => line.row === row);
    setSelectedId(row.id);
    setOffset(Math.max(0, Math.min(Math.max(start, at + 1 + hints.length - height), at)));
  };
  const run = (action: RuntimeAction) => {
    if (!selected || locked) return;
    onContent();
    const { connection } = state.scope, { profile, runtime } = selected;
    if (action === "update") { browser.showRuntimes(true); return; }
    // A project's actions run in its own view, as from its Actions.
    if (profile !== undefined) { browser.select({ connection, profile, details: false }); browser.showActions(true); }
    if (action === "signin") browser.beginAction(loginAction(runtime)!);
    else browser.showCredentials(true, { runtime, unassign: action === "unassign" });
  };
  useInput((input, key) => {
    if (!focused || locked || key.ctrl || key.meta) return;
    const delta = key.upArrow || input === "k" ? -1 : key.downArrow || input === "j" ? 1 : 0;
    if (delta) {
      const next = selected && rows[rows.indexOf(selected) + delta];
      if (next) select(next); else scroll(delta);
      return;
    }
    if (key.pageDown || key.pageUp) { scroll(key.pageDown ? height : -height); return; }
    const action = actions.find(value => ACTION_KEYS[value] === input);
    if (action) run(action);
    else if (input === "c") onCredentials();
  });
  return <>{items.slice(start, start + height).map((line, index) => {
    if (typeof line === "number") return <Box key={`hint:${line}`} height={1} gap={3} paddingLeft={indent}>
      {hints[line].map(({ text, action }) => action
        ? <Clickable key={text} flexShrink={0} onClick={() => run(action)}><Text color={palette.muted}><Text color={palette.accent}>[{ACTION_KEYS[action]}]</Text> {ACTION_LABELS[action]}</Text></Clickable>
        : <Text key={text} wrap="truncate" color={palette.muted}>{text}</Text>)}
    </Box>;
    const { row } = line;
    if (row) {
      const chosen = row === selected;
      return <Clickable key={row.id} onClick={() => { if (locked) return; onContent(); select(row); }} backgroundColor={chosen ? focused ? palette.selected : palette.idle : undefined}>
        <Text wrap="truncate" color={chosen ? focused ? palette.selectedText : palette.idleText : palette.text}>{line.text}</Text></Clickable>;
    }
    const [, label = "", value = line.text] = /^(\s*[^:]{1,40}:)( .*)$/.exec(line.text) ?? [];
    return <Text key={start + index} wrap="truncate" color={palette.text}><Text color={palette.muted}>{label}</Text>{value}</Text>;
  })}</>;
}
