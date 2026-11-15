import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('People avatars show one letter across previews',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'convoy-avatars-'));let browser;
 try {
  await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {ProjectOrganizationPreview} from './components/product-preview/project-organization';import {TaskAssignmentPreview} from './components/product-preview/task-assignment';import {ArtifactReviewPreview} from './components/product-preview/artifact-review';import {HeroPreview} from './components/product-preview/hero-preview';createRoot(document.getElementById('root')).render(<><div id="project" style={{height:900}}><ProjectOrganizationPreview/></div><div id="assignment"><TaskAssignmentPreview/></div><div id="artifact"><ArtifactReviewPreview/></div><div id="hero"><HeroPreview/></div></>);`,loader:'tsx',resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,outfile:join(dir,'app.js'),jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
  await writeFile(join(dir,'index.html'),`<html><style>${await readFile(join(dir,'app.css'),'utf8')}</style><div id="root"></div><script>${await readFile(join(dir,'app.js'),'utf8')}</script></html>`);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1560,height:1000}});await page.goto(`file://${join(dir,'index.html')}`);
  const check=async id=>{
   const texts=await page.locator(id).locator('span,div').evaluateAll(els=>els.filter(el=>/(?:^|_)avatar(?:_|$)|assigneeAvatar|activityAvatar|machineAvatar/.test(el.className)&&el.childNodes.length>0).map(el=>Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()).filter(Boolean));
   assert(texts.length>0,`Avatars found in ${id}`);assert(texts.every(text=>text.length===1),`${id}: ${texts.join(', ')}`);
  };
  for(const id of ['#project','#assignment','#artifact','#hero'])await t.test(id,()=>check(id));
  await page.locator('#project').getByRole('button',{name:'Kanban view'}).click();await t.test('board',()=>check('#project'));
  await page.locator('#project').getByRole('button',{name:/^Open NS-139:/}).click();await t.test('sidebar',()=>check('#project [role=dialog]'));
 }finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
});
