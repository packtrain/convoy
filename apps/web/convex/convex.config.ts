import { defineApp } from "convex/server";
import { v } from "convex/values";
import migrations from "@convex-dev/migrations/convex.config.js";
import resend from "@convex-dev/resend/convex.config.js";

const app = defineApp({
  // GitHub App credentials (docs/specs/github-integration.md#deployment-configuration).
  // All optional: deployments without them show the integration as unavailable.
  env: {
    GITHUB_APP_ID: v.optional(v.string()),
    GITHUB_APP_SLUG: v.optional(v.string()),
    GITHUB_APP_PRIVATE_KEY: v.optional(v.string()),
    GITHUB_APP_CLIENT_ID: v.optional(v.string()),
    GITHUB_APP_CLIENT_SECRET: v.optional(v.string()),
    GITHUB_APP_WEBHOOK_SECRET: v.optional(v.string()),
  },
});
app.use(migrations);
app.use(resend);
export default app;
