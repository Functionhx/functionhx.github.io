const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");

function css(name) {
  return readFileSync(resolve(root, "assets", "css", name), "utf8");
}

const contracts = {
  "content-creator.css": ["max-width: 58rem", "@media (max-width: 767px)", "@media (prefers-reduced-motion: reduce)"],
  "home.css": ["max-width: 42rem", "@media (max-width: 575.98px)", "@media (prefers-reduced-motion: reduce)"],
  "magic-search.css": [".magic-search::backdrop", "max-width: 42rem", "@media (prefers-reduced-motion: reduce)"],
  "owner-ui.css": ['html:not([data-owner-verified="true"]) .owner-only-control', ".site-author-menu[hidden]", "@media (max-width: 991.98px)"],
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
