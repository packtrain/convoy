import type { OnboardingSession } from "./onboarding/index.js";
import type { EnvironmentProposal, EnvironmentForm, EnvironmentProgress } from "../environment/validators.js";
import { ActionWorkflow } from "./actions/index.js";
import type { Action } from "./actions/validators.js";
import { ServiceCompatibilityError, ServiceRejectedError, ServiceUnavailableError } from "../service/errors.js";
import { codexAwsHost } from "../../agent/runtimes/codex/auth.js";
import type { CredentialMutation } from "../../lib/config/credentials/validators.js";
import type { LoginRuntime } from "../project/validators.js";
import { getCliVersion } from "../../lib/version.js";
import { prepareEnvironment, createConnection, connections, type Connection } from "./resolution.js";
import { serviceInspectionSchema } from "../service/validators.js";
import type { ServiceClient } from "../service/client.js";
import type { ServiceResponse, ServiceRequest } from "../service/validators.js";
import { runPageSchema, threadPageSchema, type BrowseState, type PagePosition, type Row, type Scope } from "./validators.js";

/** A client owns one subscription and one visible page. Spec: docs/specs/cli-tui.md. */
export class Browser {
  environmentBusy = false;
  onboardingSession?: OnboardingSession;
  /** The result of a handed-off operation, for the view that remounts after it. */
  notice?: string;
  private state: BrowseState;
  private actions: ActionWorkflow;
  private listeners = new Set<() => void>();
  private abort?: AbortController;
  private client?: ServiceClient;
  private retry?: ReturnType<typeof setTimeout>;
  private refresh?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private revision = 0;
  private reading = false;
  private position?: PagePosition;
  private previous: PagePosition[] = [];
  private disposed = false;
  constructor(readonly targets: Connection[], selected = 0, private readonly shell: (operation: (signal: AbortSignal) => Promise<void>) => Promise<void> = async () => { throw new Error("Interactive shell handoff is unavailable."); }) {
    this.state = { scope: { connection: selected, details: true },
      observations: targets.map(() => ({ health: "unknown", profiles: [] })),
      rows: [], loading: false, stale: false, pageNumber: 1 };
    this.actions = new ActionWorkflow({ targets, state: () => this.state, client: () => this.client,
      generation: () => this.generation, revision: () => this.revision, disposed: () => this.disposed,
      set: patch => this.set(patch), event: event => this.event(event), connect: () => this.connect(), reconcileSelection: () => this.reconcileSelection(),
      inspected: inspection => this.observe({ inspection }), shell });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<BrowseState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private reconcileSelection() {
    const { scope, observations, action } = this.state;
    if (scope.profile && observations[scope.connection].health === "connected" &&
        !observations[scope.connection].profiles.some(p => p.profile === scope.profile) && !action?.pending && !action?.busy && !this.state.onboarding) {
      this.revision++; this.position = undefined; this.previous = [];
      this.set({ scope: { connection: scope.connection, details: true }, credentials: undefined, runtimes: undefined,
        rows: [], history: undefined, detail: undefined, next: undefined, pageNumber: 1 });
    }
  }
  private observe(patch: Partial<BrowseState["observations"][number]>) {
    this.set({ observations: this.state.observations.map((value, i) => i === this.state.scope.connection ? { ...value, ...patch } : value) });
  }
  start() { void this.connect(); void this.checkEnvironments(); }
  /** One status check per unselected managed environment, so its dot is not unknown. Spec: docs/specs/cli-tui.md#environment-row-layout-cli-01320 */
  private async checkEnvironments() {
    await Promise.all(this.targets.filter((target, i) => target.maintenance && i !== this.state.scope.connection).map(async target => {
      const patch = await target.maintenance!.status().then(environmentStatus => ({ environmentStatus, environmentError: undefined }),
        (error: unknown) => ({ environmentStatus: undefined, environmentError: error instanceof Error ? error.message : "Cannot inspect environment." }));
      // Targets can be deleted meanwhile, so find the index again.
      const index = this.targets.indexOf(target);
      if (index >= 0) this.set({ observations: this.state.observations.map((value, i) => i === index ? { ...value, ...patch } : value) });
    }));
  }
  select(scope: Scope) {
    if (this.locked) return;
    const changed = scope.connection !== this.state.scope.connection;
    if (changed) this.observe({ health: "unknown" });
    this.revision++;
    this.previous = []; this.position = undefined;
    this.set({ scope, actions: this.state.actions && (scope.details || Boolean(scope.profile)), credentials: scope.details && !scope.addProject ? this.state.credentials : undefined, runtimes: undefined, action: undefined, rows: [], history: undefined, detail: undefined, next: undefined, error: undefined, stale: false, pageNumber: 1, updatedAt: undefined });
    if (changed) void this.connect();
    else this.schedule(0);
  }
  history(row?: Row) {
    if (this.locked) return;
    this.revision++; this.previous = []; this.position = undefined;
    this.set({ history: row, rows: [], next: undefined, pageNumber: 1, updatedAt: undefined });
    this.schedule(0);
  }
  logs(row?: Row) {
    if (this.locked) return;
    this.revision++;
    this.set({ detail: row, loading: false });
    clearTimeout(this.refresh);
    if (!row) this.schedule(0);
  }
  get locked() { return Boolean(this.state.environment) || Boolean(this.state.onboarding) || this.state.credentials === "editing" || this.state.runtimes === "editing" || this.actions.locked; }
  openEnvironment(mode: NonNullable<BrowseState["environment"]>) {
    if (this.state.environment || this.actions.locked || (this.state.onboarding && mode !== "update" && mode !== "start")) return;
    if (mode !== "create" && !this.targets[this.state.scope.connection].maintenance) {
      this.set({ error: "Environment maintenance unavailable on this transport. Use its service controls." }); return;
    }
    this.revision++; clearTimeout(this.refresh);
    this.set({ environment: mode, action: undefined, loading: false });
  }
  async inspectEnvironment() {
    const target = this.targets[this.state.scope.connection];
    if (this.locked || this.state.observations[this.state.scope.connection].checkingEnvironment) return;
    const index = this.state.scope.connection;
    this.observe({ checkingEnvironment: true, environmentError: undefined });
    try {
      if (!target.maintenance) {
        const client = this.client;
        if (!client) throw new Error("Service disconnected. Retry connection first.");
        const response = await client.request({ op: "status" });
        if (this.state.scope.connection === index && client === this.client) this.event(response);
        if (!this.disposed) this.set({ observations: this.state.observations.map((value, i) => i === index ? { ...value, checkingEnvironment: false } : value) });
        return;
      }
      const environmentStatus = await target.maintenance.status();
      if (!this.disposed) this.set({ observations: this.state.observations.map((value, i) => i === index ? { ...value, environmentStatus, checkingEnvironment: false } : value) });
    } catch (error) {
      if (!this.disposed) this.set({ observations: this.state.observations.map((value, i) => i === index ? { ...value, checkingEnvironment: false, environmentStatus: undefined, environmentError: error instanceof Error ? error.message : "Cannot inspect environment." } : value) });
    }
  }
  closeEnvironment() { this.set({ environment: undefined }); this.schedule(0); }
  /** Packed CLI that new environments install instead of the npm release (`convoy tui --package`). */
  localPackage?: string;
  prepareEnvironment = (form: EnvironmentForm) => prepareEnvironment(form, undefined, this.localPackage);
  async createEnvironment(form: EnvironmentForm, progress: EnvironmentProgress, proposal?: EnvironmentProposal) {
    let target: Connection;
    try { target = await createConnection(form, progress, proposal); }
    catch (error) {
      if (!this.disposed) {
        const retained = connections().targets.find(value => value.transport === "docker" && value.id === form.name);
        if (retained && !this.targets.some(value => value.id === retained.id && value.transport === retained.transport)) {
          this.targets.push(retained);
          this.set({ observations: [...this.state.observations, { health: "unknown", profiles: [] }] });
        }
      }
      throw error;
    }
    if (this.disposed) return;
    let index = this.targets.findIndex(value => value.id === target.id && value.transport === target.transport);
    if (index < 0) {
      index = this.targets.length; this.targets.push(target);
      this.set({ observations: [...this.state.observations, { health: "unknown", profiles: [] }] });
    }
    if (index !== this.state.scope.connection) this.observe({ health: "unknown" });
    this.set({ actions: false, scope: { connection: index, details: true }, rows: [], history: undefined, detail: undefined });
    await this.connect();
  }
  async refreshEnvironment(result: Record<string, unknown>) {
    if (this.disposed) return;
    if (result.deleted === true) {
      const index = this.state.scope.connection;
      this.targets.splice(index, 1);
      this.set({ scope: { connection: 0, details: true }, actions: false, rows: [], history: undefined, detail: undefined,
        observations: this.state.observations.filter((_, i) => i !== index) });
      await this.connect();
      return;
    }
    if (result.stopped === true) {
      this.observe({ environmentStatus: { ...result, state: result.state ?? "stopped", serviceRunning: false }, environmentError: undefined });
      return;
    }
    this.observe({ environmentStatus: result, environmentError: undefined, version: typeof result.serviceVersion === "string" ? result.serviceVersion : undefined });
    await this.connect();
  }
  /** Gives `operation` the terminal; Ink remounts before this resolves, so the result goes to `notice`. */
  async handOff(operation: () => Promise<string>) {
    await this.shell(async () => { this.notice = await operation().catch((error: unknown) => error instanceof Error ? error.message : "Operation failed."); });
  }
  openOnboarding() {
    if (this.locked) return;
    this.revision++; clearTimeout(this.refresh);
    this.set({ onboarding: true, action: undefined, loading: false });
  }
  openRuntimeAccess() {
    const { scope } = this.state;
    if (this.locked || scope.details || !scope.profile || !this.targets[scope.connection].credentials) return;
    this.onboardingSession = { origin: "actions", profile: scope.profile, message: "", step: "access",
      access: { draft: {}, saved: {}, reloadPending: false } };
    this.openOnboarding();
  }
  /** Refresh the applied registration before choosing access; keep onboarding locked. */
  async prepareOnboardingAccess(profile: string) {
    if (!this.state.onboarding) throw new Error("Add project is no longer open.");
    if (!this.client || this.client.isClosed) await this.connect();
    const client = this.client;
    if (!client || client.isClosed) throw new Error("Service disconnected. Retry when connected.");
    const status = await client.request({ op: "status" });
    if (!this.state.onboarding || this.disposed) throw new Error("Add project is no longer open.");
    this.event(status);
    const project = status.profiles?.find(value => value.profile === profile);
    if (!project) throw new Error("Project is not observed by the service yet. Retry or assign credentials from project Actions.");
    this.set({ scope: { connection: this.state.scope.connection, profile, details: false } });
    return project;
  }
  closeOnboarding(profile?: string, pending = false) {
    const returnToActions = this.onboardingSession?.origin === "actions";
    this.onboardingSession = undefined;
    this.set({ onboarding: false });
    if (returnToActions) { this.showActions(true); return; }
    if (pending) {
      this.select({ connection: this.state.scope.connection, details: true });
      this.showActions(true);
    } else if (profile) {
      this.set({ actions: false });
      this.select({ connection: this.state.scope.connection, profile, details: false });
      void this.connect();
    } else this.schedule(0);
  }
  showActions(value: boolean) {
    if (this.locked || (value && !this.state.scope.details && !this.state.scope.profile)) return;
    this.revision++;
    this.set({ actions: value, credentials: undefined, runtimes: undefined, action: undefined, loading: false });
    if (value) clearTimeout(this.refresh); else this.schedule(0);
  }
  /** The runtime row a project's editor opens on; Unassign also drafts it unassigned. The editor takes it once. */
  credentialFocus?: { runtime: LoginRuntime; unassign?: boolean };
  /** Environment tab, or a project's assignment editor opened from its Actions or a Details runtime row. */
  showCredentials(value: boolean, focus?: Browser["credentialFocus"]) {
    const { scope } = this.state;
    if (value && (this.locked || scope.addProject || (!scope.details && !scope.profile))) return;
    this.revision++;
    this.credentialFocus = value ? focus : undefined;
    this.set({ credentials: value ? scope.details ? "view" : "editing" : undefined, runtimes: undefined, actions: scope.details ? false : this.state.actions, action: undefined });
    if (!value) this.schedule(0);
  }
  /** Agent runtimes, opened from environment Actions; managed targets only. Spec: docs/specs/cli-tui.md#agent-runtimes-cli-01240-os-2236 */
  showRuntimes(value: boolean) {
    const { scope } = this.state;
    if (this.locked || (value && (!scope.details || scope.addProject || !this.targets[scope.connection].maintenance?.runtimes))) return;
    this.set({ runtimes: value ? "view" : undefined, actions: true, credentials: undefined, action: undefined });
  }
  editRuntimes(editing: boolean) {
    if (this.state.runtimes) this.set({ runtimes: editing ? "editing" : "view" });
  }
  editCredentials(editing: boolean) {
    if (this.state.credentials && this.state.scope.details) this.set({ credentials: editing ? "editing" : "view" });
  }
  /** Reloads each project so its worker reconnects with the saved credentials, interrupting its active work. */
  async reloadProjects(profiles: string[]) {
    const client = this.client;
    if (!client || client.isClosed) throw new Error("Service disconnected. Retry once the environment shows connected.");
    if (!client.hello?.capabilities?.includes("host-cli-v1")) throw new Error("Update the service for project maintenance.");
    for (const profile of profiles) await client.request({ op: "reconcile", profile, interrupt: true });
    this.event(await client.request({ op: "status" }));
  }
  /** Sends one managed credential change through this connection's service; Docker AWS keys first open their endpoint. */
  async mutateCredentials(request: CredentialMutation) {
    const client = this.client;
    if (!client || client.isClosed) throw new Error("Service disconnected. Retry once the environment shows connected.");
    if (!client.hello?.capabilities?.includes("credentials-v1")) throw new Error("This service cannot change managed credentials. Update its CLI from environment Actions.");
    if (this.targets[this.state.scope.connection].mode === "shared" && !client.hello.capabilities.includes("credentials-shared-v1"))
      throw new Error("This service predates shared-environment credentials. Restart it with [t] Restart service in environment Actions.");
    if (request.action === "add" && request.aws) await this.targets[this.state.scope.connection].credentials?.allowDomain?.(codexAwsHost(request.aws));
    try { return (await client.request({ op: "credentials.mutate", credentials: request })).applied === true; }
    catch (error) {
      if (error instanceof ServiceRejectedError) throw error;
      throw new Error(`Outcome unknown. Press f to refresh before retrying. ${error instanceof Error ? error.message : ""}`);
    }
  }
  unavailable = (kind: Action, row?: Row) => this.actions.unavailable(kind, row);
  beginAction = (kind: Action, row?: Row) => this.actions.beginAction(kind, row);
  dismissAction = () => this.actions.dismissAction();
  confirmAction = (choice?: Parameters<ActionWorkflow["confirmAction"]>[0]) => this.actions.confirmAction(choice);
  moreOperationalLogs = () => this.actions.moreOperationalLogs();
  readLogs(row: Row, args: Pick<ServiceRequest, "chunkAfter" | "chunkBefore" | "eventOrder" | "eventOffset">) {
    if (!this.client || this.client.isClosed) return Promise.reject(new ServiceUnavailableError("Service disconnected"));
    if (!this.client.hello?.capabilities?.includes("raw-logs-v1")) return Promise.reject(new ServiceCompatibilityError("Update service for raw logs"));
    const client = this.client;
    return client.request({ op: "runs.logs", profile: row.profile, threadId: row.thread.threadId,
      messageId: row.run?.messageId, rawLogs: true, ...args }).catch(error => {
        if (client.isClosed) throw new ServiceUnavailableError("Service disconnected");
        throw error;
      });
  }
  next() {
    if (!this.state.next || this.state.loading || !this.position) return;
    // Bound navigation metadata as well as the rendered rows.
    this.previous.push(this.position);
    if (this.previous.length > 100) this.previous.shift();
    this.position = this.state.next; this.revision++;
    this.set({ rows: [], next: undefined, pageNumber: this.state.pageNumber + 1 }); this.schedule(0);
  }
  back() {
    const previous = this.previous.pop();
    if (!previous) return;
    this.position = previous; this.revision++;
    this.set({ rows: [], next: undefined, pageNumber: this.state.pageNumber - 1 }); this.schedule(0);
  }
  first() {
    this.position = undefined; this.previous = []; this.revision++;
    this.set({ rows: [], next: undefined, pageNumber: 1 }); this.schedule(0);
  }
  retryNow() { if (!this.client) void this.connect(); else this.schedule(0); }
  dispose() {
    this.disposed = true; this.generation++; this.revision++;
    clearTimeout(this.retry); clearTimeout(this.refresh);
    this.abort?.abort(); this.client?.close(); this.client = undefined;
    this.actions.dispose();
    this.state = { ...this.state, action: undefined, rows: [], detail: undefined, history: undefined };
    this.listeners.clear();
  }
  private async connect() {
    const generation = ++this.generation;
    clearTimeout(this.retry); clearTimeout(this.refresh);
    this.abort?.abort(); this.client?.close(); this.client = undefined;
    const abort = this.abort = new AbortController();
    // A retry keeps "reconnecting" and its error, so the sidebar's loading row does not flash every attempt.
    const { snapshot, health } = this.state.observations[this.state.scope.connection];
    const retrying = health === "reconnecting";
    this.observe({ health: snapshot || retrying ? "reconnecting" : "connecting" });
    this.set({ stale: true, loading: true, ...(retrying ? {} : { error: undefined }) });
    try {
      const client = await this.targets[this.state.scope.connection].open(abort.signal);
      if (this.disposed || generation !== this.generation) { client.close(); return; }
      this.client = client;
      if (!client.hello?.capabilities?.includes("runs-v1")) throw new ServiceCompatibilityError("Service lacks run browsing support.");
      void client.closed.then(() => {
        if (this.disposed || generation !== this.generation || this.client !== client) return;
        this.client = undefined;
        this.observe({ health: "reconnecting" });
        this.set({ stale: true, loading: false, error: "Service disconnected. Reconnecting…" });
        clearTimeout(this.refresh);
        clearTimeout(this.retry);
        this.retry = setTimeout(() => void this.connect(), 3000);
      });
      this.observe({ version: client.hello?.version, inspection: undefined, guidance: undefined });
      await client.subscribe({}, event => {
        if (generation !== this.generation || this.disposed) return;
        this.event(event);
      });
      if (client.hello?.capabilities?.includes("inspect-v1")) {
        try {
          const response = await client.request({ op: "inspect" });
          if (generation === this.generation && !this.disposed) this.observe({ inspection: serviceInspectionSchema.parse(response.result) });
        } catch {
          // Optional metadata may fail without losing the browsing connection.
          if (client.isClosed || this.client !== client) return;
        }
      }
      if (generation !== this.generation || this.disposed) return;
      this.observe({ health: "connected" });
      this.reconcileSelection();
      this.set({ loading: false, stale: !this.state.scope.details, error: undefined });
      this.schedule(0);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      const client = this.client; this.client = undefined; client?.close();
      if (error instanceof ServiceCompatibilityError) {
        const target = this.targets[this.state.scope.connection];
        const guidance = target.maintenance ? [
          "Open Actions [a], then Update CLI [u].",
          "The host verifies a published release before confirmation.",
        ] : target.transport === "docker" ? [
          `convoy environment update --environment ${target.id} --version ${getCliVersion()} --interrupt`,
        ] : [
          "Stop the service using its previous CLI.",
          `npm install -g @useconvoy/cli@${getCliVersion()}`,
          "convoy service start -b",
        ];
        this.observe({ health: "incompatible", guidance: ["Service update needed for browsing.", ...guidance,
          "Updating stops connections and active work.", "Then press f to reconnect."] });
        this.set({ loading: false, stale: true, error: "Service update needed. Press d for instructions." });
        return;
      }
      this.observe({ health: "reconnecting" });
      this.set({ loading: false, stale: true, error: `Cannot attach: ${error instanceof Error ? error.message.replace(/\.$/, "") : "Connection failed"}. Retrying…` });
      clearTimeout(this.retry);
      this.retry = setTimeout(() => void this.connect(), 3000);
    }
  }
  private event(event: ServiceResponse) {
    if (event.event === "heartbeat") return;
    if (event.profiles) { this.observe({ profiles: event.profiles, snapshot: event }); this.reconcileSelection(); }
    // Polling below also discovers queued work, which has no worker event yet.
  }
  private schedule(delay = 5000) {
    clearTimeout(this.refresh);
    if (!this.disposed && this.client) this.refresh = setTimeout(() => void this.read(), delay);
  }
  private async read() {
    if (this.reading) { this.schedule(100); return; }
    const client = this.client;
    if (!client || this.disposed) return;
    const revision = this.revision, generation = this.generation;
    const current = () => !this.disposed && revision === this.revision && generation === this.generation;
    if (this.state.environment || this.state.onboarding || this.state.actions || this.state.credentials || this.state.runtimes || this.state.detail || this.state.scope.details) { this.set({ loading: false }); return; }
    const profiles = this.state.observations[this.state.scope.connection].profiles.map(p => p.profile);
    const selected = this.state.history?.profile ?? this.state.scope.profile;
    const profile = this.position?.profile ?? selected ?? profiles[0];
    if (!profile || !profiles.includes(profile)) {
      this.position = undefined;
      this.set({ rows: [], loading: false, stale: false, next: undefined, error: profile ? "Project is no longer registered. Select another project." : undefined });
      this.schedule(); return;
    }
    this.position ??= { profile };
    this.reading = true; this.set({ loading: true });
    try {
      const history = this.state.history;
      const response = await client.request({ op: history ? "runs.history" : "runs.list", profile,
        threadId: history?.thread.threadId, pageCursor: this.position.cursor, limit: 20 });
      if (!current()) return;
      let rows: Row[], isDone: boolean, cursor: string;
      if (history) {
        const page = runPageSchema.parse(response.result);
        rows = page.page.map(run => ({ profile, thread: history.thread, run }));
        isDone = page.isDone; cursor = page.continueCursor;
      } else {
        const page = threadPageSchema.parse(response.result);
        rows = page.page.map(thread => ({ profile, thread }));
        isDone = page.isDone; cursor = page.continueCursor;
      }
      const nextProfile = !selected ? profiles[profiles.indexOf(profile) + 1] : undefined;
      const next = !isDone ? { profile, cursor } : nextProfile ? { profile: nextProfile } : undefined;
      this.set({ rows, next, stale: false, error: undefined, updatedAt: Date.now() });
    } catch {
      if (current()) this.set({ stale: true, error: "Run page unavailable. Check backend access; press Home to restart paging or f to retry." });
    } finally {
      this.reading = false;
      if (current()) this.set({ loading: false });
      this.schedule(current() ? 5000 : 0);
    }
  }
}
