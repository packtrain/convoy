/**
 * App auth mode (OS-1230). Baked in at build time: `clerk` (default) or
 * `local-demo` (self-hosted no-auth demo — one synthetic user, no sign-in).
 * See docs/specs/local-demo-auth.md.
 */
export const isLocalDemoAuthMode =
  process.env.NEXT_PUBLIC_AUTH_MODE === "local-demo";
