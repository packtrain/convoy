import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Artifact review opens anchored feedback and reflows without overflow", async (t) => {
  const directory=await mkdtemp(join(tmpdir(),"convoy-skills-test-"));
  let browser;
  try {
    await build({stdin:{contents:`import {createRoot} from 'react-dom/client'; import {ArtifactReviewPreview} from './components/product-preview/artifact-review'; createRoot(document.getElementById('root')).render(<ArtifactReviewPreview />);`,resolveDir:fileURLToPath(new URL("../../",import.meta.url)),loader:"tsx"},bundle:true,outfile:join(directory,"preview.js"),jsx:"automatic",minify:true,define:{"process.env.NODE_ENV":'"production"'}});
    await writeFile(join(directory,"index.html"),`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1100,height:1100}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`file://${join(directory,"index.html")}`);

    const preview=page.getByRole("region",{name:"Artifact review preview"});
    const comments=page.getByRole("complementary",{name:"Comments"});
    const passage=page.getByRole("button",{name:"Open comment on retry policy"});
    await preview.waitFor();
    await t.test("initial HTML shows document and existing feedback",async()=>{
      assert.equal(await comments.count(),1);
      assert.equal(await comments.evaluate(el=>el.getBoundingClientRect().width),288);
      assert.equal(await comments.getByText("Maya Chen",{exact:true}).count(),1);
      assert.equal(await page.getByRole("heading",{level:1}).count(),0,"the page H1 belongs to the homepage");
      const title=page.getByRole("heading",{level:4,name:"Webhook delivery retries"});
      assert.equal(await title.evaluate(el=>getComputedStyle(el).fontSize),"32px");
      assert.equal(await page.locator('[contenteditable="true"],textarea,input').count(),0);
      await page.screenshot({path:"/tmp/artifact-review-desktop.png",fullPage:true});
    });
    await t.test("highlight leaves room around the passage text",async()=>{
      const gap=await passage.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().left-el.getBoundingClientRect().left;});
      assert(gap>=4,`highlight starts ${gap}px before the text`);
      const textLeft=await page.locator("article p").filter({has:passage}).evaluate(el=>el.getBoundingClientRect().left);
      assert.equal(await passage.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().left;}),textLeft,"passage text stays aligned with the paragraph");
    });
    await t.test("wrapped highlight draws one box per line that ends with the text",async()=>{
      const {boxes,lines}=await passage.evaluate(el=>{
        el.parentElement.style.width="240px";
        const range=document.createRange();range.selectNodeContents(el);
        const rects=list=>[...list].map(r=>({top:Math.round(r.top),right:r.right}));
        const result={boxes:rects(el.getClientRects()),lines:rects(range.getClientRects())};
        el.parentElement.style.width="";
        return result;
      });
      assert(lines.length>1,"passage wraps");
      assert.equal(boxes.length,lines.length);
      boxes.forEach((box,i)=>assert(Math.abs(box.right-lines[i].right-4)<1,`line ${i+1} box ends ${box.right-lines[i].right}px after the text`));
    });
    await t.test("keyboard opens feedback after hiding the rail",async()=>{
      await page.getByRole("button",{name:"Hide comments"}).click();
      assert.equal(await comments.count(),0);
      await passage.focus();
      await page.keyboard.press("Enter");
      assert.equal(await comments.count(),1);
      assert.equal(await passage.getAttribute("aria-expanded"),"true");
      assert.equal(await passage.evaluate(el=>getComputedStyle(el).outlineStyle),"solid");
    });
    await t.test("narrow container stacks comments without shrinking document text",async()=>{
      await page.locator("#root").evaluate(el=>{el.style.width="600px"});
      const doc=await page.locator("article").boundingBox(),rail=await comments.boundingBox();
      assert(rail.y>=doc.y+doc.height);
      assert.equal(await passage.evaluate(el=>getComputedStyle(el).fontSize),"16px");
      await page.locator("#root").evaluate(el=>{el.style.width=""});
    });
    await t.test("mobile and reduced motion remain readable",async()=>{
      await page.setViewportSize({width:390,height:1000});
      await page.emulateMedia({reducedMotion:"reduce"});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await comments.getByText("Maya Chen",{exact:true}).evaluate(el=>getComputedStyle(el).fontSize),"14px");
      await page.screenshot({path:"/tmp/artifact-review-mobile.png",fullPage:true});
      assert.deepEqual(errors,[]);
    });
  } finally { await browser?.close();await rm(directory,{recursive:true,force:true}); }
});
