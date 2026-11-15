import path from "node:path";
import type { NextConfig } from "next";

const appBuildId =
  process.env.NEXT_PUBLIC_APP_BUILD_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_SHA ??
  "development";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack never mis-infers it (it occasionally
  // resolved the project dir to app/, panicking with "Next.js package not
  // found").
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // The wildcard covers branch-prefixed worktree hosts from portless
  // (e.g. my-feature.app.convoy.localhost). NEXT_PUBLIC_APP_URL covers devcontainer
  // hosts (docs/specs/worktree-preview-deployments.md#devcontainer).
  allowedDevOrigins: [
    "app.convoy.localhost",
    "*.app.convoy.localhost",
    ...(process.env.NEXT_PUBLIC_APP_URL ? [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname] : []),
  ],
  // Inline html attachments load Inter from an opaque-origin frame, which needs CORS
  // (docs/specs/cli-message-attachments.md#inline-html-os-2220).
  async headers() {
    return [
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  experimental: {
    // Server Actions have their own origin allowlist, separate from allowedDevOrigins. The app
    // defines no actions of its own, but Clerk's ClerkProvider POSTs an internal one. portless
    // rewrites the browser's `origin` header to `http://localhost:<targetPort>` for .localhost
    // origins (no opt-out as of 0.9.2), so Next's CSRF check sees a mismatch against
    // x-forwarded-host and rejects with "Invalid Server Actions request" (E80). The port is
    // random per session but handed to `next dev` via PORT, so allowlist it dynamically.
    serverActions: {
      allowedOrigins: [
        "app.convoy.localhost",
        "*.app.convoy.localhost",
        ...(process.env.NODE_ENV !== "production" && process.env.PORT
          ? [`localhost:${process.env.PORT}`]
          : []),
      ],
    },
  },
  env: {
    NEXT_PUBLIC_APP_BUILD_ID: appBuildId,
    NEXT_PUBLIC_APP_BUILD_TIME:
      process.env.NEXT_PUBLIC_APP_BUILD_TIME ?? new Date().toISOString(),
    NEXT_PUBLIC_APP_GIT_REF:
      process.env.NEXT_PUBLIC_APP_GIT_REF ??
      process.env.VERCEL_GIT_COMMIT_REF ??
      "",
    NEXT_PUBLIC_APP_VERCEL_ENV:
      process.env.NEXT_PUBLIC_APP_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "",
    NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS:
      process.env.NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS ?? "",
  },
};

export default nextConfig;
