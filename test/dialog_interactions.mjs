import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class Dialog extends EventTarget {
  open = true;
  getBoundingClientRect() {
    return { left: 100, right: 400, top: 100, bottom: 500 };
  }
  close() {
    this.open = false;
  }
}
const document = new EventTarget();
document.body = {};
document.documentElement = { toggleAttribute() {} };
document.querySelector = () => null;
vm.runInNewContext(await readFile(new URL("../assets/js/dialog-interactions.js", import.meta.url), "utf8"), {
  document,
  HTMLDialogElement: Dialog,
  Event,
  MutationObserver: class {
    observe() {}
  },
});
function dispatch(type, target, x, y) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    target: { value: target },
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
  });
  document.dispatchEvent(event);
}
const dialog = new Dialog();
dispatch("pointerdown", dialog, 50, 250);
dispatch("click", dialog, 50, 250);
assert.equal(dialog.open, false, "a backdrop tap closes a clean dialog");
dialog.open = true;
dispatch("pointerdown", dialog, 150, 250);
dispatch("click", dialog, 50, 250);
assert.equal(dialog.open, true, "dragging from the sheet to its backdrop must not dismiss it");
dispatch("pointerdown", dialog, 50, 250);
dispatch("click", dialog, 150, 250);
assert.equal(dialog.open, true, "ending inside the sheet must not dismiss it");
dispatch("pointerdown", dialog, 50, 250);
dispatch("pointercancel", dialog, 50, 250);
dispatch("click", dialog, 50, 250);
assert.equal(dialog.open, true, "a canceled gesture must not close anything");
let guarded = 0;
dialog.addEventListener("cancel", (event) => {
  guarded++;
  event.preventDefault();
});
dispatch("pointerdown", dialog, 50, 250);
dispatch("click", dialog, 50, 250);
assert.equal(guarded, 1, "backdrop taps must honor the same unsaved-change guard as Escape");
assert.equal(dialog.open, true);
console.log("Dialog interaction checks passed: backdrop, drag safety, cancellation, and unsaved-change guards.");
