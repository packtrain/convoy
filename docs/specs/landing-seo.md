# Landing SEO

The landing site in `apps/landing` has one public, indexable page, the English
homepage at `https://convoy.build/`. Everything else is either a crawler file or
a noindex review page. Planning record: OS-2096.

## Site constants

`site` in `apps/landing/lib/copy.ts` holds the name, title, description,
production origin, docs URL and repository URL. Root metadata, the manifest,
crawler files, the footer and the homepage all read it. The title and
description wording stays as approved in [landing-hero.md](landing-hero.md).

`site.repoUrl` comes from the optional build-time `LANDING_REPO_URL`. When it is
unset or blank, the default is `https://github.com/packtrain/convoy`. The
repository is private for now, so that URL returns 404 until it goes public.
Acceptance checks the rendered `href`, not the response. Every repository link
uses it: the header, hero and closing-CTA buttons, the self-hosting link (its
label is the URL path) and the footer. Changing the variable needs a rebuild.

The footer "Documentation" link, the checks section's "How checks work" link and
the self-hosting section's "How to self-host" link are the homepage's links to
the docs site. "How to self-host" goes to `/docs/deployment`, the overview of
both deployment paths, and sits above the repository link. The footer goes to
`https://docs.convoy.build/docs`, the docs index, not the bare origin. The
origin only redirects there, and a crawler should reach content in one hop.

## Metadata

The root layout sets `metadataBase` to the production origin, the shared title
and description, and `viewport.themeColor` `#08080d` to match the manifest.

The homepage alone sets the canonical, Open Graph (`website`, URL, site name,
title, description, `en_US`) and a `summary_large_image` Twitter card. Putting
the canonical in the root layout would hand it to every playground page.

The share card is a static `app/opengraph-image.png`, 1200 × 630 and under
200 KB, with alt text in `opengraph-image.alt.txt`. Next's file convention
emits the Open Graph image, size and alt tags. Twitter metadata names the same
image explicitly. The alt file has no trailing newline, because Next copies the
file verbatim into the tag. The current card is a capture of the built hero with
the nav links and buttons hidden. Recapture it when the hero or brand changes.
A generated image route was rejected. It needs a renderer and font loading for
an image that changes about as often as the logo.

The homepage carries one JSON-LD `WebSite` object with name and canonical URL.
Serialization escapes `<` as `<` so copy can never close the script tag.
There is no `Organization` until publisher identity is settled, and no
`SoftwareApplication`. Google's software rich result needs a price plus a
rating or review, and the page has neither.

## Search terms

Wording follows a Google Trends comparison from 2026-11-16 (worldwide, 12
months). People search by tool name and by "coding agent(s)", which doubled over
the year. "AI project management" is falling and draws unrelated intent.

- The title carries the category term "AI coding agents" beside the "software
  factory" tagline.
- The description names Claude Code, Codex, OpenCode, Cursor and Antigravity
  and stays within 160 characters.
- The body uses the words of the exact-fit queries: "web UI" in the coding-agent
  introduction, "remotely" in the phone card, "Self-host" in "Run Convoy
  yourself".
- Convoy ships under the Apache License 2.0, so the title says "open-source".

## Crawling

`/robots.txt` allows everything and names `https://convoy.build/sitemap.xml`.
`/sitemap.xml` lists only the homepage, with no `lastmod`, priority or change
frequency. A build date says nothing about whether content changed.

Output is the same in every build. Vercel already sends
`X-Robots-Tag: noindex` on preview deployments, so the app has no environment
branch.

`app/playground/layout.tsx` sets noindex, nofollow for every playground route,
and each page keeps its own metadata too. Robots does not disallow
`/playground`, because a crawler that cannot fetch a page never sees its
noindex tag. Playgrounds stay out of the sitemap.

## Document structure

The page has one `h1`, the hero headline, and one `main` from the hero through
the closing CTA. Header and footer sit outside it. Document titles inside the
artifact previews are `h4` with `h5` sections, styled as before. Fictional demo
text stays visible and crawlable.

## Reveal without scripts

`.reveal` blocks are visible by default. `RevealOnScroll` creates its
IntersectionObserver first. It then marks only blocks below the viewport
`data-pending`, which hides them, and clears the mark as each scrolls in. Blocks
already on screen are never hidden. If scripts fail to load, or the observer
throws, every block stays readable. The transition runs only on the way in, so
the hide is instant. A `(scripting: enabled)` media query was not enough. It
matches when scripts are allowed but their requests fail.

## Analytics

The root layout loads the Google tag (`gtag.js`, measurement ID `G-HYJXB4GMHZ`)
through `next/script` with `afterInteractive`, so every route reports page
views, playgrounds included. There is no consent banner.

## Verification

`pnpm --filter @convoy/landing test:seo` reads the prerendered output after
`pnpm landing:build` without a server. It checks absolute canonical and social
URLs, the title, description and search terms, card size and alt text, JSON-LD,
crawler files, all 13 playground pages,
the 404 status, the Google tag, repository hrefs and the `LANDING_REPO_URL`
override.
`app/page.test.mjs` loads the built homepage with every script request aborted
and checks that all reveal blocks are visible, with one `h1` and one `main`.

Search Console ownership, sitemap submission and share-preview checks happen
after deployment and are not part of local acceptance.
