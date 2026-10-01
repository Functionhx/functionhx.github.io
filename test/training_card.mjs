import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

// 首页训练进度卡片：曲线和数字都是公式算出来的演示数据，不发任何网络请求。这里测试
// 三件事——同一时刻两次计算结果完全一致（确定性，不依赖 Math.random）、数值落在
// 公式预期的范围内、懒加载和 hover 交互能正常工作。

const siteRoot = new URL("../_site/", import.meta.url);
const staticServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let relativePath = pathname.replace(/^\/+/, "");
    if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
    const fileUrl = new URL(relativePath, siteRoot);
    if (!fileUrl.href.startsWith(siteRoot.href)) throw new Error("Invalid path");
    const body = await readFile(fileUrl);
    const contentType = fileUrl.pathname.endsWith(".css") ? "text/css" : fileUrl.pathname.endsWith(".js") ? "text/javascript" : "text/html";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch (_error) {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
const address = staticServer.address();
const baseUrl = `http://127.0.0.1:${address.port}/`;
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const browserExecutable = browserCandidates.find((candidate) => existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  ...(browserExecutable ? { executablePath: browserExecutable } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  // 确定性：同一个时间戳，无论算多少次都必须得到完全一样的 step/loss/lr——访客之间
  // 不应该看到不一致的曲线，图表也不能每次刷新都随机跳动。
  const [first, second] = await page.evaluate(() => {
    const at = 1_800_000_000_000;
    return [window.functionhxTrainingCard.snapshot(at), window.functionhxTrainingCard.snapshot(at)];
  });
  assert.deepEqual(first, second, "The same timestamp must always produce the same snapshot");

  // 数值范围：loss 和 lr 要落在公式设定的边界内，不能出现负数或者超过峰值。
  const bounds = await page.evaluate(() => {
    const early = window.functionhxTrainingCard.snapshot(Date.parse("2026-10-01T00:00:10Z"));
    const late = window.functionhxTrainingCard.snapshot(Date.parse("2026-11-01T00:00:00Z"));
    return { early, late };
  });
  assert.ok(bounds.early.loss > 7, "Loss must start high near the beginning of training");
  assert.ok(bounds.late.loss < bounds.early.loss, "Loss must trend down over a long span of training");
  assert.ok(bounds.late.loss >= 1.4, "Loss must not fall below its floor");
  assert.ok(bounds.late.lr > 0 && bounds.late.lr <= 3.01e-4, "Learning rate must stay within its schedule bounds");
  assert.ok(bounds.late.step > bounds.early.step, "Step must increase with wall-clock time");

  // 懒加载：卡片在视口外时不开计时器，滚入视口后才渲染。
  const card = page.locator("[data-training-card]");
  const beforeVisible = await card.getAttribute("data-training-visible");
  assert.notEqual(beforeVisible, "true", "The card must not start ticking before it enters the viewport");

  await card.scrollIntoViewIfNeeded();
  await assert.doesNotReject(async () => {
    await page.locator('[data-training-field="loss"]').filter({ hasText: /\d/ }).waitFor({ state: "visible", timeout: 5000 });
  }, "The loss figure must render once the card enters the viewport");

  const lossText = await page.locator('[data-training-field="loss"]').textContent();
  assert.match(lossText, /^\d+\.\d+$/, `Loss must render as a decimal number, got ${lossText}`);

  const pathCount = await page.locator("[data-training-loss-svg] path").count();
  assert.ok(pathCount >= 2, "The loss chart must draw an area and a line");

  // Hover：悬停图表要出现同步的 step/loss/lr 提示。
  const chartBox = await page.locator("[data-training-chart-wrap]").boundingBox();
  assert.ok(chartBox, "The chart wrapper must be visible");
  await page.mouse.move(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height / 2);
  await assert.doesNotReject(async () => {
    await page
      .locator("[data-training-tooltip]")
      .filter({ hasText: /Step \d/ })
      .waitFor({ state: "visible", timeout: 2000 });
  }, "Hovering the chart must show a step/loss/lr tooltip");

  console.log("Training card checks passed: determinism, value bounds, lazy loading, and hover tooltip.");
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
