import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function navigationState(route) {
  await page.goto(new URL(route, baseUrl).href, { waitUntil: "networkidle" });
  return page.locator("#navbar").evaluate((navbar) => {
    const items = [...navbar.querySelectorAll(".navbar-menu-list > li")];
    return {
      active: items
        .filter((item) => item.classList.contains("active"))
        .map((item) => item.querySelector("[data-nav-translation-key]")?.dataset.navTranslationKey || ""),
      brandCount: navbar.querySelectorAll(".navbar-brand.title").length,
      geometry: items.map((item) => {
        const rect = item.getBoundingClientRect();
        const link = item.querySelector(".nav-link");
        return {
          fontWeight: link ? window.getComputedStyle(link).fontWeight : "",
          left: rect.left,
          text: link?.textContent.replace(/\s+/g, " ").trim() || "",
          width: rect.width,
        };
      }),
    };
  });
}

function assertSameGeometry(actual, expected, route) {
  assert.equal(actual.geometry.length, expected.geometry.length, `${route} must keep the same navigation controls`);
  actual.geometry.forEach((rect, index) => {
    assert.ok(
      Math.abs(rect.left - expected.geometry[index].left) < 0.5,
      `${route} moved navigation item ${index + 1} (${rect.text}, ${rect.fontWeight}): ${rect.left} instead of ${expected.geometry[index].left} (${expected.geometry[index].fontWeight})`
    );
    assert.ok(
      Math.abs(rect.width - expected.geometry[index].width) < 0.5,
      `${route} resized navigation item ${index + 1} (${rect.text}, ${rect.fontWeight}): ${rect.width} instead of ${expected.geometry[index].width} (${expected.geometry[index].fontWeight})`
    );
  });
}

try {
  const chineseHome = await navigationState("/");
  assert.deepEqual(chineseHome.active, ["home"]);
  assert.equal(chineseHome.brandCount, 0);
  for (const [route, active] of [
    ["/blog/", "blog"],
    ["/tools/", "tools"],
    ["/documents/", "documents"],
    ["/spark/", "spark"],
  ]) {
    const state = await navigationState(route);
    assert.deepEqual(state.active, [active], `${route} should change only its active item`);
    assert.equal(state.brandCount, 0, `${route} must not insert a page-specific brand`);
    assertSameGeometry(state, chineseHome, route);
  }

  const englishHome = await navigationState("/en/");
  assert.deepEqual(englishHome.active, ["home"]);
  for (const [route, active] of [
    ["/en/blog/", "blog"],
    ["/en/tools/", "tools"],
    ["/en/documents/", "documents"],
    ["/en/spark/", "spark"],
  ]) {
    const state = await navigationState(route);
    assert.deepEqual(state.active, [active], `${route} should change only its active item`);
    assertSameGeometry(state, englishHome, route);
  }

  console.log("Navigation consistency browser test passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
