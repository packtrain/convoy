export interface QuotaWindow {
  name: "primary" | "secondary";
  usedPercent?: number;
  durationMinutes?: number;
  resetsAt?: number;
}

export interface QuotaBucket {
  id: string;
  name?: string;
  windows: QuotaWindow[];
}

export interface QuotaReport {
  account: string;
  refreshedAt: number;
  buckets: QuotaBucket[];
}
