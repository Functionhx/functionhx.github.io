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
    cursorCapability: document.documentElement.dataset.turboCursor,
    cursorVisible: document.getElementById("turbo-cursor").dataset.visible,
    cursorState: document.getElementById("turbo-cursor").dataset.state,
    cursorPressed: document.getElementById("turbo-cursor").dataset.pressed,
    bodyCursor: window.getComputedStyle(document.body).cursor,
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
  assert.equal(state.cursorCapability, "enabled", "Turbo must enable its custom cursor on a desktop pointer");
  assert.equal(state.cursorVisible, "true", "The Turbo cursor must appear after pointer input");
  assert.equal(state.cursorState, "locked", "The Turbo cursor must lock onto the appearance control");
  assert.equal(state.bodyCursor, "none", "The native cursor must be hidden while the Turbo cursor is active");

  if (process.env.TURBO_SCREENSHOT_PATH) {
    await page.waitForTimeout(1250);
    const blogLink = page.locator('a[data-nav-translation-key="blog"]');
    const blogBox = await blogLink.boundingBox();
    assert.ok(blogBox, "Blog navigation link must be visible for the Turbo screenshot");
    await page.mouse.move(blogBox.x + 20, blogBox.y + blogBox.height / 2);
    await page.waitForTimeout(180);
    await page.screenshot({ path: process.env.TURBO_SCREENSHOT_PATH });
  }

  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "turbo-cursor-fixture";
    fixture.innerHTML = `
      <div id="turbo-cursor-plain" style="position:fixed;left:20px;top:180px;width:70px;height:70px;z-index:2147483644"></div>
      <button id="turbo-cursor-action" style="position:fixed;left:110px;top:180px;width:80px;height:70px;z-index:2147483644">Action</button>
      <input id="turbo-cursor-input" type="text" style="position:fixed;left:210px;top:180px;width:120px;height:70px;z-index:2147483644">
    `;
    document.body.append(fixture);
  });

  await page.mouse.move(50, 210);
  state = await turboState();
  assert.equal(state.cursorState, "tracking", "The cursor must use its neutral tracking state over page content");
  assert.equal(state.cursorVisible, "true", "The tracking cursor must remain visible over page content");

  await page.mouse.move(150, 210);
  state = await turboState();
  assert.equal(state.cursorState, "locked", "The cursor must show a lock state over interactive controls");
  await page.mouse.down();
  assert.equal((await turboState()).cursorPressed, "true", "The cursor must compress on pointer down");
  await page.mouse.up();
  assert.equal((await turboState()).cursorPressed, "false", "The cursor must release after pointer up");

  await page.mouse.move(250, 210);
  state = await turboState();
  assert.equal(state.cursorVisible, "false", "Text entry must restore a native cursor instead of obscuring the caret");
  assert.equal(await page.locator("#turbo-cursor-input").evaluate((input) => window.getComputedStyle(input).cursor), "text");

  await page.reload({ waitUntil: "networkidle" });
  state = await turboState();
  assert.equal(state.active, "on", "Turbo must survive a page reload");

  await page.keyboard.press("Shift+T");
  state = await turboState();
  assert.equal(state.active, "off", "Shift+T must disable Turbo");
  assert.equal(state.cursorVisible, "false", "Disabling Turbo must hide the custom cursor");
  assert.notEqual(state.bodyCursor, "none", "Disabling Turbo must restore the system cursor");

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

  const reducedContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  try {
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(baseUrl, { waitUntil: "networkidle" });
    await reducedPage.keyboard.press("Shift+T");
    await reducedPage.mouse.move(600, 400);
    const reducedState = await reducedPage.evaluate(() => ({
      active: document.documentElement.dataset.turbo,
      cursorCapability: document.documentElement.dataset.turboCursor,
      cursorVisible: document.getElementById("turbo-cursor").dataset.visible,
      bodyCursor: window.getComputedStyle(document.body).cursor,
    }));
    assert.equal(reducedState.active, "on", "Reduced motion users may still enable the static Turbo scene");
    assert.equal(reducedState.cursorCapability, "native", "Reduced motion must keep the system cursor");
    assert.equal(reducedState.cursorVisible, "false", "Reduced motion must not force the animated cursor");
    assert.notEqual(reducedState.bodyCursor, "none", "Reduced motion must preserve the native cursor appearance");
  } finally {
    await reducedContext.close();
  }

  console.log("Turbo mode browser test passed.");
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
