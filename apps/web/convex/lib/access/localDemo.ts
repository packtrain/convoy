import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getUserByTokenIdentifier } from "../../users/lib/usersRepo";

/**
 * Local-demo auth mode (OS-1230): the self-hosted bundle can run without
 * Clerk. When the deployment env var AUTH_MODE=local-demo is set, anonymous
 * calls (no JWT, no API key) resolve to one stable synthetic demo user.
 * See docs/specs/local-demo-auth.md.
 */
export const LOCAL_DEMO_TOKEN_IDENTIFIER = "local-demo|user";
export const LOCAL_DEMO_USER_NAME = "Demo User";
export const LOCAL_DEMO_USER_EMAIL = "demo@convoy.local";

export function isLocalDemoDeployment(): boolean {
  return process.env.AUTH_MODE === "local-demo";
}

/**
 * Lookup-only: queries must never create the demo user. Creation happens
 * solely in the idempotent users.core.onboardLocalDemo mutation.
 */
export async function getLocalDemoUser(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users"> | null> {
  if (!isLocalDemoDeployment()) {
    return null;
  }
  return getUserByTokenIdentifier(ctx, LOCAL_DEMO_TOKEN_IDENTIFIER);
}
