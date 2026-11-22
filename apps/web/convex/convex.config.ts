import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/convex.config.js";
import authEmail from "@convex-dev/auth/components/email/convex.config.js";
import authPassword from "@convex-dev/auth/components/password/convex.config.js";
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
    // Backend auth mode (docs/specs/auth-adapters.md#opt-in). Unset means Clerk.
    AUTH_MODE: v.optional(v.union(v.literal("clerk"), v.literal("local-demo"), v.literal("convex"))),
    // Convex Auth sign-up (docs/specs/auth-adapters.md#email-verification). Unset means "required".
    AUTH_EMAIL_VERIFICATION: v.optional(v.union(v.literal("required"), v.literal("off"))),
    // Resend, for invitation and auth emails. Without a key, verified sign-up is refused.
    RESEND_API_KEY: v.optional(v.string()),
    EMAIL_FROM: v.optional(v.string()),
    // The help line at the bottom of every email. Unset leaves the line out.
    SUPPORT_EMAIL: v.optional(v.string()),
  },
});
// Convex Auth (docs/specs/auth-adapters.md). Mounted in every auth mode; empty outside `convex`.
app.use(auth);
app.use(authEmail);
app.use(authPassword);
app.use(migrations);
app.use(resend);
export default app;
