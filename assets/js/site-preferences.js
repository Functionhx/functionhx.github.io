(function initializeSitePreferences() {
  "use strict";

  const root = document.documentElement;
  const fontStorageKey = "functionhx:site-font";
  const loadingCopyStorageKey = "functionhx:loading-copy";
  const supportedFonts = new Set(["anthropic-serif", "anthropic-sans", "system", "dyslexic"]);
  const loadingCopy = Object.freeze({
    loading: "Loading...",
    "loading-zh": "正在载入...",
    thinking: "Thinking...",
    "thinking-zh": "正在思考...",
  });
  const loader = document.getElementById("site-page-loader");
  const loaderDelay = 180;
  const loaderMinimumVisible = 280;
  const loaderState = window.functionhxPageLoaderState || { failsafeTimer: 0, hideTimer: 0, showTimer: 0, visibleAt: 0 };
  window.functionhxPageLoaderState = loaderState;

  function storedFont() {
    try {
      const value = window.localStorage.getItem(fontStorageKey);
      return supportedFonts.has(value) ? value : "system";
    } catch (_error) {
      return "system";
    }
  }

  function setFont(value) {
    const font = supportedFonts.has(value) ? value : "system";
    root.dataset.siteFont = font;
    try {
      window.localStorage.setItem(fontStorageKey, font);
    } catch (_error) {
      // The preference still applies to this page when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent("functionhx:font-changed", { detail: { font } }));
    return font;
  }

  function storedLoadingCopy() {
    try {
      const value = window.localStorage.getItem(loadingCopyStorageKey);
      return Object.hasOwn(loadingCopy, value) ? value : "thinking";
    } catch (_error) {
      return "thinking";
    }
  }

  function setLoadingCopy(value) {
    const choice = Object.hasOwn(loadingCopy, value) ? value : "thinking";
    root.dataset.loadingCopy = choice;
    loader?.querySelector(".sr-only")?.replaceChildren(loadingCopy[choice]);
    document.querySelectorAll("[data-loading-placeholder]").forEach((element) => {
      element.textContent = loadingCopy[choice];
    });
    try {
      window.localStorage.setItem(loadingCopyStorageKey, choice);
    } catch (_error) {
      // The preference still applies to this page when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent("functionhx:loading-copy-changed", { detail: { choice } }));
    return choice;
  }

  function revealLoading() {
    loaderState.showTimer = 0;
    if (root.dataset.pageLoading === "true") return;
    root.dataset.pageLoading = "true";
    loaderState.visibleAt = window.performance.now();
  }

  function showLoading() {
    window.clearTimeout(loaderState.hideTimer);
    loaderState.hideTimer = 0;
    window.clearTimeout(loaderState.failsafeTimer);
    loaderState.failsafeTimer = window.setTimeout(hideLoading, 12000);
    document.body?.setAttribute("aria-busy", "true");
    if (root.dataset.pageLoading === "true" || loaderState.showTimer) return;
    loaderState.showTimer = window.setTimeout(revealLoading, loaderDelay);
  }

  function finishHiding() {
    window.clearTimeout(loaderState.failsafeTimer);
    loaderState.failsafeTimer = 0;
    loaderState.hideTimer = 0;
    loaderState.visibleAt = 0;
    root.removeAttribute("data-page-loading");
    document.body?.removeAttribute("aria-busy");
  }

  function hideLoading() {
    window.clearTimeout(loaderState.showTimer);
    loaderState.showTimer = 0;
    if (root.dataset.pageLoading !== "true") {
      finishHiding();
      return;
    }
    const elapsed = window.performance.now() - loaderState.visibleAt;
    const remaining = Math.max(0, loaderMinimumVisible - elapsed);
    window.clearTimeout(loaderState.hideTimer);
    loaderState.hideTimer = window.setTimeout(finishHiding, remaining);
  }

  function navigatesThisPage(anchor, event) {
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }
    if (anchor.target && anchor.target !== "_self") return false;
    if (anchor.hasAttribute("download") || anchor.hasAttribute("data-no-page-loader")) return false;
    if (anchor.matches("#search-toggle, [data-magic-search-open]")) return false;

    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin || !/^https?:$/.test(destination.protocol)) return false;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) {
      return false;
    }
    return destination.href !== window.location.href;
  }

  function submitsThisPage(form, event) {
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return false;

    const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
    const method = (submitter?.getAttribute("formmethod") || form.getAttribute("method") || "get").toLowerCase();
    const target = submitter?.getAttribute("formtarget") || form.getAttribute("target") || "_self";
    if (method === "dialog" || (target && target !== "_self")) return false;
    if (form.hasAttribute("data-no-page-loader") || submitter?.hasAttribute("data-no-page-loader")) return false;
    return true;
  }

  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (navigatesThisPage(anchor, event)) showLoading();
    },
    true
  );
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      // Wait until submit propagation has finished so application handlers still
      // have an opportunity to cancel an in-page form before we show a loader.
      window.queueMicrotask(() => {
        if (submitsThisPage(form, event)) showLoading();
      });
    },
    true
  );
  window.addEventListener("pageshow", hideLoading);
  window.addEventListener("pagehide", showLoading);

  window.functionhxSitePreferences = Object.freeze({
    getFont: () => root.dataset.siteFont || storedFont(),
    getLoadingCopy: () => root.dataset.loadingCopy || storedLoadingCopy(),
    getLoadingText: () => loadingCopy[root.dataset.loadingCopy] || loadingCopy.thinking,
    hideLoading,
    loaderTiming: Object.freeze({ delay: loaderDelay, minimumVisible: loaderMinimumVisible }),
    setFont,
    setLoadingCopy,
    showLoading,
  });

  root.dataset.siteFont = supportedFonts.has(root.dataset.siteFont) ? root.dataset.siteFont : storedFont();
  root.dataset.loadingCopy = Object.hasOwn(loadingCopy, root.dataset.loadingCopy) ? root.dataset.loadingCopy : storedLoadingCopy();
  loader?.querySelector(".sr-only")?.replaceChildren(loadingCopy[root.dataset.loadingCopy]);
  document.querySelectorAll("[data-loading-placeholder]").forEach((element) => {
    element.textContent = loadingCopy[root.dataset.loadingCopy];
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hideLoading, { once: true });
  else hideLoading();
})();
