# Vercel Analytics

## Overview

Convoy can use Vercel Web Analytics for app-level traffic analytics in the Next.js web app, but it must be opt-in. The code is public and self-hostable, so self-hosted deployments must not send web analytics events to Vercel unless the operator explicitly enables that behavior.

## Runtime Integration

- The web app depends on `@vercel/analytics`.
- `apps/web/app/layout.tsx` imports `Analytics` from `@vercel/analytics/next`.
- The root layout renders `<Analytics />` once inside the app body only when `NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED` is exactly `true`.
- The component should live beside other app-wide runtime observers such as `SpeedInsights` and `AppVersionWatcher`.

## Constraints

- `NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED` defaults to disabled when unset or set to any value other than `true`.
- Local development, self-hosted installs, and non-Vercel hosts must remain analytics-off by default.
- Do not render route-specific duplicate analytics components.
- Keep analytics integration in the root app shell unless a future Vercel requirement changes the recommended integration point.
- Do not add custom analytics event tracking without a separate spec update describing event names, payload fields, and privacy constraints.
