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
let deleteRequests = 0;
let showcaseRequests = 0;
let createdPayload = null;
const createdPayloads = [];
const documentRecords = [
  {
    created_at: "2026-08-06T08:30:00.000Z",
    id: `feishu-file-${"b".repeat(64)}`,
    modified_at: "2026-08-06T09:30:00.000Z",
    request_id: `feishu-request-${"a".repeat(64)}`,
    selection_token: `functionhx:zk2:${"b".repeat(96)}`,
    title: "已有的研究文档",
    type: "docx",
    url: "https://example.feishu.cn/docx/existingtoken",
    visible: false,
  },
  {
    created_at: "2026-08-05T08:30:00.000Z",
    id: `feishu-file-${"c".repeat(64)}`,
    modified_at: "2026-08-07T09:30:00.000Z",
    request_id: null,
    selection_token: `functionhx:zk2:${"c".repeat(96)}`,
    title: "飞书中原有的云文档",
    type: "docx",
    url: "https://example.feishu.cn/docx/external-token",
    visible: false,
  },
];
const visibleDocumentIds = new Set();
let createOutcome = "success";
let createDelay = 0;
let deleteDelay = 0;
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
  if (route.request().method() === "GET") {
    assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
    await route.fulfill({
      body: JSON.stringify({ documents: documentRecords }),
      contentType: "application/json",
      status: 200,
    });
    return;
  }
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
  const createdDocument = {
    created_at: new Date(Date.UTC(2026, 7, 7, 9, createRequests)).toISOString(),
    document_token: "mocktoken",
    request_id: `feishu-request-${createRequests.toString(16).padStart(64, "0")}`,
    title: createdPayload.title,
    url: "https://example.feishu.cn/docx/mocktoken",
  };
  documentRecords.unshift({
    created_at: createdDocument.created_at,
    id: `feishu-file-${createRequests.toString(16).padStart(64, "0")}`,
    modified_at: createdDocument.created_at,
    request_id: createdDocument.request_id,
    selection_token: `functionhx:zk2:${createRequests.toString(16).padStart(96, "0")}`,
    title: createdDocument.title,
    type: "docx",
    url: createdDocument.url,
    visible: false,
  });
  if (createDelay) await new Promise((resolve) => setTimeout(resolve, createDelay));
  await route.fulfill({
    body: JSON.stringify(createdDocument),
    contentType: "application/json",
    status: 200,
  });
});

await page.route(`${workerOrigin}/api/feishu/library`, async (route) => {
  assert.equal(route.request().method(), "GET");
  assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
  await route.fulfill({
    body: JSON.stringify({
      documents: documentRecords.map((documentRecord) => ({
        ...documentRecord,
        visible: visibleDocumentIds.has(documentRecord.id),
      })),
      truncated: false,
    }),
    contentType: "application/json",
    status: 200,
  });
});

await page.route(`${workerOrigin}/api/feishu/library-page**`, async (route) => {
  assert.equal(route.request().method(), "GET");
  assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
  await route.fulfill({
    body: JSON.stringify({
      documents: documentRecords.map((documentRecord) => ({
        ...documentRecord,
        visible: visibleDocumentIds.has(documentRecord.id),
      })),
      folders: [],
      has_more: false,
      next_page_token: "",
    }),
    contentType: "application/json",
    status: 200,
  });
});

await page.route(`${workerOrigin}/api/feishu/showcase`, async (route) => {
  assert.equal(route.request().method(), "PUT");
  assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
  const body = route.request().postDataJSON();
  const record = documentRecords.find((item) => item.selection_token === body.selection_token);
  assert.ok(record, "the frontend must submit only a selection token returned by the owner library");
  assert.equal(typeof body.visible, "boolean");
  showcaseRequests += 1;
  if (body.visible) visibleDocumentIds.add(record.id);
  else visibleDocumentIds.delete(record.id);
  await route.fulfill({
    body: JSON.stringify({ document: { ...record, visible: body.visible }, updated_at: new Date().toISOString() }),
    contentType: "application/json",
    status: 200,
  });
});

await page.route(`${workerOrigin}/public/feishu/documents`, async (route) => {
  const documents = documentRecords
    .filter((documentRecord) => visibleDocumentIds.has(documentRecord.id))
    .map(({ created_at, id, modified_at, title, type, url }) => ({ created_at, id, modified_at, title, type, url }));
  await route.fulfill({
    body: JSON.stringify({ documents, updated_at: new Date().toISOString() }),
    contentType: "application/json",
    status: 200,
  });
});

await page.route(`${workerOrigin}/api/feishu/documents/**`, async (route) => {
  assert.equal(route.request().method(), "DELETE");
  assert.equal(route.request().headers().authorization, "Bearer test-owner-session");
  const requestId = new URL(route.request().url()).pathname.split("/").at(-1);
  assert.match(requestId, /^feishu-request-[0-9a-f]{64}$/);
  deleteRequests += 1;
  if (deleteDelay) await new Promise((resolve) => setTimeout(resolve, deleteDelay));
  const recordIndex = documentRecords.findIndex((record) => record.request_id === requestId);
  if (recordIndex < 0) {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "feishu_document_not_found", message: "Not found" } }),
      contentType: "application/json",
      status: 404,
    });
    return;
  }
  const [record] = documentRecords.splice(recordIndex, 1);
  visibleDocumentIds.delete(record.id);
  await route.fulfill({
    body: JSON.stringify({
      deleted: true,
      deleted_at: new Date(Date.UTC(2026, 7, 7, 10, deleteRequests)).toISOString(),
      request_id: requestId,
      title: record.title,
    }),
    contentType: "application/json",
    status: 200,
  });
});

await context.route("https://example.feishu.cn/docx/**", async (route) => {
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
  await page.waitForFunction(() => document.querySelectorAll("#feishu-document-list a").length === 2);
  assert.match(await page.locator("#feishu-document-list").textContent(), /已有的研究文档/);
  assert.match(await page.locator("#feishu-document-list").textContent(), /飞书中原有的云文档/);
  assert.equal(await page.locator("#feishu-public-library").isHidden(), true, "unselected Feishu documents must stay invisible to visitors");
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
  await page.locator("#feishu-document-close").click();

  const externalId = `feishu-file-${"c".repeat(64)}`;
  const externalVisibility = page.locator(`[data-feishu-showcase="${externalId}"]`);
  assert.equal(await externalVisibility.getAttribute("aria-pressed"), "false");
  assert.equal(
    await page.locator('li:has(a[href="https://example.feishu.cn/docx/external-token"]) [data-feishu-delete]').count(),
    0,
    "documents not created by this site must not expose the site-created deletion endpoint"
  );
  await externalVisibility.click();
  await page.waitForFunction(
    (id) => document.querySelector(`[data-feishu-showcase="${id}"][aria-pressed="true"]`)?.textContent === "已展示",
    externalId
  );
  await page.waitForFunction(() => document.querySelector('#feishu-public-list a[href="https://example.feishu.cn/docx/external-token"]'));
  assert.equal(showcaseRequests, 1);
  assert.equal(await page.locator("#feishu-public-library").isVisible(), true);
  assert.doesNotMatch(await page.locator("#feishu-public-library").textContent(), /selection_token|functionhx:zk2/);
  await page.locator(`[data-feishu-showcase="${externalId}"]`).click();
  await page.waitForFunction(() => document.querySelector("#feishu-public-library")?.hidden === true);
  assert.equal(showcaseRequests, 2);

  await page.locator("#site-inline-editor-toggle").click();
  await createAction.click();
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "connected");
  await page.locator("#feishu-document-title").fill("新的研究札记");
  assert.equal(await page.locator("#feishu-document-form").getAttribute("data-no-page-loader"), "");
  const pagesBeforeCreate = context.pages().length;
  createDelay = 450;
  await page.locator("#feishu-document-submit").evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForTimeout(260);
  assert.equal(await page.locator("html").getAttribute("data-page-loading"), null, "in-page creation must never show the page loader");
  assert.equal(await page.locator("#feishu-document-creator").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator("#feishu-document-submit").textContent(), "正在创建…");
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "created");
  createDelay = 0;
  assert.equal(await page.locator("#feishu-document-creator").getAttribute("aria-busy"), null);
  assert.equal(await page.locator("#feishu-document-submit").textContent(), "创建文档");
  assert.equal(context.pages().length, pagesBeforeCreate, "creating a document must not open a window or tab");
  assert.equal(createRequests, 1, "a double click must create at most one Feishu document");
  assert.equal(createdPayload.title, "新的研究札记");
  assert.match(createdPayload.idempotency_key, /^feishu-document-[a-z0-9-]+$/);
  assert.equal(await page.locator("#feishu-document-result").getAttribute("href"), "https://example.feishu.cn/docx/mocktoken");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#feishu-document-list a")].some((link) => link.textContent.includes("新的研究札记"))
  );
  await page.locator("#feishu-document-close").click();
  const documentTabPromise = context.waitForEvent("page");
  await page.locator('#feishu-document-list a[href="https://example.feishu.cn/docx/mocktoken"]').first().click();
  const documentTab = await documentTabPromise;
  await documentTab.waitForURL("https://example.feishu.cn/docx/mocktoken");
  await documentTab.close();

  const createdDeleteButton = page.locator(`#feishu-document-list [data-feishu-delete="feishu-request-${"1".padStart(64, "0")}"]`);
  await createdDeleteButton.click();
  await page.locator("#feishu-document-delete-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#feishu-document-delete-title").textContent(), "新的研究札记");
  assert.match(await page.locator("#feishu-document-delete-dialog").textContent(), /飞书回收站/);
  await page.locator("#feishu-document-delete-cancel").click();
  assert.equal(deleteRequests, 0, "canceling the confirmation must never call the delete endpoint");
  await page.waitForFunction(() => document.activeElement?.matches("[data-feishu-delete]") === true);

  await createdDeleteButton.click();
  deleteDelay = 420;
  await page.locator("#feishu-document-delete-submit").evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForTimeout(240);
  assert.equal(await page.locator("html").getAttribute("data-page-loading"), null, "in-page deletion must never show the page loader");
  assert.equal(await page.locator("#feishu-document-delete").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator("#feishu-document-delete-submit").textContent(), "正在移除…");
  await page.locator("#feishu-document-delete-dialog").waitFor({ state: "hidden" });
  deleteDelay = 0;
  assert.equal(deleteRequests, 1, "a double click must delete at most one Feishu document");
  assert.equal(await page.locator('#feishu-document-list a[href="https://example.feishu.cn/docx/mocktoken"]').count(), 0);
  assert.match(await page.locator("#feishu-document-list-status").textContent(), /已移到飞书回收站/);

  await page.locator("#site-inline-editor-toggle").click();
  await createAction.click();
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "connected");
  await page.locator("#feishu-document-title").fill("重新授权后创建");
  createOutcome = "reauthorize";
  await page.locator("#feishu-document-submit").click();
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "feishu-auth-required");
  const rejectedKey = createdPayloads.at(-1).idempotency_key;

  const reconnectPopupPromise = context.waitForEvent("page");
  await page.locator("#feishu-document-connect").click();
  const reconnectPopup = await reconnectPopupPromise;
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "connected");
  if (!reconnectPopup.isClosed()) await reconnectPopup.waitForEvent("close");

  await page.locator("#feishu-document-submit").click();
  await page.waitForFunction(() => document.querySelector("#feishu-document-connection")?.dataset.state === "created");
  assert.notEqual(createdPayloads.at(-1).idempotency_key, rejectedKey, "reauthorization must use a fresh safe request key");
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
