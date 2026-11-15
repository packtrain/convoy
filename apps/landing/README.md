# Convoy Landing

Marketing landing page built with [Next.js](https://nextjs.org).

## Development

```bash
# From root
pnpm landing:dev

# Or from apps/landing
pnpm dev
```

The dev server runs at [https://convoy.localhost](https://convoy.localhost).

## Build

```bash
pnpm landing:build   # or `pnpm build` from apps/landing
```

Set `LANDING_REPO_URL` at build time to point every repository link elsewhere.
Unset or blank falls back to `https://github.com/packtrain/convoy`.

## Tests

Run these after a build. They read `.next` output and need Playwright Chromium.

```bash
pnpm test:seo                                # metadata, crawler files, share card, repo links
node --test app/page.test.mjs lib/copy.test.mjs components/product-preview/*.test.mjs
```

SEO contract: [docs/specs/landing-seo.md](../../docs/specs/landing-seo.md).
