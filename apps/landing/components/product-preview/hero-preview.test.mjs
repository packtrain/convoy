import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("hero selection, disclosure, product styles and mobile layout", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-hero-test-"));
  let browser;
  try {
    await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';
          import {HeroPreview} from './components/product-preview';
          createRoot(document.getElementById('root')).render(<HeroPreview />);`,
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
      <style>body{margin:0;padding:24px}*{box-sizing:border-box}${css}</style>
      <div id="root"></div><script>${js}</script></html>`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1560, height: 940 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(new URL(`file://${join(directory, "index.html")}`).href);
    await page.getByRole("heading", { level: 2, name: "Add retry handling for failed deliveries" }).waitFor();
    const composer = page.getByRole("region", { name: "Thread composer", exact:true });
    const toolGroup = page.locator("details").filter({ hasText: "3 tool calls" });
    await t.test("navigation glyphs match product size", async () => {
      const bell = page.getByRole("complementary", {name:"Example workspace navigation"}).locator("svg.lucide-bell");
      assert.equal(await bell.evaluate(el=>el.getBoundingClientRect().width), 16);
    });
    await t.test("new thread glyph matches product size", async () => {
      const icon = page.getByRole("complementary", {name:"Example threads"}).getByText("New thread", {exact:false}).locator("svg").first();
      assert.equal(await icon.evaluate(el=>el.getBoundingClientRect().width), 16);
    });
    await t.test("connected machine metadata matches product", async () => {
      const stamp = page.getByText("Just now", {exact:true});
      assert.equal(await stamp.evaluate(el=>getComputedStyle(el).fontSize), "11px");
    });
    await t.test("task glyph uses the product task type", async () => {
      await page.getByRole("button", {name:/NS-130/}).click();
      assert.equal(await page.locator('header svg.lucide-square-check-big').count(), 1);
      await page.getByRole("button", {name:/NS-142/}).click();
    });
    await page.getByRole("button", {name:/NS-142/}).click();
    await t.test("thread header retains product actions", async () => {
      assert.equal(await page.locator("header").getByText("Mark as done", {exact:true}).count(), 1);
    });
    await t.test("assistant results use ordinary markdown bullets", async () => {
      const item = page.getByText("Retries stop after a successful delivery", {exact:true});
      assert.equal(await item.locator("svg").count(), 0);
      assert.equal(await item.evaluate(el=>getComputedStyle(el.parentElement).listStyleType), "disc");
    });
    await t.test("real SVG wordmark", async () => {
      assert.equal(await page.getByRole("img", {name:"Convoy",exact:true}).count(), 1);
    });
    await t.test("no invented conversation status or demo footer", async () => {
      assert.equal(await page.getByText(/Completed.*Ready for review/).count(), 0);
    });
    await t.test("no invented composer footer", async () => {
      assert.equal(await page.getByText("Example conversation", {exact:false}).count(), 0);
    });
    await t.test("composer strip has product height", async () => {
      const strip = composer.locator("[data-composer-context]");
      assert.equal(await strip.evaluate(el=>el.getBoundingClientRect().height), 45);
    });
    await t.test("composer uses the light primary send button", async () => {
      const send = page.locator('svg.lucide-corner-down-left').locator('..').first();
      assert.equal(await send.evaluate(el=>getComputedStyle(el).backgroundColor), "rgb(206, 206, 206)");
      assert.equal(await send.evaluate(el=>getComputedStyle(el).opacity), "1");
    });
    await t.test("context strip uses four pixel gaps and a real usage ring", async () => {
      assert.equal(await page.locator('svg.lucide-circle-gauge').count(), 0);
      assert(await page.locator('svg circle[r="7.5"]').count() >= 2);
    });
    await t.test("thread list has product sections, connected CLI and runtime icons", async () => {
      const list = page.getByRole("complementary", {name:"Example threads"});
      for (const section of ["Connected CLIs", "Pinned", "Active", "Done"]) {
        assert.equal(await list.getByText(section, {exact:true}).count(), 1);
      }
      assert(await list.getByRole("button", {pressed:false}).count() >= 12);
      assert(await list.locator('[aria-label="Codex"]').count() > 0);
      assert(await list.locator('[aria-label="Claude Code"]').count() > 0);
    });
    await t.test("project Threads entry and collapsed projects exist", async () => {
      const nav = page.getByRole("complementary", {name:"Example workspace navigation"});
      assert.equal((await Promise.all((await nav.getByText("Threads", {exact:true}).all()).map(el=>el.isVisible()))).filter(Boolean).length, 1, "Only the project Threads entry; no muted global Threads");
      assert(await nav.locator('details:not([open])').count() >= 2);
    });
    await t.test("task sidebar includes activity composer and history", async () => {
      const side = page.getByRole("complementary", {name:"Task details"});
      assert.equal(await side.getByRole("heading", {name:"Activity",exact:true}).count(), 1);
      assert.equal(await side.getByPlaceholder("Start a new thread...").count(), 1);
      assert(await side.getByText('updated artifact', {exact:false}).count() >= 2);
    });
    await t.test("activity comment keeps the product eight pixel separation", async () => {
      const activity = page.getByRole("region", {name:"Activity composer", exact:true});
      const comment = page.getByText("Add comment...", {exact:true});
      const bottom = await activity.evaluate(el=>el.getBoundingClientRect().bottom);
      assert.equal(await comment.evaluate(el=>el.getBoundingClientRect().top) - bottom, 8);
    });
    await t.test("activity context controls avoid empty fixed-width space", async () => {
      await page.setViewportSize({width:2000,height:1000});
      const directory = page.getByRole("region", {name:"Activity composer", exact:true}).getByTitle("Local Dev / workspace");
      const extra = await directory.evaluate(el => {
        const children = [...el.children];
        return el.getBoundingClientRect().width - children.reduce((sum,child)=>sum+child.getBoundingClientRect().width,0);
      });
      assert(Math.abs(extra - 38) < 1, `Expected padding, borders and two gaps only; got ${extra}`);
      await page.setViewportSize({width:1560,height:940});
    });
    await t.test("composer focus uses a neutral border without an inner outline or halo", async () => {
      for (const name of ["Thread composer", "Activity composer"]) {
        const textarea = page.getByRole("region", {name,exact:true}).getByRole("textbox");
        await textarea.focus();
        assert.equal(await textarea.evaluate(el=>getComputedStyle(el).outlineStyle), "none");
        assert.equal(await textarea.evaluate(el=>getComputedStyle(el.parentElement).borderTopColor), "rgb(115, 115, 115)");
        assert.equal(await textarea.evaluate(el=>getComputedStyle(el.parentElement).boxShadow), "none");
      }
    });
    await t.test("notifications use normal navigation contrast", async () => {
      const color = async (text) => page.getByText(text, { exact: true }).evaluate(el => getComputedStyle(el).color);
      assert.equal(await color("Notifications"), await color("Add task"));
    });
    await t.test("composer context strip has border and workspace details", async () => {
      const strip = composer.locator("[data-composer-context]");
      assert.equal(await strip.evaluate(el => getComputedStyle(el).borderTopWidth), "1px");
      assert.equal(await composer.getByText("main", { exact: true }).count(), 1);
    });
    await t.test("composer selector arrows match product size", async () => {
      const arrow = composer.getByRole("button", {name:"Agent mode: Act",exact:true}).locator("svg").last();
      assert.equal(await arrow.evaluate(el => el.getBoundingClientRect().width), 12);
      assert.equal(await arrow.evaluate(el => getComputedStyle(el).opacity), "0.5");
    });
    await t.test("task types vary across thread rows", async () => {
      const rows = page.getByRole("complementary", { name: "Example threads" });
      assert(await rows.locator('svg[aria-label="bug"]').count() >= 1);
      assert(await rows.locator('svg[aria-label="epic"]').count() >= 1);
      assert(await rows.locator('svg[aria-label="feature"]').count() >= 1);
    });
    await t.test("right sidebar shows the selected task", async () => {
      assert.equal(await page.getByRole("complementary", {name:"Task details"}).count(), 1);
      assert(await page.getByRole("complementary", {name:"Task details"}).getByText("Add retry handling for failed deliveries", {exact:true}).first().isVisible());
    });
    assert.equal(await page.getByRole("complementary", { name: "Example threads" })
      .evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(24, 24, 24)");
    assert.equal(await page.getByText("Add retries for failed webhook deliveries. Use exponential backoff and keep the delivery history on the task.", { exact: true })
      .evaluate((element) => getComputedStyle(element).borderRadius), "8px");
    assert.equal(await page.locator("details").filter({ has: page.locator("summary", {hasText:/tool calls/}) }).getAttribute("open"), null);
    await toolGroup.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert(await page.getByText("src/queues/webhooks.ts", { exact: true }).isVisible());
    await page.getByRole("button", { name: /NS-139/ }).click();
    assert(await page.getByRole("heading", { level: 2, name: "Review the webhook delivery plan" }).isVisible());
    assert.equal(await page.locator("details").filter({ has: page.locator("summary", {hasText:/tool calls/}) }).getAttribute("open"), null);
    assert.equal(await page.getByRole("button", { name: /NS-139/ }).getAttribute("aria-pressed"), "true");
    assert.equal(await composer.getByRole("textbox").getAttribute("readonly"), "");
    assert(await page.getByRole("complementary", {name:"Task details"}).getByRole("heading", {name:"Review the webhook delivery plan"}).isVisible());
    await page.getByRole("button", {name:"Close task details"}).click();
    assert.equal(await page.getByRole("complementary", {name:"Task details"}).count(), 0);
    await page.getByRole("button", {name:"Toggle task details"}).click();
    assert(await page.getByRole("complementary", {name:"Task details"}).isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox").selectOption("NS-136");
    assert(await page.getByRole("heading", { level: 2, name: "Keep delivery filters in the URL" }).isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", {name:"Toggle task details"}).click();
    assert(await page.getByRole("complementary", {name:"Task details"}).isVisible());
    await page.getByRole("button", {name:"Close task details"}).click();
    assert.equal(await page.getByRole("complementary", {name:"Task details"}).count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("combobox").selectOption("NS-142");
    assert(await page.getByRole("heading", { level: 2, name: "Add retry handling for failed deliveries" }).isVisible());
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
