export interface ClaudeUsageWindow {
  name: string;
  label?: string;
  usedPercent?: number;
  resetsAt?: number;
}

export interface ClaudeUsageReport {
  provider: "claude-code";
  source: "reported" | "unavailable";
  account: string;
  refreshedAt: number;
  detail?: string;
  buckets: Array<{ id: string; name?: string; windows: ClaudeUsageWindow[] }>;
  extraUsage?: {
    enabled: boolean;
    usedPercent?: number;
    monthlyLimit?: number;
    usedCredits?: number;
    currency?: string;
  };
}
