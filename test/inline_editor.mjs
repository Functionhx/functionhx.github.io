import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const screenshotDirectory = process.env.INLINE_EDITOR_SCREENSHOT_DIR || "";
const testToken = "not-a-real-token-value";
const originalSource = `---
layout: about
title: "樊宇琛"
description: "测试摘要"
permalink: /
lang: zh
translation_key: home
published: true
giscus_comments: false
---
原始正文。
`;

let committedBody = null;
let committedAuthorization = "";

let staticServer = null;
let baseUrl = process.env.INLINE_EDITOR_TEST_URL || "";
if (!baseUrl) {
  staticServer = createServer(async (request, response) => {
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
  baseUrl = `http://127.0.0.1:${address.port}/`;
}

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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };

  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }

  if (url.pathname === "/user") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({ login: "Functionhx" }),
    });
    return;
  }

  if (url.pathname === "/repos/Functionhx/functionhx.github.io") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({ permissions: { push: true } }),
    });
    return;
  }

  if (url.pathname === "/repos/Functionhx/functionhx.github.io/contents/_pages/about-zh.md") {
    if (request.method() === "PUT") {
      committedAuthorization = request.headers().authorization || "";
      committedBody = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({
          content: { sha: "new-sha" },
          commit: { html_url: "https://github.com/Functionhx/functionhx.github.io/commit/test" },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({
        type: "file",
        sha: "base-sha",
        content: Buffer.from(originalSource, "utf8").toString("base64"),
      }),
    });
    return;
  }

  await route.fulfill({
    status: 404,
    contentType: "application/json",
    headers: corsHeaders,
    body: JSON.stringify({ message: `Unhandled test endpoint: ${url.pathname}` }),
  });
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#site-inline-editor-toggle").click();
  await page.locator("#site-inline-editor-form").waitFor({ state: "visible" });

  assert.equal(await page.locator("body").evaluate((element) => element.classList.contains("site-inline-editor-active")), true);
  assert.equal(await page.locator("#site-rendered-content").isVisible(), false);
  assert.match(await page.locator("#site-inline-editor-body").inputValue(), /原始正文/);

  await page.locator("#site-inline-editor-title").fill("页面内即时编辑");
  await page.locator("#site-inline-editor-body").fill("## 即时预览\n\n这是页面里的编辑结果。");
  await page.locator("#site-inline-editor-preview-body h2").waitFor({ state: "visible" });
  assert.equal(await page.locator("#site-inline-editor-preview-title").textContent(), "页面内即时编辑");
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: `${screenshotDirectory}/inline-editor-desktop.png`, fullPage: true });
  }

  await page.waitForTimeout(500);
  const savedDraft = await page.evaluate(() => Object.values(window.localStorage).find((value) => value.includes("页面里的编辑结果")));
  assert.ok(savedDraft, "the browser draft should be autosaved");
  assert.equal(savedDraft.includes(testToken), false);

  await page.locator("#site-inline-editor-connect").click();
  await page.locator("#site-inline-editor-token").fill(testToken);
  await page.locator("#site-inline-editor-auth-connect").click();
  await page.locator("#site-inline-editor-auth").waitFor({ state: "hidden" });

  await page.locator("#site-inline-editor-commit").click();
  await page.locator("#site-inline-editor-result").waitFor({ state: "visible" });

  assert.ok(committedBody, "the editor should send a Contents API PUT request");
  assert.equal(committedAuthorization, `Bearer ${testToken}`);
  assert.match(Buffer.from(committedBody.content, "base64").toString("utf8"), /页面内即时编辑/);
  assert.match(Buffer.from(committedBody.content, "base64").toString("utf8"), /这是页面里的编辑结果/);

  const browserStorage = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  assert.equal(browserStorage.includes(testToken), false, "the GitHub token must never enter browser storage");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const source = document.querySelector(".site-inline-editor__source").getBoundingClientRect();
    const preview = document.querySelector(".site-inline-editor__preview").getBoundingClientRect();
    return { sourceTop: source.top, previewTop: preview.top };
  });
  assert.ok(mobileLayout.previewTop > mobileLayout.sourceTop, "the mobile preview should stack below the source editor");
  if (screenshotDirectory) {
    await page.screenshot({ path: `${screenshotDirectory}/inline-editor-mobile.png`, fullPage: true });
  }

  await page.locator("#site-inline-editor-close").click();
  assert.equal(await page.locator("#site-rendered-content").isVisible(), true);

  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#site-inline-editor-toggle").click();
  await page.locator("#site-inline-editor-form").waitFor({ state: "visible" });
  await page.locator("#site-inline-editor-preview-body p").waitFor({ state: "visible" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  const darkThemeColors = await page.locator("#site-inline-editor").evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.notEqual(darkThemeColors.color, "rgb(0, 0, 0)");
  if (screenshotDirectory) {
    await page.screenshot({ path: `${screenshotDirectory}/inline-editor-dark.png`, fullPage: true });
  }

  console.log("Inline editor browser test passed.");
} finally {
  await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
}
