# Docs SEO

The public docs in `apps/docs` are a static React Router build served at
`https://docs.convoy.build`. Every prerendered `/docs/...` page is indexable.
Navigation and content rules live in
[docs-site-navigation.md](docs-site-navigation.md). The landing site's
counterpart is [landing-seo.md](landing-seo.md).

## Site constants

`apps/docs/app/lib/shared.ts` holds the site name (`appName`, "Convoy Docs"),
the production origin (`siteUrl`), the landing origin (`landingUrl`,
`https://convoy.build`, apex without `www`) and the share card path
(`shareImage`). Page metadata, the sitemap and the nav read them.
`public/robots.txt` is a static file, so it repeats the origin.

## Page metadata

Each docs page sets, in its prerendered HTML:

- `<title>` as `<page title> | Convoy Docs`. The `h1` and the sidebar label keep
  the bare frontmatter `title` and `sidebarTitle`.
- The meta description from frontmatter. Every page needs one, because Open
  Graph and Twitter reuse it.
- A self-referencing canonical, `siteUrl` plus the page route, with no trailing
  slash. Compatibility pointer pages get one too.
- Open Graph `website` type, site name, URL, title, description and image with
  its size and alt text. The title is the full document title, since many
  previews do not show `og:site_name`.
- A `summary_large_image` Twitter card with the same title, description and
  image.

The page component in `app/routes/docs.tsx` renders the tags and React hoists
them into `<head>`. They change with the page on client navigation.

## Search terms

Four pages take a `title` in the wording people search for and keep their short
name as `sidebarTitle`, so navigation is unchanged. Each opens with a sentence
that uses the same wording. Reasoning and the Trends data:
[landing-seo.md](landing-seo.md#search-terms).

| Page | Title |
| --- | --- |
| `/docs/using/ai-threads` | A web UI for Claude Code, Codex, OpenCode and Antigravity |
| `/docs/using/skills` | Share agent skills across your team |
| `/docs/reference/roadmap` | Claude Code, Codex, OpenCode, Cursor and Antigravity support |
| `/docs/deployment/self-hosting-convex` | Self-hosted coding agents: Docker deployment |

Descriptions stay within 160 characters. The Skills title says "agent skills",
not "Claude Code skills": Convoy delivers Skills through MCP and does not write
them into a local client's configuration.

## Share card

All pages share one static card, `public/og.png`, 1200 × 630 and under 200 KB.
A generated image route was rejected for the reason given in
[landing-seo.md](landing-seo.md#metadata). To replace the card, screenshot a
1200 × 630 page with the wordmark, "Convoy Docs" and the tagline on `#08080d`,
and save it over the file.

## Crawler files

`/robots.txt` allows everything and names
`https://docs.convoy.build/sitemap.xml`.

`/sitemap.xml` is a prerendered resource route, `app/routes/sitemap.ts`. It
lists every page the content source knows, with absolute URLs and no `lastmod`,
priority or change frequency. A build date says nothing about whether a page
changed. The `/llms.txt`, `/llms-full.txt` and `/llms.mdx/...` routes stay
crawlable but are not in the sitemap.

## Missing pages

`buildEnd` in `react-router.config.ts` copies `__spa-fallback.html` to
`404.html`. Static hosts serve `404.html` with status 404 for any path that
matches no file, and the shell then renders the Not Found route in the browser.
The copy has to be the SPA shell. A prerendered page reloads itself when it
hydrates at a URL other than its own.

Known gap: an unknown path under `/docs/` gets the 404 status but renders the
root error message, not the Not Found page. The docs route has a build-time
loader and the shell carries no data for it. This predates the 404 work.

`pnpm --filter docs start` serves the build with `serve`, which follows the
same `404.html` convention.

## Vercel

`apps/docs/vercel.json` holds the whole deployment configuration. The dashboard
needs only Root Directory `apps/docs`.

- `"framework": null` selects the "Other" preset. Vercel's React Router preset
  ends its routes with a catch-all that serves `index.html` with status 200 for
  every unmatched path when `ssr` is off, which hides `404.html` and turned
  `/robots.txt`, `/sitemap.xml` and every typo into a soft 404.
- `buildCommand` and `outputDirectory` replace what the preset supplied.
- `/` redirects permanently to `/docs`.
- `trailingSlash: false` redirects `/docs/x/` to `/docs/x`, so each page has
  one URL and it matches the canonical.
- `/assets/*` keeps the immutable cache header the preset used to add. File
  names there carry a content hash.

## Root

On Vercel `/` is the redirect above. The build still prerenders `index.html`
for hosts without redirect rules. It redirects in the browser, is titled
"Convoy Docs" and has `/docs` as its canonical.

## Links

The nav logo links to `/docs`, not the redirecting root. The layout `links` in
`app/lib/layout.shared.tsx` carry one external link to the landing site,
labelled `convoy.build`. It shows in the docs sidebar and in the Not Found
page header.

## Verification

`pnpm --filter docs test:seo` reads `build/client` after `pnpm docs:build`
without a server. It checks titles, the single `h1`, canonical and social tags
on every page, the share card, nav links, crawler files, `404.html` and
`vercel.json`.

Status codes and redirects come from Vercel, so they are checked after
deployment and are not part of local acceptance:

```bash
curl -sI https://docs.convoy.build/ | grep -iE '^(HTTP|location)'             # 308, /docs
curl -sI https://docs.convoy.build/nope | grep -i '^HTTP'                     # 404
curl -sI https://docs.convoy.build/robots.txt | grep -i '^content-type'       # text/plain
curl -sI https://docs.convoy.build/sitemap.xml | grep -i '^content-type'      # application/xml
curl -sI https://docs.convoy.build/docs/using/checks/ | grep -iE '^(HTTP|location)'  # 308, no slash
```

Search Console ownership and sitemap submission also happen after deployment.
