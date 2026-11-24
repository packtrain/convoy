"use client";

import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { CURRENT_FRAMES } from "./current";
import {
  box,
  cols,
  fit,
  hjoin,
  type Line,
  mark,
  overlay,
  act,
  seg,
  spread,
  type Tone,
  wrap,
} from "./terminal";

const SIZES = { wide: { w: 110, h: 34, side: 28 }, narrow: { w: 80, h: 24, side: 24 } } as const;
type Size = keyof typeof SIZES;
const SPIN = "⣾⣽⣻⢿⡿⣟⣯⣷";

const ENVS = [
  { id: "local-test", kind: "docker", on: true, projects: ["os", "landing"] },
  { id: "build-box", kind: "ssh", on: false, projects: ["api"] },
];
const ENV_TABS = ["Overview", "Actions", "Credentials"];
const PROJECT_TABS = ["Runs", "Actions"];

type Row =
  | { kind: "env"; env: string }
  | { kind: "project"; env: string; project: string }
  | { kind: "add-project"; env: string }
  | { kind: "add-env" };

interface Item {
  group: string;
  key: string;
  label: string;
  reason?: string;
  desc: string;
  tone?: Tone;
}

const ENV_ACTIONS: Item[] = [
  { group: "SERVICE", key: "l", label: "Saved service logs", desc: "Opens the service's JSON log in this pane. No confirmation." },
  { group: "SERVICE", key: "b", label: "Start service", reason: "already running", desc: "Starts the service; registered projects resume." },
  { group: "SERVICE", key: "x", label: "Stop service", desc: "Stops every project connection and active run on this service. The container and files stay." },
  { group: "SERVICE", key: "t", label: "Restart service", desc: "Interrupts all projects, restarts the service and reconnects." },
  { group: "MAINTENANCE", key: "u", label: "Update CLI", desc: "Prepares an update, shows installed → proposed version, then asks once." },
  { group: "MAINTENANCE", key: "r", label: "Agent runtimes", desc: "Install or update Codex, Claude Code and Cursor in this environment." },
  { group: "CONTAINER", key: "g", label: "Start or recover environment", desc: "Starts or rebuilds the container, then starts the service." },
  { group: "CONTAINER", key: "z", label: "Stop environment", desc: "Stops the container and all its projects. Volumes stay." },
  { group: "CONTAINER", key: "D", label: "Delete environment", tone: "bad", desc: "Removes the container and all saved data permanently." },
];

const PROJECT_ACTIONS: Item[] = [
  { group: "PROJECT", key: "p", label: "Pause project", desc: "Stops new runs for this project. Active runs finish." },
  { group: "PROJECT", key: "u", label: "Reload project", desc: "Interrupts active runs and re-reads the project configuration." },
  { group: "PROJECT", key: "h", label: "Private project shell", desc: "Pauses the project and opens a shell in it. Reload when you return." },
  { group: "PROJECT", key: "e", label: "Check project", reason: "needs service 0.170", desc: "Runs the project's health checks." },
  { group: "PROJECT", key: "v", label: "Remove from environment", tone: "bad", desc: "Removes this registration. Private files stay; the remote project is not deleted." },
  { group: "CREDENTIALS", key: "t", label: "Runtime access", reason: "no credential store", desc: "Choose which runtimes this project may use." },
  { group: "CREDENTIALS", key: "c", label: "Assign credentials", reason: "no credential store", desc: "Pick the named credential each runtime uses here." },
];

const RUNTIMES = [
  { name: "Codex", version: "0.171.0", login: "signed out", tone: "warn" as Tone, glyph: "!" },
  { name: "Claude Code", version: "2.1.330", login: "signed out", tone: "warn" as Tone, glyph: "!" },
  { name: "Cursor", version: "2026.10.22-27dcf5f", login: "unknown", tone: "muted" as Tone, glyph: "?" },
];

const RUNS = [
  { thread: "os1", state: "running", tone: "run" as Tone, glyph: "", task: "OS-2481", title: "Fix the flaky login test in CI", runtime: "codex", updated: "22s", last: "streaming reply…" },
  { thread: "os2", state: "needs input", tone: "warn" as Tone, glyph: "?", task: "OS-2477", title: "Review PR #812: billing webhooks", runtime: "claude", updated: "5m", last: "waiting for your answer in the thread" },
  { thread: "os3", state: "done", tone: "ok" as Tone, glyph: "✓", task: "—", title: "sup?", runtime: "codex", updated: "1h", last: "finished · reply posted" },
  { thread: "os4", state: "failed", tone: "bad" as Tone, glyph: "✗", task: "—", title: "Investigate memory growth in the worker", runtime: "codex", updated: "1d", last: "exited 137 · out of memory" },
  { thread: "os5", state: "queued", tone: "muted" as Tone, glyph: "·", task: "—", title: "Queued follow-up", runtime: "codex", updated: "2h", last: "queued behind os1" },
];

const TONES: Record<Tone, string> = {
  text: "#d4d7d9",
  muted: "#939ba1",
  accent: "#9cc9db",
  head: "#d4d7d9",
  run: "#91c7dc",
  warn: "#e4c27a",
  ok: "#9ccaa6",
  bad: "#f09d9d",
  tab: "#151719",
};

interface View {
  tabs?: string[];
  title: Line;
  body: Line[];
  cursorLine?: number;
  count: number;
  hints: [string, string][];
  enter: (i: number) => void;
  keys: Record<string, (i: number) => void>;
  detail?: { title: Line; body: Line[] };
}

interface Command {
  label: string;
  scope: string;
  key?: string;
  run: () => void;
}

function rowsFor(open: Record<string, boolean>): Row[] {
  const rows: Row[] = [];
  for (const e of ENVS) {
    rows.push({ kind: "env", env: e.id });
    if (!open[e.id]) continue;
    for (const p of e.projects) rows.push({ kind: "project", env: e.id, project: p });
    rows.push({ kind: "add-project", env: e.id });
  }
  rows.push({ kind: "add-env" });
  return rows;
}

const envOf = (id: string) => ENVS.find((e) => e.id === id) ?? ENVS[0];
const hint = (pairs: [string, string][]): Line =>
  pairs.flatMap(([k, label], i) => [seg(i ? "  " : ""), seg(k, "accent"), seg(` ${label}`, "muted")]);

export default function TuiLayoutPlayground() {
  const [size, setSize] = useState<Size>("wide");
  const [mode, setMode] = useState<"proposed" | "current">("proposed");
  const [open, setOpen] = useState<Record<string, boolean>>({ "local-test": true });
  const [rowIndex, setRowIndex] = useState(1);
  const [focus, setFocus] = useState<"side" | "main">("side");
  const [envTab, setEnvTab] = useState(0);
  const [projectTab, setProjectTab] = useState(0);
  const [cursors, setCursors] = useState<Record<string, number>>({});
  const [detailOpen, setDetailOpen] = useState(false);
  const [layer, setLayer] = useState<null | "help" | "palette">(null);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState(0);
  const [flash, setFlash] = useState("");
  const [tick, setTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, []);
  useEffect(() => ref.current?.focus(), []);

  const { w: W, h: H, side: SIDE } = SIZES[size];
  const rows = rowsFor(open);
  const row = rows[Math.min(rowIndex, rows.length - 1)];
  const spin = SPIN[tick % SPIN.length];
  const say = (text: string) => setFlash(text);

  const viewKey =
    row.kind === "env" ? `${row.env}:${envTab}` : row.kind === "project" ? `${row.project}:${projectTab}` : row.kind;
  const cursor = cursors[viewKey] ?? 0;
  const setCursor = (key: string, i: number) => setCursors((c) => ({ ...c, [key]: i }));

  const goto = (target: Row, tab: number, item: number) => {
    const nextOpen = target.kind === "add-env" ? open : { ...open, [target.env]: true };
    setOpen(nextOpen);
    const next = rowsFor(nextOpen).findIndex((r) => JSON.stringify(r) === JSON.stringify(target));
    setRowIndex(next);
    if (target.kind === "env") setEnvTab(tab);
    if (target.kind === "project") setProjectTab(tab);
    const key = target.kind === "env" ? `${target.env}:${tab}` : target.kind === "project" ? `${target.project}:${tab}` : target.kind;
    setCursor(key, item);
    setFocus("main");
    setDetailOpen(false);
  };

  // ---------- main pane views ----------
  const mainW = W - SIDE;
  const inner = mainW - 4;

  function actionsView(items: Item[], title: Line, tabs: string[]): View {
    const body: Line[] = [];
    let cursorLine = 0;
    items.forEach((it, i) => {
      if (i === 0 || items[i - 1].group !== it.group) {
        if (i) body.push([]);
        body.push([seg(it.group, "head")]);
      }
      if (i === cursor) cursorLine = body.length;
      const sel = focus === "main" && i === cursor ? "on" : i === cursor ? "dim" : undefined;
      const label: Line = [
        seg(i === cursor ? "› " : "  ", "accent"),
        seg(it.key, it.reason ? "muted" : "accent"),
        seg("  "),
        seg(it.label, it.reason ? "muted" : (it.tone ?? "text")),
      ];
      body.push(act(mark(spread(label, it.reason ? [seg(it.reason, "muted")] : [], inner), sel), `item:${i}`));
    });
    const current = items[cursor];
    body.push([], [seg("─".repeat(inner), "muted")]);
    if (current) body.push(...wrap(current.reason ? `Unavailable: ${current.reason}. ${current.desc}` : current.desc, inner, "muted"));
    const run = (i: number) => {
      const it = items[i];
      say(it.reason ? `${it.label}: ${it.reason}` : `${it.label} → opens its confirmation or panel workflow`);
    };
    const keys = Object.fromEntries(
      items.map((it, i) => [
        it.key,
        () => {
          setCursor(viewKey, i);
          run(i);
        },
      ]),
    );
    return {
      tabs,
      title,
      body,
      cursorLine,
      count: items.length,
      hints: [["↑↓", "action"], ["⏎", "choose"], ["←", "sidebar"]],
      enter: run,
      keys,
    };
  }

  function envOverview(envId: string): View {
    const env = envOf(envId);
    const field = (k: string, v: Line | string): Line => [seg(k.padEnd(15), "muted"), ...(typeof v === "string" ? [seg(v)] : v)];
    if (!env.on) {
      const body: Line[] = [
        [seg("! Disconnected", "warn"), seg(" · ssh dev@build-box.lan unreachable since 5:02 AM", "muted")],
        [seg("  Values below are from the last observation and may be stale.", "muted")],
        [seg("  "), seg("f", "accent"), seg(" retry connection", "muted")],
        [],
        field("Connection", [seg("○ disconnected", "warn")]),
        field("Version", "client 0.169.1 · service 0.166.0 (last seen)"),
        field("Service", [seg("not checked yet", "muted")]),
        field("Endpoint", "ssh dev@build-box.lan convoy service connect"),
        [],
        [seg("PROJECTS", "head")],
        [seg("  api       "), seg("offline · last seen 5:01 AM", "muted")],
      ];
      return {
        tabs: ENV_TABS,
        title: [seg(env.id, "head")],
        body,
        count: 0,
        hints: [["f", "retry"], ["←", "sidebar"]],
        enter: () => {},
        keys: { f: () => say("Retrying connection to build-box…") },
      };
    }
    const tableW = [20, 13];
    const body: Line[] = [
      field("Connection", [seg("● connected", "ok")]),
      field("Mode", "shared · one account for all projects"),
      field("Version", [seg("0.169.1 "), seg("client and service match", "muted")]),
      field("Service", "running · PID 1042691 · Node v22.23.5"),
      field("Configuration", "valid"),
      field("Endpoint", "docker exec convoy-local-test-0f079851 …/control.sock"),
      [],
      [seg("RUNTIMES", "head")],
      cols(["  RUNTIME", "VERSION", "LOGIN", "CREDENTIAL"].map((h) => [seg(h, "muted")]), [14, ...tableW], inner),
    ];
    const cursorLine = body.length + cursor;
    RUNTIMES.forEach((r, i) => {
      const sel = focus === "main" && i === cursor ? "on" : i === cursor ? "dim" : undefined;
      body.push(
        act(
          mark(
            cols(
              [
                [seg(i === cursor ? "› " : "  ", "accent"), seg(r.name)],
                [seg(r.version, "muted")],
                [seg(`${r.glyph} ${r.login}`, r.tone)],
                [seg("native", "muted")],
              ],
              [14, ...tableW],
              inner,
            ),
            sel,
          ),
          `item:${i}`,
        ),
      );
    });
    body.push(
      [],
      [seg("PROJECTS", "head")],
      [seg("  os        "), seg(`${spin} 1 running`, "run")],
      [seg("  landing   "), seg("idle", "muted")],
    );
    const name = RUNTIMES[cursor]?.name ?? "";
    return {
      tabs: ENV_TABS,
      title: [seg(env.id, "head")],
      body,
      cursorLine,
      count: RUNTIMES.length,
      hints: [["↑↓", "runtime"], ["l", "sign in"], ["u", "update"], ["←", "sidebar"]],
      enter: (i) => say(`Sign in to ${RUNTIMES[i].name} → opens the provider login in the panel`),
      keys: {
        l: (i) => say(`Sign in to ${RUNTIMES[i].name} → opens the provider login in the panel`),
        u: () => say(`Update ${name} → opens Agent runtimes with ${name} checked`),
      },
    };
  }

  function credentialsView(envId: string): View {
    const body: Line[] = [
      [seg("! Runtime credentials are unavailable here.", "warn")],
      [],
      ...wrap("Managed credentials need a shared environment, a managed Docker target or a Linux project VM run as its control account.", inner),
      [],
      ...wrap("Provider keys for ordinary profiles on this machine stay in `convoy keys` and the desktop settings. This TUI does not change them.", inner, "muted"),
    ];
    return { tabs: ENV_TABS, title: [seg(envId, "head")], body, count: 0, hints: [["←", "sidebar"]], enter: () => {}, keys: {} };
  }

  function runsView(project: string, envOn: boolean): View {
    const wide = size === "wide";
    const widths = wide ? [15, 9, inner - 15 - 9 - 8 - 6 - 8, 8, 6] : [15, inner - 15 - 6 - 4, 6];
    const head = wide ? ["STATE", "TASK", "TITLE", "RUNTIME", "AGE"] : ["STATE", "TITLE", "AGE"];
    const body: Line[] = [cols(head.map((h, i) => [seg(i ? h : `  ${h}`, "muted")]), widths, inner)];
    if (!envOn) {
      return {
        tabs: PROJECT_TABS,
        title: [seg(project, "head")],
        body: [[seg("! build-box is disconnected. Runs show once it reconnects.", "warn")]],
        count: 0,
        hints: [["←", "sidebar"]],
        enter: () => {},
        keys: {},
      };
    }
    const list = project === "os" ? RUNS : RUNS.slice(2, 3);
    list.forEach((r, i) => {
      const sel = focus === "main" && i === cursor ? "on" : i === cursor ? "dim" : undefined;
      const state: Line = [seg(i === cursor ? "› " : "  ", "accent"), seg(`${r.glyph || spin} ${r.state}`, r.tone)];
      const cells: Line[] = wide
        ? [state, [seg(r.task, "muted")], [seg(r.title)], [seg(r.runtime, "muted")], [seg(r.updated, "muted")]]
        : [state, [seg(r.title)], [seg(r.updated, "muted")]];
      body.push(act(mark(cols(cells, widths, inner), sel), `item:${i}`));
    });
    const r = list[cursor] ?? list[0];
    const detail: Line[] = [
      [seg("Thread   ", "muted"), seg(`${r.thread} · ${r.runtime} · started 3m ago`)],
      [seg("Task     ", "muted"), seg(r.task === "—" ? "no task" : `${r.task} ${r.title}`)],
      [],
      [seg("HISTORY", "head")],
      [seg("  5:12:40  ", "muted"), seg(`started ${r.runtime}`)],
      [seg("  5:13:02  ", "muted"), seg("ran pnpm test --filter login "), seg("exit 1", "bad")],
      [seg("  5:13:30  ", "muted"), seg("edited src/login.test.ts")],
      [seg("  5:14:11  ", "muted"), seg("ran pnpm test --filter login "), seg("exit 0", "ok")],
      [seg("  5:15:36  ", "muted"), seg(r.last, r.tone)],
      [],
      hint([["⏎", "full log"], ["x", r.state === "done" ? "cancel (finished)" : "cancel run"], ["o", "open thread"]]),
    ];
    return {
      tabs: PROJECT_TABS,
      title: [seg(project, "head")],
      body,
      cursorLine: cursor + 1,
      count: list.length,
      hints: wide
        ? [["↑↓", "run"], ["⏎", "log"], ["x", "cancel"], ["o", "browser"], ["←", "sidebar"]]
        : [["↑↓", "run"], ["⏎", "detail"], ["←", "sidebar"]],
      enter: (i) => (wide ? say(`Full log for ${list[i].thread} → replaces this pane, Esc back`) : setDetailOpen(true)),
      keys: {
        x: (i) => say(list[i].state === "done" ? "Cancel run: this run already finished" : `Cancel ${list[i].thread} → confirm popup names the run and thread`),
        o: (i) => say(`Opens ${list[i].thread} in the browser`),
      },
      detail: { title: [seg(`Run ${r.thread}`, "head"), seg(` · ${r.state}`, r.tone)], body: detail },
    };
  }

  function formView(kind: "add-env" | "add-project", envId?: string): View {
    const body: Line[] =
      kind === "add-env"
        ? [
            [seg("Name             ", "muted"), seg("[ my-env                  ]", "accent")],
            [seg("Transport        ", "muted"), seg("Docker (managed)")],
            [seg("Internet access  ", "muted"), seg("(•) Unrestricted  ( ) Restricted")],
            [],
            ...wrap("Restricted limits outbound traffic to an allowlist; research tools may stop working.", inner, "muted"),
            [],
            [seg("[ Review ]", "accent"), seg("  "), seg("[ Cancel ]", "muted")],
          ]
        : [
            [seg("Environment      ", "muted"), seg(envId ?? "")],
            [seg("Project          ", "muted"), seg("[ choose a Convoy project ▾ ]", "accent")],
            [seg("Settings         ", "muted"), seg("copied from the project when it attaches", "muted")],
            [],
            [seg("[ Review ]", "accent"), seg("  "), seg("[ Cancel ]", "muted")],
          ];
    return {
      title: [seg(kind === "add-env" ? "Add environment" : `Add project · ${envId}`, "head")],
      body,
      count: 0,
      hints: [["Tab", "next field"], ["⏎", "press button"], ["Esc", "back"]],
      enter: () => say("Review → shows target, change and impact, with one Create button"),
      keys: {},
    };
  }

  const env = row.kind === "add-env" ? undefined : envOf(row.env);
  const view: View =
    row.kind === "env"
      ? [() => envOverview(row.env), () => actionsView([...ENV_ACTIONS], [seg(row.env, "head")], ENV_TABS), () => credentialsView(row.env)][envTab]()
      : row.kind === "project"
        ? projectTab === 0
          ? runsView(row.project, env?.on ?? false)
          : actionsView([...PROJECT_ACTIONS], [seg(row.project, "head")], PROJECT_TABS)
        : formView(row.kind, row.kind === "add-project" ? row.env : undefined);
  const tab = row.kind === "env" ? envTab : projectTab;
  const setTab = (i: number) => {
    if (!view.tabs || i >= view.tabs.length) return;
    if (row.kind === "env") setEnvTab(i);
    else setProjectTab(i);
    setDetailOpen(false);
  };

  // ---------- commands for the palette ----------
  const commands: Command[] = [
    ...RUNTIMES.map((r, i) => ({ label: `Sign in to ${r.name}`, scope: "local-test", key: "l", run: () => goto({ kind: "env", env: "local-test" }, 0, i) })),
    ...ENV_ACTIONS.map((a, i) => ({ label: a.label, scope: "local-test", key: a.key, run: () => goto({ kind: "env", env: "local-test" }, 1, i) })),
    ...PROJECT_ACTIONS.map((a, i) => ({ label: a.label, scope: "os", key: a.key, run: () => goto({ kind: "project", env: "local-test", project: "os" }, 1, i) })),
    ...RUNS.slice(0, 2).map((r, i) => ({ label: `Cancel run ${r.thread}`, scope: "os", key: "x", run: () => goto({ kind: "project", env: "local-test", project: "os" }, 0, i) })),
    { label: "Retry connection", scope: "build-box", key: "f", run: () => goto({ kind: "env", env: "build-box" }, 0, 0) },
    { label: "Add project", scope: "local-test", run: () => goto({ kind: "add-project", env: "local-test" }, 0, 0) },
    { label: "Add environment", scope: "global", run: () => goto({ kind: "add-env" }, 0, 0) },
    { label: "Detach TUI", scope: "global", key: "q", run: () => say("Detached. Services and runs keep going.") },
  ];
  const q = query.toLowerCase();
  const matches = commands.filter((c) => `${c.label} ${c.scope}`.toLowerCase().includes(q));

  // ---------- compose the frame ----------
  function frame(): Line[] {
    const crumbs = row.kind === "add-env" ? "add environment" : row.kind === "project" ? `${row.env} › ${row.project}` : row.env;
    const connected = env ? env.on : true;
    const header = spread(
      [seg(" convoy ", "accent"), seg(` ${crumbs}`)],
      env
        ? [seg(connected ? "● connected" : "○ disconnected", connected ? "ok" : "warn"), seg(connected ? " · 0.169.1 " : " · last seen 5:02 AM ", "muted")]
        : [seg("2 environments ", "muted")],
      W,
    );

    // sidebar
    const sideBody: Line[] = rows.map((r, i) => {
      const sel = i === rowIndex ? (focus === "side" ? "on" : "dim") : undefined;
      const pointer = seg(i === rowIndex ? "›" : " ", "accent");
      let line: Line;
      if (r.kind === "env") {
        const e = envOf(r.env);
        line = spread(
          [pointer, seg(open[r.env] ? " ▾ " : " ▸ ", "muted"), seg(e.id)],
          [...(size === "wide" ? [seg(`${e.kind} `, "muted")] : []), seg(e.on ? "●" : "○", e.on ? "ok" : "warn")],
          SIDE - 4,
        );
      } else if (r.kind === "project") {
        const e = envOf(r.env);
        const status: Line = !e.on
          ? [seg("offline", "muted")]
          : r.project === "os"
            ? [seg(`${spin} 1 run`, "run")]
            : [seg("idle", "muted")];
        line = spread([pointer, seg(`    ${r.project}`)], status, SIDE - 4);
      } else if (r.kind === "add-project") {
        line = [pointer, seg("    + Add project", "accent")];
      } else {
        line = [pointer, seg("  + Add environment", "accent")];
      }
      return act(mark(line, sel), `row:${i}`);
    });
    const bodyH = H - 2;
    const noticeH = size === "wide" ? 7 : 6;
    const sideBox = box({
      w: SIDE,
      h: bodyH - noticeH,
      title: [seg("Environments", focus === "side" ? "head" : "muted")],
      focused: focus === "side" && !layer,
      body: sideBody,
      cursorLine: rowIndex,
    });
    const notices = box({
      w: SIDE,
      h: noticeH,
      title: [seg("Notices ", "muted"), seg("2", "warn")],
      body: [
        [seg("! ", "warn"), seg("Codex signed out")],
        [seg("  os · ", "muted"), seg("l", "accent"), seg(" sign in", "muted")],
        [seg("! ", "warn"), seg("build-box offline")],
        [seg("  "), seg("f", "accent"), seg(" retry", "muted")],
        ...(size === "wide" ? [[]] : []),
      ],
    });

    // main pane
    const tabsLine: Line = view.tabs
      ? view.tabs.flatMap((t, i) =>
          i === tab
            ? [seg("  "), seg(`[${i + 1} ${t}]`, "accent", `tab:${i}`)]
            : [seg("  "), seg(`${i + 1} ${t}`, "muted", `tab:${i}`)],
        )
      : [];
    const title = [...view.title, ...tabsLine];
    const mainFocused = focus === "main" && !layer;
    let main: Line[];
    const showDetailBelow = view.detail && size === "wide";
    if (view.detail && size === "narrow" && detailOpen) {
      main = box({ w: mainW, h: bodyH, title: [...view.detail.title, seg("  Esc back", "muted")], focused: mainFocused, body: view.detail.body });
    } else if (showDetailBelow && view.detail) {
      const listH = Math.min(view.body.length + 2, Math.floor(bodyH / 2));
      main = [
        ...box({ w: mainW, h: listH, title, focused: mainFocused, body: view.body, cursorLine: view.cursorLine, foot: [seg(`${cursor + 1} of ${view.count} · page 1`, "muted")] }),
        ...box({ w: mainW, h: bodyH - listH, title: view.detail.title, body: view.detail.body }),
      ];
    } else {
      main = box({ w: mainW, h: bodyH, title, focused: mainFocused, body: view.body, cursorLine: view.cursorLine });
    }

    const footerHints: [string, string][] =
      focus === "side"
        ? [["↑↓", "move"], ["⏎", row.kind === "env" ? "expand" : "open"], ["→", "panel"], ...(view.tabs ? [[`1-${view.tabs.length}`, "tab"] as [string, string]] : [])]
        : view.hints;
    const footer = spread(
      [seg(" "), ...hint([...footerHints, [":", "command"], ["?", "help"], ["q", "detach"]])],
      flash ? [seg(flash, "warn"), seg(" ")] : [],
      W,
    );

    let out: Line[] = [header, ...hjoin(sideBox.concat(notices), main), footer];

    if (layer === "help") {
      const hw = Math.min(62, W - 8);
      const k = (key: string, text: string): Line => [seg(`  ${key.padEnd(12)}`, "accent"), seg(text)];
      const body: Line[] = [
        [seg("MOVE", "head")],
        k("↑ ↓", "move in the focused pane"),
        k("← → Tab", "switch pane"),
        k("1 2 3", "switch tab in the main pane"),
        k("Enter", "open or run the selected item"),
        k("Esc", "back"),
        [],
        [seg("GLOBAL", "head")],
        k(":  Ctrl+K", "command palette: every action, by name"),
        k("?", "this help"),
        k("m", "mouse on/off, to select text"),
        k("q", "detach; services and runs keep going"),
        [],
        [seg(`THIS VIEW`, "head"), seg(` · ${view.tabs?.[tab] ?? view.title.map((s) => s.t).join("")}`, "muted")],
        ...view.hints.map(([key, text]) => k(key, text)),
        ...Object.keys(view.keys)
          .filter((key) => !view.hints.some(([h]) => h === key))
          .slice(0, 6)
          .map((key) => k(key, "shortcut shown beside its row")),
      ];
      out = overlay(out, box({ w: hw, h: body.length + 2, title: [seg("Keys", "head")], foot: [seg("Esc close", "muted")], focused: true, body }), Math.floor((W - hw) / 2), 2);
    }
    if (layer === "palette") {
      const pw = Math.min(70, W - 8);
      const shown = matches.slice(0, size === "wide" ? 12 : 9);
      const p = Math.min(pick, Math.max(0, shown.length - 1));
      const body: Line[] = [
        [seg(": ", "accent"), seg(query), seg(tick % 8 < 4 ? "█" : " ", "accent")],
        [seg("─".repeat(pw - 4), "muted")],
        ...(shown.length
          ? shown.map((c, i) =>
              mark(
                spread(
                  [seg(i === p ? "› " : "  ", "accent"), seg(c.label)],
                  [seg(c.scope, "muted"), seg("  "), seg((c.key ?? " ").padEnd(1), "accent")],
                  pw - 4,
                ),
                i === p ? "on" : undefined,
              ),
            )
          : [[seg("  No matching action", "muted")]]),
      ];
      out = overlay(
        out,
        box({ w: pw, h: body.length + 2, title: [seg("Command", "head")], foot: [seg(`${matches.length} actions · ⏎ go · Esc close`, "muted")], focused: true, body }),
        Math.floor((W - pw) / 2),
        2,
      );
    }
    return out;
  }

  // ---------- input ----------
  function onKey(e: KeyboardEvent) {
    const k = e.key;
    if (e.metaKey || (e.ctrlKey && k !== "k")) return;
    e.preventDefault();
    setFlash("");
    if (layer === "palette") {
      if (k === "Escape") setLayer(null);
      else if (k === "ArrowDown") setPick((p) => Math.min(p + 1, matches.length - 1));
      else if (k === "ArrowUp") setPick((p) => Math.max(p - 1, 0));
      else if (k === "Enter") {
        matches[Math.min(pick, matches.length - 1)]?.run();
        setLayer(null);
      } else if (k === "Backspace") setQuery((s) => s.slice(0, -1));
      else if (k.length === 1) {
        setQuery((s) => s + k);
        setPick(0);
      }
      return;
    }
    if (layer === "help") {
      if (k === "Escape" || k === "?" || k === "q") setLayer(null);
      return;
    }
    if (k === "?") return setLayer("help");
    if (k === ":" || (e.ctrlKey && k === "k")) {
      setQuery("");
      setPick(0);
      return setLayer("palette");
    }
    if (k === "q") return say("Detached. Services and runs keep going.");
    if (/^[1-3]$/.test(k)) return setTab(Number(k) - 1);
    if (k === "Tab") return setFocus((f) => (f === "side" ? "main" : "side"));

    if (focus === "side") {
      if (k === "ArrowDown") setRowIndex((i) => Math.min(i + 1, rows.length - 1));
      else if (k === "ArrowUp") setRowIndex((i) => Math.max(i - 1, 0));
      else if (row.kind === "env" && (k === "Enter" || k === " ")) setOpen((o) => ({ ...o, [row.env]: !o[row.env] }));
      else if (row.kind === "env" && k === "ArrowRight" && !open[row.env]) setOpen((o) => ({ ...o, [row.env]: true }));
      else if (row.kind === "env" && k === "ArrowLeft" && open[row.env]) setOpen((o) => ({ ...o, [row.env]: false }));
      else if (row.kind !== "env" && row.kind !== "add-env" && k === "ArrowLeft")
        setRowIndex(rows.findIndex((r) => r.kind === "env" && r.env === row.env));
      else if (k === "ArrowRight" || k === "Enter") setFocus("main");
      else if (k === "f" || k === "l") (k === "f" ? commands.find((c) => c.label === "Retry connection") : commands[0])?.run();
      setDetailOpen(false);
      return;
    }
    if (k === "Escape") {
      if (detailOpen) setDetailOpen(false);
      else setFocus("side");
    } else if (k === "ArrowLeft") setFocus("side");
    else if (k === "ArrowDown") setCursor(viewKey, Math.min(cursor + 1, Math.max(0, view.count - 1)));
    else if (k === "ArrowUp") setCursor(viewKey, Math.max(cursor - 1, 0));
    else if (k === "Enter" || k === " ") view.enter(cursor);
    else view.keys[k]?.(cursor);
  }

  function onClick(e: MouseEvent) {
    ref.current?.focus();
    const target = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
    if (!target || layer) return;
    const [kind, n] = target.split(":");
    const i = Number(n);
    if (kind === "row") {
      setRowIndex(i);
      setFocus("side");
      setDetailOpen(false);
    } else if (kind === "tab") setTab(i);
    else if (kind === "item") {
      setCursor(viewKey, i);
      setFocus("main");
    }
  }

  const lines = mode === "proposed" ? frame() : null;
  const current =
    row.kind === "project"
      ? projectTab === 0
        ? CURRENT_FRAMES.runs
        : CURRENT_FRAMES.projectActions
      : [CURRENT_FRAMES.overview, CURRENT_FRAMES.actions, CURRENT_FRAMES.credentials][envTab];

  return (
    <main className="min-h-screen bg-[#0e1012] px-6 py-8 text-[#d4d7d9]">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold">TUI layout proposal</h1>
          <p className="max-w-3xl text-sm leading-6 text-[#939ba1]">
            Titled panes, tabs for every scope, a command palette and a key reference, drawn cell for cell at real
            terminal sizes. Click the terminal, then use the keys: arrows, Tab, 1–3, Enter, Esc, <b>:</b> for commands,{" "}
            <b>?</b> for help. Current shows the frame captured from the real TUI (0.169.1, 110 × 34, no color) for the same view.
          </p>
        </header>
        <div className="flex flex-wrap gap-6 text-sm">
          <Toggle value={mode} options={["proposed", "current"]} onChange={setMode} />
          <Toggle value={size} options={["wide", "narrow"]} labels={{ wide: "110 × 34", narrow: "80 × 24" }} onChange={setSize} />
        </div>
        <div
          ref={ref}
          tabIndex={0}
          onKeyDown={onKey}
          onClick={onClick}
          className="w-fit cursor-default select-none rounded-md bg-[#151719] p-3 font-mono text-[13px] leading-[1.2] outline-none ring-[#9cc9db]/40 focus:ring-2"
        >
          {lines ? (
            lines.map((line, y) => (
              <div key={y} className="whitespace-pre" style={y === 0 || y === lines.length - 1 ? { background: "#20262a" } : undefined}>
                {fit(line, W).map((s, x) => (
                  <span
                    key={x}
                    data-act={s.act}
                    style={{
                      display: "inline-block",
                      width: `${s.t.length}ch`,
                      overflow: "hidden",
                      verticalAlign: "top",
                      color: s.sel === "on" ? "#ecf8ff" : TONES[s.tone ?? "text"],
                      background: s.sel === "on" ? "#34515f" : s.sel === "dim" ? "#202a2f" : undefined,
                      fontWeight: s.tone === "head" ? 700 : undefined,
                      cursor: s.act ? "pointer" : undefined,
                    }}
                  >
                    {s.t}
                  </span>
                ))}
              </div>
            ))
          ) : (
            <pre className="text-[#d4d7d9]">{current}</pre>
          )}
        </div>
        <Notes />
      </div>
    </main>
  );
}

function Toggle<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: T[];
  labels?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[#363b40] p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded px-3 py-1 capitalize ${o === value ? "bg-[#34515f] text-[#ecf8ff]" : "text-[#939ba1] hover:text-[#d4d7d9]"}`}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

function Notes() {
  const changes = [
    "Panes are boxes with the title in the top border. The focused pane gets a heavy border (┏━┓), so focus reads without color.",
    "The sidebar holds only environments and projects. Overview, Actions and Credentials become tabs of the environment, the same way Runs and Actions already are for a project. Keys 1–3 switch tabs.",
    "Notices get their own small pane under the sidebar, one line each with its fix key, instead of 4–5 lines above every view.",
    "Runs are one line each. On wide terminals the selected run's history sits below the list; on narrow ones Enter opens it in place.",
    ": or Ctrl+K opens a command palette with every action by name; picking one jumps to its row, where the usual confirmation runs. ? lists the keys.",
    "One header (breadcrumb, connection, version) and one footer (keys for the focused pane). The second header line and the status bar go away.",
    "States use a glyph and a word (● connected, ○ disconnected, ! signed out, ✓ done, ✗ failed), not color alone. Panes that hold more than they show say ↓ n more in the bottom border.",
  ];
  const conflicts = [
    "TUI-UX-GUIDELINES.md says environment views are sidebar rows, not tabs. This proposal makes them tabs.",
    "The palette is a second way to reach every action. The guidelines allow accelerators for visible controls, and every palette entry lands on a visible row, but the doc would need a line saying so.",
    "Borders cost two columns per pane, which matters at 80 columns.",
  ];
  return (
    <section className="grid gap-6 text-sm leading-6 md:grid-cols-2">
      <div>
        <h2 className="mb-2 font-semibold">What changes</h2>
        <ul className="list-disc space-y-1 pl-5 text-[#b5bcc1]">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">What it breaks in the guidelines</h2>
        <ul className="list-disc space-y-1 pl-5 text-[#b5bcc1]">
          {conflicts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
