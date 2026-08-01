import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const testToken = "not-a-real-creator-token";
const treeRequests = [];
const blobRequests = [];
const commitRequests = [];
let commitCounter = 0;
let gateFirstCommit = true;
let markFirstCommitStarted;
let releaseFirstCommitRequest;
const firstCommitStarted = new Promise((resolve) => {
  markFirstCommitStarted = resolve;
});
const firstCommitRelease = new Promise((resolve) => {
  releaseFirstCommitRequest = resolve;
});

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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => {
  window.functionhxDeploymentConfig = { maxWait: 1000, pollInterval: 20 };
});

await page.route("**/healthz.json?**", async (route) => {
  const commit = new URL(route.request().url()).searchParams.get("commit") || "";
  await route.fulfill({
    body: JSON.stringify({ commit }),
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    status: 200,
  });
});

await page.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = decodeURIComponent(url.pathname);
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
  if (request.method() === "OPTIONS") {
    await route.fulfill({ headers: corsHeaders, status: 204 });
    return;
  }
  const authorization = request.headers().authorization || "";
  if (authorization && authorization !== `Bearer ${testToken}`) throw new Error(`Unexpected credential: ${authorization}`);

  if (pathname === "/user") {
    await route.fulfill({ body: JSON.stringify({ login: "Functionhx" }), contentType: "application/json", headers: corsHeaders, status: 200 });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io") {
    await route.fulfill({
      body: JSON.stringify({ permissions: { push: true } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/ref/heads/main") {
    if (gateFirstCommit) {
      gateFirstCommit = false;
      markFirstCommitStarted();
      await firstCommitRelease;
    }
    await route.fulfill({
      body: JSON.stringify({ object: { sha: "creator-head" } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/commits/creator-head" && request.method() === "GET") {
    await route.fulfill({
      body: JSON.stringify({ tree: { sha: "creator-base-tree" } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (pathname.startsWith("/repos/Functionhx/functionhx.github.io/contents/") && request.method() === "GET") {
    await route.fulfill({ body: JSON.stringify({ message: "Not Found" }), contentType: "application/json", headers: corsHeaders, status: 404 });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/blobs" && request.method() === "POST") {
    blobRequests.push(request.postDataJSON());
    await route.fulfill({ body: JSON.stringify({ sha: "cover-blob-sha" }), contentType: "application/json", headers: corsHeaders, status: 201 });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/trees" && request.method() === "POST") {
    treeRequests.push(request.postDataJSON());
    await route.fulfill({
      body: JSON.stringify({ sha: `creator-tree-${treeRequests.length}` }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 201,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/commits" && request.method() === "POST") {
    commitCounter += 1;
    commitRequests.push(request.postDataJSON());
    await route.fulfill({
      body: JSON.stringify({
        html_url: `https://github.com/Functionhx/functionhx.github.io/commit/creator-${commitCounter}`,
        sha: `creator-commit-${commitCounter}`,
      }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 201,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/refs/heads/main" && request.method() === "PATCH") {
    await route.fulfill({ body: JSON.stringify({ ref: "refs/heads/main" }), contentType: "application/json", headers: corsHeaders, status: 200 });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/actions/runs") {
    await route.fulfill({
      body: JSON.stringify({
        workflow_runs: [
          {
            conclusion: "success",
            head_sha: `creator-commit-${commitCounter}`,
            html_url: "https://github.com/Functionhx/functionhx.github.io/actions/runs/creator",
            status: "completed",
          },
        ],
      }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  await route.fulfill({
    body: JSON.stringify({ message: `Unhandled creator endpoint: ${request.method()} ${pathname}` }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 404,
  });
});

async function connectOwner() {
  await page.locator("#site-settings-toggle").click();
  await page.locator("#site-settings-owner > summary").click();
  await page.locator("#site-settings-connect").click();
  await page.locator("#site-settings-token").fill(testToken);
  await page.locator("#site-settings-auth-connect").click();
  await page.locator("#site-settings-auth").waitFor({ state: "hidden" });
  await page.locator("#site-settings-close").click();
}

async function openCreator(action) {
  await page.locator("#site-inline-editor-toggle").click();
  await page.locator(`#site-author-menu [data-author-action="${action}"]`).click();
  await page.locator("#site-content-creator").waitFor({ state: "visible" });
}

async function assertPageMetadata(expectedTitle) {
  assert.equal(await page.title(), expectedTitle);
  assert.equal(await page.locator('meta[property="og:title"]').getAttribute("content"), expectedTitle);
  assert.equal(await page.locator('meta[name="twitter:title"]').getAttribute("content"), expectedTitle);
}

async function waitForCreatorStatus(expectedText) {
  await page.waitForFunction((text) => document.getElementById("site-content-creator-status")?.textContent.includes(text), expectedText);
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await assertPageMetadata("Magic · In Progress");
  assert.equal(await page.locator("#site-inline-editor-toggle").isVisible(), false, "author controls must stay private before verification");
  await connectOwner();
  assert.equal(await page.locator("#site-inline-editor-toggle").isVisible(), true, "author controls should appear after owner verification");

  await openCreator("article-create");
  assert.equal(await page.locator("#site-content-creator-settings").evaluate((element) => element.open), false);
  await page.locator("#site-content-creator-title-zh").fill("中文优先的新文章");
  await page.locator("#site-content-creator-description-zh").fill("只写中文也能创建公开文章。");
  await page.locator("#site-content-creator-body-zh").fill("## 正文\n\n这是中文正文。");
  await page.locator("#site-content-creator-settings > summary").click();
  await page.locator("#site-content-creator-slug").fill("chinese-first-article");
  await page.locator("#site-content-creator-commit").evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await firstCommitStarted;
  assert.equal(await page.locator("#site-content-creator").getAttribute("aria-busy"), "true");
  await page.locator("#site-content-creator-title-zh").fill("不应进入 Commit 的后续标题");
  await page.locator("#site-content-creator-slug").fill("mutated-after-click");
  await page.locator("#site-content-creator-message").fill("wrong: mutated after click");
  await page.locator('[data-author-action="tool-create"]').first().dispatchEvent("click");
  await page.keyboard.press("Escape");
  await page.locator("#site-content-creator-close").dispatchEvent("click");
  assert.equal(await page.locator("#site-content-creator").isVisible(), true, "busy creator must ignore Escape and close actions");
  assert.equal(await page.locator("#site-content-creator").getAttribute("data-creator-type"), "article");
  assert.equal(await page.locator("#site-content-creator-title-zh").inputValue(), "不应进入 Commit 的后续标题");
  releaseFirstCommitRequest();
  await page.locator("#site-content-creator-result").waitFor({ state: "visible" });

  assert.equal(treeRequests.length, 1);
  assert.equal(commitCounter, 1, "rapid double-click must produce exactly one commit");
  assert.equal(commitRequests[0].message, "content: add article");
  const articleEntries = treeRequests[0].tree;
  const articleZh = articleEntries.find((entry) => entry.path.endsWith("chinese-first-article-zh.md"));
  const articleEn = articleEntries.find((entry) => entry.path.endsWith("chinese-first-article-en.md"));
  assert.ok(articleZh?.path.startsWith("_posts/"));
  assert.equal(
    articleEntries.some((entry) => entry.path.startsWith("_projects/")),
    false
  );
  assert.match(articleZh.content, /announce: true/);
  assert.match(articleZh.content, /中文优先的新文章/);
  assert.doesNotMatch(articleZh.content, /不应进入 Commit/);
  assert.match(articleZh.content, /这是中文正文/);
  assert.match(articleEn.content, /English translation pending/);
  assert.match(articleEn.content, /translation_key: post-chinese-first-article/);

  await page.locator("#site-content-creator-close").click();
  await openCreator("tool-create");
  assert.equal(
    await page.locator("#site-content-creator-settings").evaluate((element) => element.open),
    true,
    "tool creation should reveal cover and link settings immediately"
  );
  assert.match(await page.locator("#site-content-creator-settings-label").innerText(), /封面与链接/);
  for (const selector of ["#site-content-creator-url", "#site-content-creator-github", "#site-content-creator-cover"]) {
    assert.equal(await page.locator(selector).isVisible(), true, `${selector} should be visible when the tool creator opens`);
  }
  assert.equal(await page.locator("#site-content-creator-english").evaluate((element) => element.open), false);
  await page.locator("#site-content-creator-title-zh").fill("极简小工具");
  await page.locator("#site-content-creator-description-zh").fill("一个测试封面与动态联动的小工具。");
  await page.locator("#site-content-creator-body-zh").fill("工具详情。");
  await page.locator("#site-content-creator-slug").fill("minimal-tool");
  await page.locator("#site-content-creator-url").fill("https://example.com/minimal-tool");
  await page.locator("#site-content-creator-github").fill("https://github.com/Functionhx/minimal-tool");
  await page.locator("#site-content-creator-cover").setInputFiles({
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64"),
    mimeType: "image/png",
    name: "cover.png",
  });
  await page.locator("#site-content-creator-commit").click();
  await page.locator('#site-content-creator-result[href*="creator-2"]').waitFor({ state: "visible" });

  assert.equal(blobRequests.length, 1);
  assert.equal(blobRequests[0].encoding, "base64");
  assert.equal(treeRequests.length, 2);
  const toolEntries = treeRequests[1].tree;
  assert.ok(toolEntries.some((entry) => entry.path === "assets/img/tools/minimal-tool-cover.png" && entry.sha === "cover-blob-sha"));
  const toolZh = toolEntries.find((entry) => entry.path === "_projects/minimal-tool-zh.md");
  const toolEn = toolEntries.find((entry) => entry.path === "_projects/minimal-tool-en.md");
  assert.match(toolZh.content, /kind: tool/);
  assert.match(toolZh.content, /img: assets\/img\/tools\/minimal-tool-cover\.png/);
  assert.match(toolZh.content, /redirect: https:\/\/example\.com\/minimal-tool/);
  assert.match(toolZh.content, /github: https:\/\/github\.com\/Functionhx\/minimal-tool/);
  assert.match(toolEn.content, /English translation pending/);
  assert.ok(
    toolEntries.some((entry) => entry.path.includes("minimal-tool-launched-zh.md")),
    "new tools should optionally add an activity item"
  );

  await page.locator("#site-content-creator-close").click();
  await openCreator("tool-create");
  await waitForCreatorStatus("中文写完即可创建");
  assert.equal(await page.locator("#site-content-creator-title-zh").inputValue(), "", "an unchanged committed tool must not return as a draft");
  await page.locator("#site-content-creator-close").click();

  await openCreator("article-create");
  await waitForCreatorStatus("已恢复这台设备上的加密草稿");
  assert.equal(
    await page.locator("#site-content-creator-title-zh").inputValue(),
    "不应进入 Commit 的后续标题",
    "edits made after the commit snapshot should remain available as a draft"
  );
  assert.equal(await page.locator("#site-content-creator-slug").inputValue(), "mutated-after-click");
  assert.equal(await page.locator("#site-content-creator-message").inputValue(), "wrong: mutated after click");
  await page.locator("#site-content-creator-close").click();

  const storage = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  assert.equal(storage.includes(testToken), false, "the creator must not expose the GitHub token in ordinary storage");

  await page.goto(`${baseUrl}blog/`, { waitUntil: "domcontentloaded" });
  await assertPageMetadata("博客 · Magic");
  await page.goto(`${baseUrl}en/`, { waitUntil: "domcontentloaded" });
  await assertPageMetadata("Magic · In Progress");
  await page.goto(`${baseUrl}en/blog/`, { waitUntil: "domcontentloaded" });
  await assertPageMetadata("blog · Magic");
  console.log("Context-aware content creator browser test passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
