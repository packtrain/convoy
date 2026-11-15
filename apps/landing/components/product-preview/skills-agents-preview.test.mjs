import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Skills and agent crops preserve product fields and readable layout", async (t) => {
  const directory=await mkdtemp(join(tmpdir(),"convoy-skills-test-"));
  let browser;
  try {
    await build({stdin:{contents:`import {createRoot} from 'react-dom/client'; import {SkillsAgentsPreview} from './components/product-preview'; createRoot(document.getElementById('root')).render(<SkillsAgentsPreview />);`,resolveDir:fileURLToPath(new URL("../../",import.meta.url)),loader:"tsx"},bundle:true,outfile:join(directory,"preview.js"),jsx:"automatic",minify:true,define:{"process.env.NODE_ENV":'"production"'}});
    await writeFile(join(directory,"index.html"),`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1100,height:1100}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`file://${join(directory,"index.html")}`);
    const skill=page.getByRole("region",{name:"Skill detail preview"});
    const agent=page.getByRole("region",{name:"Project agent configuration preview"});
    await skill.waitFor();
    await t.test("source field names, sizes and static inputs",async()=>{
      assert.equal(await agent.getByLabel("Agent name",{exact:true}).inputValue(),"Code Reviewer");
      assert.equal(await agent.getByLabel("Agent name",{exact:true}).evaluate(el=>el.getBoundingClientRect().height),32);
      assert.equal(await agent.getByLabel("Agent name",{exact:true}).getAttribute("readonly"),"");
      assert.equal(await skill.getByRole("heading",{name:"/review-webhooks"}).evaluate(el=>getComputedStyle(el).fontSize),"24px");
      assert.equal(await agent.getByText("Content",{exact:true}).count(),1);
      assert.equal(await agent.getByLabel("Category",{exact:true}).count(),1);
    });
    await t.test("agent color control contains the product sixteen pixel swatch",async()=>{
      const swatch=agent.getByLabel("Agent name",{exact:true}).locator("..").locator('[aria-hidden="true"] > span');
      assert.equal(await swatch.count(),1);
      assert.equal(await swatch.evaluate(el=>el.getBoundingClientRect().width),16);
      assert.equal(await swatch.evaluate(el=>getComputedStyle(el).borderRadius),"50%");
    });
    await t.test("separate screens and no invented Skill binding controls",async()=>{
      assert.equal(await skill.getByRole("listitem").count(),3);
      assert.equal(await agent.getByText("Attached Skills",{exact:true}).count(),0);
      assert.equal(await page.getByRole("button").count(),0);
      assert.equal(await skill.getByText("references/review-checklist.md",{exact:true}).count(),1);
    });
    await t.test("a narrow desktop section stacks the crops",async()=>{
      await page.locator("#root").evaluate(el=>{el.style.width="600px";});
      const s=await skill.boundingBox(),a=await agent.boundingBox();
      assert(a.y >= s.y+s.height, "Stack based on section width, not the browser viewport");
      await page.locator("#root").evaluate(el=>{el.style.width="";});
    });
    await t.test("mobile stacks both crops without scaling text or overflowing",async()=>{
      await page.setViewportSize({width:390,height:844});
      const s=await skill.boundingBox(),a=await agent.boundingBox();
      assert(a.y >= s.y+s.height);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await skill.getByText("Before approving a webhook change:").evaluate(el=>getComputedStyle(el).fontSize),"16px");
      await page.emulateMedia({reducedMotion:"reduce"});
      assert.deepEqual(errors,[]);
    });
  } finally { await browser?.close();await rm(directory,{recursive:true,force:true}); }
});
