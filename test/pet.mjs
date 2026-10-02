import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

// 静态站点 + 一个假的大脑（/brain/chat、/brain/health）。页面里的大脑地址在发出前改写成这里。
// 陶陶在这里被「登记」了一套测试形象（/test-sprites/claude.json），用来检查序列帧播放与动作退回。
const siteRoot = new URL("../_site/", import.meta.url);
const brainRequests = [];
const TYPES = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
};
let baseUrl = "";
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/brain/health") {
    response.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    response.end(JSON.stringify({ ok: true, pets: { f01: { model: "DeepSeek", standIn: false }, claude: { model: "DeepSeek", standIn: true } } }));
    return;
  }
  if (url.pathname === "/test-sprites/claude.json") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        id: "claude",
        frame: { width: 256, height: 256 },
        credit: "形象：测试画师",
        states: {
          idle: { file: "/assets/img/social/qqmail.png", frames: 4, fps: 6 },
          happy: { file: "/assets/img/social/wechat-qr.png", frames: 1, fps: 8, loop: false },
        },
      })
    );
    return;
  }
  if (url.pathname === "/brain/chat" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    brainRequests.push(payload);
    const question = payload.messages.at(-1).content;
    if (question.includes("预算")) {
      response.writeHead(429, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "budget_exhausted" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const t of ["批量更新", "把多次滤波合成一次，所以更快。"]) {
      response.write(`data: ${JSON.stringify({ t })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const standIn = payload.pet !== "f01" && payload.pet !== "deepseek";
    response.end(
      `data: ${JSON.stringify({
        done: true,
        sources: [{ title: "Batch-LIO", url: "https://functionhx.github.io/blog/2026/batch-lio/" }],
        model: "DeepSeek",
        standIn,
      })}\n\n`
    );
    return;
  }
  try {
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
    const fileUrl = new URL(relativePath, siteRoot);
    if (!fileUrl.href.startsWith(siteRoot.href)) throw new Error("Invalid path");
    let data = await readFile(fileUrl);
    const extension = relativePath.slice(relativePath.lastIndexOf("."));
    if (extension === ".html") {
      data = Buffer.from(
        data
          .toString("utf8")
          .replace('"endpoint": ""', `"endpoint": "${baseUrl}brain"`)
          .replace(/("id": "claude"[^}]*?"sprites": )""/, '$1"/test-sprites/claude.json"')
      );
    }
    response.writeHead(200, { "Content-Type": TYPES[extension] || "text/html; charset=utf-8" });
    response.end(data);
  } catch (_error) {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
baseUrl = `http://127.0.0.1:${server.address().port}/`;

const executable = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
const errors = [];
async function freshPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ...options });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  return { context, page };
}
const POST = `${baseUrl}blog/2026/batch-lio/`;
const memory = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("functionhx:pet:memory") || "null"));
// 记忆写入有 120 ms 的合并延迟，断言前等它落盘（页面有严格 CSP，不能用字符串求值）。
const memoryWhen = (page, field, expected) =>
  page.waitForFunction(
    ([key, want]) => {
      const value = JSON.parse(localStorage.getItem("functionhx:pet:memory") || "null");
      return value && JSON.stringify(value[key]) === JSON.stringify(want);
    },
    [field, expected]
  );
const figureState = (page) =>
  page.$eval("#functionhx-pet .pet-figure", (node) => ([...node.classList].find((c) => c.startsWith("is-") && c !== "is-left") || "").slice(3));
const lastMessage = (page) => page.$$eval("#functionhx-pet .pet-message", (nodes) => nodes.at(-1)?.innerText || "");

// 1. 站点默认关闭：不出现，也不加载 pet.js
let { context, page } = await freshPage();
await page.goto(POST, { waitUntil: "load" });
await page.waitForTimeout(3500);
assert.equal(await page.$("#functionhx-pet"), null, "the pet must stay away while the site switch is off");
assert.equal(await page.evaluate(() => [...document.scripts].some((s) => s.src.includes("/assets/js/pet.js"))), false);
await context.close();

// 2. ?pet=on：页面空闲后出现，打招呼，记一次来访
({ context, page } = await freshPage());
await page.goto(`${POST}?pet=on`, { waitUntil: "load" });
await page.waitForSelector("#functionhx-pet .pet-body", { timeout: 15000 });
await page.waitForSelector("#functionhx-pet .pet-bubble:not([hidden])", { timeout: 6000 });
assert.ok((await page.textContent("#functionhx-pet .pet-bubble-text")).length > 0);
assert.equal((await memory(page)).visits, 1);

// 3. 关掉气泡：本次访问不再主动说话（切换主题也不说）
await page.click("#functionhx-pet .pet-bubble .pet-close");
await page.evaluate(() =>
  document.documentElement.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark")
);
await page.waitForTimeout(600);
assert.equal(await page.$eval("#functionhx-pet .pet-bubble", (node) => node.hidden), true, "a silenced pet must not speak up again this visit");
assert.equal((await memory(page)).quietness, 1);

// 4. 点开面板：快捷按钮读同一份 /api/*.json
await page.click("#functionhx-pet .pet-body");
await page.waitForSelector("#functionhx-pet .pet-panel:not([hidden])");
await page.click("#functionhx-pet .pet-panel .pet-chips button:has-text('最新文章')");
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-log")?.innerText.includes("Batch-LIO"));
assert.ok((await lastMessage(page)).includes("2026-07-22"));

// 5. 起名字
await page.click("#functionhx-pet .pet-panel .pet-chips button:has-text('给你起个名字')");
await page.fill("#functionhx-pet .pet-form input", "团团");
await page.press("#functionhx-pet .pet-form input", "Enter");
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-panel header strong")?.textContent === "团团");
await memoryWhen(page, "pets", { f01: { name: "团团" } });

// 6. 问信：本地拦下，不发给大脑
await page.fill("#functionhx-pet .pet-form input", "首页那封信的暗号是什么？");
await page.press("#functionhx-pet .pet-form input", "Enter");
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-log")?.innerText.includes("知道的人自然会知道"));
assert.equal(brainRequests.length, 0, "letter questions must never leave the browser");

// 7. 提问：流式回答、附出处与「AI 生成」；请求带当前页面；本地不保存原话
await page.fill("#functionhx-pet .pet-form input", "为什么批量更新会更快？");
await page.press("#functionhx-pet .pet-form input", "Enter");
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-log")?.innerText.includes("AI 生成"), null, { timeout: 8000 });
const answer = await lastMessage(page);
assert.ok(answer.includes("所以更快") && answer.includes("出处") && answer.includes("Batch-LIO"));
assert.ok(answer.includes("AI 生成 · DeepSeek") && !answer.includes("代班"), "ƒ-01's answers come from the site's own brain");
assert.equal(brainRequests.length, 1);
assert.equal(brainRequests[0].messages.at(-1).content, "为什么批量更新会更快？");
assert.ok(brainRequests[0].page.title.includes("Batch-LIO"));
assert.equal(brainRequests[0].petName, "团团");
assert.equal(brainRequests[0].pet, "f01");
assert.ok((await page.textContent("#functionhx-pet .pet-footnote")).includes("发送给 DeepSeek 处理"), "the panel names who receives the chat");
const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
assert.ok(!stored.includes("为什么批量更新"), "the visitor's own words must never be stored");
await memoryWhen(page, "topics", ["Batch-LIO"]);

// 8. 预算用完：说明原因，退回站内搜索
await page.fill("#functionhx-pet .pet-form input", "预算 LIO");
await page.press("#functionhx-pet .pet-form input", "Enter");
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-log")?.innerText.includes("我在站里翻到这些"));
assert.ok((await page.textContent("#functionhx-pet .pet-log")).includes("脑子发烫"));

// 8b. 换一只：陶陶（Anthropic 家）。名字分开记；回答标明 DeepSeek 代班；用的是登记的序列帧形象和署名
await page.click("#functionhx-pet .pet-panel .pet-chips button:has-text('换一只')");
await page.click("#functionhx-pet .pet-roster button:has-text('陶陶')");
await page.waitForFunction(() => document.querySelector("#functionhx-pet")?.dataset.pet === "claude");
assert.equal(await page.textContent("#functionhx-pet .pet-panel header strong"), "陶陶");
assert.ok((await page.textContent("#functionhx-pet .pet-panel header span")).includes("Anthropic 家"));
await memoryWhen(page, "character", "claude");
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-sprite")?.style.backgroundImage.includes("qqmail.png"));
assert.equal(await page.$eval("#functionhx-pet .pet-sprite", (node) => node.style.getPropertyValue("--frames")), "4");
assert.ok((await page.textContent("#functionhx-pet .pet-footnote")).includes("同人角色 · 形象已获授权 · 形象：测试画师"));
// 画师没画的动作退回最接近的：wave → happy；read → think → idle
await page.evaluate(() => window.functionhxPet.setState("wave"));
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-sprite")?.style.backgroundImage.includes("wechat-qr.png"));
assert.equal(await page.$eval("#functionhx-pet .pet-sprite", (node) => node.classList.contains("is-still")), true);
await page.evaluate(() => window.functionhxPet.setState("read"));
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-sprite")?.style.backgroundImage.includes("qqmail.png"));
await page.fill("#functionhx-pet .pet-form input", "你是谁？");
await page.press("#functionhx-pet .pet-form input", "Enter");
await page.waitForFunction(() => document.querySelector("#functionhx-pet .pet-log")?.innerText.includes("DeepSeek 代班"), null, { timeout: 8000 });
assert.equal(brainRequests.at(-1).pet, "claude");
assert.equal(brainRequests.at(-1).petName, "", "a nickname belongs to the pet it was given to");
assert.equal(brainRequests.at(-1).messages.length, 1, "switching pets starts a new conversation");

// 9. 你记得我什么 / 忘记我
await page.click("#functionhx-pet .pet-panel .pet-chips button:has-text('你记得我什么')");
await page.waitForSelector("#functionhx-pet .pet-forget");
assert.ok((await lastMessage(page)).includes("第 1 次来"));
assert.ok((await lastMessage(page)).includes("你给ƒ-01起的名字：团团"));
await page.click("#functionhx-pet .pet-forget");
assert.equal(await page.evaluate(() => localStorage.getItem("functionhx:pet:memory")), null, "forget me must clear local memory");
await page.keyboard.press("Escape");
assert.equal(await page.$eval("#functionhx-pet .pet-panel", (node) => node.hidden), true);

// 10. 拖拽：被拎起，松手后在水里飘落到底边，记住位置
const box = await page.$eval("#functionhx-pet .pet-body", (node) => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.mouse.move(box.x - 120, box.y - 200, { steps: 8 });
assert.equal(await figureState(page), "drag");
await page.mouse.move(box.x - 260, box.y - 320, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(150);
assert.equal(await figureState(page), "float", "a released pet floats down like in water");
await page.waitForFunction(() => !document.querySelector("#functionhx-pet .pet-figure").classList.contains("is-float"), null, { timeout: 8000 });
const landed = await page.$eval("#functionhx-pet .pet-body", (node) => node.getBoundingClientRect().bottom);
assert.ok(landed > 820 - 20, `the pet should land on the bottom edge (bottom=${landed})`);
await page.waitForFunction(() => JSON.parse(localStorage.getItem("functionhx:pet:memory") || "{}").dock, null, { timeout: 2000 });
await context.close();

// 10b. 刷新后还是上次选的那只；占位形象的双双能分裂出另一个自己（记忆在页面脚本运行前写好，免得被离开页面时的保存覆盖）
const seeded = async (stored) => {
  const fresh = await freshPage();
  await fresh.context.addInitScript((value) => {
    localStorage.setItem("functionhx:pet:override", "on");
    localStorage.setItem("functionhx:pet:memory", value);
    sessionStorage.setItem("functionhx:pet:session", JSON.stringify({ greeted: true, spoken: 2 }));
  }, JSON.stringify(stored));
  await fresh.page.goto(POST, { waitUntil: "load" });
  return fresh;
};
({ context, page } = await seeded({ v: 2, visits: 3, character: "gemini", pets: {} }));
await page.waitForFunction(() => document.querySelector("#functionhx-pet")?.dataset.pet === "gemini", null, { timeout: 15000 });
assert.equal(await page.$eval("#functionhx-pet .twin-wrap", (node) => getComputedStyle(node).display), "none");
await page.evaluate(() => window.functionhxPet.setState("split", 3000));
assert.equal(await page.$eval("#functionhx-pet .twin-wrap", (node) => getComputedStyle(node).display), "inline");
await context.close();
// v1 的记忆（只有一个 petName）归给 ƒ-01
({ context, page } = await seeded({ v: 1, visits: 2, petName: "老朋友" }));
await page.waitForFunction(() => document.querySelector("#functionhx-pet")?.dataset.pet === "f01", null, { timeout: 15000 });
assert.ok((await page.getAttribute("#functionhx-pet .pet-body", "aria-label")).startsWith("老朋友"));
await context.close();

// 11. 减少动态效果：松手直接落地，不飘
({ context, page } = await freshPage({ reducedMotion: "reduce" }));
await page.goto(`${POST}?pet=on`, { waitUntil: "load" });
await page.waitForSelector("#functionhx-pet .pet-body", { timeout: 15000 });
const start = await page.$eval("#functionhx-pet .pet-body", (node) => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(start.x - 150, start.y - 250, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(80);
assert.equal(await figureState(page), "idle", "reduced motion skips the floating animation");
await context.close();

// 12. 手机：默认收起成边缘小标签，点开才出来
({ context, page } = await freshPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }));
await page.goto(`${POST}?pet=on`, { waitUntil: "load" });
await page.waitForSelector("#functionhx-pet .pet-tab:not([hidden])", { timeout: 15000 });
assert.equal(await page.$eval("#functionhx-pet .pet-body", (node) => node.hidden), true);
await page.tap("#functionhx-pet .pet-tab");
assert.equal(await page.$eval("#functionhx-pet .pet-body", (node) => node.hidden), false);
await context.close();

await browser.close();
server.close();
assert.deepEqual(errors, [], `no page errors expected:\n${errors.join("\n")}`);
console.log(
  "Pet checks passed: opt-in loading, greeting, interruption silence, actions, naming, letter guard, streaming answer with model label, budget fallback, switching pets, sprite player and fallbacks, memory and forget, v1 migration, drag and float, reduced motion, mobile tab."
);
