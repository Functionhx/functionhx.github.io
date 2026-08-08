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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

async function turboState() {
  return page.evaluate(() => ({
    active: document.documentElement.dataset.turbo,
    canvasVisibility: window.getComputedStyle(document.getElementById("turbo-canvas")).visibility,
    setting: document.documentElement.dataset.themeSetting,
    stored: window.localStorage.getItem("functionhx:turbo-mode"),
  }));
}

async function holdThemeButton() {
  const button = page.locator("[data-turbo-trigger]");
  const box = await button.boundingBox();
  assert.ok(box, "Turbo trigger must be visible on desktop");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(740);
  await page.mouse.up();
  await page.waitForTimeout(80);
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  let state = await turboState();
  assert.equal(state.active, "off", "Turbo must default to off");

  await page.locator("[data-turbo-trigger]").click();
  state = await turboState();
  assert.equal(state.active, "off", "A normal appearance click must not enable Turbo");
  const settingAfterClick = state.setting;

  await holdThemeButton();
  state = await turboState();
  assert.equal(state.active, "on", "Holding the appearance control must enable Turbo");
  assert.equal(state.stored, "on", "Turbo choice must be persisted");
  assert.equal(state.setting, settingAfterClick, "Holding for Turbo must not change the color theme");
  assert.equal(state.canvasVisibility, "visible", "Turbo canvas must be visible while active");

  await page.reload({ waitUntil: "networkidle" });
  state = await turboState();
  assert.equal(state.active, "on", "Turbo must survive a page reload");

  await page.keyboard.press("Shift+T");
  state = await turboState();
  assert.equal(state.active, "off", "Shift+T must disable Turbo");

  await page.evaluate(() => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press("Shift+T");
  assert.equal((await turboState()).active, "off", "Turbo shortcut must not fire while typing");

  await page.goto(new URL("en/", baseUrl).href, { waitUntil: "networkidle" });
  const englishLabel = await page.locator("[data-turbo-trigger]").getAttribute("aria-label");
  assert.match(englishLabel, /hold to toggle Turbo/i, "English pages must explain the Turbo gesture");
  await page.keyboard.press("Shift+T");
  await assert.doesNotReject(async () => {
    await page.locator("#turbo-status").filter({ hasText: "ROBOT ARENA READY" }).waitFor({ state: "visible" });
  }, "English pages must announce Turbo in English");

  console.log("Turbo mode browser test passed.");
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
