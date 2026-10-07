const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");

function css(name) {
  return readFileSync(resolve(root, "assets", "css", name), "utf8");
}

const contracts = {
  "content-creator.css": ["max-width: 58rem", "@media (max-width: 767px)", "@media (prefers-reduced-motion: reduce)"],
  "feishu-documents.css": ["max-width: 56rem", ".feishu-document-dialog::backdrop", "@media (max-width: 575.98px)"],
  "home.css": ["max-width: 42rem", "@media (max-width: 575.98px)", "@media (prefers-reduced-motion: reduce)"],
  "magic-search.css": [".magic-search::backdrop", "max-width: 42rem", "@media (prefers-reduced-motion: reduce)"],
  "owner-ui.css": [
    'html:not([data-owner-verified="true"][data-owner-mode="true"]) .owner-only-control',
    // 铅笔只在站长模式下显示（「返回访客模式」后页面与访客一致，2026-09-27）。
    'html[data-owner-verified="true"][data-owner-mode="true"] .site-author-nav.owner-only-control',
    ".site-author-menu[hidden]",
    "@media (max-width: 575.98px)",
  ],
  // 文章页 2026-09-26 改成 claude.dev 版式；手机上目录与进度由底部阅读条承担（2026-10-07）。
  "post.css": [
    "max-width: 732px",
    "@media (max-width: 820px)",
    ".post-dock.is-collapsed",
    ".post-sheet::backdrop",
    "@media (prefers-reduced-motion: reduce)",
  ],
  // 文章便利贴（2026-10-07）：三种排版、手机折角、减少动画。
  "sticky-notes.css": [
    '[data-sticky-mode="margin"]',
    '[data-sticky-mode="fold"]',
    "::highlight(sticky-yellow)",
    "@media (prefers-reduced-motion: reduce)",
  ],
  "blog-feed.css": ["@media (max-width: 760px)", ".writing-filter-sheet::backdrop", "@media (prefers-reduced-motion: reduce)"],
  "site-preferences.css": ["@media (prefers-color-scheme: dark)", "@media (prefers-reduced-motion: reduce)"],
  "site-settings.css": ["max-width: min(50rem, calc(100vw - 2rem))", ".site-settings-dialog::backdrop", "@media (max-width: 575px)"],
  "spark-writer.css": [".site-spark-writer[hidden]", "@media (max-width: 767px)", "@media (max-width: 420px)"],
};

for (const [name, requiredFragments] of Object.entries(contracts)) {
  const source = css(name);
  for (const fragment of requiredFragments) {
    assert.ok(source.includes(fragment), `${name} must preserve style contract ${JSON.stringify(fragment)}`);
  }
  assert.equal(/(?:^|[;{]\s*)width:\s*(?:[5-9]\d{2}|\d{4,})px/m.test(source), false, `${name} must not require a desktop-only fixed width`);
}

console.log("Minimal responsive style contracts passed.");
