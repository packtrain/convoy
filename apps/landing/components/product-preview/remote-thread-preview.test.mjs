import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Mobile remote thread keeps its composer visible and disclosure local", async () => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-remote-test-"));
  let browser;
  try {
    await build({stdin: {contents: `import {createRoot} from 'react-dom/client'; import {RemoteThreadPreview} from './components/product-preview/remote-thread'; createRoot(document.getElementById('root')).render(<RemoteThreadPreview />);`, resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx"}, bundle: true, outfile: join(directory,"preview.js"), jsx: "automatic", minify: true, define: {"process.env.NODE_ENV": '"production"'}});
    await writeFile(join(directory,"index.html"), `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 414, height: 900}});
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(`file://${join(directory,"index.html")}`);
    const phone = page.getByRole("region", {name: "Mobile remote thread preview", exact: true});
    await phone.waitFor();
    const titleEnd = await phone.locator("h2").evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().right; });
    const add = await page.getByRole("button", {name:"Add thread to group", exact:true}).boundingBox();
    assert(add.x - titleEnd <= 16, "Add thread must sit beside the title, as in the product header");
    const summary = phone.locator("summary");
    const composer = page.getByRole("region", {name: "Thread composer", exact: true});
    const before = await composer.boundingBox();
    await summary.focus();
    await page.keyboard.press("Enter");
    assert.equal(await phone.locator("details").getAttribute("open"), "");
    assert(await phone.locator("pre").isVisible());
    assert.equal((await composer.boundingBox()).y, before.y, "Tool output must scroll without pushing composer");
    await page.keyboard.press("Space");
    assert.equal(await phone.locator("details").getAttribute("open"), null);
    await page.emulateMedia({reducedMotion: "reduce"});
    for (const width of [414, 390, 354, 320]) {
      await page.setViewportSize({width, height: 900});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const frame = await phone.boundingBox();
      const send = await page.getByRole("button", {name: "Send message", exact: true}).boundingBox();
      assert(send.x + send.width <= frame.x + frame.width - 16, `Send fits at ${width}px`);
      assert.equal(await page.getByRole("region", {name:"Thread conversation"}).evaluate(el => getComputedStyle(el).fontSize), "14px");
    }
    const desktop = page.locator("[data-desktop-backdrop]");
    assert.equal(await desktop.isVisible(), false, "No desktop backdrop beside a phone-width frame");
    await page.setViewportSize({width: 1000, height: 900});
    const screen = await desktop.boundingBox();
    const phoneBox = await phone.boundingBox();
    assert(screen.width > phoneBox.width && screen.height < phoneBox.height, "Desktop sits behind the phone, wider but not full height");
    assert(Math.abs(screen.width / screen.height - 1.6) < 0.02, "Desktop backdrop keeps a 16:10 laptop ratio");
    assert.equal(await desktop.getAttribute("aria-hidden"), "true");
    assert.equal(await desktop.evaluate(el => el.inert), true);
    assert.match(await desktop.evaluate(el => getComputedStyle(el).filter), /blur/);
    await page.setViewportSize({width: 414, height: 900});
    assert.equal(await phone.getByRole("textbox").getAttribute("readonly"), "");
    await page.getByRole("button", {name: "Send message", exact: true}).click({force: true});
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(directory, {recursive: true, force: true}); }
});

test("Built playground fits its phone frame on mobile", async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.route("**/*", async route => {
      const path = new URL(route.request().url()).pathname;
      const relative = path.startsWith("/_next/static/") ? `.next/static/${path.slice(14)}` : path === "/playground/remote-thread" ? ".next/server/app/playground/remote-thread.html" : null;
      if (!relative) { await route.abort(); return; }
      const file = new URL(`../../${relative}`, import.meta.url);
      const contentType = relative.endsWith(".html") ? "text/html" : relative.endsWith(".css") ? "text/css" : relative.endsWith(".js") ? "application/javascript" : "font/woff2";
      await route.fulfill({body: await readFile(file), contentType});
    });
    await page.goto("https://convoy.localhost/playground/remote-thread");
    await page.getByRole("heading", {name:"Remote thread preview", exact:true}).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Playground grid must not overflow the mobile viewport");
  } finally { await browser.close(); }
});
