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

  // Service Worker（/sw.js）：回访和站内切换时，带版本号的样式与脚本直接用本地缓存。
  // 排查用：地址后加 ?sw=off 会在这台浏览器上关掉它（注销并清空缓存），?sw=on 重新打开。
  if ("serviceWorker" in navigator && window.isSecureContext) {
    const offKey = "functionhx:sw:off";
    const toggle = new URLSearchParams(window.location.search).get("sw");
    let disabled = false;
    try {
      if (toggle === "off") window.localStorage.setItem(offKey, "1");
      if (toggle === "on") window.localStorage.removeItem(offKey);
      disabled = window.localStorage.getItem(offKey) === "1";
    } catch (_error) {
      disabled = toggle === "off";
    }
    const whenLoaded = (callback) => {
      if (document.readyState === "complete") callback();
      else window.addEventListener("load", callback, { once: true });
    };
    if (disabled) {
      navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
      // 这一页可能还被旧的 Service Worker 接管着，等它的请求都结束再清缓存，免得被重新写回去。
      whenLoaded(() =>
        window.setTimeout(() => {
          window.caches?.keys().then((names) => names.filter((name) => name.startsWith("functionhx-")).forEach((name) => window.caches.delete(name)));
        }, 1500)
      );
    } else {
      whenLoaded(() => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
        // 第一次访问时 Service Worker 还没接管这一页：把这页已经用到的带版本号资源告诉它，
        // 让它提前存好，下一页就能直接从缓存拿。
        navigator.serviceWorker.ready.then((registration) => {
          const urls = window.performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => {
              const url = new URL(name);
              return url.origin === window.location.origin && url.pathname.startsWith("/assets/") && url.searchParams.has("v");
            });
          if (urls.length) registration.active?.postMessage({ type: "warm", urls });
          // 导航栏里的页面（含当前页，返回首页时用得上）也提前存好：首次点进博客等页面时不必等网络，慢网络下差别最明显。
          const pages = [...document.querySelectorAll("#navbar a[href]")]
            .map((anchor) => new URL(anchor.href, window.location.href))
            .filter((url) => url.origin === window.location.origin && !url.search)
            .map((url) => url.href);
          if (pages.length) registration.active?.postMessage({ type: "warm-pages", urls: [...new Set(pages)] });
        });
      });
    }
  }
})();
