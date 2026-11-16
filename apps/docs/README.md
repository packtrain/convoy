# Convoy Docs

Documentation site built with [Fumadocs](https://fumadocs.vercel.app/) and [React Router](https://reactrouter.com/).

## Development

From the repository root:

```bash
pnpm docs:dev
```

Or from `apps/docs`:

```bash
pnpm dev
```

The dev server runs at [https://docs.convoy.localhost](https://docs.convoy.localhost).

## Build

```bash
# From root
pnpm docs:build

# Or from apps/docs
pnpm build
```

The site is fully pre-rendered (static). Build output goes to `build/client/`.

## Type Checking

```bash
# From root
pnpm docs:types:check

# Or from apps/docs
pnpm types:check
```

## Deploy to Vercel

1. Import the repository in Vercel
2. Set **Root Directory** to `apps/docs`
3. Deploy

`vercel.json` sets the rest: the "Other" framework preset, the build command `npx react-router build`, the output directory `build/client`, the `/` to `/docs` redirect, and trailing-slash removal. No environment variables are required.

Keep the preset off. Vercel's React Router preset serves the root page with status 200 for every unknown URL, which hides the build's `404.html`. See [Deploying the docs site](content/docs/deployment/deploy-docs.mdx) and the [docs SEO spec](../../docs/specs/docs-seo.md).

The `react-router build` command runs the static prerender defined in `react-router.config.ts`, which generates pages for all MDX content under `content/docs/`, plus `sitemap.xml` and `404.html`.

## SEO check

```bash
pnpm docs:build
pnpm --filter docs test:seo
```

The test reads `build/client/` without a server.

## Content

Documentation content lives in `content/docs/` as `.mdx` files. Root `content/docs/meta.json` owns flat-section ordering. Only the MCP and dev-container groups own child ordering. See [Authoring docs](content/docs/contributing/authoring-docs.mdx) for navigation and compatibility-page rules. See the [Fumadocs docs](https://fumadocs.vercel.app/) for authoring details.
