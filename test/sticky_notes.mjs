// 文章便利贴（站长决定 2026-10-07）：作者便利贴的三种排版、读者便利贴的创建 / 修改 / 撕掉 / 导出、
// 文章改动后的重新定位与「掉落」、不发网络请求，以及站长「公开」交给原位编辑器插进原文。
// 需要先构建 _site。作者便利贴按 _plugins/sticky_notes.rb 的输出注入到 GPA 那篇文章里。
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const source = await readFile(new URL("../_posts/2026-10-05-gpa-zh.md", import.meta.url), "utf8");
const types = { ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
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
const article = `${base}/blog/2026/gpa/`;
const executable = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });

const authorNote = (color, text) =>
  `<aside class="sticky-note sticky-note--author" data-sticky-color="${color}" role="note" aria-label="作者便利贴"><span class="sticky-note__by" aria-hidden="true">ƒ 作者</span><p>${text}</p></aside>`;
const QUOTE = "我们知道，收入不是能力本";

// edit(html) 改写正文部分（用来模拟作者便利贴和「文章改过了」）。
async function open(context, edit = (html) => html) {
  await context.route(`${article}`, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const cut = html.indexOf('id="markdown-content"');
    await route.fulfill({
      response,
      body: html.slice(0, cut) + edit(html.slice(cut)),
      headers: { ...response.headers(), "content-type": "text/html" },
    });
  });
  // 字体 CDN 不参与测试。
  await context.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(article, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".post--article")?.dataset.stickyMode);
  return { page, errors };
}

const withAuthorNotes = (html) => {
  let n = 0;
  return html.replace(/<\/p>/g, (match) => {
    n += 1;
    if (n === 2) return match + authorNote("yellow", "写完半年后再看这句，我还是同意自己。");
    if (n === 3) return match + authorNote("pink", "紧挨着的第二张，不能叠在第一张上。");
    return match;
  });
};

async function select(page, paragraph, from, to) {
  await page.evaluate(
    ([index, start, end]) => {
      const node = document.querySelectorAll("#markdown-content > p")[index].firstChild;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    },
    [paragraph, from, to]
  );
  await page.waitForSelector(".sticky-pin:not([hidden])");
}

const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("functionhx:sticky-notes") || "null")?.pages?.["/blog/2026/gpa/"] || []);
const paragraphWith = (page, text) =>
  page.evaluate((needle) => [...document.querySelectorAll("#markdown-content > p")].findIndex((p) => p.textContent.includes(needle)), text);

// ---------- 宽屏：作者便利贴贴在右侧留白，读者便利贴的完整流程 ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const requests = [];
  context.on("request", (request) => requests.push(`${decodeURIComponent(request.url())} ${request.postData() || ""}`));
  const { page, errors } = await open(context, withAuthorNotes);
  assert.equal(await page.evaluate(() => document.querySelector(".post--article").dataset.stickyMode), "margin", "wide screens use the margin");
  await page.waitForTimeout(1200); // 等「贴上」的动画结束再量
  const placed = await page.evaluate(() =>
    [...document.querySelectorAll("#markdown-content > .sticky-note")].map((note) => {
      let anchor = note.previousElementSibling;
      while (anchor.matches(".sticky-note, .sticky-chip")) anchor = anchor.previousElementSibling;
      const box = note.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        anchor: anchor.getBoundingClientRect().top,
        textRight: anchor.getBoundingClientRect().right,
      };
    })
  );
  assert.equal(placed.length, 2);
  // 允许 24px：便利贴有意上提 6px，旋转后外框也会变大一点。
  assert.ok(Math.abs(placed[0].top - placed[0].anchor) < 24, "the first note lines up with the paragraph it annotates");
  assert.ok(placed[1].top >= placed[0].bottom + 8, "notes never overlap in the margin");
  assert.ok(
    placed.every((note) => note.left > note.textRight),
    "notes sit to the right of the text"
  );
  assert.match(await page.locator(".sticky-tray__note").textContent(), /选中一段文字/, "an empty tray is a one-line hint");

  // 选中 → 贴便利贴 → 写 → ⌘/Ctrl+Enter
  const paragraph = await paragraphWith(page, QUOTE);
  const offset = await page.evaluate(
    ([index, quote]) => document.querySelectorAll("#markdown-content > p")[index].firstChild.data.indexOf(quote),
    [paragraph, QUOTE]
  );
  await select(page, paragraph, offset, offset + QUOTE.length);
  await page.click(".sticky-pin");
  await page.waitForSelector(".sticky-note.is-editing textarea:focus");
  assert.equal(await page.isVisible(".sticky-pin"), false, "the pin goes away while writing");
  await page.keyboard.type("薪资至少是市场定价。");
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector(".sticky-note--mine:not(.is-editing)");
  let saved = await store(page);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].quote, QUOTE);
  assert.equal(saved[0].text, "薪资至少是市场定价。");
  assert.equal(saved[0].color, "yellow");
  assert.equal(await page.evaluate(() => CSS.highlights.has("sticky-yellow")), true, "the quoted words are highlighted");
  assert.match(await page.locator(".sticky-tray__title").textContent(), /我的便利贴 · 1 张/);

  // 改颜色
  await page.locator(".sticky-note--mine").hover();
  await page.click(".sticky-note--mine .sticky-note__edit");
  await page.click('.sticky-editor__color[data-sticky-color="mint"]');
  await page.click(".sticky-editor__done");
  saved = await store(page);
  assert.equal(saved[0].color, "mint", "colour changes are saved");

  // Esc 放弃一张空白的新便利贴
  await select(page, paragraph + 1, 0, 4);
  await page.click(".sticky-pin");
  await page.waitForSelector(".sticky-note.is-editing textarea:focus");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".sticky-note--mine").count(), 1, "Escape on an empty new note throws it away");
  assert.equal((await store(page)).length, 1);

  // 撕掉一张正被指着的便利贴：原文的高亮和下划线都要一起消失（站长 2026-10-08 报的 bug）
  await select(page, paragraph + 2, 0, 6);
  await page.click(".sticky-pin");
  await page.waitForSelector(".sticky-note.is-editing textarea:focus");
  await page.keyboard.type("马上撕掉");
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => document.querySelectorAll(".sticky-note--mine:not(.is-editing)").length === 2);
  const doomed = page.locator(".sticky-note--mine").filter({ hasText: "马上撕掉" });
  await doomed.hover();
  assert.equal(await page.evaluate(() => CSS.highlights.has("sticky-focus")), true, "pointing at a note underlines its quote");
  await doomed.locator(".sticky-note__edit").click();
  await page.click(".sticky-editor__tear");
  assert.equal(await page.evaluate(() => CSS.highlights.has("sticky-focus")), false, "tearing a note off removes the underline");
  assert.equal(await page.evaluate(() => CSS.highlights.get("sticky-mint")?.size ?? 0), 1, "only the remaining note keeps its highlight");
  assert.equal((await store(page)).length, 1);

  // 导出
  const [download] = await Promise.all([page.waitForEvent("download"), page.click(".sticky-tray__actions button:first-child")]);
  assert.match(download.suggestedFilename(), /^便利贴-gpa\.md$/);
  const exported = await readFile(await download.path(), "utf8");
  assert.ok(exported.includes(`> ${QUOTE}`) && exported.includes("薪资至少是市场定价。"), "the export carries the quote and the note");

  // 重新打开：还在原处
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sticky-note--mine");
  const anchored = await page.evaluate(() => {
    let anchor = document.querySelector(".sticky-note--mine").previousElementSibling;
    while (anchor.matches(".sticky-note, .sticky-chip")) anchor = anchor.previousElementSibling;
    return anchor.textContent;
  });
  assert.ok(anchored.includes(QUOTE), "after a reload the note is back beside its sentence");

  assert.deepEqual(
    requests.filter((request) => request.includes("薪资至少") || request.includes(QUOTE)),
    [],
    "neither the note nor the quoted words ever leave the browser"
  );
  assert.deepEqual(errors, []);
  await context.close();
}

// ---------- 文章改过：多半还能找回；原句没了就掉到文末 ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const now = new Date().toISOString();
  const notes = [
    {
      id: "kept",
      quote: QUOTE,
      prefix: "这时候，大多数人都会觉得哪里不太对。\n\n因为",
      suffix: "身。",
      text: "还在",
      color: "yellow",
      created: now,
      updated: now,
    },
    { id: "lost", quote: "这一句后来被删掉了", prefix: "", suffix: "", text: "掉了", color: "blue", created: now, updated: now },
  ];
  await context.addInitScript((value) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("functionhx:sticky-notes", JSON.stringify({ version: 1, pages: { "/blog/2026/gpa/": value } }));
      sessionStorage.setItem("seeded", "1");
    }
  }, notes);
  const { page, errors } = await open(context, (html) => html.replace("<p>", "<p>作者后来在开头补了一段。</p><p>"));
  await page.waitForSelector(".sticky-note--mine");
  assert.equal(await page.locator("#markdown-content > .sticky-note--mine").count(), 1, "a note whose sentence survived is re-anchored");
  assert.equal(await page.locator(".sticky-tray__dropped-list .sticky-note--mine").count(), 1, "a note whose sentence is gone drops to the tray");
  assert.equal(await page.isVisible(".sticky-tray__dropped"), true);

  // 全部撕掉要点两下
  const clear = page.locator(".sticky-tray__actions button:last-child");
  await clear.click();
  assert.equal((await store(page)).length, 2, "the first click only asks");
  await clear.click();
  assert.equal((await store(page)).length, 0, "the second click clears");
  assert.equal(await page.locator(".sticky-note--mine").count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
}

// ---------- 中等宽度夹在段落之间，手机上折成折角 ----------
for (const [width, mode] of [
  [1180, "inline"],
  [390, "fold"],
]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 800, hasTouch: width < 800 });
  const { page, errors } = await open(context, withAuthorNotes);
  assert.equal(await page.evaluate(() => document.querySelector(".post--article").dataset.stickyMode), mode, `${width}px uses ${mode}`);
  if (mode === "inline") {
    assert.equal(
      await page
        .locator("#markdown-content > .sticky-note")
        .first()
        .evaluate((note) => getComputedStyle(note).position),
      "relative"
    );
    assert.equal(await page.locator(".sticky-chip").first().isVisible(), false);
  } else {
    const chip = page.locator(".sticky-chip").first();
    assert.equal(await page.locator("#markdown-content > .sticky-note").first().isVisible(), false, "on phones notes start folded");
    assert.ok((await chip.boundingBox()).height >= 44, "the fold is a comfortable tap target");
    await chip.tap();
    assert.equal(await page.locator("#markdown-content > .sticky-note").first().isVisible(), true, "tapping the fold unfolds the note");
    assert.equal(await chip.getAttribute("aria-expanded"), "true");
    await chip.tap();
    assert.equal(await chip.getAttribute("aria-expanded"), "false");
  }
  assert.deepEqual(errors, []);
  await context.close();
}

// ---------- 站长：公开 → 原位编辑器把便利贴插进原文 ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname.endsWith("/contents/_posts/2026-10-05-gpa-zh.md")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ type: "file", sha: "abc123", content: Buffer.from(source).toString("base64") }),
      });
      return;
    }
    await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });
  const { page, errors } = await open(context);
  await page.evaluate(() => {
    document.documentElement.dataset.ownerVerified = "true";
    document.documentElement.dataset.ownerMode = "true";
  });
  const paragraph = await paragraphWith(page, QUOTE);
  const offset = await page.evaluate(
    ([index, quote]) => document.querySelectorAll("#markdown-content > p")[index].firstChild.data.indexOf(quote),
    [paragraph, QUOTE]
  );
  await select(page, paragraph, offset, offset + QUOTE.length);
  await page.click(".sticky-pin");
  await page.waitForSelector(".sticky-editor__scope");
  await page.click('.sticky-editor__color[data-sticky-color="pink"]');
  await page.click('.sticky-editor__scope button:has-text("公开")');
  await page.keyboard.press("Tab");
  await page.fill(".sticky-editor__text", "公开的一张。\n第二行。");
  await page.click(".sticky-editor__done");
  await page.waitForFunction(() => document.getElementById("site-inline-editor-body")?.value.includes("[!便利贴"), null, { timeout: 15000 });
  const body = await page.inputValue("#site-inline-editor-body");
  const quoteAt = body.indexOf(QUOTE);
  const noteAt = body.indexOf("> [!便利贴 粉] 公开的一张。\n> 第二行。");
  assert.ok(quoteAt !== -1 && noteAt > quoteAt, "the public note lands after the paragraph it annotates");
  assert.equal(body.slice(quoteAt, noteAt).split("\n\n").length, 2, "right after that paragraph, not further down");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("functionhx:sticky-publish")), null, "the hand-off is consumed once");
  assert.match(
    await page.locator(".sticky-note--mine .sticky-note__by").textContent(),
    /待公开/,
    "the local copy says it is waiting to be published"
  );
  assert.deepEqual(errors, []);
  await context.close();
}

await browser.close();
server.close();
console.log(
  "Sticky note checks passed: margin / inline / fold layouts, create, edit, export, re-anchoring, dropped notes, privacy, and the owner's public hand-off."
);
