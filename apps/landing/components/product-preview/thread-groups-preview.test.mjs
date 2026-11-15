import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Thread group preview matches the single-container layout", async (t) => {
  const directory=await mkdtemp(join(tmpdir(),"convoy-groups-test-"));
  let browser;
  try {
    await build({stdin:{contents:`import {createRoot} from 'react-dom/client'; import {ThreadGroupsPreview} from './components/product-preview/thread-groups'; createRoot(document.getElementById('root')).render(<ThreadGroupsPreview />);`,resolveDir:fileURLToPath(new URL("../../",import.meta.url)),loader:"tsx"},bundle:true,outfile:join(directory,"preview.js"),jsx:"automatic",minify:true,define:{"process.env.NODE_ENV":'"production"'}});
    await writeFile(join(directory,"index.html"),`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1100,height:1100}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`file://${join(directory,"index.html")}`);


    const preview=page.locator("section").first();
    await preview.waitFor();
    await t.test("single container starts with three tabs and no sharing chrome",async()=>{
      assert.equal(await page.getByText("Owner’s sharing control",{exact:true}).count(),0);
      assert.equal(await page.getByText("Read-only",{exact:true}).count(),0);
      assert.equal(await page.getByRole("tab").count(),3);
      const frame=await preview.boundingBox(), tabs=await page.getByRole("tablist").boundingBox();
      assert(tabs.y-frame.y<=2,"Tabs must be the first row");
      assert.equal(tabs.height,56);
      assert.equal(await page.getByRole("tablist").getByText("NS-142",{exact:true}).count(),1);
      assert.equal(await page.getByRole("tablist").getByText("NS-145",{exact:true}).count(),1);
      assert.equal(await page.getByRole("tablist").getByText("NS-146",{exact:true}).count(),1);
      assert.equal(await page.getByRole("tab").nth(1).locator("svg").evaluate(el=>getComputedStyle(el).color),"rgb(34, 197, 94)");
      assert.equal(await page.getByRole("tab").nth(2).locator("svg").evaluate(el=>getComputedStyle(el).color),"rgb(100, 116, 139)");
      const ref=page.getByRole("tab").first().getByText("NS-142",{exact:true});
      assert.equal(await ref.evaluate(el=>getComputedStyle(el).fontSize),"12px");
      assert.equal(await page.getByRole("tab").first().locator("svg").evaluate(el=>getComputedStyle(el).color),"rgb(239, 68, 68)");
      assert.equal(await page.getByRole("tablist").locator("svg").count(),4,"Three task icons and plus, no status dots");
    });
    await t.test("switching tabs changes transcript by keyboard and pointer",async()=>{
      await page.getByRole("tab",{name:"Add webhook retries",exact:true}).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab",{name:"Review retry handling",exact:true}).getAttribute("aria-selected"),"true");
      assert.equal(await page.getByRole("tabpanel").getByText(/One case needs a change/).count(),1);
      await page.keyboard.press("End");
      assert.equal(await page.getByRole("tab",{name:"Test retry limits",exact:true}).getAttribute("aria-selected"),"true");
      assert.equal(await page.getByRole("tabpanel").getByText(/All retry tests pass/).count(),1);
      await page.getByRole("tab",{name:"Add webhook retries",exact:true}).click();
      assert.equal(await page.getByRole("tabpanel").getByText(/The retry tests pass/).count(),1);
    });
    await t.test("mobile and narrow sections preserve text and fit",async()=>{
      await page.setViewportSize({width:390,height:1000});
      await page.emulateMedia({reducedMotion:"reduce"});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await page.getByRole("tabpanel").evaluate(el=>getComputedStyle(el).fontSize),"14px");
      const strip=await page.getByRole("tablist").evaluate(el=>({overflows:el.scrollWidth>el.clientWidth,scrollbar:getComputedStyle(el).scrollbarWidth}));
      assert(strip.overflows&&strip.scrollbar==="none","Overflowing tabs scroll without a visible scrollbar");
      await page.getByRole("tab",{name:"Review retry handling",exact:true}).click();
      assert.equal(await page.getByRole("tabpanel").getByText(/One case needs a change/).count(),1);
      await page.locator("#root").evaluate(el=>{el.style.width="330px"});
      const composer=await page.getByRole("region",{name:"Thread composer",exact:true}).boundingBox();
      const send=await page.getByRole("button",{name:"Send message",exact:true}).boundingBox();
      assert(send.x+send.width<=composer.x+composer.width-16,"Send stays inside narrow composer");
      assert.deepEqual(errors,[]);
    });
  } finally { await browser?.close();await rm(directory,{recursive:true,force:true}); }
});
