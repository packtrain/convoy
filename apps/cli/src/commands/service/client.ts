import { ServiceCompatibilityError, ServiceUnavailableError, ServiceRejectedError, ServiceTransportError } from "./errors.js";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { servicePaths } from "./paths.js";
import { frameParser } from "./parsers.js";
import { FRAME_LIMIT, RESPONSE_LIMIT, responseSchema, type ServiceRequest, type ServiceResponse } from "./validators.js";

let transport: (() => Duplex) | undefined;
export function configureServiceTransport(factory?: () => Duplex) { transport = factory; }
export function serviceEndpoint(): string | Duplex { return transport ? transport() : servicePaths(undefined, false).socket; }

type Operation = Omit<ServiceRequest, "v" | "id">;

export class ServiceClient {
  private readonly socket: Duplex;
  private connected = false;
  private ended = false;
  private epoch?: string;
  hello?: ServiceResponse;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<string, { resolve: (value: ServiceResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Map<string, (event: ServiceResponse) => void>();
  private finish!: (error?: Error) => void;
  readonly closed = new Promise<Error | undefined>(resolve => { this.finish = resolve; });

  private constructor(socketPath: string | Duplex) {
    this.socket = typeof socketPath === "string" ? connect(socketPath) : socketPath;
    this.connected = typeof socketPath !== "string";
    this.socket.once("connect", () => { this.connected = true; });
    this.socket.on("error", (error: NodeJS.ErrnoException) => this.fail(error instanceof ServiceTransportError ? error : !this.connected && ["ENOENT", "ECONNREFUSED"].includes(error.code ?? "")
      ? new ServiceUnavailableError("Service unavailable. Run convoy service start -b inside the execution environment.")
      : new Error("Cannot reach service control socket. Check permissions.")));
    this.socket.on("close", () => this.fail(new Error("Service response lost; operation outcome is unknown. Inspect state and request outcome before retrying.")));
    const parse = frameParser(RESPONSE_LIMIT, value => {
      if (this.ended) return;
      const parsed = responseSchema.safeParse(value);
      if (!parsed.success) { this.fail(new Error("Invalid service response. Check that client and service versions match.")); return; }
      const response = parsed.data;
      this.watchHeartbeat();
      const pending = this.pending.get(response.id);
      if (!response.ok) {
        const error = new ServiceRejectedError(response.error ?? "Service rejected the request.");
        if (pending) { clearTimeout(pending.timer); this.pending.delete(response.id); pending.reject(error); }
        else this.fail(error);
        return;
      }
      if (response.event) {
        try { this.listeners.get(response.id)?.(response); }
        catch (error) { this.fail(error instanceof Error ? error : new Error("Service event consumer failed.")); return; }
      }
      if (pending && (!response.event || response.event === "snapshot")) {
        clearTimeout(pending.timer); this.pending.delete(response.id); pending.resolve(response);
      }
    }, () => this.fail(new Error("Invalid service response. Frame limit or JSON framing failed.")));
    this.socket.on("data", parse); this.socket.on("end", () => parse.end());
  }

  static async open(socketPath: string | Duplex, signal?: AbortSignal): Promise<ServiceClient> {
    const client = new ServiceClient(socketPath);
    const abort = () => client.close(new Error("Service client detached."));
    signal?.addEventListener("abort", abort, { once: true });
    void client.closed.then(() => signal?.removeEventListener("abort", abort));
    if (signal?.aborted) abort();
    try {
      const hello = await client.request({ op: "hello" });
      if (!hello.epoch || !hello.capabilities?.includes("attach-v1")) throw new ServiceCompatibilityError("Invalid service response. Restart the service with a matching CLI.");
      client.epoch = hello.epoch;
      client.hello = hello;
      return client;
    } catch (error) {
      client.close();
      if (error instanceof Error && error.message === "Invalid version 1 service request.") {
        throw new ServiceCompatibilityError("Incompatible running service. Stop it with the previous CLI, then restart it with this CLI using convoy service start -b.");
      }
      throw error;
    }
  }

  request(operation: Operation, id: string = randomUUID()): Promise<ServiceResponse> {
    if (this.ended) return Promise.reject(new Error("Service connection closed. Inspect operation outcome before retrying."));
    if (this.pending.size >= 8 || this.pending.has(id)) return Promise.reject(new Error("Client already has pending requests."));
    const frame = JSON.stringify({ ...operation, epoch: operation.epoch ?? this.epoch, v: 1, id }) + "\n";
    if (Buffer.byteLength(frame) > FRAME_LIMIT) return Promise.reject(new Error("Service request exceeds frame limit."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Service response lost; operation outcome is unknown. Request ID: ${id}. Inspect state before retrying.`)), 40000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(frame);
    });
  }

  async subscribe(operation: Omit<Operation, "op">, receive: (event: ServiceResponse) => void): Promise<void> {
    if (this.listeners.size) throw new Error("Connection already has a subscription.");
    const id = randomUUID();
    this.listeners.set(id, receive);
    try { await this.request({ ...operation, op: "subscribe" }, id); this.watchHeartbeat(); }
    catch (error) { this.listeners.delete(id); this.watchHeartbeat(); throw error; }
  }

  get isClosed() { return this.ended; }

  close(error?: Error) { this.fail(error); }
  private watchHeartbeat() {
    clearTimeout(this.heartbeat);
    if (this.listeners.size && !this.ended) this.heartbeat = setTimeout(() => this.fail(new Error("Service heartbeat timed out after 15 seconds. Reconnect to inspect current state.")), 15000);
  }
  private fail(error?: Error) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.heartbeat);
    this.socket.destroy();
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      const Failure = error instanceof ServiceTransportError ? ServiceTransportError : Error;
      // Before hello nothing was sent, so a request ID would only add noise.
      request.reject(error && !(error instanceof ServiceUnavailableError) && !(error instanceof ServiceTransportError && !this.epoch)
        ? new Failure(`${error.message} Request ID: ${id}; service epoch: ${this.epoch ?? "not negotiated"}.`)
        : error ?? new Error("Service client detached."));
    }
    this.pending.clear(); this.listeners.clear(); this.finish(error);
  }
}

export async function serviceRequest(socketPath: string | Duplex, operation: Operation): Promise<ServiceResponse> {
  const client = await ServiceClient.open(socketPath);
  try {
    const response = await client.request(operation);
    if ((operation.op === "status" && (!response.profiles || !response.pid || response.stopping === undefined)) ||
        (operation.op === "logs" && (!response.entries || response.cursor === undefined || response.gap === undefined)) ||
        (["project.add", "project.remove", "reconcile", "credentials.mutate"].includes(operation.op) && response.applied === undefined)) {
      throw new Error("Invalid service response. Check that client and service versions match.");
    }
    return response;
  } finally { client.close(); }
}
