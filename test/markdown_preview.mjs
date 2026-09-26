import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The editor preview must render what the article page renders: code blocks
// carry their language for the card header, and table alignment matches
// kramdown's inline text-align styles.
const window = {};
vm.runInNewContext(await readFile(new URL("../assets/js/markdown-preview.js", import.meta.url), "utf8"), {
  window,
  document: {},
});
const { render } = window.functionhxMarkdownPreview;

assert.equal(render("```yaml\nbatch_dt: 0.0\n```"), '<pre data-lang="yaml"><code>batch_dt: 0.0</code></pre>');
assert.equal(render("```\nplain\n```"), '<pre data-lang="text"><code>plain</code></pre>', "unlabeled fences read as text");
assert.match(render('```x"><script>\nbody\n```'), /^<pre data-lang="x&quot;&gt;&lt;script&gt;">/, "the language is escaped");

const table = render("| 数据包 | 居中 | 加速比 |\n| --- | :-: | --: |\n| quick-shack | a | 3.5× |");
assert.match(table, /^<div class="site-markdown-preview__table-wrap"><table>/);
assert.match(table, /<th>数据包<\/th><th style="text-align: center">居中<\/th><th style="text-align: right">加速比<\/th>/);
assert.match(table, /<td>quick-shack<\/td><td style="text-align: center">a<\/td><td style="text-align: right">3\.5×<\/td>/);
assert.match(render("| a | b |\n|-|-:|\n| 1 | 2 |"), /<td style="text-align: right">2<\/td>/, "single-dash dividers are tables");

console.log("markdown preview: ok");
