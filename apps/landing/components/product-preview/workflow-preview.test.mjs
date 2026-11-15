import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("workflow scene preserves product geometry and readable crops", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-workflow-test-"));
  let browser;
  try {
    await build({
      stdin: { contents: `import {createRoot} from 'react-dom/client'; import {WorkflowPreview} from './components/product-preview'; createRoot(document.getElementById('root')).render(<WorkflowPreview />);`, resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx" },
      bundle: true, outfile: join(directory, "preview.js"), jsx: "automatic", minify: true, define: { "process.env.NODE_ENV": '"production"' },
    });
    await writeFile(join(directory, "index.html"), `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({viewport:{width:1040,height:900}});
    const errors=[];
    page.on("pageerror", e=>errors.push(e.message));
    await page.goto(`file://${join(directory,"index.html")}`);
    await page.getByRole("table").waitFor();
    await t.test("source-sized lanes and step shells", async () => {
      const stage = await page.getByRole("columnheader").first().evaluate(el=>el.getBoundingClientRect().width);
      const frame = await page.getByRole("region").evaluate(el=>el.clientWidth);
      assert(stage >= 160, `Stage column keeps at least 160px, got ${stage}`);
      assert.equal(stage + 640, frame, "Stage column absorbs the spare width so no blank strip follows the lanes");
      const edges = await page.locator('[role="row"] > :last-child, [aria-hidden="true"] > span:last-child').evaluateAll(els=>els.map(el=>getComputedStyle(el).borderRightWidth));
      assert.deepEqual([...new Set(edges)], ["0px"], "Last lane leaves the right edge to the frame border, so it is not doubled");
      assert.equal(await page.getByRole("columnheader").nth(1).evaluate(el=>el.getBoundingClientRect().width),320);
      assert.equal(await page.locator('[data-workflow-card="prompt"]').count(),3);
      assert.equal(await page.locator('[data-workflow-card="wait"]').count(),1);
      assert.equal(await page.locator('[data-workflow-card="bash"]').count(),1);
      assert.equal(await page.locator('[data-workflow-card="prompt"]').first().evaluate(el=>getComputedStyle(el).borderRadius),"8px");
    });
    await t.test("lane selector uses product small-button type size", async () => {
      assert.equal(await page.getByText("Parallel",{exact:true}).evaluate(el=>getComputedStyle(el).fontSize),"12.8px");
    });
    await t.test("parallel runtime uses the product runtime name", async () => {
      assert.equal(await page.getByText("Claude Code",{exact:true}).count(),1);
    });
    await t.test("mobile starts with a complete readable card", async () => {
      await page.setViewportSize({width:390,height:844});
      const card=await page.locator('[data-workflow-card="prompt"]').first().boundingBox();
      assert(card.x >= 0 && card.x + card.width <= 390, "First card should be fully visible without horizontal scrolling");
      assert.equal(await page.locator("h4").first().evaluate(el=>getComputedStyle(el).fontSize),"14px");
      assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    });
    await t.test("keyboard scrolling reveals the parallel lane", async () => {
      const scroll=page.getByRole("region");
      await scroll.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(()=>document.querySelector('[role="region"]').scrollLeft > 0);
      assert(await scroll.evaluate(el=>el.scrollLeft>0));
      assert.equal(await scroll.evaluate(el=>getComputedStyle(el).outlineStyle),"solid");
      assert.equal(await page.getByRole("button").count(),0);
      assert.deepEqual(errors,[]);
    });
  } finally {
    await browser?.close();
    await rm(directory,{recursive:true,force:true});
  }
});
