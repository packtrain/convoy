import type { EnvelopeEvent, ProviderId, ProviderInput, RunFinalState, RunHandle } from "./types.js";

interface PendingResolver {
  resolve: (value: IteratorResult<EnvelopeEvent>) => void;
}

class AsyncEventQueue implements AsyncIterable<EnvelopeEvent> {
  private readonly queue: EnvelopeEvent[] = [];
  private readonly pending: PendingResolver[] = [];
  private readonly maxQueueDepth: number;
  private closed = false;

  constructor(maxQueueDepth: number) {
    this.maxQueueDepth = maxQueueDepth;
  }

  push(event: EnvelopeEvent): void {
    if (this.closed) return;

    const waiter = this.pending.shift();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }

    if (this.queue.length >= this.maxQueueDepth) {
      this.queue.shift();
    }
    this.queue.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.pending.length) {
      const waiter = this.pending.shift();
      waiter?.resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<EnvelopeEvent> {
    return {
      next: () => {
        const buffered = this.queue.shift();
        if (buffered) {
          return Promise.resolve({ value: buffered, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<EnvelopeEvent>>((resolve) => {
          this.pending.push({ resolve });
        });
      },
    };
  }
}

export interface RunHandleControls {
  send: (input: ProviderInput) => Promise<void>;
  interrupt: () => Promise<void>;
  terminate: (reason?: string) => Promise<void>;
}

export class RunHandleImpl implements RunHandle {
  readonly runId: string;
  readonly providerId: ProviderId;

  private readonly eventsQueue: AsyncEventQueue;
  private readonly controls: RunHandleControls;
  private finalStatePromise: Promise<RunFinalState>;
  private resolveFinalState: ((state: RunFinalState) => void) | null = null;

  constructor(
    runId: string,
    providerId: ProviderId,
    controls: RunHandleControls,
    maxEventQueueDepth: number
  ) {
    this.runId = runId;
    this.providerId = providerId;
    this.controls = controls;
    this.eventsQueue = new AsyncEventQueue(maxEventQueueDepth);
    this.finalStatePromise = new Promise((resolve) => {
      this.resolveFinalState = resolve;
    });
  }

  events(): AsyncIterable<EnvelopeEvent> {
    return this.eventsQueue;
  }

  emit(event: EnvelopeEvent): void {
    this.eventsQueue.push(event);
  }

  finish(state: RunFinalState): void {
    if (this.resolveFinalState) {
      this.resolveFinalState(state);
      this.resolveFinalState = null;
    }
    this.eventsQueue.close();
  }

  async send(input: ProviderInput): Promise<void> {
    await this.controls.send(input);
  }

  async interrupt(): Promise<void> {
    await this.controls.interrupt();
  }

  async terminate(reason?: string): Promise<void> {
    await this.controls.terminate(reason);
  }

  wait(): Promise<RunFinalState> {
    return this.finalStatePromise;
  }
}
