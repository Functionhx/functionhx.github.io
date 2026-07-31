import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const vaultOrigin = "https://spark-vault.test";
const vaultToken = "opaque-not-a-real-spark-session";
const testDeepSeekKey = "not-a-real-deepseek-spark-key";
const sha = (value) => createHash("sha1").update(String(value)).digest("hex");
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
const privateValues = {
  comments: true,
  date: "2026-07-29T09:15",
  en: {
    body: "Private English body.",
    summary: "A private note.",
    title: "Private Spark",
  },
  kind: "note",
  published: false,
  slug: "private-spark",
  zh: {
    body: "私密中文正文。",
    summary: "一条私密笔记。",
    title: "私密闪耀",
  },
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

const siteOrigin = new URL(baseUrl).origin;
const translationRequests = [];
const translationAuthorizations = [];
const deploymentPolls = new Map();
const githubMutationRequests = [];
const githubAuthorizations = [];
const vaultAuthorizations = [];
const vaultWrites = [];
const publicChanges = [];
const vaultNotes = new Map();
let vaultCounter = 0;
let publicCounter = 0;
let sessionChecks = 0;

function clone(value) {
  return structuredClone(value);
}

function noteSummary(note) {
  return {
    date: note.values.date,
    id: note.id,
    kind: note.values.kind,
    published: note.published,
    sha: note.sha,
    title: { en: note.values.en.title, zh: note.values.zh.title },
    updatedAt: note.updatedAt,
  };
}

function responseNote(note) {
  return {
    ...noteSummary(note),
    public: note.public,
    values: clone(note.values),
  };
}

function saveVaultNote(id, values, publicState = null, existing = null) {
  vaultCounter += 1;
  const actualPublished = existing?.published === true || Boolean(publicState);
  const normalizedValues = clone(values);
  normalizedValues.published = actualPublished;
  const note = {
    id,
    public: existing?.public || publicState,
    published: actualPublished,
    sha: sha(`vault-${id}-${vaultCounter}`),
    updatedAt: new Date(1_800_000_000_000 + vaultCounter).toISOString(),
    values: normalizedValues,
  };
  vaultNotes.set(id, note);
  return note;
}

saveVaultNote("private-spark", privateValues);

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

await page.addInitScript(
  ({ endpoint, token }) => {
    window.functionhxDeploymentConfig = { maxWait: 2000, pollInterval: 25 };
    window.functionhxSparkVaultConfig = { endpoint };
    window.__sparkPopupCount = 0;
    window.open = () => {
      window.__sparkPopupCount += 1;
      window.setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              token,
              type: "functionhx:spark-vault-session",
              user: { id: 172989722, login: "Functionhx" },
            },
            origin: endpoint,
            source: window,
          })
        );
      }, 20);
      return window;
    };
  },
  { endpoint: vaultOrigin, token: vaultToken }
);

await page.route("https://api.deepseek.com/**", async (route) => {
  const request = route.request();
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  translationRequests.push(request.postDataJSON());
  translationAuthorizations.push(request.headers().authorization || "");
  await route.fulfill({
    body: JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "An English body translated after the private save.",
              summary: "A Chinese-first private note.",
              title: "Chinese First Draft",
            }),
          },
        },
      ],
    }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
});

await page.route(`${vaultOrigin}/**`, async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Origin": siteOrigin,
    "Access-Control-Expose-Headers": "X-Spark-Session",
  };
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  const authorization = request.headers().authorization || "";
  vaultAuthorizations.push(authorization);
  if (authorization !== `Bearer ${vaultToken}`) {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "authentication_required", message: "Sign in." } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 401,
    });
    return;
  }
  if (url.pathname === "/api/session" && request.method() === "GET") {
    sessionChecks += 1;
    await route.fulfill({
      body: JSON.stringify({ authenticated: true, user: { id: 172989722, login: "Functionhx" } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (url.pathname === "/api/logout" && request.method() === "POST") {
    await route.fulfill({ body: JSON.stringify({ authenticated: false }), contentType: "application/json", headers: corsHeaders, status: 200 });
    return;
  }
  if (url.pathname === "/api/notes" && request.method() === "GET") {
    await route.fulfill({
      body: JSON.stringify({ notes: Array.from(vaultNotes.values(), noteSummary) }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }

  const match = url.pathname.match(/^\/api\/notes\/([^/]+)(?:\/(publish|unpublish))?$/);
  if (!match) {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 404,
    });
    return;
  }
  const id = decodeURIComponent(match[1]);
  const action = match[2] || "";
  const existing = vaultNotes.get(id);
  if (request.method() === "GET" && !action) {
    await route.fulfill({
      body: existing ? JSON.stringify({ note: responseNote(existing) }) : JSON.stringify({ error: { code: "not_found", message: "Not found." } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: existing ? 200 : 404,
    });
    return;
  }
  if (request.method() === "PUT" && !action) {
    const body = request.postDataJSON();
    if (existing && body.expectedSha !== existing.sha) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "vault_conflict", message: "Conflict." } }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 409,
      });
      return;
    }
    const note = saveVaultNote(id, body.values, body.public || null, existing);
    vaultWrites.push({ id, public: clone(body.public || null), values: clone(body.values) });
    await route.fulfill({
      body: JSON.stringify({ note: responseNote(note) }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (request.method() === "POST" && action) {
    const body = request.postDataJSON();
    if (!existing || body.expectedSha !== existing.sha) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "vault_conflict", message: "Conflict." } }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 409,
      });
      return;
    }
    if (action === "publish" && (!existing.values.en.title.trim() || !existing.values.en.body.trim())) {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "bilingual_required", message: "English is required." } }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 422,
      });
      return;
    }

    publicCounter += 1;
    const next = clone(existing);
    next.published = action === "publish";
    next.values.published = next.published;
    next.sha = sha(`visibility-${id}-${publicCounter}`);
    next.updatedAt = new Date(1_900_000_000_000 + publicCounter).toISOString();
    next.public = next.published
      ? {
          paths: existing.public?.paths || {
            en: `_posts/${existing.values.date.slice(0, 10)}-${id}-en.md`,
            zh: `_posts/${existing.values.date.slice(0, 10)}-${id}-zh.md`,
          },
          shas: { en: sha(`public-en-${publicCounter}`), zh: sha(`public-zh-${publicCounter}`) },
        }
      : null;
    vaultNotes.set(id, next);
    const commitSha = sha(`public-commit-${publicCounter}`);
    const commit = {
      html_url: `https://github.com/Functionhx/functionhx.github.io/commit/${commitSha}`,
      sha: commitSha,
    };
    publicChanges.push({ action, id, values: clone(next.values) });
    await route.fulfill({
      body: JSON.stringify({ commit, note: responseNote(next) }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
});

await page.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = decodeURIComponent(url.pathname);
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
  if (request.headers().authorization) githubAuthorizations.push(request.headers().authorization);
  if (!["GET", "OPTIONS"].includes(request.method())) githubMutationRequests.push(`${request.method()} ${pathname}`);
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/actions/runs") {
    const commitSha = url.searchParams.get("head_sha") || "";
    const polls = (deploymentPolls.get(commitSha) || 0) + 1;
    deploymentPolls.set(commitSha, polls);
    const state = polls === 1 ? "queued" : polls === 2 ? "in_progress" : "completed";
    await route.fulfill({
      body: JSON.stringify({
        workflow_runs: [
          {
            conclusion: state === "completed" ? "success" : null,
            head_sha: commitSha,
            html_url: `https://github.com/Functionhx/functionhx.github.io/actions/runs/${commitSha}`,
            status: state,
          },
        ],
      }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  const contentsPrefix = "/repos/Functionhx/functionhx.github.io/contents/";
  if (pathname.startsWith(contentsPrefix)) {
    const sourcePath = pathname.slice(contentsPrefix.length);
    const fixture =
      sourcePath === editPaths.zh
        ? { source: editSources.zh, sha: sha("existing-zh") }
        : sourcePath === editPaths.en
          ? { source: editSources.en, sha: sha("existing-en") }
          : null;
    await route.fulfill({
      body: fixture
        ? JSON.stringify({ content: Buffer.from(fixture.source, "utf8").toString("base64"), sha: fixture.sha, type: "file" })
        : JSON.stringify({ message: "Not Found" }),
      contentType: "application/json",
      headers: corsHeaders,
      status: fixture ? 200 : 404,
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

async function encryptedDeviceRecords() {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = window.indexedDB.open("functionhx-site-auth", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const transaction = database.transaction("vault", "readonly");
      const request = transaction.objectStore("vault").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return records.map((record) => ({
      ciphertext: record.ciphertext ? Array.from(new Uint8Array(record.ciphertext)) : [],
      id: record.id,
      iv: record.iv || [],
      version: record.version,
    }));
  });
}

try {
  await page.goto(`${baseUrl}spark/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('footer[role="contentinfo"]').count(), 0, "the removed global footer must not render");

  await page.locator("#site-spark-create").click();
  await page.locator("#site-spark-writer").waitFor({ state: "visible" });
  assert.equal(await page.locator("#site-rendered-content").isVisible(), true, "writing should stay inside the Spark page");
  assert.equal(await page.locator("#site-inline-editor").isVisible(), false, "the source editor must stay closed");
  assert.equal(await page.locator("#site-spark-writer-published").isChecked(), false, "new Sparks must default to private");

  await page.locator("#site-spark-writer-title-zh").fill("只写中文的草稿");
  await page.locator("#site-spark-writer-summary-zh").fill("先保存中文，之后再翻译。");
  await page.locator("#site-spark-writer-body-zh").fill("这是只写了中文、但应该能够安全保存的正文。");
  await page.locator(".site-spark-writer__settings > summary").click();
  await page.locator("#site-spark-writer-slug").fill("chinese-first");
  await page.waitForTimeout(500);

  assert.equal(
    await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }).includes("只写中文的草稿")),
    false,
    "private autosaves must not be plaintext in ordinary browser storage"
  );
  const draftRecords = await encryptedDeviceRecords();
  assert.ok(
    draftRecords.some((record) => record.id.includes("spark-draft")),
    "the autosave should enter the encrypted device vault"
  );
  assert.equal(JSON.stringify(draftRecords).includes("只写中文的草稿"), false);

  await page.locator("#site-spark-writer-close").click();
  await page.locator("#site-spark-create").click();
  await page.waitForFunction(() => document.querySelector("#site-spark-writer-title-zh").value === "只写中文的草稿");
  assert.equal(await page.locator("#site-spark-writer-title-en").inputValue(), "");

  await page.locator("#site-spark-writer-publish").click();
  await page.waitForFunction(() => document.querySelector("#site-spark-writer-status").textContent.includes("已加密保存为私密稿"));
  assert.equal(await page.locator("#site-spark-writer-result").isVisible(), false);
  assert.equal(vaultWrites.length, 1);
  assert.equal(vaultWrites[0].id, "chinese-first");
  assert.equal(vaultWrites[0].values.en.title, "", "English must be optional for private saves");
  assert.equal(publicChanges.length, 0, "a private save must not touch the public repository");
  assert.equal(await page.evaluate(() => window.__sparkPopupCount), 1, "the first private save should use one GitHub login");

  await page.locator("#site-spark-writer-close").click();
  await page.locator("#site-spark-drafts").click();
  await page.locator("#site-spark-drafts-panel").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll("#site-spark-drafts-list li").length === 2);
  assert.equal(await page.locator("#site-spark-drafts-list li").count(), 2);
  const chineseDraft = page.locator("#site-spark-drafts-list li").filter({ hasText: "只写中文的草稿" });
  await chineseDraft.locator(".site-spark-draft-open").click();
  await page.waitForFunction(() => document.querySelector("#site-spark-writer-title-zh").value === "只写中文的草稿");

  await page.locator("#site-spark-writer-published").check();
  await page.locator("#site-spark-writer-publish").click();
  assert.match(await page.locator("#site-spark-writer-status").textContent(), /英文标题和正文/);
  assert.equal(vaultWrites.length, 1, "failed public validation must happen before a vault write");

  await page.locator("#site-spark-writer-translate").click();
  await page.locator("#deepseek-translator-dialog").waitFor({ state: "visible" });
  await page.locator("#deepseek-translator-key").fill(testDeepSeekKey);
  await page.locator("#deepseek-translator-submit").click();
  await page.locator("#deepseek-translator-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#site-spark-writer-title-en").inputValue(), "Chinese First Draft");
  assert.equal(await page.locator("#site-spark-writer-slug").inputValue(), "chinese-first", "saved slugs must remain stable");

  await page.locator("#site-spark-writer-publish").click();
  await page.locator("#site-spark-writer-result").waitFor({ state: "visible" });
  await page.locator('#site-deployment-monitor[data-state="success"]').waitFor({ state: "visible" });
  assert.equal(publicChanges.length, 1);
  assert.equal(publicChanges[0].action, "publish");
  assert.equal(publicChanges[0].values.en.title, "Chinese First Draft");
  assert.equal(translationRequests.length, 1);
  assert.equal(translationAuthorizations[0], `Bearer ${testDeepSeekKey}`);
  assert.equal(translationRequests[0].model, "deepseek-v4-pro");
  assert.deepEqual(translationRequests[0].response_format, { type: "json_object" });
  assert.match(translationRequests[0].messages[1].content, /只写中文的草稿/);

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
  await page.waitForFunction(() => document.querySelector("#site-spark-writer-status").textContent.includes("公开版本均已保存"));
  const migrationWrite = vaultWrites.find((write) => write.id === "existing-spark");
  assert.ok(migrationWrite?.public, "the first edit of a public Spark must adopt its paths and SHAs into the vault");
  assert.deepEqual(migrationWrite.public.paths, editPaths);
  assert.equal(publicChanges.at(-1).id, "existing-spark");
  assert.match(publicChanges.at(-1).values.zh.body, /原位修改后的中文正文/);
  assert.match(publicChanges.at(-1).values.en.body, /English body edited in place/);

  await page.locator("#site-spark-writer-published").uncheck();
  await page.locator("#site-spark-writer-publish").click();
  await page.waitForFunction(() => document.querySelector("#site-spark-writer-status").textContent.includes("私密稿"));
  assert.equal(publicChanges.at(-1).action, "unpublish", "making a Spark private must remove both public files through the vault");

  assert.deepEqual(githubMutationRequests, [], "browser JavaScript must never write private Sparks directly to the public GitHub API");
  assert.deepEqual(githubAuthorizations, [], "the Spark browser must never expose a GitHub access token to public-source reads");
  assert.ok(vaultAuthorizations.every((value) => value === `Bearer ${vaultToken}`));

  const browserStorage = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  assert.equal(browserStorage.includes(vaultToken), false, "the opaque session must not enter ordinary browser storage");
  assert.equal(browserStorage.includes(testDeepSeekKey), false, "the DeepSeek key must never enter browser storage");
  const finalDeviceRecords = await encryptedDeviceRecords();
  assert.equal(JSON.stringify(finalDeviceRecords).includes(vaultToken), false, "the device vault must store only session ciphertext");
  assert.equal(JSON.stringify(finalDeviceRecords).includes(testDeepSeekKey), false);

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
  await page.waitForFunction(() => document.querySelector("#site-spark-writer-connect").dataset.connected === "true");
  assert.equal(await page.evaluate(() => window.__sparkPopupCount), 0, "the encrypted device session must survive reload without another login");
  assert.ok(sessionChecks >= 1, "reload must verify the remembered opaque session with the backend");
  await page.locator("#site-spark-create").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  const writerColor = await page.locator("#site-spark-writer").evaluate((element) => window.getComputedStyle(element).color);
  assert.notEqual(writerColor, "rgb(0, 0, 0)");

  console.log("Spark encrypted direct-writer browser test passed.");
} finally {
  await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
}
