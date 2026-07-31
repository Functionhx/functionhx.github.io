import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const testToken = "not-a-real-spark-token";
const editPaths = {
  en: "_posts/2026-07-30-existing-spark-en.md",
  zh: "_posts/2026-07-30-existing-spark-zh.md",
};
const editSources = {
  en: `---
layout: post
title: "Existing Spark"
slug: existing-spark
date: 2026-07-30 12:30:00 +0800
published: true
description: "An existing note."
permalink: /en/spark/existing-spark/
lang: en
locale: en
translation_key: spark-existing-spark
kind: note
tags: []
categories: []
related_posts: false
giscus_comments: true
---

Existing English body.
`,
  zh: `---
layout: post
title: "已有闪耀"
slug: existing-spark
date: 2026-07-30 12:30:00 +0800
published: true
description: "一条已有笔记。"
permalink: /spark/existing-spark/
lang: zh
locale: zh
translation_key: spark-existing-spark
kind: note
tags: []
categories: []
related_posts: false
giscus_comments: true
---

已有中文正文。
`,
};

let staticServer = null;
let baseUrl = process.env.SPARK_WRITER_TEST_URL || "";
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

const treeRequests = [];
const commitRequests = [];
const refUpdates = [];
const authorizations = [];
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

await page.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = decodeURIComponent(url.pathname);
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
  if (request.headers().authorization) authorizations.push(request.headers().authorization);

  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  if (pathname === "/user") {
    await route.fulfill({
      body: JSON.stringify({ login: "Functionhx" }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
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

  const contentsPrefix = "/repos/Functionhx/functionhx.github.io/contents/";
  if (pathname.startsWith(contentsPrefix)) {
    const sourcePath = pathname.slice(contentsPrefix.length);
    const language = sourcePath === editPaths.zh ? "zh" : sourcePath === editPaths.en ? "en" : "";
    if (language) {
      await route.fulfill({
        body: JSON.stringify({
          content: Buffer.from(editSources[language], "utf8").toString("base64"),
          sha: `existing-${language}-sha`,
          type: "file",
        }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ message: "Not Found" }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 404,
    });
    return;
  }

  if (pathname === "/repos/Functionhx/functionhx.github.io/git/ref/heads/main") {
    await route.fulfill({
      body: JSON.stringify({ object: { sha: `head-${treeRequests.length + 1}` } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (/\/repos\/Functionhx\/functionhx\.github\.io\/git\/commits\/head-\d+/.test(pathname) && request.method() === "GET") {
    await route.fulfill({
      body: JSON.stringify({ tree: { sha: `base-tree-${treeRequests.length + 1}` } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/trees" && request.method() === "POST") {
    const body = request.postDataJSON();
    treeRequests.push(body);
    const index = treeRequests.length;
    await route.fulfill({
      body: JSON.stringify({
        sha: `new-tree-${index}`,
        tree: body.tree.map((item, itemIndex) => ({ path: item.path, sha: `blob-${index}-${itemIndex}` })),
      }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 201,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/commits" && request.method() === "POST") {
    const body = request.postDataJSON();
    commitRequests.push(body);
    const index = commitRequests.length;
    await route.fulfill({
      body: JSON.stringify({
        html_url: `https://github.com/Functionhx/functionhx.github.io/commit/spark-${index}`,
        sha: `commit-${index}`,
      }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 201,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/refs/heads/main" && request.method() === "PATCH") {
    refUpdates.push(request.postDataJSON());
    await route.fulfill({
      body: JSON.stringify({ object: { sha: `commit-${refUpdates.length}` } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }

  await route.fulfill({
    body: JSON.stringify({ message: `Unhandled test endpoint: ${request.method()} ${pathname}` }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 404,
  });
});

try {
  await page.goto(`${baseUrl}spark/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('footer[role="contentinfo"]').count(), 0, "the removed global footer must not render");

  await page.locator("#site-spark-create").click();
  await page.locator("#site-spark-writer").waitFor({ state: "visible" });
  assert.equal(await page.locator("#site-rendered-content").isVisible(), true, "writing should stay inside the Spark page");
  assert.equal(await page.locator("#site-inline-editor").isVisible(), false, "the source editor must stay closed");

  await page.locator("#site-spark-writer-title-zh").fill("第一条闪耀");
  await page.locator("#site-spark-writer-body-zh").fill("直接像写笔记一样写下中文正文。");
  await page.locator("#site-spark-writer-tab-en").click();
  await page.locator("#site-spark-writer-title-en").fill("First Spark");
  await page.locator("#site-spark-writer-body-en").fill("Write the English body directly like a note.");
  assert.equal(await page.locator("#site-spark-writer-slug").inputValue(), "first-spark");

  await page.waitForTimeout(450);
  const localDraft = await page.evaluate(() => Object.values(window.localStorage).find((value) => value.includes("第一条闪耀")));
  assert.ok(localDraft, "the Spark draft should autosave locally");
  assert.equal(localDraft.includes(testToken), false);

  await page.locator("#site-spark-writer-publish").click();
  await page.locator("#site-inline-editor-auth").waitFor({ state: "visible" });
  await page.locator("#site-inline-editor-token").fill(testToken);
  await page.locator("#site-inline-editor-auth-connect").click();
  await page.locator("#site-inline-editor-auth").waitFor({ state: "hidden" });
  await page.locator("#site-spark-writer-result").waitFor({ state: "visible" });

  assert.equal(treeRequests.length, 1, "creation should make one Git tree");
  assert.equal(treeRequests[0].tree.length, 2, "one tree should contain both language files");
  const createdZh = treeRequests[0].tree.find((item) => item.path.endsWith("-first-spark-zh.md"));
  const createdEn = treeRequests[0].tree.find((item) => item.path.endsWith("-first-spark-en.md"));
  assert.ok(createdZh && createdEn, "both paired Spark files should be created");
  assert.match(createdZh.content, /translation_key: spark-first-spark/);
  assert.match(createdEn.content, /translation_key: spark-first-spark/);
  assert.match(createdZh.content, /permalink: \/spark\/first-spark\//);
  assert.match(createdEn.content, /permalink: \/en\/spark\/first-spark\//);
  assert.match(createdZh.content, /直接像写笔记一样写下中文正文/);
  assert.match(createdEn.content, /Write the English body directly like a note/);
  assert.deepEqual(refUpdates[0], { force: false, sha: "commit-1" });

  await page.locator("#site-spark-writer-close").click();
  await page.locator("#site-spark-create").click();
  assert.equal(await page.locator("#site-spark-writer-title-zh").inputValue(), "", "a second independent Spark can be started");
  await page.locator("#site-spark-writer-close").click();

  await page.evaluate(
    ({ editPaths }) => {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.textContent = "edit fixture";
      trigger.dataset.sparkEdit = "";
      trigger.dataset.translationKey = "spark-existing-spark";
      trigger.dataset.sourcePathZh = editPaths.zh;
      trigger.dataset.sourcePathEn = editPaths.en;
      trigger.id = "spark-edit-fixture";
      document.querySelector(".post-list").prepend(trigger);
    },
    { editPaths }
  );
  await page.locator("#spark-edit-fixture").click();
  await page.waitForFunction(() => document.querySelector("#site-spark-writer-title-zh").value === "已有闪耀");
  assert.equal(await page.locator("#site-spark-writer-title-en").inputValue(), "Existing Spark");
  assert.equal(await page.locator("#site-spark-writer-slug").isEditable(), false, "an existing entry keeps its stable URL");

  await page.locator("#site-spark-writer-body-zh").fill("原位修改后的中文正文。");
  await page.locator("#site-spark-writer-tab-en").click();
  await page.locator("#site-spark-writer-body-en").fill("English body edited in place.");
  await page.locator("#site-spark-writer-publish").click();
  await page.locator("#site-spark-writer-result").waitFor({ state: "visible" });
  await page.waitForFunction(() => window.document.querySelector("#site-spark-writer-result").href.endsWith("spark-2"));

  assert.equal(treeRequests.length, 2, "editing should create a second atomic tree");
  assert.deepEqual(treeRequests[1].tree.map((item) => item.path).sort(), [editPaths.en, editPaths.zh].sort());
  assert.match(treeRequests[1].tree.find((item) => item.path === editPaths.zh).content, /原位修改后的中文正文/);
  assert.match(treeRequests[1].tree.find((item) => item.path === editPaths.en).content, /English body edited in place/);
  assert.ok(authorizations.every((value) => value === `Bearer ${testToken}`));

  const browserStorage = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  assert.equal(browserStorage.includes(testToken), false, "the GitHub token must never enter browser storage");

  await page.locator("#site-spark-writer-close").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#site-spark-create").click();
  const mobileBounds = await page.locator("#site-spark-writer").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
  });
  assert.ok(mobileBounds.left >= 0 && mobileBounds.right <= mobileBounds.viewport + 1, "the writer must fit the mobile viewport");

  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#site-spark-create").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  const writerColor = await page.locator("#site-spark-writer").evaluate((element) => window.getComputedStyle(element).color);
  assert.notEqual(writerColor, "rgb(0, 0, 0)");

  console.log("Spark direct writer browser test passed.");
} finally {
  await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
}
