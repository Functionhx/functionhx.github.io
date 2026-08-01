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
const mainContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await mainContext.newPage();
const dynamicAssetRequests = [];
let creatorScriptAttempts = 0;

async function seedEncryptedOwnerVault(targetPage, token, { legacy = false } = {}) {
  await targetPage.evaluate(
    async ({ legacy, token }) => {
      const repository = "Functionhx/functionhx.github.io";
      const hintKey = legacy ? "functionhx:owner-ui:remembered" : "functionhx:owner-ui:vault-hint";
      window.localStorage.setItem(hintKey, "true");
      const database = await new Promise((resolve, reject) => {
        const request = window.indexedDB.open("functionhx-site-auth", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("vault", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(JSON.stringify({ owner: "Functionhx", repository, savedAt: new Date().toISOString(), token }));
      const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("vault", "readwrite");
        const store = transaction.objectStore("vault");
        store.put({ id: "device-key", key, version: 1 });
        store.put({ ciphertext, id: `github:${repository.toLowerCase()}`, iv: Array.from(iv), owner: "Functionhx", repository, version: 1 });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    },
    { legacy, token }
  );
}

let releaseOwnerVerification;
const ownerVerificationGate = new Promise((resolve) => {
  releaseOwnerVerification = resolve;
});
await page.route("https://api.github.com/user", async (route) => {
  assert.equal(route.request().headers().authorization, "Bearer valid-owner-token");
  await ownerVerificationGate;
  await route.fulfill({ body: JSON.stringify({ login: "Functionhx" }), contentType: "application/json", status: 200 });
});
await page.route("**/assets/js/content-creator.js*", async (route) => {
  dynamicAssetRequests.push(route.request().url());
  creatorScriptAttempts += 1;
  if (creatorScriptAttempts === 1) {
    await route.abort("failed");
    return;
  }
  await route.continue();
});
page.on("request", (request) => {
  const url = request.url();
  if (
    request.resourceType() === "stylesheet" &&
    ["deployment-monitor.css", "deepseek-translator.css", "content-creator.css"].some((name) => url.includes(name))
  ) {
    dynamicAssetRequests.push(url);
  }
  if (url.includes("/assets/js/") && ["github-auth-vault.js", "deployment-monitor.js", "deepseek-translator.js"].some((name) => url.includes(name))) {
    dynamicAssetRequests.push(url);
  }
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await seedEncryptedOwnerVault(page, "valid-owner-token", { legacy: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.ownerRestore === "true");
  const restoringLayout = await page.evaluate(() => {
    const author = document.querySelector(".site-author-nav").getBoundingClientRect();
    const search = document.getElementById("search-toggle").getBoundingClientRect();
    return {
      authorWidth: author.width,
      searchLeft: search.left,
      visibility: getComputedStyle(document.querySelector(".site-author-nav")).visibility,
    };
  });
  assert.ok(restoringLayout.authorWidth > 0, "a remembered owner slot should stay reserved while identity is checked");
  assert.equal(restoringLayout.visibility, "hidden");
  releaseOwnerVerification();
  await page.waitForFunction(() => document.documentElement.dataset.ownerVerified === "true");
  const verifiedLayout = await page.evaluate(() => ({
    authorWidth: document.querySelector(".site-author-nav").getBoundingClientRect().width,
    searchLeft: document.getElementById("search-toggle").getBoundingClientRect().left,
  }));
  assert.equal(verifiedLayout.authorWidth, restoringLayout.authorWidth);
  assert.equal(verifiedLayout.searchLeft, restoringLayout.searchLeft, "owner restore must not make the navigation jump");
  assert.equal(await page.evaluate(() => window.localStorage.getItem("functionhx:owner-ui:remembered")), null);
  assert.equal(await page.evaluate(() => window.localStorage.getItem("functionhx:owner-ui:vault-hint")), "true");

  const authorToggle = page.locator("#site-inline-editor-toggle");
  await page.setViewportSize({ width: 390, height: 844 });
  const navToggle = page.locator('[data-nav-toggle="navbarNav"]');
  await navToggle.click();
  assert.equal(await page.locator("#navbarNav").evaluate((element) => element.classList.contains("show")), true);
  await authorToggle.click();
  const createActivity = page.locator('#site-author-menu [data-author-action="activity-create"]');
  await createActivity.evaluate((element) => element.click());

  const loadStatus = page.locator("#site-admin-load-status");
  await loadStatus.waitFor({ state: "visible" });
  assert.match(await loadStatus.textContent(), /再次点按原按钮重试/);
  assert.equal(await page.locator('script[src*="content-creator.js"]').count(), 0, "a failed script node must be removed before retry");
  assert.equal(await page.locator("#navbarNav").evaluate((element) => element.classList.contains("show")), false);
  assert.equal(await navToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await navToggle.evaluate((element) => element.classList.contains("collapsed")), true);

  await createActivity.evaluate((element) => element.click());
  await page.locator("#site-content-creator").waitFor({ state: "visible" });
  assert.equal(await loadStatus.isHidden(), true, "a successful retry should clear the load error");
  assert.equal(creatorScriptAttempts, 2, "a failed explicit load should retry exactly once");

  const loaderVersion = await page.locator('script[src*="admin-loader.js"]').evaluate((element) => new URL(element.src).search);
  assert.ok(loaderVersion, "the built loader should carry a cache-busting version");
  assert.ok(dynamicAssetRequests.length > 4, "the creator should load its dependency bundle on demand");
  for (const requestUrl of dynamicAssetRequests) {
    assert.equal(new URL(requestUrl).search, loaderVersion, `dynamic asset must use the loader build version: ${requestUrl}`);
  }
  await page.locator("#site-content-creator-close").click();

  await navToggle.click();
  await authorToggle.click();
  await page.locator('#site-author-menu a[href*="compose=1"]').evaluate((element) => {
    element.addEventListener("click", (event) => event.preventDefault(), { once: true });
    element.click();
  });
  assert.equal(
    await page.locator("#navbarNav").evaluate((element) => element.classList.contains("show")),
    false,
    "a Spark compose link should close the mobile navigation before opening"
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await authorToggle.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.locator("#site-author-menu").isVisible(), true);
  const menuItems = page.locator('#site-author-menu [role="menuitem"]');
  assert.equal(await menuItems.first().evaluate((element) => element === document.activeElement), true, "ArrowDown should focus the first item");
  await page.keyboard.press("End");
  assert.equal(await menuItems.last().evaluate((element) => element === document.activeElement), true, "End should focus the last item");
  await page.keyboard.press("ArrowDown");
  assert.equal(await menuItems.first().evaluate((element) => element === document.activeElement), true, "ArrowDown should wrap");
  await page.keyboard.press("ArrowUp");
  assert.equal(await menuItems.last().evaluate((element) => element === document.activeElement), true, "ArrowUp should wrap");
  await page.keyboard.press("Home");
  assert.equal(await menuItems.first().evaluate((element) => element === document.activeElement), true, "Home should focus the first item");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#site-author-menu").isHidden(), true);
  assert.equal(await authorToggle.evaluate((element) => element === document.activeElement), true, "Escape should restore focus to the menu button");

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("functionhx:github-auth-changed", {
        detail: { connected: true, remembered: true, repository: "Functionhx/functionhx.github.io" },
      })
    );
  });
  const activityEdit = page.locator(".activity-feed__edit").first();
  await activityEdit.waitFor({ state: "visible" });
  const editTarget = await activityEdit.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, opacity: Number.parseFloat(getComputedStyle(element).opacity), width: rect.width };
  });
  assert.ok(editTarget.width >= 36 && editTarget.height >= 36, "dynamic edit controls must expose at least a 36px target");
  assert.ok(editTarget.opacity >= 0.7, "dynamic edit controls should be visible without hover");

  const expiredContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const expiredPage = await expiredContext.newPage();
  let expiredChecks = 0;
  await expiredPage.route("https://api.github.com/user", async (route) => {
    expiredChecks += 1;
    await route.fulfill({ body: JSON.stringify({ message: "Bad credentials" }), contentType: "application/json", status: 401 });
  });
  await expiredPage.goto(baseUrl, { waitUntil: "networkidle" });
  await seedEncryptedOwnerVault(expiredPage, "expired-owner-token");
  await expiredPage.reload({ waitUntil: "networkidle" });
  await expiredPage.waitForFunction(() => window.localStorage.getItem("functionhx:owner-ui:vault-hint") === null);
  assert.equal(expiredChecks, 1, "an expired remembered session should be checked once");
  assert.equal(await expiredPage.locator("html").getAttribute("data-owner-verified"), null);
  assert.equal(await expiredPage.locator("#site-inline-editor-toggle").isVisible(), false);
  await expiredContext.close();

  const visitorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitorPage = await visitorContext.newPage();
  let visitorChecks = 0;
  await visitorPage.route("https://api.github.com/user", async (route) => {
    visitorChecks += 1;
    await route.abort("blockedbyclient");
  });
  await visitorPage.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(visitorChecks, 0, "ordinary visitors must not generate a GitHub identity request");
  assert.equal(await visitorPage.locator("#site-inline-editor-toggle").isVisible(), false);
  await visitorContext.close();

  console.log("Author menu, lazy loader, and mobile navigation browser test passed.");
} finally {
  await mainContext.close();
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
