import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
class Element extends EventTarget {
  value = "";
  disabled = false;
  open = false;
  dataset = {};
  focus() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}
const ids = ["dialog", "key", "cancel", "submit", "status"];
const fields = Object.fromEntries(ids.map((id) => [id, new Element()]));
fields.dialog.dataset = { endpoint: "https://example.invalid/translate", model: "synthetic", language: "zh" };
const calls = [];
const window = {
  requestAnimationFrame: (callback) => callback(),
  fetch: (_url, options) =>
    new Promise((resolve, reject) => {
      calls.push({ options, resolve, reject });
    }),
};
vm.runInNewContext(await readFile(new URL("../assets/js/deepseek-translator.js", import.meta.url), "utf8"), {
  window,
  DOMException,
  AbortController,
  document: { getElementById: (id) => fields[id.replace("deepseek-translator-", "")] },
});
const turn = () => new Promise((resolve) => setImmediate(resolve));
const response = (title) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ title, summary: "", body: "" }) } }] }),
});
let firstError;
const first = window.functionhxDeepSeek.translate({ title: "第一篇" }).catch((error) => {
  firstError = error;
});
fields.key.value = "synthetic-key-one";
fields.submit.dispatchEvent(new Event("click"));
fields.submit.dispatchEvent(new Event("click"));
assert.equal(calls.length, 1, "repeated submit must not issue duplicate requests");
assert.equal(fields.cancel.disabled, false, "translation must remain cancelable while waiting");
fields.cancel.dispatchEvent(new Event("click"));
await first;
assert.equal(firstError.name, "AbortError");
assert.equal(calls[0].options.signal.aborted, true);
assert.equal(fields.key.value, "");
let secondDone = false;
const second = window.functionhxDeepSeek.translate({ title: "第二篇" }).then((value) => {
  secondDone = true;
  return value;
});
fields.key.value = "synthetic-key-two";
fields.submit.dispatchEvent(new Event("click"));
calls[0].resolve(response("Old result"));
await turn();
assert.equal(secondDone, false, "a late response must not resolve a newer request");
assert.equal(fields.dialog.open, true);
calls[1].resolve(response("Second result"));
assert.equal((await second).title, "Second result");
assert.equal(fields.dialog.open, false);
let thirdError;
const third = window.functionhxDeepSeek.translate({ title: "第三篇" }).catch((error) => {
  thirdError = error;
});
fields.key.value = "synthetic-key-three";
fields.submit.dispatchEvent(new Event("click"));
fields.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
await third;
calls[2].reject(new Error("Late failure"));
await turn();
assert.equal(thirdError.name, "AbortError");
assert.equal(fields.status.textContent, "", "a canceled request must not show a late failure");
assert.equal(fields.key.value, "");
console.log("Translation cancellation checks passed: no duplicate requests, abort, cleared keys, and stale-result isolation.");
