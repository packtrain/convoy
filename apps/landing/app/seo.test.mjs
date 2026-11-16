import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';

// Run after the landing build; reads prerendered output without a server. Contract: docs/specs/landing-seo.md.
const app = new URL('../.next/server/app/', import.meta.url);
const read = path => readFile(new URL(path, app), 'utf8');
const home = 'https://convoy.build/';
const defaultRepo = 'https://github.com/packtrain/convoy';
const meta = (html, key) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];
const crawlerFile = async prefix => read((await readdir(app)).find(name => name.startsWith(prefix) && name.endsWith('.body')));

test('homepage has canonical, social and theme metadata with absolute URLs', async () => {
  const html = await read('index.html');
  assert.equal(new URL(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]).href, home);
  assert.equal(new URL(meta(html, 'og:url')).href, home);
  assert.equal(meta(html, 'og:type'), 'website');
  assert.equal(meta(html, 'og:site_name'), 'Convoy');
  assert.equal(meta(html, 'og:locale'), 'en_US');
  assert.equal(meta(html, 'og:title'), meta(html, 'twitter:title'));
  assert.equal(meta(html, 'og:description'), meta(html, 'twitter:description'));
  assert.equal(new URL(meta(html, 'og:image')).pathname, '/opengraph-image.png');
  assert.ok(meta(html, 'og:image').startsWith('https://convoy.build/'));
  assert.equal(meta(html, 'og:image:width'), '1200');
  assert.equal(meta(html, 'og:image:height'), '630');
  assert.match(meta(html, 'og:image:alt') ?? '', /^Convoy: \S.*\.$/, 'alt text has no stray whitespace');
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
  assert.equal(new URL(meta(html, 'twitter:image')).href, new URL('/opengraph-image.png', home).href);
  assert.equal(meta(html, 'theme-color'), '#08080d');
  for (const icon of ['rel="icon"', 'rel="apple-touch-icon"', 'rel="manifest"']) assert.ok(html.includes(icon), icon);
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1, 'one document H1');
  assert.equal(html.match(/<main[\s>]/g)?.length, 1, 'one main landmark');
});

test('title and description carry the category term and the runtime names', async () => {
  const html = await read('index.html');
  assert.equal(html.match(/<title>([^<]*)<\/title>/)?.[1], 'Convoy | The software factory for AI coding agents');
  const description = meta(html, 'description');
  for (const runtime of ['Claude Code', 'Codex', 'OpenCode', 'Cursor']) assert.ok(description.includes(runtime), runtime);
  assert.ok(description.length <= 160, `description is ${description.length} characters`);
});

test('homepage copy uses searched terms and never claims open source', async () => {
  const text = (await read('index.html')).replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
  for (const term of [/web UI/, /Control it remotely/, /Self-host Convoy/]) assert.match(text, term);
  assert.doesNotMatch(text, /open[- ]source/i, 'Elastic License 2.0 is source-available');
});

test('homepage JSON-LD describes the website and cannot close its script', async () => {
  const html = await read('index.html');
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => m[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotMatch(scripts[0], /</);
  assert.deepEqual(JSON.parse(scripts[0]), { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Convoy', url: home });
});

test('homepage loads the Google tag with the production measurement ID', async () => {
  const html = await read('index.html');
  assert.ok(html.includes('https://www.googletagmanager.com/gtag/js?id=G-HYJXB4GMHZ'), 'gtag.js script');
  assert.match(html, /gtag\('config', ?'G-HYJXB4GMHZ'\)/);
});

test('robots allows crawling and points at the production sitemap', async () => {
  const robots = await crawlerFile('robots');
  assert.match(robots, /^Allow: \/$/m);
  assert.doesNotMatch(robots, /Disallow/, 'playgrounds and static assets stay crawlable so noindex is read');
  assert.match(robots, /^Sitemap: https:\/\/convoy\.build\/sitemap\.xml$/m);
});

test('sitemap lists only the homepage without invented dates', async () => {
  const sitemap = await crawlerFile('sitemap');
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]), [home]);
  assert.doesNotMatch(sitemap, /lastmod|priority|changefreq/);
});

test('share card is a 1200 × 630 PNG under 200 KB with alt text', async () => {
  const png = await readFile(new URL('opengraph-image.png', import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  assert.ok(png.length <= 200 * 1024, `share card is ${png.length} bytes`);
  assert.ok((await stat(new URL('opengraph-image.alt.txt', import.meta.url))).size > 10);
});

test('every playground page is noindex and has no homepage canonical', async () => {
  const pages = ['playground.html', ...(await readdir(new URL('playground/', app))).filter(n => n.endsWith('.html')).map(n => `playground/${n}`)];
  assert.equal(pages.length, 13);
  for (const page of pages) {
    const html = await read(page);
    assert.equal(meta(html, 'robots'), 'noindex, nofollow', page);
    assert.doesNotMatch(html, /rel="canonical"/, page);
  }
});

test('missing pages return 404', async () => {
  assert.equal(JSON.parse(await read('_not-found.meta')).status, 404);
});

test('every repository link uses the configured repository URL', async () => {
  const html = await read('index.html');
  const links = [...html.matchAll(/href="(https:\/\/github\.com[^"]*)"/g)].map(m => m[1]);
  assert.equal(links.length, 5, 'header, hero, self-hosting, closing CTA and footer');
  for (const link of links) assert.equal(link, defaultRepo);
  assert.match(html, />packtrain\/convoy</, 'self-hosting label names the repository');
  assert.match(html, /href="https:\/\/docs\.convoy\.build\/docs"/, 'footer links the docs index, not the redirecting root');
  assert.match(html, /href="https:\/\/docs\.convoy\.build\/docs\/deployment"[^>]*>How to self-host/, 'self-hosting section links the deployment guide');
});

test('LANDING_REPO_URL overrides the repository and blank falls back to the default', async () => {
  const load = async value => {
    process.env.LANDING_REPO_URL = value;
    return (await import(`../lib/copy.ts?repo=${encodeURIComponent(value)}`)).site.repoUrl;
  };
  try {
    assert.equal(await load('https://github.com/example/fork'), 'https://github.com/example/fork');
    assert.equal(await load(' '), defaultRepo);
  } finally { delete process.env.LANDING_REPO_URL; }
});
