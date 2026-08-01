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

async function seedEncryptedOwnerVault(targetPage, token, { hint = true, legacy = false } = {}) {
  await targetPage.evaluate(
    async ({ hint, legacy, token }) => {
      const repository = "Functionhx/functionhx.github.io";
      const hintKey = legacy ? "functionhx:owner-ui:remembered" : "functionhx:owner-ui:vault-hint";
      if (hint) window.localStorage.setItem(hintKey, "true");
      else window.localStorage.removeItem(hintKey);
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
    { hint, legacy, token }
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
  await page.waitForFunction(() => document.documentElement.dataset.ownerVerified === "true");
  const restoringLayout = await page.evaluate(() => {
    const authorElement = document.querySelector(".site-author-nav");
    const author = authorElement.getBoundingClientRect();
    const navbar = document.getElementById("navbar").getBoundingClientRect();
    const search = document.getElementById("search-toggle").getBoundingClientRect();
    return {
      authorWidth: author.width,
      belowNavbar: author.top >= navbar.bottom,
      insideNavbar: Boolean(authorElement.closest("#navbar")),
      searchLeft: search.left,
      visibility: getComputedStyle(authorElement).visibility,
    };
  });
  assert.ok(restoringLayout.authorWidth > 0, "the remembered owner launcher should keep its stable geometry while identity is checked");
  assert.equal(restoringLayout.visibility, "visible", "a decrypted trusted-device launcher should be visible while GitHub refreshes its identity");
  assert.equal(restoringLayout.insideNavbar, false, "the author launcher must not consume a navigation item");
  assert.equal(restoringLayout.belowNavbar, true, "the author launcher should sit below the fixed navigation");
  releaseOwnerVerification();
  await page.waitForLoadState("networkidle");
  const verifiedLayout = await page.evaluate(() => {
    const author = document.querySelector(".site-author-nav").getBoundingClientRect();
    const navbar = document.getElementById("navbar").getBoundingClientRect();
    return {
      authorWidth: author.width,
      belowNavbar: author.top >= navbar.bottom,
      insideViewport: author.right <= window.innerWidth && author.left >= 0,
      searchLeft: document.getElementById("search-toggle").getBoundingClientRect().left,
    };
  });
  assert.equal(verifiedLayout.authorWidth, restoringLayout.authorWidth);
  assert.equal(verifiedLayout.belowNavbar, true);
  assert.equal(verifiedLayout.insideViewport, true);
  assert.equal(verifiedLayout.searchLeft, restoringLayout.searchLeft, "owner verification must not make the navigation jump");
  assert.equal(await page.evaluate(() => window.localStorage.getItem("functionhx:owner-ui:remembered")), null);
  assert.equal(await page.evaluate(() => window.localStorage.getItem("functionhx:owner-ui:vault-hint")), "true");

  const authorToggle = page.locator("#site-inline-editor-toggle");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLauncher = await page.evaluate(() => {
    const launcher = document.querySelector(".site-author-nav").getBoundingClientRect();
    const navbar = document.getElementById("navbar").getBoundingClientRect();
    return {
      belowNavbar: launcher.top >= navbar.bottom,
      insideViewport: launcher.left >= 0 && launcher.right <= window.innerWidth,
    };
  });
  assert.equal(mobileLauncher.belowNavbar, true);
  assert.equal(mobileLauncher.insideViewport, true);
  const navToggle = page.locator('[data-nav-toggle="navbarNav"]');
  await navToggle.click();
  assert.equal(await page.locator("#navbarNav").evaluate((element) => element.classList.contains("show")), true);
  await authorToggle.click();
  const mobileAuthorUi = await page.evaluate(() => {
    const toggle = document.getElementById("site-inline-editor-toggle").getBoundingClientRect();
    const menu = document.getElementById("site-author-menu").getBoundingClientRect();
    return {
      menuInsideViewport: menu.left >= 0 && menu.right <= window.innerWidth && menu.top >= 0 && menu.bottom <= window.innerHeight,
      position: getComputedStyle(document.querySelector(".site-author-nav")).position,
      toggleHeight: toggle.height,
      toggleWidth: toggle.width,
    };
  });
  assert.equal(mobileAuthorUi.position, "fixed", "the author launcher should remain a page-level floating control");
  assert.ok(mobileAuthorUi.toggleWidth >= 40 && mobileAuthorUi.toggleHeight >= 40, "the floating pencil needs a mobile-friendly target");
  assert.equal(mobileAuthorUi.menuInsideViewport, true, "the author menu must remain fully visible on a phone viewport");
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

  const settingsRestoreContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const settingsRestorePage = await settingsRestoreContext.newPage();
  let settingsRestoreChecks = 0;
  await settingsRestorePage.route("https://api.github.com/user", async (route) => {
    settingsRestoreChecks += 1;
    assert.equal(route.request().headers().authorization, "Bearer settings-owner-token");
    await route.fulfill({ body: JSON.stringify({ login: "Functionhx" }), contentType: "application/json", status: 200 });
  });
  await settingsRestorePage.goto(baseUrl, { waitUntil: "networkidle" });
  await seedEncryptedOwnerVault(settingsRestorePage, "settings-owner-token", { hint: false });
  await settingsRestorePage.reload({ waitUntil: "networkidle" });
  assert.equal(settingsRestoreChecks, 0, "a vault without a restore hint must not create a visitor-time identity request");
  assert.equal(await settingsRestorePage.locator("#site-inline-editor-toggle").isVisible(), false);
  await settingsRestorePage.locator("#site-settings-toggle").click();
  await settingsRestorePage.locator("#site-settings-dialog").waitFor({ state: "visible" });
  await settingsRestorePage.waitForFunction(() => document.documentElement.dataset.ownerVerified === "true");
  assert.equal(settingsRestoreChecks, 1, "opening settings should verify a recovered encrypted owner session once");
  assert.equal(await settingsRestorePage.locator("#site-inline-editor-toggle").isVisible(), true);
  assert.equal(await settingsRestorePage.locator("#site-settings-connect span").textContent(), "退出 @Functionhx");
  assert.equal(await settingsRestorePage.evaluate(() => window.localStorage.getItem("functionhx:owner-ui:vault-hint")), "true");
  await settingsRestoreContext.close();

  for (const transientStatus of [403, 429, 503]) {
    const transientRestoreContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const transientRestorePage = await transientRestoreContext.newPage();
    let transientRestoreChecks = 0;
    await transientRestorePage.route("https://api.github.com/user", async (route) => {
      transientRestoreChecks += 1;
      await route.fulfill({
        body: JSON.stringify({ message: "GitHub temporarily unavailable" }),
        contentType: "application/json",
        status: transientStatus,
      });
    });
    await transientRestorePage.goto(baseUrl, { waitUntil: "networkidle" });
    await seedEncryptedOwnerVault(transientRestorePage, `transient-owner-token-${transientStatus}`);
    await transientRestorePage.reload({ waitUntil: "networkidle" });
    assert.equal(transientRestoreChecks, 1, `a remembered owner session should refresh its identity once after HTTP ${transientStatus}`);
    assert.equal(await transientRestorePage.locator("html").getAttribute("data-owner-verified"), "true");
    assert.equal(
      await transientRestorePage.locator("#site-inline-editor-toggle").isVisible(),
      true,
      `HTTP ${transientStatus} must not hide the trusted-device pencil`
    );
    assert.equal(await transientRestorePage.evaluate(() => window.localStorage.getItem("functionhx:owner-ui:vault-hint")), "true");
    await transientRestoreContext.close();
  }

  for (const transientStatus of [403, 503]) {
    const transientSettingsContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const transientSettingsPage = await transientSettingsContext.newPage();
    let transientSettingsChecks = 0;
    await transientSettingsPage.route("https://api.github.com/user", async (route) => {
      transientSettingsChecks += 1;
      await route.fulfill({
        body: JSON.stringify({ message: "GitHub temporarily unavailable" }),
        contentType: "application/json",
        status: transientStatus,
      });
    });
    await transientSettingsPage.goto(baseUrl, { waitUntil: "networkidle" });
    await seedEncryptedOwnerVault(transientSettingsPage, `transient-settings-owner-token-${transientStatus}`, { hint: false });
    await transientSettingsPage.reload({ waitUntil: "networkidle" });
    assert.equal(transientSettingsChecks, 0, "a vault without a hint should still avoid visitor-time GitHub requests");
    await transientSettingsPage.locator("#site-settings-toggle").click();
    await transientSettingsPage.locator("#site-settings-dialog").waitFor({ state: "visible" });
    await transientSettingsPage.waitForFunction(() => document.querySelector("#site-settings-connect span")?.textContent === "退出 @Functionhx");
    assert.equal(transientSettingsChecks, 1, `opening settings should refresh identity once after HTTP ${transientStatus}`);
    await transientSettingsPage.locator("#site-settings-close").click();
    await transientSettingsPage.locator("#site-settings-dialog").waitFor({ state: "hidden" });
    assert.equal(await transientSettingsPage.locator("html").getAttribute("data-owner-verified"), "true");
    assert.equal(
      await transientSettingsPage.locator("#site-inline-editor-toggle").isVisible(),
      true,
      `closing settings after HTTP ${transientStatus} should leave the restored pencil visible`
    );
    await transientSettingsContext.close();
  }

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

  const expiredSettingsContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const expiredSettingsPage = await expiredSettingsContext.newPage();
  let expiredSettingsChecks = 0;
  await expiredSettingsPage.route("https://api.github.com/user", async (route) => {
    expiredSettingsChecks += 1;
    await route.fulfill({ body: JSON.stringify({ message: "Bad credentials" }), contentType: "application/json", status: 401 });
  });
  await expiredSettingsPage.goto(baseUrl, { waitUntil: "networkidle" });
  await seedEncryptedOwnerVault(expiredSettingsPage, "expired-settings-owner-token", { hint: false });
  await expiredSettingsPage.reload({ waitUntil: "networkidle" });
  await expiredSettingsPage.locator("#site-settings-toggle").click();
  await expiredSettingsPage.locator("#site-settings-dialog").waitFor({ state: "visible" });
  await expiredSettingsPage.waitForFunction(() => window.localStorage.getItem("functionhx:owner-ui:vault-hint") === null);
  assert.equal(expiredSettingsChecks, 1, "settings should reject an explicitly invalid restored token once");
  await expiredSettingsPage.locator("#site-settings-close").click();
  await expiredSettingsPage.locator("#site-settings-dialog").waitFor({ state: "hidden" });
  assert.equal(await expiredSettingsPage.locator("html").getAttribute("data-owner-verified"), null);
  assert.equal(await expiredSettingsPage.locator("#site-inline-editor-toggle").isVisible(), false, "an explicit 401 must revoke the pencil");
  await expiredSettingsContext.close();

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
