import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

import { createUnlockPage } from "../spark-vault/unlock-page.mjs";

let origin = "";
let keyring = null;
let keyringSha = "";
let keyringGets = 0;
let keyringPuts = 0;
let lastKeyringWrite = null;
let lastNoteWrite = null;
let noteWrites = 0;
let oauthLogins = 0;

const authVaultScript = readFileSync(new URL("../assets/js/github-auth-vault.js", import.meta.url));
const vaultClientScript = readFileSync(new URL("../assets/js/spark-vault-client.js", import.meta.url));

async function sendResponse(response, nodeResponse) {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) nodeResponse.setHeader(name, value);
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function openerPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Spark Vault opener test</title></head>
<body>
  <button id="strong-save" type="button">保存私密 Spark</button>
  <button id="decoy-open" type="button">打开私密草稿</button>
  <button id="strong-reopen" type="button">重新解锁</button>
  <p id="status" role="status"></p>
  <script src="/assets/js/github-auth-vault.js"></script>
  <script src="/assets/js/spark-vault-client.js"></script>
  <script>
    const endpoint = location.origin;
    const status = document.getElementById("status");
    let popupEvents = 0;
    window.addEventListener("message", () => { popupEvents += 1; });
    async function savePrivate() {
      const access = await window.functionhxSparkVault.unlock(endpoint, {
        intent: "strong",
        returnTo: "/spark/",
      });
      if (!access.unlocked || access.decoy) throw new Error("Strong unlock did not return the real vault.");
      const body = await window.functionhxSparkVault.sealValues(endpoint, "integration", {
        zh: { body: "真实私密内容", title: "端到端私密 Spark" },
      });
      await window.functionhxSparkVault.request(endpoint, "/api/notes/integration", {
        body: { id: "integration", values: { zh: { body, title: "Private Spark" } } },
        method: "PUT",
      });
      status.textContent = "已加密保存";
    }
    document.getElementById("strong-save").addEventListener("click", async () => {
      status.textContent = "保存中";
      try { await savePrivate(); } catch (error) { status.textContent = "错误：" + error.message; }
    });
    document.getElementById("decoy-open").addEventListener("click", async () => {
      status.textContent = "打开中";
      window.functionhxSparkVault.lock(endpoint);
      try {
        const access = await window.functionhxSparkVault.unlock(endpoint, { intent: "decoy" });
        status.textContent = access.decoy ? "已打开诱饵" : "错误：没有进入诱饵";
      } catch (error) { status.textContent = "错误：" + error.message; }
    });
    document.getElementById("strong-reopen").addEventListener("click", async () => {
      status.textContent = "解锁中";
      window.functionhxSparkVault.lock(endpoint);
      try {
        const access = await window.functionhxSparkVault.unlock(endpoint, { intent: "strong" });
        status.textContent = access.unlocked && !access.decoy ? "已再次安全解锁" : "错误：解锁结果错误";
      } catch (error) { status.textContent = "错误：" + error.message; }
    });
  </script>
</body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", origin || "http://127.0.0.1");
  if (url.pathname === "/opener") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" });
    response.end(openerPage());
    return;
  }
  if (url.pathname === "/assets/js/github-auth-vault.js") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/javascript; charset=utf-8" });
    response.end(authVaultScript);
    return;
  }
  if (url.pathname === "/assets/js/spark-vault-client.js") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/javascript; charset=utf-8" });
    response.end(vaultClientScript);
    return;
  }
  if (url.pathname === "/auth/login") {
    oauthLogins += 1;
    assert.equal(url.searchParams.get("continuation"), "strong-unlock");
    assert.equal(url.searchParams.get("site_origin"), origin);
    const parameters = new URLSearchParams({
      intent: "strong",
      session: "opaque-oauth-session",
      site_origin: origin,
      user_id: "251018234",
      user_login: "Functionhx",
    });
    response.writeHead(302, { "Cache-Control": "no-store", Location: `/unlock#${parameters}` });
    response.end();
    return;
  }
  if (url.pathname === "/unlock") {
    await sendResponse(createUnlockPage([origin]), response);
    return;
  }
  if (url.pathname === "/api/keyring" && request.method === "GET") {
    keyringGets += 1;
    assert.equal(request.headers.authorization, "Bearer opaque-oauth-session");
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end(JSON.stringify({ keyring, sha: keyringSha }));
    return;
  }
  if (url.pathname === "/api/keyring" && request.method === "PUT") {
    keyringPuts += 1;
    assert.equal(request.headers.authorization, "Bearer opaque-oauth-session");
    lastKeyringWrite = await requestBody(request);
    keyring = lastKeyringWrite.keyring;
    keyringSha = "a".repeat(40);
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end(JSON.stringify({ keyring, sha: keyringSha }));
    return;
  }
  if (url.pathname === "/api/notes/integration" && request.method === "PUT") {
    noteWrites += 1;
    assert.equal(request.headers.authorization, "Bearer opaque-oauth-session");
    lastNoteWrite = await requestBody(request);
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end(JSON.stringify({ note: { id: "integration" } }));
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;

const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (error) => console.error("opener page error:", error));

await context.addInitScript(() => {
  const credentialId = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const prf = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
  const credential = {
    getClientExtensionResults() {
      return { prf: { results: { first: prf.buffer.slice(0) } } };
    },
    rawId: credentialId.buffer.slice(0),
  };
  Object.defineProperty(window.navigator, "credentials", {
    configurable: true,
    value: {
      async create() {
        return credential;
      },
      async get() {
        return credential;
      },
    },
  });
});

async function clickForPopup(selector) {
  const popupPromise = context.waitForEvent("page");
  await page.locator(selector).click();
  const popup = await popupPromise;
  popup.on("pageerror", (error) => console.error("unlock popup error:", error));
  await popup.waitForLoadState("domcontentloaded");
  return popup;
}

async function expectPopupClosed(popup) {
  if (!popup.isClosed()) await popup.waitForEvent("close", { timeout: 3000 });
  assert.equal(popup.isClosed(), true, "the unlock popup should close after the opener acknowledges its result");
}

try {
  await page.goto(`${origin}/opener`);

  const setupPopup = await clickForPopup("#strong-save");
  await setupPopup.waitForURL(/\/unlock$/);
  assert.equal(oauthLogins, 1, "the first save should use one OAuth popup with a strong-unlock continuation");
  assert.equal(await setupPopup.locator("#gate").isHidden(), true, "a normal private save must bypass the 608 gate");
  await setupPopup.waitForFunction(() => document.querySelector("#unlock-title").textContent.includes("零知识"));
  await setupPopup.locator("#passphrase").fill("correct horse battery staple");
  await setupPopup.locator("#passphrase-confirm").fill("correct horse battery staple");
  await setupPopup.locator("#unlock-submit").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent === "已加密保存");
  await expectPopupClosed(setupPopup);

  assert.equal(keyringGets, 1);
  assert.equal(keyringPuts, 1);
  assert.equal(noteWrites, 1, "the real popup result must continue into the private-note save");
  assert.equal(JSON.stringify(lastKeyringWrite).includes("correct horse battery staple"), false, "the passphrase must never enter the API payload");
  assert.equal(lastKeyringWrite.keyring.version, 2);
  assert.equal(lastKeyringWrite.keyring.iterations, 600000);
  assert.match(lastKeyringWrite.keyring.wrapped_root, /^[A-Za-z0-9_-]+$/);
  assert.match(lastKeyringWrite.keyring.recovery_wrapped_root, /^[A-Za-z0-9_-]+$/);
  assert.match(lastNoteWrite.values.zh.body, /^functionhx:zk2:/);
  assert.equal(JSON.stringify(lastNoteWrite).includes("端到端私密 Spark"), false);
  assert.equal(JSON.stringify(lastNoteWrite).includes("真实私密内容"), false);

  const keyringGetsBeforeDecoy = keyringGets;
  const keyringPutsBeforeDecoy = keyringPuts;
  const noteWritesBeforeDecoy = noteWrites;
  const decoyPopup = await clickForPopup("#decoy-open");
  assert.equal(await decoyPopup.locator("#gate").isVisible(), true, "the private-drafts entry may still show the decoy gate");
  await decoyPopup.locator("#pin").fill("608");
  await decoyPopup.locator("#pin-form button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent === "已打开诱饵");
  await expectPopupClosed(decoyPopup);
  assert.equal(keyringGets, keyringGetsBeforeDecoy, "the 608 decoy must not query the real keyring");
  assert.equal(keyringPuts, keyringPutsBeforeDecoy, "the 608 decoy must not mutate the real vault");
  assert.equal(noteWrites, noteWritesBeforeDecoy, "the 608 decoy must not request or save real notes");

  const reopenPopup = await clickForPopup("#strong-reopen");
  assert.equal(await reopenPopup.locator("#gate").isHidden(), true, "a real edit/unlock must bypass the 608 gate");
  await reopenPopup.waitForFunction(() => document.querySelector("#unlock-title").textContent.includes("双重解锁"));
  await reopenPopup.locator("#passphrase").fill("correct horse battery staple");
  await reopenPopup.locator("#unlock-submit").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent === "已再次安全解锁");
  await expectPopupClosed(reopenPopup);
  assert.equal(keyringGets, keyringGetsBeforeDecoy + 1);
  assert.equal(keyringPuts, keyringPutsBeforeDecoy, "normal unlock must not rewrite the keyring");

  console.log("Spark Vault popup, passkey, encrypted-save, and decoy checks passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
