import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser } from "../workflow.js";
import type { Row } from "../validators.js";
import { palette, plain } from "../formatters.js";
import { Logs } from "./workflow.js";
import { exportLogs } from "./export.js";
import { Dialog } from "../dialog/index.js";
import type { Key } from "ink";
import { displayLines } from "./formatters.js";

export function LogDetail({ browser, row, width, height, small = false }: { browser: Browser; row: Row; width: number; height: number; small?: boolean }) {
  const { exit } = useApp();
  const [logs] = useState(() => new Logs(args => browser.readLogs(row, args)));
  const state = useSyncExternalStore(logs.subscribe, logs.getSnapshot);
  const [offset, setOffset] = useState(0);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"view" | "path" | "checking" | "confirm" | "exporting" | "notice">("view");
  const [overwrite, setOverwrite] = useState(false);
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const exporting = useRef<AbortController | undefined>(undefined);
  const lines = useMemo(() => displayLines(state.events, Math.max(1, width)), [state.events, width]);
  const capacity = Math.max(1, height - 8);
  const start = state.following ? Math.max(0, lines.length - capacity) : Math.min(offset, Math.max(0, lines.length - capacity));
  useEffect(() => {
    active.current = true; logs.start();
    return () => { active.current = false; exporting.current?.abort(); logs.dispose(); };
  }, [logs]);
  const chooseDestination = async () => {
    if (!path.trim()) return;
    const destination = resolve(path);
    setMode("checking");
    try {
      let exists = false;
      try {
        const stat = await lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Choose a regular file destination.");
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!active.current) return;
      setNotice(""); setPath(destination); setOverwrite(exists);
      if (exists) setMode("confirm"); else await save(destination, false);
    } catch {
      if (active.current) { setNotice("Cannot use that destination. Choose a writable regular file path."); setMode("path"); }
    }
  };
  const save = async (destination = path, replace = overwrite) => {
    const abort = new AbortController(); exporting.current = abort;
    let partial: string | undefined;
    setMode("exporting"); setNotice("Exporting stored history as of export start…");
    try {
      const count = await exportLogs(args => browser.readLogs(row, args), destination, replace, abort.signal, value => { partial = value; });
      if (active.current) setNotice(`Exported ${count} events to ${destination}`);
    } catch {
      if (active.current) setNotice(`${abort.signal.aborted ? "Export cancelled" : "Export failed"}.${partial ? ` Partial file: ${partial}` : " No file created."} Close, then press e to retry.`);
    } finally {
      exporting.current = undefined;
      if (active.current) setMode("notice");
    }
  };
  const editPath = (input: string, key: Key) => {
    if (key.backspace || key.delete) { setNotice(""); setPath(value => [...value].slice(0, -1).join("")); }
    else if (input) {
      const pasted = input.replace(/[\t\r\n]+$/, "");
      if (/[\p{Cc}]/u.test(pasted)) setNotice("Path contains control characters. Paste a single file path.");
      else { setNotice(""); setPath(value => (value + pasted).slice(0, 4096)); }
    }
  };
  const cancel = () => {
    if (mode === "exporting") exporting.current?.abort();
    else if (mode !== "checking") setMode("view");
  };
  useInput((input, key) => {
    if (key.escape) {
      if (mode === "exporting") { exporting.current?.abort(); return; }
      if (mode === "checking") return;
      if (mode !== "view") { setMode("view"); return; }
      browser.logs(); return;
    }
    if (key.ctrl || key.meta) return;
    if (input === "q" && mode === "view") { browser.dispose(); exit(); return; }
    if (mode !== "view") return;
    if (input === "e") { logs.pause(); setNotice(""); setMode("path"); setPath(path || `convoy-${row.run!.messageId}.jsonl`); return; }
    if (input === "f" || key.end) { logs.latest(); return; }
    if (input === " ") { if (state.following) { setOffset(start); logs.pause(); } else logs.latest(); return; }
    if (input === "p") { logs.older(); setOffset(0); return; }
    if (input === "n") { logs.newer(); setOffset(Math.max(0, lines.length - capacity)); return; }
    if (input === "r") { logs.retry(); return; }
    const delta = key.pageUp ? -capacity : key.pageDown ? capacity : key.upArrow || input === "k" ? -1 : key.downArrow || input === "j" ? 1 : 0;
    if (delta) { logs.pause(); setOffset(Math.max(0, Math.min(lines.length - capacity, start + delta))); }
  });
  const prompt = mode !== "view" && <Dialog inline={mode === "notice" || mode === "exporting" || mode === "checking"} key={mode} width={width} height={height} onCancel={cancel}
      scrollable={mode === "notice" || mode === "exporting"}
      lines={mode === "path" ? ["Export stored run", "", `Export path: ${path}`, notice || "Type path · Tab selects buttons · Enter continues"]
        : mode === "confirm" ? [`${overwrite ? "Overwrite" : "Create"} ${path}?`, "", "Tab / arrows select · Enter activate"]
        : [mode === "checking" ? "Checking destination…" : notice, "", "↑/↓ PgUp/PgDn scroll"]}
      onText={mode === "path" ? editPath : undefined} onSubmit={chooseDestination}
      buttons={mode === "checking" ? [] : mode === "notice" ? [{ label: "Close", activate: cancel }]
        : [{ label: "Cancel", activate: cancel }, ...(mode === "path" ? [{ label: "Continue", activate: () => { void chooseDestination(); } }]
          : mode === "confirm" ? [{ label: overwrite ? "Overwrite" : "Create", activate: () => { void save(); } }] : [])]} />;
  if (small) return <Box flexDirection="column"><Text>Resize to 45×10 to browse.</Text><Text>Esc back · q / Ctrl+C detach</Text></Box>;
  if (["notice", "exporting", "checking"].includes(mode)) return <Box flexDirection="column" width={width} height={height}><Text bold color={palette.text}>Export · {plain(row.run?.runId ?? row.run?.messageId)}</Text>{prompt}</Box>;
  return <Box flexDirection="column" width={width} height={height}>
    <Text bold wrap="truncate" color={palette.text}>Raw JSON · {plain(row.thread.title)} · {plain(row.run?.runId ?? row.run?.messageId)}</Text>
    <Text color={palette.muted} wrap="truncate">{state.following ? "Following" : "Paused"} · {state.events.length} events / {state.bytes} bytes · {state.latest > state.seen ? "unread events" : "caught up"} {state.loading ? "· reading" : ""}</Text>
    <Box height={capacity} flexShrink={0} flexDirection="column" overflow="hidden">
      {lines.length ? lines.slice(start, start + capacity).map((line, i) => <Text key={i} wrap="truncate" color={palette.text}>{line || " "}</Text>) : <Text color={palette.text}>{state.loading ? "Loading stored events…" : "No stored events available. Live deltas are not retained history."}</Text>}
    </Box>
    <Text color={palette.warning} wrap="truncate">{state.error ?? "Stored payloads; original completeness unknown. Ingestion may have shortened historical data."}</Text>
    <Text wrap="truncate" color={palette.muted}>{`Events ${state.events[0]?.order ?? "–"}…${state.events.at(-1)?.order ?? "–"} · native terminal selection/copy`}</Text>
    <Text color={palette.muted} wrap="truncate">↑/↓ scroll · PgUp/PgDn · p older · n newer · Space pause · f latest</Text>
    <Text color={palette.muted} wrap="truncate">[e] Export entire stored run · r retry · Esc {mode === "exporting" ? "cancel export" : "back"} · q detach</Text>
    {prompt}
  </Box>;
}
