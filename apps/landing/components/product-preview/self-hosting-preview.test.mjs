import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Self-hosting diagram explains the stack without installer commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-self-hosting-test-"));
  let browser;
  try {
    await build({stdin: {contents: `import {createRoot} from 'react-dom/client'; import {SelfHostingPreview} from './components/product-preview/self-hosting'; createRoot(document.getElementById('root')).render(<SelfHostingPreview />);`, resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx"}, bundle: true, outfile: join(directory,"preview.js"), jsx: "automatic", minify: true, define: {"process.env.NODE_ENV": '"production"'}});
    await writeFile(join(directory,"index.html"), `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px;background:#08080d;color:#f2f3f5}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 1000, height: 900}});
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(`file://${join(directory,"index.html")}`);

    const diagram = page.getByRole("figure", {name: "Self-hosted Convoy architecture", exact: true});
    await diagram.waitFor();
    const infrastructure = diagram.getByRole("region", {name: "Your infrastructure", exact: true});
    await infrastructure.getByText("Web app", {exact: true}).waitFor();
    await infrastructure.getByText("Convex backend", {exact: true}).waitFor();
    assert.equal(await diagram.getByRole("list", {name: "Connected machines"}).getByRole("listitem").count(), 3);
    await diagram.getByText("convoy connect", {exact: true}).waitFor();
    assert.equal(await diagram.getByRole("region", {name: "Outside your infrastructure", exact: true}).count(), 0);
    const providers = diagram.getByRole("list", {name: "Model providers"});
    for (const name of ["Anthropic", "OpenAI", "Amazon Bedrock", "Google Vertex AI"]) {
      const logo = providers.getByRole("img", {name, exact: true});
      assert.equal(await logo.locator("svg").count(), 2, `${name} shows its mark and wordmark`);
      assert.equal(await providers.getByText(name, {exact: true}).count(), 0, `${name} is a logo, not text`);
    }
    assert.equal((await providers.innerText()).trim(), "", "Provider cards hold only logos");
    assert.match(await diagram.innerText(), /model API calls/i, "Machines call the providers configured on them");
    const centre = box => box.x + box.width / 2;
    const fanout = await page.evaluate(() => {
      const boxes = selector => [...document.querySelectorAll(selector)].map(el => el.getBoundingClientRect().toJSON());
      return {machines: boxes('[aria-label="Connected machines"] > li'), drops: boxes("[data-drop]"), providers: boxes('[aria-label="Model providers"] > li'), stubs: boxes("[data-stub]"), bus: document.querySelector("[data-bus]").getBoundingClientRect().toJSON()};
    });
    assert.equal(fanout.drops.length, 3);
    fanout.machines.forEach((machine, i) => assert(Math.abs(centre(fanout.drops[i]) - centre(machine)) < 1, `Line leaves machine ${i} at its centre`));
    fanout.providers.forEach((provider, i) => assert(Math.abs(centre(fanout.stubs[i]) - centre(provider)) < 1, `Line reaches provider ${i} at its centre`));
    const ends = [...fanout.drops, ...fanout.stubs].map(centre);
    assert(fanout.bus.left <= Math.min(...ends) + 1 && fanout.bus.right >= Math.max(...ends) - 1, "Shared line joins every machine and provider");
    for (const box of [...fanout.drops, ...fanout.stubs]) assert(box.bottom <= fanout.bus.top + 1 || box.top >= fanout.bus.bottom - 1, "Lines meet the shared line");
    assert.doesNotMatch(await diagram.innerText(), /curl |docker compose|start\.sh|npm i|pnpm add/i, "No installer commands");

    const webApp = infrastructure.getByText("Web app", {exact: true});
    const backend = infrastructure.getByText("Convex backend", {exact: true});
    for (const width of [1000, 640, 375, 320]) {
      await page.setViewportSize({width, height: 900});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
      const [a, b] = [await webApp.boundingBox(), await backend.boundingBox()];
      if (width >= 640) assert(b.x > a.x + a.width, `Services side by side at ${width}px`);
      else assert(b.y > a.y + a.height, `Services stack at ${width}px`);
    }

    const flows = page.locator("[data-flow]");
    assert(await flows.count() > 0);
    assert.notEqual(await flows.first().evaluate(el => getComputedStyle(el, "::after").animationName), "none");
    await page.emulateMedia({reducedMotion: "reduce"});
    for (const flow of await flows.all()) assert.equal(await flow.evaluate(el => getComputedStyle(el, "::after").animationName), "none");

    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(directory, {recursive: true, force: true}); }
});
