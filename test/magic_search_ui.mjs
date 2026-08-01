import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const searchIndex = JSON.parse(await readFile(new URL("assets/search/index-zh.json", siteRoot), "utf8"));
const semanticChunkId = searchIndex.chunks.find((chunk) => chunk.text && chunk.title)?.id;
assert.ok(semanticChunkId, "the built Chinese index should expose a semantic test chunk");

const staticServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let relativePath = pathname.replace(/^\/+/, "");
    if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
    const fileUrl = new URL(relativePath, siteRoot);
    if (!fileUrl.href.startsWith(siteRoot.href)) throw new Error("Invalid path");
    const body = await readFile(fileUrl);
    const contentType = fileUrl.pathname.endsWith(".css")
      ? "text/css"
      : fileUrl.pathname.endsWith(".js")
        ? "text/javascript"
        : fileUrl.pathname.endsWith(".json")
          ? "application/json"
          : "text/html";
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
const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });

await page.route("https://fanyuchen.com.cn/api/magic-search/search", async (route) => {
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ headers: corsHeaders, status: 204 });
    return;
  }
  const query = route.request().postDataJSON()?.query || "";
  await route.fulfill({
    body: JSON.stringify({ results: query === "luminousquokka" ? [{ id: semanticChunkId, score: 0.94 }] : [] }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-page-loading"));

  const contactLinks = page.locator(".contact-icons a");
  assert.equal(await contactLinks.count(), 8, "the home contact row should expose eight useful destinations");
  assert.equal(await page.locator(".fa-globe, .fa-square-rss").count(), 0, "redundant website and RSS icons must stay hidden");
  const contactMetrics = await contactLinks.evaluateAll((links) =>
    links.map((link) => {
      const linkRect = link.getBoundingClientRect();
      const iconRect = link.querySelector("i, img, svg").getBoundingClientRect();
      return {
        height: linkRect.height,
        iconCenterY: iconRect.top + iconRect.height / 2,
        linkCenterY: linkRect.top + linkRect.height / 2,
        width: linkRect.width,
      };
    })
  );
  assert.ok(
    Math.max(...contactMetrics.map(({ width }) => width)) - Math.min(...contactMetrics.map(({ width }) => width)) < 0.5,
    "contact targets should share one width"
  );
  assert.ok(
    Math.max(...contactMetrics.map(({ height }) => height)) - Math.min(...contactMetrics.map(({ height }) => height)) < 0.5,
    "contact targets should share one height"
  );
  assert.ok(
    contactMetrics.every(({ iconCenterY, linkCenterY }) => Math.abs(iconCenterY - linkCenterY) < 1),
    "contact marks should be vertically centered"
  );

  const qqTrigger = page.locator('.contact-icons a[title="QQ · 2994114386"]');
  assert.equal(await qqTrigger.count(), 1, "the home contact row should expose one independent QQ contact");
  assert.equal(
    await qqTrigger.getAttribute("href"),
    "tencent://message/?uin=2994114386&Site=Magic&Menu=yes",
    "the QQ contact should open a Tencent QQ conversation"
  );
  assert.equal(await qqTrigger.getAttribute("aria-label"), "QQ · 2994114386", "the QQ contact should announce its account number");
  assert.equal(await qqTrigger.getAttribute("data-no-page-loader"), "", "the QQ contact must not trigger page loading UI");
  assert.equal(
    await qqTrigger.locator(".fa-qq").evaluate((icon) => getComputedStyle(icon, "::before").color),
    "rgb(18, 183, 245)",
    "the QQ icon should use QQ blue"
  );
  await page.evaluate(() => {
    window.__contactCopies = [];
    window.__contactLaunches = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => window.__contactCopies.push(value) },
    });
    document.addEventListener("functionhx:contact-launch", (event) => {
      window.__contactLaunches.push(event.detail);
      event.preventDefault();
    });
  });
  await qqTrigger.click();
  await page.waitForFunction(() => window.__contactLaunches.length === 1);
  const qqMailTrigger = page.locator('.contact-icons a[title="QQ Mail"]');
  assert.equal(await qqMailTrigger.getAttribute("aria-label"), "QQ Mail · 2994114386@qq.com");
  assert.equal(await qqMailTrigger.getAttribute("data-no-page-loader"), "");
  await qqMailTrigger.click();
  await page.waitForFunction(() => window.__contactLaunches.length === 2);
  assert.deepEqual(
    await page.evaluate(() => ({ copies: window.__contactCopies, launches: window.__contactLaunches })),
    {
      copies: ["2994114386", "2994114386@qq.com"],
      launches: [
        {
          copyText: "2994114386",
          href: "tencent://message/?uin=2994114386&Site=Magic&Menu=yes",
        },
        {
          copyText: "2994114386@qq.com",
          href: "mailto:2994114386@qq.com",
        },
      ],
    },
    "QQ and QQ Mail should copy the right values before launching their target protocols"
  );
  assert.match(await page.locator("#contact-copy-status").textContent(), /2994114386@qq\.com/, "copy feedback should name the copied address");

  await page.evaluate(() => {
    window.__contactCopies = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error("Clipboard permission denied")) },
    });
    document.execCommand = (_command) => {
      window.__contactCopies.push(document.querySelector('textarea[aria-hidden="true"]')?.value || "");
      return true;
    };
  });
  await qqTrigger.click();
  await page.waitForFunction(() => window.__contactLaunches.length === 3);
  assert.deepEqual(await page.evaluate(() => window.__contactCopies), ["2994114386"], "the copy fallback should preserve the QQ number");

  await page.evaluate(() => {
    window.__contactCopies = [];
    document.execCommand = () => false;
  });
  await qqMailTrigger.click();
  await page.waitForFunction(() => window.__contactLaunches.length === 4);
  assert.equal(
    await page.evaluate(() => window.__contactLaunches.at(-1).href),
    "mailto:2994114386@qq.com",
    "a failed copy must still launch QQ Mail"
  );
  assert.match(await page.locator("#contact-copy-status").textContent(), /复制失败/, "copy failure should be announced without blocking launch");
  await page.waitForTimeout(240);
  assert.equal(await page.locator("html").getAttribute("data-page-loading"), null, "the QQ contact must leave the page loader idle");

  const wechatTrigger = page.locator('.contact-icons a[title="WeChat"]');
  assert.equal(await wechatTrigger.getAttribute("data-no-page-loader"), "", "opening the WeChat dialog must not trigger page navigation loading");
  await wechatTrigger.click();
  const wechatDialog = page.locator("#wechat-qr-dialog");
  assert.equal(await wechatDialog.evaluate((dialog) => dialog.open), true, "WeChat should open an in-page QR dialog");
  await page.waitForFunction(() => {
    const image = document.querySelector("#wechat-qr-dialog img");
    return image?.complete && image.naturalWidth === 660 && image.naturalHeight === 660;
  });
  await wechatDialog.locator(".wechat-qr-dialog__close").click();
  assert.equal(await wechatDialog.evaluate((dialog) => dialog.open), false, "the QR dialog should close without navigation");
  await page.waitForTimeout(240);
  assert.equal(
    await page.locator("html").getAttribute("data-page-loading"),
    null,
    "closing the WeChat dialog must not start a page loader for a non-navigation form"
  );
  assert.equal(await page.locator("body").getAttribute("aria-busy"), null, "closing the WeChat dialog must leave the document idle");

  await wechatTrigger.click();
  await page.keyboard.press("Escape");
  assert.equal(await wechatDialog.evaluate((dialog) => dialog.open), false, "Escape should dismiss the WeChat dialog");
  await page.waitForTimeout(240);
  assert.equal(await page.locator("html").getAttribute("data-page-loading"), null, "Escape-closing a dialog must leave the loader idle");

  const canceledFormState = await page.evaluate(async () => {
    const form = document.createElement("form");
    const button = document.createElement("button");
    button.type = "submit";
    form.append(button);
    form.addEventListener("submit", (event) => event.preventDefault());
    document.body.append(form);
    button.click();
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    const state = {
      busy: document.body.hasAttribute("aria-busy"),
      loading: document.documentElement.hasAttribute("data-page-loading"),
    };
    form.remove();
    return state;
  });
  assert.deepEqual(canceledFormState, { busy: false, loading: false }, "client-handled forms must not masquerade as page navigation");

  await page.setViewportSize({ height: 844, width: 390 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "the contact row must not create mobile horizontal overflow"
  );
  await page.setViewportSize({ height: 900, width: 1280 });

  const fastLoadingState = await page.evaluate(async () => {
    window.functionhxSitePreferences.showLoading();
    await new Promise((resolve) => window.setTimeout(resolve, 70));
    window.functionhxSitePreferences.hideLoading();
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    return document.documentElement.hasAttribute("data-page-loading");
  });
  assert.equal(fastLoadingState, false, "sub-180 ms work must never reveal the page loader");

  const delayedLoadingState = await page.evaluate(async () => {
    window.functionhxSitePreferences.showLoading();
    await new Promise((resolve) => window.setTimeout(resolve, 205));
    const appeared = document.documentElement.dataset.pageLoading === "true";
    window.functionhxSitePreferences.hideLoading();
    const stayedStable = document.documentElement.dataset.pageLoading === "true";
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    return {
      appeared,
      disappeared: !document.documentElement.hasAttribute("data-page-loading"),
      stayedStable,
    };
  });
  assert.deepEqual(delayedLoadingState, { appeared: true, disappeared: true, stayedStable: true });

  await page.locator("#search-toggle").click();
  const search = page.locator("#magic-search-dialog");
  await search.waitFor({ state: "visible" });
  await search.locator(".magic-search__input").fill("具身");

  const titleEvidence = search.locator(".magic-search__result-title .magic-search__match", { hasText: "具身" });
  const bodyEvidence = search.locator(".magic-search__evidence").filter({ hasText: "正文" });
  await titleEvidence.first().waitFor({ state: "visible" });
  await bodyEvidence.first().waitFor({ state: "visible" });
  assert.ok(
    await bodyEvidence.first().locator(".magic-search__match", { hasText: "具身" }).count(),
    "body matches should expose highlighted context"
  );

  await search.locator(".magic-search__input").fill("luminousquokka");
  const semanticEvidence = search.locator(".magic-search__evidence-label", { hasText: "语义" });
  await semanticEvidence.first().waitFor({ state: "visible" });
  assert.equal(await search.locator(".magic-search__match").count(), 0, "semantic-only results must not invent token-level attribution");

  await search.locator(".magic-search__escape").click();
  await page.waitForTimeout(240);
  assert.equal(await page.locator("html").getAttribute("data-page-loading"), null, "closing Magic Search must leave the loader idle");

  console.log("Magic Search evidence and delayed loader browser test passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
