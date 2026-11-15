export type TimeoutKind = "startup" | "idle" | "max-run";

export interface TimeoutConfig {
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  maxRunTimeoutMs: number;
}

export interface TimeoutCallbacks {
  onTimeout: (kind: TimeoutKind) => void;
}

export class RunTimeoutController {
  private readonly callbacks: TimeoutCallbacks;
  private readonly config: TimeoutConfig;
  private startupTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private maxRunTimer: NodeJS.Timeout | null = null;
  private startupSatisfied = false;
  private stopped = false;

  constructor(config: TimeoutConfig, callbacks: TimeoutCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.stopped) return;

    if (this.config.startupTimeoutMs > 0) {
      this.startupTimer = setTimeout(() => {
        this.callbacks.onTimeout("startup");
      }, this.config.startupTimeoutMs);
    }

    if (this.config.idleTimeoutMs > 0) {
      this.armIdleTimer();
    }

    if (this.config.maxRunTimeoutMs > 0) {
      this.maxRunTimer = setTimeout(() => {
        this.callbacks.onTimeout("max-run");
      }, this.config.maxRunTimeoutMs);
    }
  }

  satisfyStartup(): void {
    if (this.startupSatisfied) return;
    this.startupSatisfied = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  touchActivity(): void {
    if (this.stopped || this.config.idleTimeoutMs <= 0) return;
    this.armIdleTimer();
  }

  stop(): void {
    this.stopped = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxRunTimer) clearTimeout(this.maxRunTimer);
    this.startupTimer = null;
    this.idleTimer = null;
    this.maxRunTimer = null;
  }

  private armIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.callbacks.onTimeout("idle");
    }, this.config.idleTimeoutMs);
  }
}
