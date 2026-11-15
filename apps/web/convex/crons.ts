import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "notifications retention sweep",
  { hourUTC: 4, minuteUTC: 13 },
  internal.notifications.core.retentionSweep,
  {}
);

crons.cron(
  "pending upload retention sweep",
  "41 4 * * *",
  internal.cli.messages.pendingUploadRetentionSweep,
  {}
);

crons.cron("api key expiry sweep", "27 4 * * *", internal.apiKeys.core.sweepExpiredKeys, {});

// GitHub integration repair for missed webhooks (docs/specs/github-integration.md#reconciliation).
crons.interval("github integration reconciliation", { minutes: 15 }, internal.integrations.github.sync.reconcile, {});

export default crons;
