import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const screenshotDirectory = process.env.INLINE_EDITOR_SCREENSHOT_DIR || "";
const testToken = "not-a-real-token-value";
const expiredToken = "expired-test-token";
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
const newsSource = `---
layout: post
title: "答辩录上线"
date: 2026-07-31
inline: true
lang: zh
translation_key: news-rebuttal-reader
permalink: /news/rebuttal-reader/
---
[答辩录](https://example.com/) 已公开访问。
`;

let committedBody = null;
let committedNewsBody = null;
const committedNewsBodies = [];
let committedAuthorization = "";
let deploymentPolls = 0;
let identityChecks = 0;
let latestDeploymentSha = "test-deployment-sha";
let visibleDeploymentSha = latestDeploymentSha;
let aboutGetGate = null;
let newsGetGate = null;
let actionRunGate = null;
const actionPollsBySha = new Map();
const healthPollsBySha = new Map();
let newsRemoteSource = newsSource;
let newsRemoteSha = "base-news-sha";
let newsCommitCount = 0;
let expiredSourceRequests = 0;

function deferredGate(extra = {}) {
  let markStarted;
  let release;
  const startedPromise = new Promise((resolve) => {
    markStarted = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    release = resolve;
  });
  return { ...extra, release: releasePromise, releaseNow: release, started: markStarted, startedPromise };
}

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
await page.addInitScript(() => {
  window.functionhxDeploymentConfig = { maxWait: 2000, pollInterval: 25 };
  window.localStorage.setItem("functionhx:owner-ui:remembered", "true");
});

await page.route("**/healthz.json?**", async (route) => {
  const requestedSha = new URL(route.request().url()).searchParams.get("commit") || visibleDeploymentSha;
  const count = (healthPollsBySha.get(requestedSha) || 0) + 1;
  healthPollsBySha.set(requestedSha, count);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    body: JSON.stringify({ commit: count === 1 ? "previous-deployment-sha" : visibleDeploymentSha }),
  });
});

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
    identityChecks += 1;
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

  if (url.pathname === "/repos/Functionhx/functionhx.github.io/actions/runs") {
    const requestedSha = url.searchParams.get("head_sha") || latestDeploymentSha;
    if (actionRunGate?.sha === requestedSha) {
      const gate = actionRunGate;
      actionRunGate = null;
      gate.started();
      await gate.release;
    }
    deploymentPolls += 1;
    const shaPolls = (actionPollsBySha.get(requestedSha) || 0) + 1;
    actionPollsBySha.set(requestedSha, shaPolls);
    const state = shaPolls === 1 ? "queued" : shaPolls === 2 ? "in_progress" : "completed";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({
        workflow_runs: [
          {
            conclusion: state === "completed" ? "success" : null,
            head_sha: requestedSha,
            html_url: "https://github.com/Functionhx/functionhx.github.io/actions/runs/test",
            status: state,
          },
        ],
      }),
    });
    return;
  }

  if (url.pathname === "/repos/Functionhx/functionhx.github.io/contents/_pages/about-zh.md") {
    if (request.method() === "PUT") {
      committedAuthorization = request.headers().authorization || "";
      committedBody = request.postDataJSON();
      latestDeploymentSha = "test-deployment-sha";
      visibleDeploymentSha = latestDeploymentSha;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({
          content: { sha: "new-sha" },
          commit: {
            html_url: "https://github.com/Functionhx/functionhx.github.io/commit/test",
            sha: "test-deployment-sha",
          },
        }),
      });
      return;
    }

    if (request.headers().authorization === `Bearer ${expiredToken}`) {
      expiredSourceRequests += 1;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({ message: "Bad credentials" }),
      });
      return;
    }

    if (aboutGetGate) {
      const gate = aboutGetGate;
      aboutGetGate = null;
      gate.started();
      await gate.release;
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

  if (url.pathname === "/repos/Functionhx/functionhx.github.io/contents/_news/2026-07-31-rebuttal-reader-zh.md") {
    if (request.method() === "PUT") {
      committedNewsBody = request.postDataJSON();
      committedNewsBodies.push(committedNewsBody);
      newsCommitCount += 1;
      newsRemoteSource = Buffer.from(committedNewsBody.content, "base64").toString("utf8");
      newsRemoteSha = `new-news-sha-${newsCommitCount}`;
      latestDeploymentSha = `test-news-deployment-sha-${newsCommitCount}`;
      visibleDeploymentSha = latestDeploymentSha;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({
          content: { sha: newsRemoteSha },
          commit: {
            html_url: `https://github.com/Functionhx/functionhx.github.io/commit/test-news-${newsCommitCount}`,
            sha: latestDeploymentSha,
          },
        }),
      });
      return;
    }

    if (request.headers().authorization === `Bearer ${expiredToken}`) {
      expiredSourceRequests += 1;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify({ message: "Bad credentials" }),
      });
      return;
    }

    if (newsGetGate) {
      const gate = newsGetGate;
      newsGetGate = null;
      gate.started();
      await gate.release;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({
        type: "file",
        sha: newsRemoteSha,
        content: Buffer.from(newsRemoteSource, "utf8").toString("base64"),
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
  await page.evaluate(() => window.functionhxOwnerUi?.setVerified?.(true, false));
  await page.locator("#site-inline-editor-toggle").click();
  await page.locator('#site-author-menu [data-author-action="source-edit"]').click();
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

  // A commit intent must be canceled when the auth dialog is dismissed with Escape.
  await page.locator("#site-inline-editor-commit").click();
  await page.locator("#site-inline-editor-auth").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator("#site-inline-editor-auth").waitFor({ state: "hidden" });
  await page.waitForTimeout(450);
  assert.equal(committedBody, null, "closing auth with Escape must clear the pending commit");

  // A direct commit intent must resume automatically after successful auth.
  // Freeze the path/source/SHA before any await and block every author action
  // while that resumed commit's preflight Contents request is delayed.
  const delayedAboutGet = deferredGate();
  aboutGetGate = delayedAboutGet;
  await page.locator("#site-inline-editor-commit").click();
  await page.locator("#site-inline-editor-auth").waitFor({ state: "visible" });
  await page.locator("#site-inline-editor-token").fill(testToken);
  await page.locator("#site-inline-editor-auth-connect").click();
  await page.locator("#site-inline-editor-auth").waitFor({ state: "hidden" });
  await delayedAboutGet.startedPromise;
  assert.equal(await page.locator("#site-inline-editor-close").isDisabled(), true, "closing should be locked during commit");
  const lockedActivityEditor = page.locator('[data-source-path="_news/2026-07-31-rebuttal-reader-zh.md"]');
  assert.equal(await lockedActivityEditor.isDisabled(), true, "source actions should be disabled during commit");
  await page.evaluate(() => document.querySelector('[data-source-path="_news/2026-07-31-rebuttal-reader-zh.md"]')?.click());
  assert.equal(await page.locator("#site-inline-editor-path").textContent(), "_pages/about-zh.md");
  delayedAboutGet.releaseNow();
  await page.locator("#site-inline-editor-result").waitFor({ state: "visible" });
  await page.locator('#site-deployment-monitor[data-state="success"]').waitFor({ state: "visible" });

  assert.ok(committedBody, "the editor should send a Contents API PUT request");
  assert.equal(committedAuthorization, `Bearer ${testToken}`);
  assert.match(Buffer.from(committedBody.content, "base64").toString("utf8"), /页面内即时编辑/);
  assert.match(Buffer.from(committedBody.content, "base64").toString("utf8"), /这是页面里的编辑结果/);
  assert.equal(await page.locator("#site-deployment-monitor-progress").getAttribute("aria-valuenow"), "100");
  assert.equal(await page.locator("#site-deployment-monitor-refresh").isVisible(), true);
  assert.ok(deploymentPolls >= 3, "deployment progress should follow the workflow through success");
  assert.ok((healthPollsBySha.get("test-deployment-sha") || 0) >= 2, "ready should wait until this origin serves the committed SHA");
  await page.locator("#site-settings-toggle").hover();
  await page.waitForFunction(() => document.querySelector("#site-settings-connect span")?.textContent.includes("退出"));

  await page.locator("#site-inline-editor-close").click();
  const activityEditor = page.locator('[data-source-path="_news/2026-07-31-rebuttal-reader-zh.md"]');
  await activityEditor.waitFor({ state: "visible" });

  // A late response for a previous source must not hydrate the newly selected source.
  const delayedNewsGet = deferredGate();
  newsGetGate = delayedNewsGet;
  await activityEditor.click();
  await delayedNewsGet.startedPromise;
  await page.evaluate(() => document.querySelector('#site-author-menu [data-author-action="source-edit"]')?.click());
  await page.locator("#site-inline-editor-form").waitFor({ state: "visible" });
  assert.equal(await page.locator("#site-inline-editor-path").textContent(), "_pages/about-zh.md");
  delayedNewsGet.releaseNow();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#site-inline-editor-path").textContent(), "_pages/about-zh.md");
  assert.doesNotMatch(await page.locator("#site-inline-editor-body").inputValue(), /答辩录/);

  await page.locator("#site-inline-editor-close").click();
  await activityEditor.click();
  await page.locator("#site-inline-editor-form").waitFor({ state: "visible" });
  assert.equal(await page.locator("#site-inline-editor-path").textContent(), "_news/2026-07-31-rebuttal-reader-zh.md");
  assert.match(await page.locator("#site-inline-editor-body").inputValue(), /答辩录/);
  await page
    .locator("#site-inline-editor-body")
    .fill("[答辩录](https://example.com/) 已公开访问。欢迎大家[在 GitHub 提 Issue](https://github.com/example/issues/new)。");

  // Switching away from dirty content requires an explicit decision and keeps
  // the accepted draft under the original source key.
  page.once("dialog", (prompt) => prompt.dismiss());
  await page.evaluate(() => document.querySelector('#site-author-menu [data-author-action="source-edit"]')?.click());
  assert.equal(await page.locator("#site-inline-editor-path").textContent(), "_news/2026-07-31-rebuttal-reader-zh.md");
  page.once("dialog", (prompt) => prompt.accept());
  await page.evaluate(() => document.querySelector('#site-author-menu [data-author-action="source-edit"]')?.click());
  await page.locator("#site-inline-editor-form").waitFor({ state: "visible" });
  assert.equal(await page.locator("#site-inline-editor-path").textContent(), "_pages/about-zh.md");
  const preservedNewsDraft = await page.evaluate(() =>
    window.localStorage.getItem("functionhx:inline-editor:Functionhx/functionhx.github.io:main:_news/2026-07-31-rebuttal-reader-zh.md")
  );
  assert.match(preservedNewsDraft || "", /GitHub 提 Issue/);

  await page.locator("#site-inline-editor-close").click();
  await activityEditor.click();
  await page.locator("#site-inline-editor-form").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#site-inline-editor-body")?.value.includes("GitHub 提 Issue"));
  assert.match(await page.locator("#site-inline-editor-body").inputValue(), /GitHub 提 Issue/);

  // Simulate an external GitHub edit. Local work remains visible and in the
  // draft; discard adopts the cached remote SHA/source instead of stale state.
  newsRemoteSource = newsSource.replace("已公开访问。", "已公开访问。远端刚刚更新。");
  newsRemoteSha = "external-news-sha";
  await page.locator("#site-inline-editor-commit").click();
  await page.locator("#site-inline-editor-status").filter({ hasText: "当前修改仍保留" }).waitFor({ state: "visible" });
  assert.equal(committedNewsBodies.length, 0, "a SHA conflict must not issue a PUT");
  assert.match(await page.locator("#site-inline-editor-body").inputValue(), /GitHub 提 Issue/);
  const conflictedDraft = await page.evaluate(() =>
    window.localStorage.getItem("functionhx:inline-editor:Functionhx/functionhx.github.io:main:_news/2026-07-31-rebuttal-reader-zh.md")
  );
  assert.match(conflictedDraft || "", /GitHub 提 Issue/);
  await page.locator("#site-inline-editor-commit").click();
  await page.locator("#site-inline-editor-status").filter({ hasText: "当前修改仍保留" }).waitFor({ state: "visible" });
  assert.equal(committedNewsBodies.length, 0, "repeated commit attempts must remain safely conflicted");

  page.once("dialog", (prompt) => prompt.accept());
  await page.locator("#site-inline-editor-discard").click();
  assert.match(await page.locator("#site-inline-editor-body").inputValue(), /远端刚刚更新/);
  assert.doesNotMatch(await page.locator("#site-inline-editor-body").inputValue(), /GitHub 提 Issue/);
  assert.equal(
    await page.evaluate(() =>
      window.localStorage.getItem("functionhx:inline-editor:Functionhx/functionhx.github.io:main:_news/2026-07-31-rebuttal-reader-zh.md")
    ),
    null,
    "discarding a conflict should clear the local draft"
  );

  await page
    .locator("#site-inline-editor-body")
    .fill("[答辩录](https://example.com/) 已公开访问。远端刚刚更新。欢迎大家[在 GitHub 提 Issue](https://github.com/example/issues/new)。");
  const delayedFirstDeployment = deferredGate({ sha: "test-news-deployment-sha-1" });
  actionRunGate = delayedFirstDeployment;
  await page.locator("#site-inline-editor-commit").click();
  await page.locator('#site-inline-editor-result[href*="test-news-1"]').waitFor({ state: "visible" });
  await delayedFirstDeployment.startedPromise;

  // A second commit starts a newer deployment watch while the first watch is
  // still awaiting a response. The old response must never overwrite it.
  await page.locator("#site-inline-editor-body").fill(`${await page.locator("#site-inline-editor-body").inputValue()}\n\n连续提交仍然安全。`);
  await page.locator("#site-inline-editor-commit").click();
  await page.locator('#site-inline-editor-result[href*="test-news-2"]').waitFor({ state: "visible" });
  delayedFirstDeployment.releaseNow();
  await page.locator('#site-deployment-monitor[data-state="success"]').waitFor({ state: "visible" });
  assert.match(await page.locator("#site-deployment-monitor-commit").getAttribute("href"), /test-news-2/);
  assert.ok((healthPollsBySha.get("test-news-deployment-sha-2") || 0) >= 2, "the mirror health check should gate the newer ready state");
  assert.ok(committedNewsBody, "an activity row should commit its own _news source");
  assert.equal(committedNewsBodies.length, 2, "two consecutive edits should produce two ordered PUTs");
  assert.match(Buffer.from(committedNewsBody.content, "base64").toString("utf8"), /在 GitHub 提 Issue/);
  assert.match(Buffer.from(committedNewsBody.content, "base64").toString("utf8"), /连续提交仍然安全/);

  const browserStorage = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  assert.equal(browserStorage.includes(testToken), false, "the GitHub token must never enter browser storage");
  const vaultStorage = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = window.indexedDB.open("functionhx-site-auth");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("vault", "readonly");
          const records = transaction.objectStore("vault").getAll();
          records.onerror = () => reject(records.error);
          records.onsuccess = () =>
            resolve({
              ids: records.result.map((record) => record.id),
              serialized: JSON.stringify(records.result),
            });
        };
      })
  );
  assert.equal(vaultStorage.serialized.includes(testToken), false, "the trusted-device vault must contain only ciphertext");
  assert.ok(vaultStorage.ids.includes("github:functionhx/functionhx.github.io"));

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
  await page.locator('#site-author-menu [data-author-action="source-edit"]').hover();
  await page.waitForFunction(() => document.querySelector("#site-inline-editor-connect span")?.textContent.includes("退出"));
  assert.equal(identityChecks, 2, "a trusted device should reconnect with one silent identity verification");
  await page.locator('#site-author-menu [data-author-action="source-edit"]').click();
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

  page.once("dialog", (prompt) => prompt.accept());
  await page.locator("#site-inline-editor-connect").click();
  await page.waitForFunction(() => document.querySelector("#site-inline-editor-connect span")?.textContent.includes("连接"));
  const remainingCredentials = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = window.indexedDB.open("functionhx-site-auth");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("vault", "readonly");
          const records = transaction.objectStore("vault").getAll();
          records.onerror = () => reject(records.error);
          records.onsuccess = () => resolve(records.result.map((record) => record.id));
        };
      })
  );
  assert.equal(remainingCredentials.includes("github:functionhx/functionhx.github.io"), false, "disconnect should clear the trusted token");

  // A restored but expired token is forgotten after the first 401, and a
  // public source load retries without Authorization instead of failing.
  await page.evaluate(
    async (token) =>
      window.functionhxGitHubAuth.save({
        owner: "Functionhx",
        remember: false,
        repository: "Functionhx/functionhx.github.io",
        token,
      }),
    expiredToken
  );
  await page.waitForFunction(() => document.querySelector("#site-inline-editor-connect span")?.textContent.includes("退出"));
  await page.locator("#site-inline-editor-close").click();
  assert.equal(await page.locator("html").getAttribute("data-owner-mode"), null, "reconnecting identity must preserve visitor mode");
  assert.equal(await activityEditor.isHidden(), true, "activity pencils must stay hidden until owner mode is explicitly re-entered");
  await page.locator("#site-inline-editor-toggle").click();
  assert.equal(await activityEditor.isVisible(), true, "the mode pencil should reveal activity editing after reconnection");
  await activityEditor.click();
  await page.locator("#site-inline-editor-form").waitFor({ state: "visible" });
  assert.equal(expiredSourceRequests, 1, "an expired credential should be attempted only once");
  assert.match(await page.locator("#site-inline-editor-body").inputValue(), /连续提交仍然安全/);
  await page.waitForFunction(() => document.querySelector("#site-inline-editor-connect span")?.textContent.includes("连接"));
  assert.equal(await page.locator("html").getAttribute("data-owner-verified"), null, "expired auth should hide owner-only controls again");

  console.log("Inline editor browser test passed.");
} finally {
  await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
}
