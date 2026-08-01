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

  console.log("Magic Search evidence and delayed loader browser test passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
