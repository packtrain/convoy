import { ServiceRejectedError } from "../../service/errors.js";
import type { ServiceClient } from "../../service/client.js";
import type { LogEntry, ServiceResponse } from "../../service/validators.js";
import type { Connection } from "../resolution.js";
import type { BrowseState, Row } from "../validators.js";
import { loginRuntime, type Action } from "./validators.js";
import { loginRuntimeLabels, type LoginRuntime } from "../../project/validators.js";
import { checkLines } from "../../project/formatters.js";

const PROJECT = ["pause", "reload", "shell", "login-codex", "login-claude-code", "login-antigravity", "remove"];

interface Host {
  targets: Connection[];
  state(): BrowseState;
  client(): ServiceClient | undefined;
  generation(): number;
  revision(): number;
  disposed(): boolean;
  set(patch: Partial<BrowseState>): void;
  event(event: ServiceResponse): void;
  connect(): Promise<void>;
  reconcileSelection(): void;
  shell(operation: (signal: AbortSignal) => Promise<void>): Promise<void>;
}

// Pending/busy locks navigation. Revision/disposal invalidate results; reconnects invalidate confirmations.
export class ActionWorkflow {
  private actionClient?: ServiceClient;
  constructor(private host: Host) {}
  get locked() { return Boolean(this.host.state().action?.pending || this.host.state().action?.busy); }
  dispose() { this.actionClient = undefined; }
  unavailable(kind: Action, row?: Row): string | undefined {
    const state = this.host.state();
    const target = this.host.targets[state.scope.connection];
    const client = this.host.client();
    const live = client && !client.isClosed && state.observations[state.scope.connection].health === "connected";
    if (kind === "start") return target.start ? undefined : target.startUnavailable ?? "Start is unavailable on this transport.";
    if (kind === "logs") return live || target.savedLogs ? undefined : "Saved logs are unavailable on this transport.";
    // Read-only and service-independent: it diagnoses a project whose service is down too.
    if (kind === "check") {
      if (state.scope.details || !state.scope.profile) return "Select one registered project first.";
      return target.check ? undefined : "Project check needs a shared environment, a configured Linux project environment, a managed Docker target or an SSH remote.";
    }
    if (!live) return "Service disconnected. Reconnect before using this control.";
    if (PROJECT.includes(kind)) {
      if (state.scope.details || !state.scope.profile) return "Select one registered project first.";
      const project = state.observations[state.scope.connection].profiles.find(p => p.profile === state.scope.profile);
      if (!project) return "Project is no longer registered. Select another project.";
      if (!client?.hello?.capabilities?.includes("host-cli-v1")) return "Update the service for project maintenance.";
      if ((kind === "shell" || loginRuntime(kind)) && !target.shell) return "Private shell requires a configured Linux project environment or managed Docker target.";
      const login = loginRuntime(kind);
      if (login && project.runtimes && !project.runtimes.includes(login)) {
        return `${loginRuntimeLabels[login]} was not detected on this target when ${project.profile} last started. Install it ${target.mode === "shared" ? "for this account" : "root-owned, for example under /usr/local/bin"}, then [u] Reload project.`;
      }
    }
    if (kind === "cancel") {
      if (this.host.state().stale) return "Run selection is stale. Return to Runs and refresh.";
      if (!row?.run?.runId || row.run.status !== "streaming") return "Select an active execution in Runs history first.";
      if (!this.host.state().rows.some(value => value.profile === row.profile && value.run?.messageId === row.run?.messageId && value.run?.runId === row.run?.runId)) return "Selected execution is no longer on this page.";
    }
  }
  beginAction(kind: Action, row?: Row) {
    if (this.locked) return;
    const reason = this.unavailable(kind, row);
    if (reason) { this.host.set({ action: { kind, message: reason } }); return; }
    this.actionClient = this.host.client();
    const state = this.host.state();
    const profile = state.scope.profile;
    const project = state.observations[state.scope.connection].profiles.find(p => p.profile === profile);
    // A shared shell or login interrupts nothing, so it needs no pause or confirmation. Spec: docs/specs/cli-shared-environments.md#runtimes-and-logins
    const terminal = kind === "shell" || Boolean(loginRuntime(kind)), shared = terminal && this.host.targets[state.scope.connection].mode === "shared";
    this.host.set({ action: { kind, row, profile, identity: project?.identity,
      pauseBeforeShell: terminal && !shared && !project?.paused, pending: !shared && !["status", "logs", "check"].includes(kind) } });
    if (!this.host.state().action?.pending) void this.executeAction();
  }
  dismissAction() {
    if (this.host.state().action?.busy) return;
    this.actionClient = undefined;
    this.host.set({ action: undefined });
    this.host.reconcileSelection();
  }
  confirmAction() {
    if (this.host.state().action?.pending) void this.executeAction();
  }
  moreOperationalLogs() {
    const action = this.host.state().action;
    if (!this.locked && action?.kind === "logs" && action.cursor !== undefined) void this.executeAction(action.cursor);
  }
  private async executeAction(after = 0) {
    const action = this.host.state().action;
    if (!action) return;
    const kind = action.kind;
    const client = kind === "status" || kind === "logs" ? this.host.client() : this.actionClient;
    const target = this.host.targets[this.host.state().scope.connection];
    const generation = this.host.generation();
    const revision = this.host.revision();
    const reason = this.unavailable(kind, action.row);
    if (reason || (["cancel", "stop", ...PROJECT].includes(kind) && client !== this.host.client())) {
      this.host.set({ action: { ...action, pending: false, message: reason ?? "Service changed since confirmation. Inspect status and confirm again." } });
      this.host.reconcileSelection(); return;
    }
    this.host.set({ action: { ...action, pending: false, busy: true, message: undefined } });
    let sent = false, preflightCompleted = false, shellStarted = false;
    const login = loginRuntime(kind), shared = target.mode === "shared";
    try {
      let message: string;
      let entries: LogEntry[] | undefined;
      let cursor: number | undefined;
      if (PROJECT.includes(kind)) {
        const status = await client!.request({ op: "status" });
        this.host.event(status);
        preflightCompleted = true;
        const project = status.profiles?.find(p => p.profile === action.profile);
        if (!project || project.identity !== action.identity) throw new Error("Project registration changed. Inspect status and confirm again.");
        if (kind === "shell" || login) {
          if (!project.paused && !shared) {
            if (!action.pauseBeforeShell) throw new Error("Project resumed. Confirm pause and shell entry again.");
            sent = true;
            await client!.request({ op: "reconcile", profile: action.profile, interrupt: true, pause: true });
            const pausedStatus = await client!.request({ op: "status" });
            this.host.event(pausedStatus);
            const paused = pausedStatus.profiles?.find(p => p.profile === action.profile);
            if (!paused || paused.identity !== action.identity) throw new Error("Project registration changed. Shell was not opened. Inspect status.");
            if (!paused.paused) throw new Error("Project is not paused. Shell was not opened. Inspect status and retry.");
          }
          if (this.host.disposed() || revision !== this.host.revision()) return;
          if (client !== this.host.client() || client?.isClosed) throw new Error("Service changed. Shell was not opened. Inspect status and retry.");
          sent = false;
          shellStarted = true;
          await this.host.shell(signal => target.shell!(action.profile!, action.identity, signal, login));
          if (shared) message = login
            ? `Logged in to ${loginRuntimeLabels[login]}. The login applies to every project in this environment. Running agents were not restarted; if this project does not pick it up, use [u] Reload project.`
            : "Shell exited. Logins made there apply to every project in this environment.";
          else if (login) {
            sent = true;
            await client!.request({ op: "reconcile", profile: action.profile, interrupt: true });
            message = await this.online(client!, action.profile!, login);
          } else message = "Shell exited. Native runtime login stays in this project's private HOME. Use [u] Reload project to resume its connection and load changes; other projects remain connected.";
        } else {
          sent = true;
          const response = await client!.request(kind === "remove"
            ? { op: "project.remove", profile: action.profile, interrupt: true }
            : { op: "reconcile", profile: action.profile, interrupt: true, ...(kind === "pause" ? { pause: true } : {}) });
          message = kind === "pause" ? "Project paused for all clients. Private shell is available. Reload resumes the connection; service restart also resumes it."
            : kind === "remove" ? "Local registration removed. Private files retained; remote project unchanged."
              : "Project reload requested. Its connection resumes for all clients.";
          if (response.applied === false) message += " Some registration changes remain pending. Inspect service status.";
        }
        if (!await this.refreshStatus()) message += " Status refresh failed. Inspect status before another action.";
      } else if (kind === "check") {
        message = checkLines(await target.check!(action.profile!)).join("\n");
      } else if (kind === "start") {
        await target.start!();
        message = "Service start completed. Reconnecting.";
      } else if (kind === "logs") {
        const profile = this.host.state().scope.details ? undefined : this.host.state().scope.profile;
        const response = client && !client.isClosed
          ? await client.request({ op: "logs", after, profile })
          : await target.savedLogs!(after, profile);
        entries = response.entries ?? []; cursor = response.cursor;
        message = `${response.gap ? "Retention gap. " : ""}Saved operational JSON, not following. ${entries.length} entries. n next, Home first.`;
      } else if (kind === "status") {
        const response = await client!.request({ op: "status" });
        this.host.event(response);
        message = `Service ${response.pid} ${response.stopping ? "stopping" : "running"}. ${response.profiles?.length ?? 0} project connections.`;
      } else if (kind === "stop") {
        sent = true;
        await client!.request({ op: "stop" });
        message = "Service stopped for all clients. Saved logs and start remain available.";
      } else {
        const row = action.row!;
        sent = true;
        await client!.request({ op: "runs.cancel", profile: row.profile, threadId: row.thread.threadId, runId: row.run!.runId });
        message = `Cancellation accepted for run ${row.run!.runId}. Return to Runs to refresh.`;
      }
      if (!this.host.disposed() && revision === this.host.revision()) this.host.set({ action: { ...action, pending: false, busy: false, message, entries, cursor } });
      if (kind === "start" && !this.host.disposed()) void this.host.connect();
    } catch (error) {
      if (this.host.disposed() || revision !== this.host.revision()) return;
      const uncertain = sent && !(error instanceof ServiceRejectedError) && (client?.isClosed || generation !== this.host.generation());
      const detail = error instanceof Error ? error.message : "Operation failed.";
      let message = detail;
      if (uncertain) message = `Outcome unknown. Inspect status before retrying. ${detail}`;
      else if (PROJECT.includes(kind) && !preflightCompleted) {
        message = `No project action was sent. ${error instanceof ServiceRejectedError ? detail : "Status check failed. Reconnect and inspect status before retrying."}`;
      } else if (kind === "shell" || login) {
        message = `${detail} ${shellStarted ? "Terminal restored." : "Shell was not opened."} ${shared ? "Retry" : "Pause if needed, then retry"} ${login ? "the login" : "the shell"}${shared ? "." : " or use [u] Reload project to resume."}`;
        if (shellStarted && !await this.refreshStatus()) message += " Status refresh failed. Inspect status before another action.";
      }
      this.host.set({ action: { ...action, pending: false, busy: false, message } });
    } finally {
      this.host.reconcileSelection();
    }
  }
  /** After a login reload, poll until the project is online or reports why not. */
  private async online(client: ServiceClient, profile: string, login: LoginRuntime) {
    const label = loginRuntimeLabels[login];
    for (let attempt = 0; attempt < 60 && !this.host.disposed(); attempt++) {
      const status = await client.request({ op: "status" });
      this.host.event(status);
      const project = status.profiles?.find(p => p.profile === profile);
      if (project?.status === "online") return `Logged in to ${label}. ${profile} is online.`;
      if (!project || (project.warning && project.status !== "connecting") || ["failed", "blocked"].includes(project.status)) {
        return `Logged in to ${label}, but ${profile} is ${project?.status ?? "not registered"}${project?.warning ? `: ${project.warning}` : "."}`;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return `Logged in to ${label}. ${profile} is still starting; watch its status.`;
  }
  private async refreshStatus() {
    const client = this.host.client();
    if (!client || client.isClosed || this.host.disposed()) return false;
    try { this.host.event(await client.request({ op: "status" })); return true; }
    catch { return false; }
  }
}
