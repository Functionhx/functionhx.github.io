// 手机视图（站长确认 2026-10-07）：在 360 / 390 / 430 宽、亮色和暗色下检查
// 导航栏与正文对齐、没有横向滚动、文章页的阅读条与目录面板、博客页的筛选面板，以及触摸区域。
// 需要先构建 _site。MOBILE_SHOTS=<目录> 时顺便保存截图，方便肉眼复查。
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const types = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/+/, "");
    if (!path || path.endsWith("/")) path += "index.html";
    const file = new URL(path, siteRoot);
    if (!file.href.startsWith(siteRoot.href)) throw new Error("outside");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file.pathname)] || "text/html" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const executable = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
const shots = process.env.MOBILE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const article = "/blog/2026/gpa/";
const routes = ["/", "/blog/", article, "/projects/", "/notes/", "/paper-notes/", "/documents/", "/more/"];

async function tapTargets(page, selector, minimum) {
  const small = await page.$$eval(
    selector,
    (nodes, min) =>
      nodes
        .filter((node) => node.getClientRects().length && !node.hidden)
        .map((node) => ({ text: node.textContent.trim().slice(0, 20), height: Math.round(node.getBoundingClientRect().height) }))
        .filter((item) => item.height < min),
    minimum
  );
  assert.deepEqual(small, [], `${selector} must be at least ${minimum}px tall`);
}

for (const scheme of ["light", "dark"]) {
  for (const width of [360, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const label = `${scheme} ${width}px`;

    for (const route of routes) {
      await page.goto(base + route, { waitUntil: "load" });
      await page.waitForTimeout(200);
      const layout = await page.evaluate(() => {
        const brand = document.querySelector(".function-mobile-brand")?.getBoundingClientRect().left ?? 0;
        const main = (document.querySelector("#markdown-content") || document.querySelector('.container[role="main"]')).getBoundingClientRect().left;
        return { brand, main, overflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      assert.ok(layout.overflow <= 0, `${label} ${route}: no horizontal scrolling (overflow ${layout.overflow}px)`);
      assert.ok(Math.abs(layout.brand - layout.main) <= 2, `${label} ${route}: the logo lines up with the text (${layout.brand} vs ${layout.main})`);
      if (shots) await page.screenshot({ path: `${shots}/${scheme}-${width}${route.replace(/\W+/g, "-")}.png` });
    }

    // ---------- 文章页：阅读条与目录面板 ----------
    await page.goto(base + article, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const dock = page.locator("#post-dock");
    assert.equal(await dock.evaluate((node) => node.classList.contains("is-on")), false, `${label}: the dock waits until the hero has scrolled away`);
    assert.equal(await page.locator(".post-rail").isVisible(), false, `${label}: the rail's leftovers are folded away on phones`);

    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: "instant" }));
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollBy({ top: -80, behavior: "instant" }));
    await page.waitForTimeout(700);
    const reading = await page.evaluate(() => {
      const node = document.getElementById("post-dock");
      return {
        on: node.classList.contains("is-on"),
        collapsed: node.classList.contains("is-collapsed"),
        section: document.getElementById("post-dock-section").textContent.trim(),
        pct: document.getElementById("post-dock-pct").textContent,
        floor: Number(document.documentElement.dataset.floorInset),
        height: node.offsetHeight,
        backToTop: document.getElementById("back-to-top") ? getComputedStyle(document.getElementById("back-to-top")).display : "none",
      };
    });
    assert.ok(reading.on && !reading.collapsed, `${label}: the dock shows while reading`);
    assert.ok(reading.section && reading.section !== "目录", `${label}: the dock names the current section`);
    assert.match(reading.pct, /^\d{2}%$|^100%$/);
    assert.equal(reading.floor, reading.height + 16, `${label}: the pet stands on top of the dock`);
    assert.equal(reading.backToTop, "none", `${label}: the theme's back-to-top button gives way to the dock`);
    await tapTargets(page, "#post-dock-open", 44);

    await page.evaluate(() => window.scrollBy({ top: 400, behavior: "instant" }));
    await page.waitForTimeout(500);
    assert.equal(await dock.evaluate((node) => node.classList.contains("is-collapsed")), true, `${label}: reading on folds the dock into a hairline`);
    await page.evaluate(() => window.scrollBy({ top: -60, behavior: "instant" }));
    await page.waitForTimeout(500);
    assert.equal(await dock.evaluate((node) => node.classList.contains("is-collapsed")), false, `${label}: scrolling back unfolds it`);

    await page.tap("#post-dock-open");
    await page.waitForTimeout(500);
    const sheet = await page.evaluate(() => ({
      open: document.getElementById("post-dock-sheet").open,
      links: document.querySelectorAll("#post-sheet-tree a").length,
      tree: document.querySelectorAll("#post-tree a").length,
      active: document.querySelector("#post-sheet-tree a.is-active")?.textContent.trim() || "",
    }));
    assert.ok(sheet.open, `${label}: tapping the dock opens the contents`);
    assert.equal(sheet.links, sheet.tree, `${label}: the sheet lists every section`);
    assert.ok(sheet.active, `${label}: the sheet marks the section being read`);
    await tapTargets(page, "#post-sheet-tree a, .post-sheet__actions > *, .post-sheet__close", 44);
    if (shots) await page.screenshot({ path: `${shots}/${scheme}-${width}-sheet.png` });
    const target = await page.locator("#post-sheet-tree a").nth(2).getAttribute("href");
    await page.locator("#post-sheet-tree a").nth(2).tap();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.getElementById("post-dock-sheet").open), false, `${label}: choosing a section closes the sheet`);
    const landed = await page.evaluate((hash) => document.getElementById(decodeURIComponent(hash.slice(1))).getBoundingClientRect().top, target);
    assert.ok(landed >= 0 && landed < 200, `${label}: and scrolls to it (${Math.round(landed)}px)`);

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(600);
    assert.equal(await dock.getAttribute("data-state"), "done", `${label}: at the end the dock offers what to do next`);
    await tapTargets(page, ".post-dock__done > *", 44);
    if (shots) await page.screenshot({ path: `${shots}/${scheme}-${width}-done.png` });

    // ---------- 博客页：筛选收成一行，第一屏能看到文章 ----------
    await page.goto(base + "/blog/", { waitUntil: "load" });
    await page.waitForTimeout(300);
    const feed = await page.evaluate(() => ({
      firstCard: document.querySelector(".writing-card").getBoundingClientRect().top,
      inlineFilters: getComputedStyle(document.querySelector(".writing-filters")).display,
    }));
    assert.ok(feed.firstCard < 844, `${label}: the first article starts on the first screen (${Math.round(feed.firstCard)}px)`);
    await tapTargets(page, ".writing-filter-trigger, .writing-topics a", 44);
    await page.tap(".writing-filter-trigger");
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.getElementById("writing-filter-sheet").open), true, `${label}: the filter sheet opens`);
    await tapTargets(page, ".writing-filter-sheet .writing-filter-options button", 40);
    await page.tap('.writing-filter-sheet [data-writing-sort="old"]');
    await page.tap("[data-writing-sheet-close]");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("[data-writing-summary]").textContent(), "最早在前", `${label}: the trigger shows the current filter`);

    assert.deepEqual(errors, [], `${label}: no script errors`);
    await context.close();
  }
}

// 宽屏上这些手机部件都不出现，侧栏照旧。
const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await wide.goto(base + article, { waitUntil: "load" });
await wide.evaluate(() => window.scrollTo({ top: 2000, behavior: "instant" }));
await wide.waitForTimeout(300);
assert.equal(await wide.locator("#post-dock").isVisible(), false, "desktop keeps the rail instead of the dock");
assert.equal(await wide.locator("#post-tree").isVisible(), true);
await wide.goto(base + "/blog/", { waitUntil: "load" });
assert.equal(await wide.locator(".writing-filter-trigger").isVisible(), false, "desktop keeps the filter sidebar");
assert.equal(await wide.locator(".writing-layout > .writing-filters").isVisible(), true);

await browser.close();
server.close();
console.log("Mobile layout checks passed: alignment, overflow, reading dock, contents sheet, blog filters, and touch targets.");
