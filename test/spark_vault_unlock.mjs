import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

import { createUnlockPage } from "../spark-vault/unlock-page.mjs";

let origin = "";
let keyring = null;
let keyringSha = "";
let keyringGets = 0;
let keyringPuts = 0;
let lastWrite = null;

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", origin || "http://127.0.0.1");
  if (url.pathname === "/unlock") {
    await sendResponse(createUnlockPage([origin]), response);
    return;
  }
  if (url.pathname === "/api/keyring" && request.method === "GET") {
    keyringGets += 1;
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end(JSON.stringify({ keyring, sha: keyringSha }));
    return;
  }
  if (url.pathname === "/api/keyring" && request.method === "PUT") {
    keyringPuts += 1;
    lastWrite = await requestBody(request);
    keyring = lastWrite.keyring;
    keyringSha = "a".repeat(40);
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end(JSON.stringify({ keyring, sha: keyringSha }));
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
page.on("pageerror", (error) => console.error("unlock page error:", error));

await page.addInitScript(() => {
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

const unlockUrl = `${origin}/unlock#session=opaque-test-session&site_origin=${encodeURIComponent(origin)}`;

try {
  await page.goto(`${origin}/reset`);
  await page.goto(unlockUrl);
  await page.locator("#pin").fill("608");
  await page.locator("#pin-form button[type=submit]").evaluate((button) => button.click());
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("已打开"), null, { timeout: 3000 });
  assert.equal(keyringGets, 0, "the 608 decoy must not query the real keyring");
  assert.equal(keyringPuts, 0, "the 608 decoy must not mutate the real vault");

  await page.goto(`${origin}/reset`);
  await page.goto(unlockUrl);
  await page.locator("#strong-unlock").click();
  await page.waitForFunction(() => document.querySelector("#unlock-title").textContent.includes("零知识"));
  await page.locator("#passphrase").fill("correct horse battery staple");
  await page.locator("#passphrase-confirm").fill("correct horse battery staple");
  await page.locator("#unlock-submit").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("恢复包已下载"));
  assert.equal(keyringGets, 1);
  assert.equal(keyringPuts, 1);
  assert.equal(JSON.stringify(lastWrite).includes("correct horse battery staple"), false, "the passphrase must never enter the API payload");
  assert.equal(lastWrite.keyring.version, 2);
  assert.equal(lastWrite.keyring.iterations, 600000);
  assert.match(lastWrite.keyring.wrapped_root, /^[A-Za-z0-9_-]+$/);
  assert.match(lastWrite.keyring.recovery_wrapped_root, /^[A-Za-z0-9_-]+$/);

  await page.goto(`${origin}/reset`);
  await page.goto(unlockUrl);
  await page.locator("#strong-unlock").click();
  await page.waitForFunction(() => document.querySelector("#unlock-title").textContent.includes("双重解锁"));
  await page.locator("#passphrase").fill("correct horse battery staple");
  await page.locator("#unlock-submit").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("安全解锁"));
  assert.equal(keyringGets, 2);
  assert.equal(keyringPuts, 1, "normal unlock must not rewrite the keyring");

  console.log("Spark Vault passkey and decoy checks passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
