(function initializeDialogInteractions() {
  "use strict";

  // Backdrop taps follow the same cancellation path as Escape. A drag that
  // starts inside the sheet must never dismiss it when released outside.
  let backdropPress = null;
  function outside(dialog, event) {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      backdropPress = event.button === 0 && target instanceof HTMLDialogElement && target.open && outside(target, event) ? target : null;
    },
    true
  );
  document.addEventListener(
    "pointercancel",
    () => {
      backdropPress = null;
    },
    true
  );
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      const dismiss = backdropPress === target && target instanceof HTMLDialogElement && target.open && outside(target, event);
      backdropPress = null;
      if (!dismiss) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (target.dispatchEvent(new Event("cancel", { cancelable: true }))) target.close();
    },
    true
  );

  // Keep the underlying page still, including when one modal opens over another.
  const sync = () => {
    document.documentElement.toggleAttribute("data-site-dialog-open", Boolean(document.querySelector("dialog[open]")));
  };
  new MutationObserver(sync).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  sync();
})();
