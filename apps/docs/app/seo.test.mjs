import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Run after `pnpm docs:build`; reads prerendered output without a server.
// Contract: docs/specs/docs-seo.md.
const app = new URL("../", import.meta.url);
const out = new URL("build/client/", app);
const read = (path) => readFile(new URL(path, out), "utf8");
const origin = "https://docs.convoy.build";
const card = `${origin}/og.png`;
const meta = (html, key) =>
  html.match(
    new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`),
  )?.[1];
const canonical = (html) =>
  html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
const title = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1];
const files = async (dir, suffix) =>
  (await readdir(new URL(dir, app), { recursive: true })).filter((file) =>
    file.endsWith(suffix),
  );

// Route path of every prerendered docs page, e.g. "/docs/using/checks".
const routes = (await files("build/client/docs/", "index.html"))
  .map((file) => `/docs/${file}`.replace(/\/?index\.html$/, ""))
  .sort();
const pages = await Promise.all(
  routes.map(async (route) => ({
    route,
    html: await read(`${route.slice(1)}/index.html`),
  })),
);
const vercel = JSON.parse(
  await readFile(new URL("vercel.json", app), "utf8").catch(() => "{}"),
);

test("every content file is prerendered", async () => {
  assert.equal(routes.length, (await files("content/docs/", ".mdx")).length);
  assert.ok(routes.includes("/docs"), "docs index");
});

test("titles carry the site name and the h1 does not", () => {
  for (const { route, html } of pages) {
    assert.match(title(html) ?? "", /^\S.* \| Convoy Docs$/, route);
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/g);
    assert.equal(h1?.length, 1, `${route} has one h1`);
    assert.doesNotMatch(h1[0], /Convoy Docs/, route);
  }
});

test("every page has a self-referencing canonical and social tags", () => {
  for (const { route, html } of pages) {
    const description = meta(html, "description");
    assert.ok(description, `${route} has a description`);
    assert.equal(canonical(html), origin + route, route);
    assert.equal(meta(html, "og:url"), origin + route, route);
    assert.equal(meta(html, "og:type"), "website", route);
    assert.equal(meta(html, "og:site_name"), "Convoy Docs", route);
    assert.equal(meta(html, "og:title"), title(html), route);
    assert.equal(meta(html, "og:description"), description, route);
    assert.equal(meta(html, "og:image"), card, route);
    assert.equal(meta(html, "og:image:width"), "1200", route);
    assert.equal(meta(html, "og:image:height"), "630", route);
    assert.ok(meta(html, "og:image:alt"), `${route} has card alt text`);
    assert.equal(meta(html, "twitter:card"), "summary_large_image", route);
    assert.equal(meta(html, "twitter:title"), title(html), route);
    assert.equal(meta(html, "twitter:description"), description, route);
    assert.equal(meta(html, "twitter:image"), card, route);
  }
});

test("share card is a 1200 × 630 PNG under 200 KB", async () => {
  const png = await readFile(new URL("og.png", out));
  assert.equal(png.toString("ascii", 1, 4), "PNG");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  assert.ok(png.length <= 200 * 1024, `share card is ${png.length} bytes`);
});

test("nav links the landing site and the logo links the docs index", () => {
  const logoLink =
    /<a [^>]*href="\/docs"[^>]*><span[^>]*><svg aria-label="Convoy"/;
  for (const { route, html } of pages) {
    assert.match(html, /<a [^>]*href="https:\/\/convoy\.build"/, route);
    assert.doesNotMatch(html, /<a [^>]*href="\/"/, `${route} links the root`);
    assert.match(html, logoLink, `${route} logo`);
  }
});

test("robots allows crawling and points at the sitemap", async () => {
  const robots = await read("robots.txt");
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.doesNotMatch(robots, /Disallow/);
  assert.match(
    robots,
    /^Sitemap: https:\/\/docs\.convoy\.build\/sitemap\.xml$/m,
  );
});

test("sitemap lists exactly the prerendered docs pages without dates", async () => {
  const sitemap = await read("sitemap.xml");
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset /);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(
    locs.sort(),
    routes.map((route) => origin + route),
  );
  assert.doesNotMatch(sitemap, /lastmod|priority|changefreq|llms/);
});

test("missing pages get the SPA shell as 404.html", async () => {
  const shell = await read("404.html");
  assert.equal(shell, await read("__spa-fallback.html"));
  assert.match(shell, /"isSpaMode":true/, "a prerendered page would reload");
});

test("Vercel serves 404.html instead of the preset's SPA fallback", () => {
  assert.ok("framework" in vercel, "vercel.json sets framework");
  assert.equal(vercel.framework, null, "the React Router preset is off");
  assert.equal(vercel.outputDirectory, "build/client");
  assert.equal(vercel.rewrites, undefined, "no catch-all rewrite");
  assert.equal(vercel.routes, undefined, "no legacy routes");
});

test("the root redirects to the docs index", async () => {
  assert.deepEqual(vercel.redirects, [
    { source: "/", destination: "/docs", permanent: true },
  ]);
  assert.equal(vercel.trailingSlash, false, "one URL per page");
  // Hosts without redirects serve the prerendered root.
  const html = await read("index.html");
  assert.equal(title(html), "Convoy Docs");
  assert.equal(canonical(html), `${origin}/docs`);
});

test("retitled pages lead with the searched wording", () => {
  const expected = {
    "/docs/using/ai-threads":
      "A web UI for Claude Code, Codex, OpenCode and Antigravity",
    "/docs/using/skills": "Share agent skills across your team",
    "/docs/deployment/self-hosting-convex":
      "Self-hosted coding agents: Docker deployment",
    "/docs/reference/roadmap":
      "Claude Code, Codex, OpenCode, Cursor and Antigravity support",
  };
  for (const [route, heading] of Object.entries(expected)) {
    const { html } = pages.find((page) => page.route === route);
    assert.equal(title(html), `${heading} | Convoy Docs`, route);
    assert.ok(meta(html, "description").length <= 160, `${route} description`);
  }
});
