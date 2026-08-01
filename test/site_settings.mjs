import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const siteRoot = new URL("../_site/", import.meta.url);
const repositoryRoot = new URL("../", import.meta.url);
const testToken = "not-a-real-settings-token";
const testDeepSeekKey = "not-a-real-deepseek-settings-key";
const testIntruderToken = "not-a-real-helper-github-token";
const managedPaths = ["_pages/blog-zh.md", "_pages/blog-en.md", "_pages/people-zh.md", "_pages/people-en.md", "_data/site_ui.yml"];
const managedSources = Object.fromEntries(
  await Promise.all(managedPaths.map(async (path) => [path, await readFile(new URL(path, repositoryRoot), "utf8")]))
);
const initialNavigationDensity = managedSources["_data/site_ui.yml"].match(/^navigation_density:\s*(auto|compact|relaxed)$/m)?.[1];
assert.ok(initialNavigationDensity, "site UI data must define a supported navigation density");
const targetNavigationDensity = initialNavigationDensity === "relaxed" ? "compact" : "relaxed";

let staticServer = null;
let baseUrl = process.env.SITE_SETTINGS_TEST_URL || "";
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

let treeRequest = null;
let commitRequest = null;
let refUpdate = null;
let translationRequest = null;
let translationAuthorization = "";
let deploymentPolls = 0;
const authorizations = [];
const githubRequests = [];
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
await page.addInitScript(() => {
  window.functionhxDeploymentConfig = { maxWait: 2000, pollInterval: 25 };
});

await page.route("**/healthz.json?**", async (route) => {
  await route.fulfill({
    body: JSON.stringify({ commit: "settings-commit" }),
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    status: 200,
  });
});

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
  translationRequest = request.postDataJSON();
  translationAuthorization = request.headers().authorization || "";
  await route.fulfill({
    body: JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "",
              summary: "Ideas and results from experiments.",
              title: "Lab Notes",
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

await page.route("https://api.github.com/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = decodeURIComponent(url.pathname);
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
  const authorization = request.headers().authorization || "";
  if (authorization) authorizations.push(authorization);
  githubRequests.push({ authorization, method: request.method(), pathname });

  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  if (pathname === "/user") {
    await route.fulfill({
      body: JSON.stringify({
        login: authorization === `Bearer ${testIntruderToken}` ? "HelpfulTranslator" : "Functionhx",
      }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io") {
    await route.fulfill({
      body: JSON.stringify({ permissions: { push: true } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/actions/runs") {
    deploymentPolls += 1;
    const state = deploymentPolls === 1 ? "queued" : deploymentPolls === 2 ? "in_progress" : "completed";
    await route.fulfill({
      body: JSON.stringify({
        workflow_runs: [
          {
            conclusion: state === "completed" ? "success" : null,
            head_sha: "settings-commit",
            html_url: "https://github.com/Functionhx/functionhx.github.io/actions/runs/settings-test",
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
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/ref/heads/main") {
    await route.fulfill({
      body: JSON.stringify({ object: { sha: "head-settings" } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/commits/head-settings" && request.method() === "GET") {
    await route.fulfill({
      body: JSON.stringify({ tree: { sha: "base-settings-tree" } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
    });
    return;
  }

  const contentsPrefix = "/repos/Functionhx/functionhx.github.io/contents/";
  if (pathname.startsWith(contentsPrefix)) {
    const sourcePath = pathname.slice(contentsPrefix.length);
    if (managedSources[sourcePath]) {
      await route.fulfill({
        body: JSON.stringify({
          content: Buffer.from(managedSources[sourcePath], "utf8").toString("base64"),
          sha: `${sourcePath}-sha`,
          type: "file",
        }),
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ message: "Not Found" }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 404,
    });
    return;
  }

  if (pathname === "/repos/Functionhx/functionhx.github.io/git/trees" && request.method() === "POST") {
    treeRequest = request.postDataJSON();
    await route.fulfill({
      body: JSON.stringify({ sha: "new-settings-tree" }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 201,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/commits" && request.method() === "POST") {
    commitRequest = request.postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        html_url: "https://github.com/Functionhx/functionhx.github.io/commit/settings-test",
        sha: "settings-commit",
      }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 201,
    });
    return;
  }
  if (pathname === "/repos/Functionhx/functionhx.github.io/git/refs/heads/main" && request.method() === "PATCH") {
    refUpdate = request.postDataJSON();
    await route.fulfill({
      body: JSON.stringify({ object: { sha: "settings-commit" } }),
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
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

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-page-loading"));
  assert.equal(await page.locator("#site-page-loader").isVisible(), false, "the page loader must leave when the page is ready");
  await page.locator("#site-settings-toggle").click();
  await page.locator("#site-settings-dialog").waitFor({ state: "visible" });

  assert.equal(await page.locator("#site-settings-font").inputValue(), "system");
  assert.equal(await page.locator("#site-settings-loading-copy").inputValue(), "thinking");
  await page.locator("#site-settings-font").selectOption("dyslexic");
  assert.equal(await page.locator("html").getAttribute("data-site-font"), "dyslexic");
  await page.locator("#site-settings-loading-copy").selectOption("loading-zh");
  assert.equal(await page.locator("html").getAttribute("data-loading-copy"), "loading-zh");
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-page-loading"));
  assert.equal(
    await page.evaluate(() => window.functionhxSitePreferences.getLoadingText()),
    "正在载入...",
    "the selected loading copy should become the global loading message"
  );
  await page.locator("#site-settings-owner > summary").click();

  const sectionKeys = await page.locator("[data-section-toggle]").evaluateAll((inputs) => inputs.map((input) => input.dataset.translationKey));
  assert.equal(new Set(sectionKeys).size, sectionKeys.length, "each section should appear only once");
  assert.ok(sectionKeys.includes("people") && sectionKeys.includes("repositories"));
  assert.equal(
    (await page.locator("#site-settings-sections").textContent()).includes("page 2"),
    false,
    "pagination clones must not appear as sections"
  );

  const peopleToggle = page.locator('[data-section-toggle][data-translation-key="people"]');
  const repositoriesToggle = page.locator('[data-section-toggle][data-translation-key="repositories"]');
  const blogToggle = page.locator('[data-section-toggle][data-translation-key="blog"]');
  assert.equal(await peopleToggle.isChecked(), false);
  assert.equal(await repositoriesToggle.isChecked(), false);
  assert.equal(await blogToggle.isChecked(), true);
  assert.equal(await page.locator("html").getAttribute("data-nav-density"), initialNavigationDensity);
  const initialNavWidth = await page.locator("#navbarNav").evaluate((element) => element.getBoundingClientRect().width);
  await page.locator(`#site-settings-density-${targetNavigationDensity}`).check();
  assert.equal(await page.locator("html").getAttribute("data-nav-density"), targetNavigationDensity, "navigation density should preview immediately");
  const previewNavWidth = await page.locator("#navbarNav").evaluate((element) => element.getBoundingClientRect().width);
  if (targetNavigationDensity === "relaxed") {
    assert.ok(previewNavWidth > initialNavWidth + 40, "relaxed navigation should use more of the available header width");
  } else {
    assert.ok(previewNavWidth < initialNavWidth - 40, "compact navigation should use less of the available header width");
  }
  await peopleToggle.check();
  await blogToggle.uncheck();

  await page.locator("#site-settings-new summary").click();
  await page.locator("#site-settings-title-zh").fill("实验札记");
  await page.locator("#site-settings-description-zh").fill("记录实验中的想法与结果。");
  await page.locator("#site-settings-translate").click();
  await page.locator("#deepseek-translator-dialog").waitFor({ state: "visible" });
  await page.locator("#deepseek-translator-cancel").click();
  await page.locator("#deepseek-translator-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#site-settings-title-en").inputValue(), "");
  assert.match(await page.locator("#site-settings-status").textContent(), /取消/);

  await page.locator("#site-settings-translate").click();
  await page.locator("#deepseek-translator-dialog").waitFor({ state: "visible" });
  await page.locator("#deepseek-translator-key").fill(testDeepSeekKey);
  await page.locator("#deepseek-translator-submit").click();
  await page.locator("#deepseek-translator-dialog").waitFor({ state: "hidden" });

  assert.equal(await page.locator("#site-settings-title-en").inputValue(), "Lab Notes");
  assert.equal(await page.locator("#site-settings-description-en").inputValue(), "Ideas and results from experiments.");
  assert.equal(await page.locator("#site-settings-slug").inputValue(), "lab-notes");
  assert.equal(translationAuthorization, `Bearer ${testDeepSeekKey}`);
  assert.equal(translationRequest.model, "deepseek-v4-pro");
  assert.deepEqual(translationRequest.response_format, { type: "json_object" });
  assert.match(translationRequest.messages[0].content, /Never add facts/);
  await page.locator("#site-settings-format").selectOption("posts");
  await page.locator("#site-settings-order").fill("12");

  await page.locator("#site-settings-connect").click();
  await page.locator("#site-settings-auth").waitFor({ state: "visible" });
  await page.locator("#site-settings-token").fill(testIntruderToken);
  await page.locator("#site-settings-auth-connect").click();
  await page.locator('#site-settings-auth-status[data-state="error"]').waitFor();
  assert.match(await page.locator("#site-settings-auth-status").textContent(), /not @Functionhx/);
  assert.equal(treeRequest, null, "a translator who is not the owner must not write");
  await page.locator("#site-settings-auth-cancel").click();
  await page.locator("#site-settings-auth").waitFor({ state: "hidden" });

  await page.locator("#site-settings-commit").click();
  await page.locator("#site-settings-auth").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator("#site-settings-auth").waitFor({ state: "hidden" });
  await page.waitForTimeout(450);
  assert.equal(treeRequest, null, "closing owner authentication with Escape must cancel the pending settings commit");

  await page.locator("#site-settings-commit").click();
  await page.locator("#site-settings-auth").waitFor({ state: "visible" });
  await page.locator("#site-settings-token").fill(testToken);
  await page.locator("#site-settings-auth-connect").click();
  await page.locator("#site-settings-auth").waitFor({ state: "hidden" });
  await page.locator("#site-settings-result").waitFor({ state: "visible" });
  await page.locator('#site-deployment-monitor[data-state="success"]').waitFor({ state: "visible" });

  assert.ok(treeRequest, "settings should create a Git tree");
  assert.equal(treeRequest.base_tree, "base-settings-tree");
  assert.equal(treeRequest.tree.length, 7, "layout, two changed pairs, and one new pair should share one commit");
  const byPath = Object.fromEntries(treeRequest.tree.map((item) => [item.path, item.content]));
  assert.match(byPath["_data/site_ui.yml"], new RegExp(`^navigation_density: ${targetNavigationDensity}$`, "m"));
  assert.match(byPath["_pages/people-zh.md"], /^nav: true$/m);
  assert.match(byPath["_pages/people-en.md"], /^nav: true$/m);
  assert.match(byPath["_pages/blog-zh.md"], /^nav: false$/m);
  assert.match(byPath["_pages/blog-en.md"], /^nav: false$/m);

  const newZh = byPath["_pages/lab-notes-zh.md"];
  const newEn = byPath["_pages/lab-notes-en.md"];
  assert.ok(newZh && newEn, "new sections must be created as a bilingual pair");
  assert.match(newZh, /title: "实验札记"/);
  assert.match(newEn, /title: "Lab Notes"/);
  assert.match(newZh, /translation_key: section-lab-notes/);
  assert.match(newEn, /translation_key: section-lab-notes/);
  assert.match(newZh, /settings_file_stem: lab-notes/);
  assert.match(newZh, /kind: lab-notes/);
  assert.match(newZh, /{% include post-lane\.liquid %}/);
  assert.match(newZh, /permalink: \/lab-notes\//);
  assert.match(newEn, /permalink: \/en\/lab-notes\//);
  assert.equal(commitRequest.parents[0], "head-settings");
  assert.deepEqual(refUpdate, { force: false, sha: "settings-commit" });
  assert.ok(authorizations.includes(`Bearer ${testIntruderToken}`));
  assert.ok(authorizations.includes(`Bearer ${testToken}`));
  const mutationAuthorizations = githubRequests
    .filter(({ method }) => method === "POST" || method === "PATCH")
    .map(({ authorization }) => authorization);
  assert.ok(
    mutationAuthorizations.every((authorization) => authorization === `Bearer ${testToken}`),
    "only the owner token may reach GitHub mutation endpoints"
  );
  assert.ok(deploymentPolls >= 3, "settings commits should expose deployment progress through success");

  const browserStorage = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }));
  assert.equal(browserStorage.includes(testToken), false, "the settings token must never enter browser storage");
  assert.equal(browserStorage.includes(testIntruderToken), false, "a rejected token must never enter browser storage");
  assert.equal(browserStorage.includes(testDeepSeekKey), false, "the DeepSeek key must never enter browser storage");

  await page.locator("#site-settings-close").click();
  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-page-loading"));
  await page.locator('[data-nav-toggle="navbarNav"]').click();
  await page.locator("#site-settings-toggle").click();
  await page.waitForFunction(() => document.querySelector("#site-settings-connect span")?.textContent.includes("退出"));
  assert.equal(
    await page.locator("#navbarNav").evaluate((element) => element.classList.contains("show")),
    false,
    "opening settings should close the mobile navigation behind the modal"
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.locator("html").getAttribute("data-site-font"), "dyslexic", "the font preference should survive reloads");
  assert.equal(await page.locator("html").getAttribute("data-loading-copy"), "loading-zh", "the loading copy should survive reloads");
  const dialogBounds = await page.locator("#site-settings-dialog").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  assert.ok(dialogBounds.width <= 390 && dialogBounds.height <= 844, "settings should fit the mobile viewport");

  console.log("Site settings browser test passed.");
} finally {
  await browser.close();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
}
