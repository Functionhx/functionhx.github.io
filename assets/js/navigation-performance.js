(function initializeNavigationPerformance() {
  "use strict";

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const constrainedConnection = Boolean(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || ""));
  const prefetched = new Set();
  const pendingTimers = new WeakMap();
  const maximumPrefetches = 8;

  function eligibleUrl(anchor) {
    if (!anchor || constrainedConnection || prefetched.size >= maximumPrefetches) return null;
    if (anchor.target && anchor.target !== "_self") return null;
    if (anchor.hasAttribute("download") || anchor.hasAttribute("data-no-prefetch")) return null;

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !/^https?:$/.test(url.protocol)) return null;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
    if (/\.(?:7z|avi|docx?|gif|jpe?g|mov|mp3|mp4|pdf|png|pptx?|rar|svg|webm|webp|xlsx?|zip)$/i.test(url.pathname)) return null;

    url.hash = "";
    return url;
  }

  function prefetch(anchor) {
    const url = eligibleUrl(anchor);
    if (!url || prefetched.has(url.href)) return;

    prefetched.add(url.href);
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.as = "document";
    hint.href = url.href;
    hint.fetchPriority = "low";
    document.head.append(hint);
  }

  function triggerFromEvent(event) {
    return event.target instanceof Element ? event.target.closest("a[href]") : null;
  }

  document.addEventListener(
    "pointerover",
    (event) => {
      const anchor = triggerFromEvent(event);
      if (!anchor || event.pointerType === "touch" || pendingTimers.has(anchor)) return;
      const timer = window.setTimeout(() => {
        pendingTimers.delete(anchor);
        prefetch(anchor);
      }, 65);
      pendingTimers.set(anchor, timer);
    },
    { passive: true }
  );

  document.addEventListener(
    "pointerout",
    (event) => {
      const anchor = triggerFromEvent(event);
      const timer = anchor ? pendingTimers.get(anchor) : 0;
      if (!timer || anchor.contains(event.relatedTarget)) return;
      window.clearTimeout(timer);
      pendingTimers.delete(anchor);
    },
    { passive: true }
  );

  document.addEventListener("focusin", (event) => prefetch(triggerFromEvent(event)));
  document.addEventListener("touchstart", (event) => prefetch(triggerFromEvent(event)), { passive: true });
})();
