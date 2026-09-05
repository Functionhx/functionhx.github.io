import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleSource = await readFile(new URL("../assets/js/magic-search-owner.js", import.meta.url), "utf8");
const { loadOwnerRecords, parseOwnerRecord } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);
const searchSource = await readFile(new URL("../assets/js/magic-search.js", import.meta.url), "utf8");
const { withOwnerRecords, MagicSearch } = await import(
  `data:text/javascript;base64,${Buffer.from(searchSource + "\nexport { MagicSearch };").toString("base64")}`
);
const source = (fields = "", body = "Hidden article body") =>
  `---\nlang: zh\ntitle: 隐藏文章\ntranslation_key: hidden\npermalink: /books/hidden/\n${fields}\n---\n${body}`;
const parse = (fields) => parseOwnerRecord("_books/hidden-zh.md", source(fields), "zh");
assert.ok(parse("visibility: unlisted"));
for (const field of ["private: true", 'private: "broken', "visibility: private", "visibility: owner", "visibility: draft", "published: false"]) {
  assert.equal(parse(field), null, `Never read private or unpublished content into the owner supplement: ${field}`);
}
assert.equal(parseOwnerRecord("x.md", source().replace("/books/hidden/", "//evil.invalid/"), "zh"), null);
assert.equal(parseOwnerRecord("x.md", source(), "en"), null);

const sha = "a".repeat(40);
let currentToken = "synthetic-owner-token";
const auth = { restore: async () => (currentToken ? { token: currentToken } : null) };
const calls = [];
let login = "Functionhx";
let expireDuringBlob = false;
const request = async (url, options) => {
  calls.push(url);
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "omit");
  assert.equal(options.headers.Authorization, "Bearer synthetic-owner-token");
  const payload = url.endsWith("/user")
    ? { login }
    : url.includes("/git/trees/")
      ? { tree: [{ type: "blob", path: "_books/hidden-zh.md", sha }] }
      : { encoding: "base64", content: Buffer.from(source()).toString("base64") };
  if (url.includes("/git/blobs/") && expireDuringBlob) currentToken = "";
  return { ok: true, json: async () => payload };
};
const load = () => loadOwnerRecords({ language: "zh", signal: new AbortController().signal, publicKeys: new Set(), auth, request });
currentToken = "";
assert.equal(await load(), null);
assert.deepEqual(calls, [], "Visitors must never fetch repository sources");
currentToken = "synthetic-owner-token";
login = "someone-else";
await assert.rejects(load(), /Owner identity required/);
assert.equal(calls.length, 1, "A non-owner credential must stop before listing sources");
login = "Functionhx";
const records = await load();
assert.equal(records.length, 1);
assert.equal(records[0].title, "隐藏文章");
assert.equal(JSON.stringify(records).includes(currentToken), false, "Credentials never become search data");
expireDuringBlob = true;
await assert.rejects(load(), { name: "AbortError" }, "Logout during a request must discard its response");

const publicIndex = { audience: "visitor", documents: [], chunks: [], postings: {}, average_length: 1 };
const combined = withOwnerRecords(publicIndex, records, "隐藏栏目");
assert.equal(combined.audience, "owner");
assert.equal(combined.documents.length, 1);
assert.ok(combined.postings.article);
assert.deepEqual(
  publicIndex,
  { audience: "visitor", documents: [], chunks: [], postings: {}, average_length: 1 },
  "Owner results must not mutate the reusable visitor index"
);
console.log(
  "Owner search checks passed: visitor isolation, identity verification, safe source parsing, logout races, and in-memory index separation."
);

// A real logout event must erase the rendered results and index immediately,
// including when a source request is still in flight. No browser auth is used.
class NodeElement extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.value = "";
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  setAttribute() {}
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  querySelectorAll() {
    return [];
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}
globalThis.window = new EventTarget();
window.setTimeout = setTimeout;
window.clearTimeout = clearTimeout;
globalThis.document = {
  createElement: () => new NodeElement(),
  createTextNode: (value) => value,
  documentElement: { dataset: {} },
  body: new NodeElement(),
};
const search = new MagicSearch({ language: "zh" });
search.publicIndex = { ...publicIndex, chunk_count: 0, semantic_endpoint: "" };
search.index = combined;
search.ownerLoaded = true;
search.input.value = "owner-only-query";
search.dialog.open = true;
const pendingRequest = new AbortController();
search.ownerRequest = pendingRequest;
search.results.append("hidden result");
const logout = new Event("functionhx:github-auth-changed");
Object.defineProperty(logout, "detail", { value: { connected: false, repository: "Functionhx/functionhx.github.io" } });
window.dispatchEvent(logout);
assert.equal(search.index, search.publicIndex);
assert.equal(search.ownerLoaded, false);
assert.equal(pendingRequest.signal.aborted, true);
assert.equal(search.input.value, "", "Do not send a former owner query to public semantic search after logout");
assert.equal(search.results.children.length, 0);
search.input.value = "po";
let prevented = false;
search.handleKeys({
  key: "Escape",
  preventDefault() {
    prevented = true;
  },
});
assert.equal(search.dialog.open, false, "One Escape closes search even with a non-empty native search input");
assert.equal(prevented, true);
delete globalThis.window;
delete globalThis.document;
console.log("Search UI state checks passed: immediate logout cleanup and Escape dismissal.");
