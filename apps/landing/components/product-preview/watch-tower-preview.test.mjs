import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Watch Tower navigation, layouts and responsive crops", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-hero-test-"));
  let browser;
  try {
    await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';
          import {HeroPreview} from './components/product-preview';
          import {WatchTowerPreview} from './components/product-preview/watch-tower';
          createRoot(document.getElementById('root')).render(location.search ? <WatchTowerPreview crop /> : <HeroPreview />);`,
        resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
        loader: "tsx",
      },
      bundle: true,
      outfile: join(directory, "preview.js"),
      jsx: "automatic",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const css = await readFile(join(directory, "preview.css"), "utf8");
    const js = await readFile(join(directory, "preview.js"), "utf8");
    await writeFile(join(directory, "index.html"), `<!doctype html>
      <html><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{margin:0;padding:24px}*{box-sizing:border-box}svg{display:block}${css}</style>
      <div id="root"></div><script>${js}</script></html>`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1560, height: 940 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL(`file://${join(directory, "index.html")}`).href);
    await page.getByRole("heading", { level: 2, name: "Add retry handling for failed deliveries" }).waitFor();
    await t.test("hero Watch Tower defaults to Board", async () => {
      await page.getByRole("button", {name:"Watch Tower",exact:true}).click();
      assert.equal(await page.locator('[data-watch-tower="board"]').count(), 1);
      assert.deepEqual(await page.locator('[data-watch-tower] h3').allTextContents(), ["Running", "Waiting for your input", "Failed", "Needs your review", "Done"]);
    });
    await page.locator('summary[aria-label="View settings"]').click();
    await page.getByRole("button", {name:"List",exact:true}).click();
    await t.test("source table geometry survives the landing SVG reset", async () => {
      const row = page.getByRole("button", {name:"Open thread Review the webhook delivery plan",exact:true});
      assert.equal(await row.evaluate(el=>el.getBoundingClientRect().height), 59);
    });
    await t.test("source table header has a 16px line height", async () => {
      const row = page.getByRole("button", {name:"Open thread Review the webhook delivery plan",exact:true});
      const tableHeader = row.locator('..').locator(':scope > div').first();
      assert.equal(await tableHeader.evaluate(el=>el.getBoundingClientRect().height), 32);
    });
    await t.test("settings switch board and retain it after opening a run", async () => {
      await page.locator('summary[aria-label="View settings"]').click();
      await page.getByRole("button", {name:"Board",exact:true}).click();
      assert.equal(await page.locator('[data-watch-tower="board"]').count(), 1);
      await page.getByRole("button", {name:"Open thread Review the webhook delivery plan",exact:true}).click();
      await page.getByText("Should retries share the original event's idempotency key?", {exact:false}).waitFor();
      await page.getByRole("button", {name:"Watch Tower",exact:true}).click();
      assert.equal(await page.locator('[data-watch-tower="board"]').count(), 1);
    });
    await t.test("board task icons retain task-type colors", async () => {
      for (const [title, icon, color] of [
        ["Review the webhook delivery plan", "layers", "rgb(139, 92, 246)"],
        ["Document webhook authentication", "square-check-big", "rgb(100, 116, 139)"],
        ["Fix the signup form validation", "bug", "rgb(239, 68, 68)"],
        ["Keep delivery filters in the URL", "sparkles", "rgb(34, 197, 94)"],
      ]) {
        const glyph = page.getByRole("button", {name:`Open thread ${title}`,exact:true}).locator(`svg.lucide-${icon}`);
        assert.equal(await glyph.evaluate(el=>getComputedStyle(el).color), color);
        assert.equal(await glyph.evaluate(el=>getComputedStyle(el).filter), "saturate(0.7)");
      }
    });
    await t.test("all board column headers have source-sized status dots", async () => {
      const headers = page.locator('[data-watch-tower="board"] section > header');
      assert.equal(await headers.locator('svg').count(), 5);
      for (const header of await headers.all()) {
        const dot=header.locator('svg');
        assert.equal(await dot.evaluate(el=>el.getBoundingClientRect().width),8);
        assert.equal(await dot.evaluate(el=>getComputedStyle(el).fill),await dot.evaluate(el=>getComputedStyle(el).color));
        assert.equal(await header.evaluate(el=>getComputedStyle(el).gap),"8px");
      }
    });
    await t.test("board uses product live status words", async () => {
      const waiting = page.getByRole("button", {name:"Open thread Review the webhook delivery plan",exact:true});
      assert.equal(await waiting.getByText("Waiting", {exact:true}).count(), 1);
    });
    await t.test("cross-project failure opens the matching project and transcript", async () => {
      await page.getByRole("button", {name:"Open thread Fix the signup form validation",exact:true}).click();
      await page.getByRole("heading", {name:"Fix the signup form validation",exact:true}).waitFor();
      await page.getByText("The run stopped because the test browser could not start.", {exact:false}).waitFor();
      assert.equal(await page.getByRole("complementary", {name:"Example threads"}).getByText("Website", {exact:true}).count(), 1);
      assert.equal(await page.getByRole("button", {name:"Toggle task details"}).isVisible(), false);
      await page.getByRole("complementary", {name:"Example workspace navigation"}).getByRole("button", {name:"Threads",exact:true}).click();
      await page.getByRole("heading", {level:2,name:"Add retry handling for failed deliveries",exact:true}).waitFor();
    });
    await t.test("keyboard settings and section filtering", async () => {
      await page.getByRole("button", {name:"Watch Tower",exact:true}).click();
      const trigger = page.locator('summary[aria-label="View settings"]');
      await trigger.focus(); await page.keyboard.press("Enter");
      await page.getByRole("button", {name:"List",exact:true}).click();
      await trigger.click();
      await page.getByLabel("Running", {exact:true}).uncheck();
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("heading", {name:"Running",exact:true}).count(), 0);
      assert.equal(await trigger.evaluate(el=>el===document.activeElement), true);
    });
    await page.screenshot({path:"/tmp/watch-tower-desktop.png"});
    await t.test("mobile list stays readable without page overflow", async () => {
      await page.setViewportSize({width:390,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), true);
      const title = page.locator('[data-watch-tower] strong').filter({hasText:"Review the webhook delivery plan"});
      assert.equal(await title.evaluate(el=>getComputedStyle(el).fontSize), "14px");
      await page.screenshot({path:"/tmp/watch-tower-mobile.png"});
    });
    await t.test("dedicated crop works in a narrow desktop slot and scrolls its board", async () => {
      await page.setViewportSize({width:1560,height:940});
      await page.goto(new URL(`file://${join(directory, "index.html")}?crop=1`).href);
      await page.locator('[data-watch-tower]').waitFor();
      assert.equal(await page.locator('[data-watch-tower="list"]').count(),1);
      await page.locator('#root').evaluate(el=>el.style.width='600px');
      const edge=await page.locator('[data-watch-tower]').evaluate(el=>({mask:getComputedStyle(el).maskImage,bottom:getComputedStyle(el).borderBottomWidth}));
      assert.match(edge.mask,/gradient/,"Crop fades out at the bottom like the other homepage cards");
      assert.equal(edge.bottom,"0px","Faded edge has no bottom border");
      assert.deepEqual(await page.locator('[data-watch-tower] h3').allTextContents(), ["Waiting for your input", "Failed", "Needs your review"]);
      assert.equal(await page.getByRole("button", {name:/Open thread/}).count(), 0);
      await page.locator('summary[aria-label="View settings"]').click();
      await page.getByRole("button", {name:"Board",exact:true}).click();
      const board=page.getByRole("region", {name:"Watch Tower board"});
      await board.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      assert.equal(await board.evaluate(el=>el.scrollLeft>0), true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(directory, {recursive:true,force:true}); }
});
