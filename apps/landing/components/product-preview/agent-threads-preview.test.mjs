import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Agent threads: one thread in the centre, the threads it talks to on both sides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "convoy-agent-threads-test-"));
  let browser;
  try {
    await build({stdin: {contents: `import {createRoot} from 'react-dom/client'; import {AgentThreadsPreview} from './components/product-preview/agent-threads'; createRoot(document.getElementById('root')).render(<AgentThreadsPreview />);`, resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx"}, bundle: true, outfile: join(directory,"preview.js"), jsx: "automatic", minify: true, define: {"process.env.NODE_ENV": '"production"'}});
    await writeFile(join(directory,"index.html"), `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px;background:#08080d;color:#f2f3f5}*{box-sizing:border-box}${await readFile(join(directory,"preview.css"),"utf8")}</style><div id="root"></div><script>${await readFile(join(directory,"preview.js"),"utf8")}</script></html>`);
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 1200, height: 900}});
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(`file://${join(directory,"index.html")}`);

    const scene = page.getByRole("figure", {name: "Agent threads messaging each other", exact: true});
    await scene.waitFor();
    const thread = scene.getByRole("region", {name: "Lead thread", exact: true});
    await thread.getByText("Add retry handling for failed deliveries", {exact: true}).waitFor();
    const agents = scene.getByRole("listitem");
    assert.deepEqual(await agents.locator("[data-agent-name]").allInnerTexts(), ["Planner", "Docs Writer", "Reviewer", "Tester"]);

    // Faithful to the product: started threads show as tool rows, and messages from
    // another thread's agent get the foreign tint and an icon-only link badge.
    assert.equal(await thread.getByText("Started thread", {exact: true}).count(), 2);
    const foreign = thread.locator("[data-sent-by]");
    assert.equal(await foreign.count(), 2);
    for (const message of await foreign.all()) {
      assert.equal(await message.locator("[data-bubble]").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(27, 36, 49)");
      assert.equal(await message.getByLabel("Sent by another thread's agent", {exact: true}).count(), 1);
      assert.doesNotMatch(await message.innerText(), /^(Planner|Reviewer)\b/, "No sender name, as in the product");
    }
    assert.notEqual(await thread.locator("[data-person] [data-bubble]").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(27, 36, 49)");

    const geometry = () => page.evaluate(() => {
      const box = el => el.getBoundingClientRect().toJSON();
      return {
        thread: box(document.querySelector('[aria-label="Lead thread"]')),
        agents: [...document.querySelectorAll("li")].map(box),
        links: [...document.querySelectorAll("[data-flow]")].map(el => ({...box(el), visible: getComputedStyle(el).display !== "none"})),
      };
    });
    const wide = await geometry();
    const [left, right] = [wide.agents.slice(0, 2), wide.agents.slice(2)];
    for (const box of left) assert(box.right < wide.thread.left, "Planner and Docs Writer sit left of the thread");
    for (const box of right) assert(box.left > wide.thread.right, "Reviewer and Tester sit right of the thread");
    assert.equal(wide.links.length, 4);
    wide.links.forEach((link, i) => {
      const agent = wide.agents[i];
      const [from, to] = i < 2 ? [agent.right, wide.thread.left] : [wide.thread.right, agent.left];
      assert(Math.abs(link.left - from) <= 1 && Math.abs(link.right - to) <= 1, `Line ${i} joins its agent to the thread`);
      assert(link.top >= agent.top && link.bottom <= agent.bottom, `Line ${i} leaves its agent box`);
    });
    assert.notEqual(await page.locator("[data-flow]").first().evaluate(el => getComputedStyle(el, "::after").animationName), "none");

    for (const width of [780, 390, 320]) {
      await page.setViewportSize({width, height: 900});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
      const narrow = await geometry();
      for (const box of narrow.agents) assert(box.top >= narrow.thread.bottom, `Agents sit below the thread at ${width}px`);
      assert(narrow.links.every(link => !link.visible), `No connector lines at ${width}px`);
    }

    await page.setViewportSize({width: 1200, height: 900});
    await page.emulateMedia({reducedMotion: "reduce"});
    for (const flow of await page.locator("[data-flow]").all()) assert.equal(await flow.evaluate(el => getComputedStyle(el, "::after").animationName), "none");
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(directory, {recursive: true, force: true}); }
});
