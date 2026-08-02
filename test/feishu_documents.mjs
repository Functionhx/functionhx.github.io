import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const workerOrigin = "https://functionhx-spark-vault.functionhx.workers.dev";
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
const siteOrigin = new URL(baseUrl).origin;
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
const context = await browser.newContext({ viewport: { height: 900, width: 1280 } });
const page = await context.newPage();

let configured = false;
let connected = false;
let createRequests = 0;
let createdPayload = null;
const createdPayloads = [];
let createOutcome = "success";
let oauthOutcome = "denied";

await page.route("**/assets/js/spark-vault-client.js*", async (route) => {
  await route.fulfill({
    body: `(() => {
      function normalizeEndpoint(value) {
        const parsed = new URL(String(value || ""), window.location.href);
        return parsed.origin + parsed.pathname.replace(/\\/$/, "");
      }
      async function parse(response) {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.error?.message || "Request failed");
          error.code = payload.error?.code || "request_failed";
          error.status = response.status;
          throw error;
        }
        return payload;
      }
      window.functionhxSparkVault = Object.freeze({
        normalizeEndpoint,
        async login() {
          window.__feishuOwnerSession = true;
          return { remembered: true, user: { login: "Functionhx" } };
        },
        async request(endpoint, path, options = {}) {
          const response = await fetch(normalizeEndpoint(endpoint) + path, {
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            headers: {
              Accept: "application/json",
              Authorization: "Bearer test-owner-session",
              ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            method: options.method || "GET",
          });
          return parse(response);
        },
        async restore() {
          return window.__feishuOwnerSession ? { remembered: true, user: { login: "Functionhx" } } : null;
        },
      });
    })();`,
    contentType: "text/javascript",
    status: 200,
  });
});

await page.route(`${workerOrigin}/api/feishu/session`, async (route) => {
  assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
  await route.fulfill({
    body: JSON.stringify({ configured, connected, user: connected ? { name: "测试用户" } : null }),
    contentType: "application/json",
    status: 200,
  });
});

await page.route(`${workerOrigin}/api/feishu/oauth/start`, async (route) => {
  assert.equal(route.request().method(), "POST");
  assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
  assert.deepEqual(route.request().postDataJSON(), { return_to: "/documents/", site_origin: siteOrigin });
  await route.fulfill({
    body: JSON.stringify({
      authorize_url: "https://accounts.feishu.cn/open-apis/authen/v1/authorize?app_id=test&redirect_uri=test&state=test",
    }),
    contentType: "application/json",
    status: 200,
  });
});

await context.route("https://accounts.feishu.cn/open-apis/authen/v1/authorize**", async (route) => {
  await route.fulfill({
    body: `<script>window.location.replace(${JSON.stringify(`${workerOrigin}/auth/feishu/callback?code=test&state=test`)})</script>`,
    contentType: "text/html",
    status: 200,
  });
});

await context.route(`${workerOrigin}/auth/feishu/callback**`, async (route) => {
  const payload =
    oauthOutcome === "denied"
      ? { connected: false, error: { code: "feishu_access_denied" }, type: "functionhx:feishu-connected" }
      : { connected: true, type: "functionhx:feishu-connected", user: { name: "测试用户" } };
  if (oauthOutcome === "denied") oauthOutcome = "success";
  else connected = true;
  await route.fulfill({
    body: `<script>
      window.opener.postMessage(
        ${JSON.stringify(payload)},
        ${JSON.stringify(siteOrigin)}
      );
      setTimeout(() => window.close(), 20);
    </script>`,
    contentType: "text/html",
    status: 200,
  });
});

await page.route(`${workerOrigin}/api/feishu/documents`, async (route) => {
  createRequests += 1;
  assert.equal(route.request().method(), "POST");
  assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
  createdPayload = route.request().postDataJSON();
  createdPayloads.push(createdPayload);
  if (createOutcome === "reauthorize") {
    createOutcome = "success";
    connected = false;
    await route.fulfill({
      body: JSON.stringify({
        error: { code: "feishu_reauthorization_required", message: "Reconnect Feishu before creating another document." },
      }),
      contentType: "application/json",
      status: 409,
    });
    return;
  }
  await route.fulfill({
    body: JSON.stringify({ document_token: "mocktoken", title: createdPayload.title, url: "https://example.feishu.cn/docx/mocktoken" }),
    contentType: "application/json",
    status: 200,
  });
});

await context.route("https://example.feishu.cn/docx/mocktoken", async (route) => {
  await route.fulfill({ body: "<title>Mock Feishu document</title>", contentType: "text/html", status: 200 });
});

try {
  await page.goto(`${baseUrl}documents/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('a[data-nav-translation-key="documents"]').count(), 1);
  assert.equal(await page.locator('li.active a[data-nav-translation-key="documents"]').count(), 1);
  assert.equal(await page.locator('script[src*="feishu-documents.js"]').count(), 0, "the Feishu client must load only on owner intent");
  await page.evaluate(() => {
    window.__feishuOwnerSession = true;
    window.functionhxOwnerUi.setVerified(true, false);
  });

  await page.locator("#site-inline-editor-toggle").click();
  const createAction = page.locator('#site-author-menu [data-author-action="feishu-document-create"]');
  assert.equal(await createAction.count(), 1, "the Documents pencil must expose only the Feishu create action");
  assert.equal(await page.locator('#site-author-menu [data-author-action="source-edit"]').count(), 0);
  await createAction.click();
  await page.locator("#feishu-document-dialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "unconfigured");
  assert.match(await page.locator("#feishu-document-status").textContent(), /尚未完成配置/);
  assert.doesNotMatch(await page.locator("#feishu-document-status").textContent(), /Thinking/i);
  assert.equal(await page.locator("#feishu-document-connect").isDisabled(), true);
  assert.equal(await page.locator("#feishu-document-title").isDisabled(), true);
  await page.setViewportSize({ height: 844, width: 390 });
  const mobileDialog = await page.locator("#feishu-document-dialog").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
  assert.ok(mobileDialog.left >= 0 && mobileDialog.right <= mobileDialog.viewportWidth, "the Feishu dialog must fit a phone viewport");
  assert.ok(mobileDialog.top >= 0 && mobileDialog.bottom <= mobileDialog.viewportHeight, "the Feishu dialog must stay vertically reachable");
  await page.locator("#feishu-document-close").click();
  await page.waitForFunction(() => document.activeElement?.id === "site-inline-editor-toggle");
  await page.setViewportSize({ height: 900, width: 1280 });

  configured = true;
  await page.locator("#site-inline-editor-toggle").click();
  await createAction.click();
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "feishu-auth-required");
  assert.equal(await page.locator("#feishu-document-connect").textContent(), "连接飞书");

  const deniedPopupPromise = context.waitForEvent("page");
  await page.locator("#feishu-document-connect").click();
  const deniedPopup = await deniedPopupPromise;
  await page.waitForFunction(
    () =>
      document.querySelector("#feishu-document-connection")?.dataset.state === "feishu-auth-required" &&
      document.querySelector("#feishu-document-status")?.textContent.includes("取消了飞书授权")
  );
  if (!deniedPopup.isClosed()) await deniedPopup.waitForEvent("close");
  assert.equal(await page.locator("#feishu-document-title").isDisabled(), true, "a denied OAuth flow must not unlock document creation");

  const oauthPopupPromise = context.waitForEvent("page");
  await page.locator("#feishu-document-connect").click();
  const oauthPage = await oauthPopupPromise;
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "connected");
  assert.match(await page.locator("#feishu-document-status").textContent(), /测试用户/);
  assert.equal(await page.locator("#feishu-document-title").isEnabled(), true);
  if (!oauthPage.isClosed()) await oauthPage.waitForEvent("close");

  await page.locator("#feishu-document-title").fill("新的研究札记");
  const documentPopupPromise = context.waitForEvent("page");
  await page.locator("#feishu-document-submit").evaluate((button) => {
    button.click();
    button.click();
  });
  const documentPage = await documentPopupPromise;
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "created");
  assert.equal(createRequests, 1, "a double click must create at most one Feishu document");
  assert.equal(createdPayload.title, "新的研究札记");
  assert.match(createdPayload.idempotency_key, /^feishu-document-[a-z0-9-]+$/);
  assert.equal(await page.locator("#feishu-document-result").getAttribute("href"), "https://example.feishu.cn/docx/mocktoken");
  await documentPage.waitForURL("https://example.feishu.cn/docx/mocktoken");
  await documentPage.close();
  await page.locator("#feishu-document-close").click();

  await page.locator("#site-inline-editor-toggle").click();
  await createAction.click();
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "connected");
  await page.locator("#feishu-document-title").fill("重新授权后创建");
  createOutcome = "reauthorize";
  const rejectedDocumentPopupPromise = context.waitForEvent("page");
  await page.locator("#feishu-document-submit").click();
  const rejectedDocumentPopup = await rejectedDocumentPopupPromise;
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "feishu-auth-required");
  if (!rejectedDocumentPopup.isClosed()) await rejectedDocumentPopup.waitForEvent("close");
  const rejectedKey = createdPayloads.at(-1).idempotency_key;

  const reconnectPopupPromise = context.waitForEvent("page");
  await page.locator("#feishu-document-connect").click();
  const reconnectPopup = await reconnectPopupPromise;
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "connected");
  if (!reconnectPopup.isClosed()) await reconnectPopup.waitForEvent("close");

  const retriedDocumentPopupPromise = context.waitForEvent("page");
  await page.locator("#feishu-document-submit").click();
  const retriedDocumentPopup = await retriedDocumentPopupPromise;
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "created");
  assert.notEqual(createdPayloads.at(-1).idempotency_key, rejectedKey, "reauthorization must use a fresh safe request key");
  await retriedDocumentPopup.waitForURL("https://example.feishu.cn/docx/mocktoken");
  await retriedDocumentPopup.close();
  await page.locator("#feishu-document-close").click();

  await page.goto(`${baseUrl}en/documents/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('li.active a[data-nav-translation-key="documents"]').count(), 1);
  assert.equal(await page.locator("#site-inline-editor-toggle").count(), 0, "the English reading mirror must not expose owner creation");
  assert.equal(await page.locator("#feishu-document-dialog").count(), 0);
  assert.match(await page.locator('[role="main"]').textContent(), /read-only mirror/i);

  console.log("Feishu Documents official OAuth frontend test passed.");
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
