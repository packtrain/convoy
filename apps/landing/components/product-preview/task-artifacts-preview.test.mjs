import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Task artifacts switch the open document locally and reflow without overflow", async (t) => {
  const directory=await mkdtemp(join(tmpdir(),"convoy-task-artifacts-test-"));
  let browser;
  try {
    await build({stdin:{contents:`import {createRoot} from 'react-dom/client'; import {TaskArtifactsPreview} from './components/product-preview/task-artifacts'; createRoot(document.getElementById('root')).render(<TaskArtifactsPreview />);`,resolveDir:fileURLToPath(new URL("../../",import.meta.url)),loader:"tsx"},bundle:true,outfile:join(directory,"preview.js"),jsx:"automatic",minify:true,define:{"process.env.NODE_ENV":'"production"'}});
    await writeFile(join(directory,"index.html"),`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`file://${join(directory,"index.html")}`);

    const preview=page.getByRole("region",{name:"Task artifacts preview"});
    const doc=page.getByRole("region",{name:"Open artifact"});
    const plan=page.getByRole("button",{name:/Implementation plan/});
    const report=page.getByRole("button",{name:/Test report/});
    await preview.waitFor();
    await t.test("initial HTML lists outputs and opens the plan",async()=>{
      assert.equal(await page.getByRole("list",{name:"Resources"}).getByRole("listitem").count(),3);
      assert.equal(await plan.getAttribute("aria-pressed"),"true");
      assert.equal(await doc.getByRole("heading",{level:4}).textContent(),"Webhook delivery retries");
      assert.equal(await page.locator('[contenteditable="true"],textarea,input').count(),0);
      await page.screenshot({path:"/tmp/task-artifacts-desktop.png",fullPage:true});
    });
    await t.test("keyboard selects another artifact",async()=>{
      await report.focus();
      assert.equal(await report.evaluate(el=>getComputedStyle(el).outlineStyle),"solid");
      await page.keyboard.press("Enter");
      assert.equal(await report.getAttribute("aria-pressed"),"true");
      assert.equal(await plan.getAttribute("aria-pressed"),"false");
      assert.equal(await doc.getByRole("heading",{level:4}).textContent(),"Retry test report");
      assert.equal(await doc.getByText("HTML",{exact:true}).count(),1);
    });
    await t.test("narrow container stacks the document below resources",async()=>{
      await page.locator("#root").evaluate(el=>{el.style.width="600px"});
      const list=await page.getByRole("list",{name:"Resources"}).boundingBox(),panel=await doc.boundingBox();
      assert(panel.y>=list.y+list.height);
      await page.locator("#root").evaluate(el=>{el.style.width=""});
    });
    await t.test("mobile and reduced motion remain readable",async()=>{
      await page.setViewportSize({width:390,height:900});
      await page.emulateMedia({reducedMotion:"reduce"});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await doc.locator("p").first().evaluate(el=>getComputedStyle(el).fontSize),"16px");
      await page.screenshot({path:"/tmp/task-artifacts-mobile.png",fullPage:true});
      assert.deepEqual(errors,[]);
    });
  } finally { await browser?.close();await rm(directory,{recursive:true,force:true}); }
});
