import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Assignment picker filters, preserves owner and fits narrow hosts", async (t) => {
 const directory = await mkdtemp(join(tmpdir(),"convoy-assignment-")); let browser;
 try {
  await build({stdin:{contents:`import {createRoot} from 'react-dom/client'; import {TaskAssignmentPreview} from './components/product-preview/task-assignment'; createRoot(document.getElementById('root')).render(<TaskAssignmentPreview/>);`,resolveDir:fileURLToPath(new URL("../../",import.meta.url)),loader:"tsx"},bundle:true,outfile:join(directory,"preview.js"),jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
  await writeFile(join(directory,"index.html"),`<!doctype html><html><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><button id="outside">Outside</button><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
  browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:600,height:900}});
  const errors=[],requests=[];page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(`file://${join(directory,"index.html")}`);
  for (const label of ["Threads", "Due date", "Tags", "Created", "Description"]) assert.equal(await page.getByText(label,{exact:true}).count(),1,`Task context includes ${label} below assignment`);
  const dialog=page.getByRole("group",{name:"Choose assignee"});await dialog.waitFor();
  const frameRegion=page.getByRole("region",{name:"Task assignment preview",exact:true});
  assert.equal((await page.getByRole("button",{name:"Implementer",exact:true}).boundingBox()).height,28,"Match product dropdown row height");
  const menuBox=await dialog.boundingBox();const groupBox=await page.getByText("AI Agents",{exact:true}).locator("../..").boundingBox();assert.equal(groupBox.x,menuBox.x+1,"Section dividers reach the menu border");
  await t.test("Threads uses the same gap as adjacent properties",async()=>{
    const threads=await page.getByText("Threads",{exact:true}).locator("..").boundingBox();
    const due=await page.getByText("Due date",{exact:true}).locator("..").boundingBox();
    assert.equal(due.y-threads.y-threads.height,16);
  });
  await t.test("Unassigned clears the search divider",async()=>{
    const searchRow=await page.getByRole("textbox",{name:"Search assignees"}).locator("..").boundingBox();
    const item=await page.getByRole("button",{name:"Unassigned",exact:true}).boundingBox();
    assert.equal(item.y-searchRow.y-searchRow.height,4);
  });
  await t.test("Two working threads are present",async()=>{
    assert.equal(await page.getByRole("list",{name:"Task threads"}).getByRole("listitem").count(),2);
    assert.equal(await page.getByLabel("Streaming response",{exact:true}).count(),2);
  });
  await t.test("Thread icons and times align beside a separate add control",async()=>{
    for (const width of [600,390,320]) {
      await page.setViewportSize({width,height:900});
      const rows=page.getByRole("list",{name:"Task threads"});
      const codex=await rows.getByLabel("Codex",{exact:true}).boundingBox();
      const claude=await rows.getByLabel("Claude Code",{exact:true}).boundingBox();
      assert.equal(codex.x,claude.x,`CLI icons align at ${width}px`);
      const times=await rows.getByText("now",{exact:true}).all();
      assert.equal((await times[0].boundingBox()).x,(await times[1].boundingBox()).x);
      const list=await rows.boundingBox();const add=await page.getByRole("button",{name:"Open threads composer",exact:true}).boundingBox();
      assert(add.x>=list.x+list.width,"Plus sits outside the list");assert.equal(add.y,list.y);
    }
    await page.setViewportSize({width:600,height:900});
  });
  await t.test("narrow frame keeps the picker in flow under Assignee",async()=>{
    const menu=await dialog.boundingBox(),threads=await page.getByText("Threads",{exact:true}).boundingBox();
    assert(threads.y>=menu.y+menu.height,"Picker pushes later fields down instead of covering them");
  });
  await t.test("wide frame pulls the picker out beside a muted card",async()=>{
    await page.setViewportSize({width:1000,height:900});
    const frame=await frameRegion.boundingBox(),menu=await dialog.boundingBox();
    assert(menu.x<frame.x+frame.width&&menu.x+menu.width>frame.x+frame.width,"Picker overlaps the card's right edge");
    assert(frame.x+frame.width/2<500,"Card sits left of centre");
    assert(Math.abs(menu.y+menu.height/2-(frame.y+frame.height/2))<2,"Picker is centred on the card");
    assert(menu.height>frame.height*0.6,`Picker is tall enough to balance the card, got ${menu.height}px`);
    assert.equal(await dialog.locator(".options, [class*=options]").first().evaluate(el=>el.scrollHeight>el.clientHeight),false,"Full roster shows without scrolling");
    const overlay=await frameRegion.evaluate(el=>{const scene=el.parentElement,after=getComputedStyle(scene,"::after"),r=el.getBoundingClientRect(),s=scene.getBoundingClientRect();return {left:s.x+parseFloat(after.left),width:parseFloat(after.width),z:Number(after.zIndex),frameLeft:r.x,frameWidth:r.width,row:Number(getComputedStyle(document.querySelector('[aria-label^="Assignee:"]').parentElement).zIndex)};});
    assert.equal(overlay.left,overlay.frameLeft,"Muting overlay covers the card");assert.equal(overlay.width,overlay.frameWidth);
    assert(overlay.row>overlay.z,"Assignee row stays above the overlay");
    await page.setViewportSize({width:600,height:900});
  });
  const search=page.getByRole("textbox",{name:"Search assignees"});
  assert.equal(await search.evaluate(el=>document.activeElement===el),false,"Initial load does not steal focus");
  await search.fill("review");assert.equal(await dialog.locator("button[data-option]").count(),1);
  await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
  await page.getByRole("button",{name:"Assignee: Reviewer · Alex Morgan",exact:true}).waitFor();
  assert.equal(await dialog.count(),1,"Picker stays open after a selection");
  assert.equal(await search.inputValue(),"","Selection clears the search");
  assert.equal(await page.getByRole("button",{name:"Clear delegation (Reviewer)",exact:true}).count(),1);
  await page.getByRole("button",{name:"Reviewer",exact:true}).click();
  await page.getByRole("button",{name:"Assignee: Alex Morgan",exact:true}).waitFor();
  await page.getByRole("button",{name:"Implementer",exact:true}).click();
  await page.getByRole("button",{name:"Assignee: Implementer · Alex Morgan",exact:true}).waitFor();
  await page.getByRole("button",{name:"Maya Chen",exact:true}).click();
  await page.getByRole("button",{name:"Assignee: Implementer · Maya Chen",exact:true}).waitFor();
  await page.getByRole("button",{name:"Unassigned",exact:true}).click();
  const trigger=page.getByRole("button",{name:"Assignee: Implementer",exact:true});await trigger.waitFor();
  await search.fill("missing");assert.equal(await page.getByText("No assignees found").count(),1);
  await page.keyboard.press("Escape");assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,"Escape returns focus to the trigger");
  assert.equal(await dialog.count(),1);
  await trigger.click();assert.equal(await search.evaluate(el=>document.activeElement===el),true,"Trigger focuses the search");
  await page.emulateMedia({reducedMotion:"reduce"});
  assert.equal(await page.getByLabel("Streaming response",{exact:true}).first().locator("i").first().evaluate(el=>getComputedStyle(el).animationName),"none");
  for(const width of [390,320]) {await page.setViewportSize({width,height:900});const frame=await frameRegion.boundingBox(), menu=await dialog.boundingBox();assert(menu.x>=frame.x&&menu.x+menu.width<=frame.x+frame.width);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.getByRole("button",{name:"Outside",exact:true}).click();assert.equal(await dialog.count(),1,"Outside clicks leave the picker open");
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 } finally {await browser?.close();await rm(directory,{recursive:true,force:true});}
});
