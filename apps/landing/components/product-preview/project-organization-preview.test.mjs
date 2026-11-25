import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Project views share tasks, open details and fit both hosts", async (t) => {
 const directory = await mkdtemp(join(tmpdir(),"convoy-project-")); let browser;
 try {
  await build({stdin:{contents:`import {createRoot} from 'react-dom/client'; import {ProjectOrganizationPreview} from './components/product-preview/project-organization'; import {HeroPreview} from './components/product-preview/hero-preview'; createRoot(document.getElementById('root')).render(location.hash === '#hero' ? <HeroPreview/> : <div style={{height:560}}><ProjectOrganizationPreview/></div>);`,resolveDir:fileURLToPath(new URL("../../",import.meta.url)),loader:"tsx"},bundle:true,outfile:join(directory,"preview.js"),jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
  await writeFile(join(directory,"index.html"),`<!doctype html><html><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
  browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1200,height:1000}});
  const errors=[],requests=[];page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  const url=`file://${join(directory,"index.html")}`;await page.goto(url);
  const scene=page.getByRole("region",{name:"Project organization preview",exact:true});await scene.waitFor();
  await t.test("Focused search has no inner outline",async()=>{
    const search=page.getByRole('textbox',{name:'Search project tasks'});
    await search.focus();
    assert.equal(await search.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    assert.equal(await search.evaluate(el=>getComputedStyle(el).boxShadow),'none');
  });
  await t.test("List pill opens a list menu in the toolbar and the task details",async()=>{
    const lists=['Backlog','Archived','Inbox','Milestone 1','Milestone 2','Milestone 3','Desktop App','Ideas','Refactoring','References','Followups'];
    const check=async(trigger)=>{
      assert.equal(await trigger.getAttribute('aria-haspopup'),'menu');
      assert.equal(await trigger.getAttribute('aria-expanded'),'false');
      await trigger.click();
      const menu=page.getByRole('menu',{name:'Lists',exact:true});
      assert.equal(await trigger.getAttribute('aria-expanded'),'true');
      assert.deepEqual(await menu.getByRole('menuitemradio').allInnerTexts(),lists);
      assert.equal(await menu.getByRole('menuitemradio',{name:'Milestone 1',exact:true}).getAttribute('aria-checked'),'true');
      assert.equal(await trigger.locator('svg').count(),1,'Pill has its list dot and no chevron');
      assert.equal(await menu.locator('.lucide-check').count(),0,'Selection is a row highlight, not a checkmark');
      assert.equal(await menu.getByRole('textbox',{name:'Search lists',exact:true}).getAttribute('placeholder'),'Search lists...');
      const box=await menu.boundingBox(),host=await scene.boundingBox();
      assert(box.x>=host.x&&box.x+box.width<=host.x+host.width,'Menu stays inside the preview');
      await page.keyboard.press('Escape');assert.equal(await menu.count(),0);
      assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,'Escape returns focus to the pill');
      await trigger.click();await menu.getByRole('menuitemradio',{name:'Ideas',exact:true}).click();assert.equal(await menu.count(),0);
      await trigger.click();await page.mouse.click(5,5);assert.equal(await menu.count(),0);
    };
    const pill=scene.locator('header').getByRole('button',{name:'Open Lists',exact:true});
    const toggle=await scene.getByRole('button',{name:'Table view'}).boundingBox(),pillBox=await pill.boundingBox();
    assert.equal(pillBox.height,toggle.height,'Pill matches the view toggle height');
    assert.equal(pillBox.y,toggle.y);
    assert.deepEqual(await pill.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.paddingLeft,s.paddingRight,s.borderRadius]}),['14px','500','8px','12px','9999px']);
    await check(scene.locator('header').getByRole('button',{name:'Open Lists',exact:true}));
    assert.equal(await scene.locator('tbody tr').count(),11,'Selection is a mock: the list does not change');
    await page.getByRole("button",{name:"Add retry handling for failed deliveries",exact:true}).click();
    await check(page.getByRole('dialog').getByRole('button',{name:'Open Lists',exact:true}));
    await page.getByRole('dialog').getByRole('button',{name:'Close project task details'}).click();
  });
  await t.test("Runs and Priority cells center their content",async()=>{
    for(const column of [3,4]) {
      const offsets=await page.locator(`tbody td:nth-child(${column})`).evaluateAll(cells=>cells.map(cell=>{
        const outer=cell.getBoundingClientRect(),inner=cell.firstElementChild.getBoundingClientRect();
        return Math.abs(inner.x+inner.width/2-outer.x-outer.width/2);
      }));
      assert(offsets.every(offset=>offset<=1),`Column ${column} center offsets: ${offsets}`);
    }
  });
  await t.test("Assignee cells show names beside avatars",async()=>{
    const cells=page.locator('tbody td:nth-child(5)');
    assert.equal(await cells.getByText('Maya Chen',{exact:true}).count(),6);
    assert.equal(await cells.getByText('Alex Morgan',{exact:true}).count(),5);
    const name=cells.first().getByText('Maya Chen',{exact:true});
    assert(await name.isVisible());
    const avatar=await cells.first().getByLabel('Maya Chen',{exact:true}).boundingBox();
    const label=await name.boundingBox();
    assert.equal(label.x-avatar.x-avatar.width,8);
  });
  await t.test("Table expands subtasks and filters locally",async()=>{
    assert.equal(await page.locator('tbody tr').count(),11);
    await page.getByRole("button",{name:"Toggle delivery plan subtasks"}).click();assert.equal(await page.locator('tbody tr').count(),9);
    await page.getByRole("button",{name:"Toggle delivery plan subtasks"}).click();
    await page.getByRole("textbox",{name:"Search project tasks"}).fill("NS-142");assert.equal(await page.locator('tbody tr').count(),1);
    await page.getByRole("textbox",{name:"Search project tasks"}).fill("");
  });
  await t.test("Details match selection and restore keyboard focus",async()=>{
    const trigger=page.getByRole("button",{name:"Add retry handling for failed deliveries",exact:true});await trigger.click();
    const dialog=page.getByRole("dialog",{name:"Task details: NS-142"});await dialog.waitFor();
    assert.equal(await dialog.getByRole('heading',{name:'Add retry handling for failed deliveries'}).count(),1);
    await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);
    assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,"Close returns focus to the task");
  });
  await t.test("Project details reuse the complete sidebar",async()=>{
    await page.getByRole("button",{name:"Add retry handling for failed deliveries",exact:true}).click();
    const dialog=page.getByRole('dialog');
    assert.equal(await dialog.getByRole('complementary',{name:'Task details',exact:true}).count(),1);
    assert.equal(await dialog.getByRole('region',{name:'Task activity',exact:true}).count(),1);
    assert.equal(await dialog.getByText('Due date',{exact:true}).count(),1);
    assert.equal(await dialog.getByRole('region',{name:'Activity composer',exact:true}).count(),1);
    assert.equal(await dialog.getByText('Changes',{exact:true}).count(),0);
    assert.equal(await dialog.getByRole('heading',{name:'Add retry handling for failed deliveries',exact:true}).evaluate(el=>getComputedStyle(el).marginBottom),'24px');
    await page.keyboard.press('Escape');
  });
  if(await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await t.test("Task Type displays its name rather than the reference",async()=>{
    await page.getByRole("button",{name:"Add retry handling for failed deliveries",exact:true}).click();
    assert.equal(await page.getByRole('dialog').locator('dt').filter({hasText:/^Type$/}).locator('xpath=following-sibling::dd[1]').innerText(),'Bug');
    await page.keyboard.press('Escape');
  });
  // Recover the scene even when the preceding visual contract fails.
  if(await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await t.test("Parent identity stays on one line",async()=>{
    await page.getByRole('button',{name:'Review idempotency rules',exact:true}).click();
    const parent=page.getByRole('dialog').locator('dt').filter({hasText:/^Parent$/}).locator('xpath=following-sibling::dd[1]');
    for(const width of [1200,390,320]) {
      await page.setViewportSize({width,height:1000});
      assert.equal((await parent.boundingBox()).height,20,`Single parent line at ${width}px`);
    }
    await page.keyboard.press('Escape');
  });
  if(await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await page.setViewportSize({width:1200,height:1000});
  await t.test("Sidebar pills match product badge padding",async()=>{
    await page.getByRole('button',{name:'Review idempotency rules',exact:true}).click();
    for(const label of ['Type','Status']) {
      const badge=page.getByRole('dialog').locator('dt').filter({hasText:new RegExp(`^${label}$`)}).locator('xpath=following-sibling::dd[1]').locator('span').first();
      assert.deepEqual(await badge.evaluate(el=>{const s=getComputedStyle(el);return [s.paddingTop,s.paddingRight,s.fontSize,s.lineHeight,s.gap]}),['2px','6px','12px','16px','6px']);
      assert.equal((await badge.boundingBox()).height,22);
    }
    await page.keyboard.press('Escape');
  });
  if(await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await t.test("Priorities use product chevrons",async()=>{
    assert.equal(await page.locator('tbody').locator('[title="High priority"] .lucide-chevrons-up').count(),4);
  });
  await t.test("Subtask progress uses a partial arc",async()=>{
    assert.equal(await page.locator('tbody svg circle[stroke-dashoffset]').count(),1);
  });
  await t.test("Board column geometry matches product",async()=>{
    await page.getByRole('button',{name:'Kanban view'}).click();
    const col=page.getByRole('heading',{name:'To Do',exact:true}).locator('../..');
    assert.equal((await col.boundingBox()).width,320);
    assert.equal((await col.locator('header').boundingBox()).height,40);
  });
  await t.test("Kanban renders the same tasks and selection",async()=>{
    await page.getByRole("button",{name:"Kanban view"}).click();assert.equal(await scene.getAttribute('data-project-view'),'board');
    assert.equal(await page.getByRole('button',{name:/^Open NS-/}).count(),9);
    await page.getByRole('button',{name:/^Open NS-139:/}).click();
    const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('heading',{name:/Subtasks/}).count(),1);
    await page.getByRole('button',{name:'Close project task details'}).click();
  });
  await t.test("Narrow hosts scroll the board and contain the details",async()=>{
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.getByRole('button',{name:/^Open NS-135:/}).click();
      const box=await page.getByRole('dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=width);
      await page.keyboard.press('Escape');
    }
  });
  await page.setViewportSize({width:1600,height:1050});await page.goto(`${url}#hero`);await page.reload();
  await t.test("Hero project navigation mounts both views alongside existing destinations",async()=>{
    await page.getByRole('button',{name:'Northstar',exact:true}).click();
    await scene.waitFor();
    const search=page.getByRole('textbox',{name:'Search project tasks'});await search.focus();
    assert.equal(await search.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    await page.getByRole('button',{name:'Kanban view'}).click();assert.equal(await scene.getAttribute('data-project-view'),'board');
    await page.getByRole('button',{name:'Watch Tower',exact:true}).click();await page.getByRole('heading',{name:'Watch Tower',exact:true}).waitFor();
    await page.getByRole('button',{name:'Threads',exact:true}).click();assert.equal(await scene.count(),0);
    await page.setViewportSize({width:900,height:900});await page.getByRole('button',{name:'Project preview',exact:true}).click();await scene.waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  await page.setViewportSize({width:1600,height:1050});
  await t.test("Every Northstar list opens its own tasks",async()=>{
    await scene.getByRole("button",{name:"Table view"}).click();
    const nav=page.getByRole('complementary',{name:'Example workspace navigation'});
    for(const list of ['Backlog','Inbox','Milestone 1','Milestone 2','Ideas']) {
      const link=nav.getByRole('button',{name:list,exact:true});
      assert.equal(await link.count(),1,`${list} is clickable`);
      await link.click();assert.equal(await link.getAttribute('aria-current'),'page');
      assert.equal(await scene.getByText(list,{exact:true}).count(),1);
      assert.equal(await scene.locator('tbody tr').count(),list==='Milestone 1'?11:8);
      await scene.locator('tbody td:first-child button').last().click();
      assert.equal(await page.getByRole('dialog').getByText(list,{exact:true}).count(),1);
      await page.keyboard.press('Escape');
    }
  });
  await t.test("List changes preserve Kanban and clear search and details",async()=>{
    await scene.getByRole('button',{name:'Kanban view'}).click();
    await scene.getByRole('textbox',{name:'Search project tasks'}).fill('replay');
    await scene.getByRole('button',{name:/^Open NS-155:/}).click();
    await page.getByRole('complementary',{name:'Example workspace navigation'}).getByRole('button',{name:'Inbox',exact:true}).click();
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await scene.getAttribute('data-project-view'),'board');
    assert.equal(await scene.getByRole('textbox',{name:'Search project tasks'}).inputValue(),'');
    assert.equal(await scene.getByRole('button',{name:/^Open NS-/}).count(),8);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 } finally {await browser?.close();await rm(directory,{recursive:true,force:true});}
});
