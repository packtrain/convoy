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

// Pull request watches no webhook reached: missed deliveries, base-branch pushes (docs/specs/pull-request-watch.md).
// Keep in step with WATCH_IDLE_CRON_MINUTES; most runs find no idle watch.
crons.interval("pull request watch idle evaluation", { minutes: 1 }, internal.integrations.github.pullRequestWatches.evaluateIdle, {});

export default crons;
