(function initializeSitePreferences() {
  "use strict";

  const root = document.documentElement;
  const supportedFonts = new Set(["anthropic-serif", "anthropic-sans", "system", "dyslexic", "wenkai"]);
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

  // 字体与加载文案是站长发布的站点设置（_data/site_ui.yml），由 <head> 里的脚本写到
  // data-published-site-font / data-published-loading-copy 上。这里不再读写浏览器存储；
  // setFont / setLoadingCopy 只在当前页面预览，发布由设置面板提交到仓库。
  function publishedFont() {
    const value = root.dataset.publishedSiteFont;
    return supportedFonts.has(value) ? value : "system";
  }

  function publishedLoadingCopy() {
    const value = root.dataset.publishedLoadingCopy;
    return Object.hasOwn(loadingCopy, value) ? value : "thinking";
  }

  // Roboto、Roboto Slab、Atkinson Hyperlegible 来自 Google Fonts：只有选了这些字体才加载，
  // 系统字体用不到它（国内也常常连不上），构建时已把它从 <head> 里拿掉，换成一个 <meta> 记着地址。
  const googleFonts = new Set(["anthropic-serif", "anthropic-sans", "dyslexic"]);
  // 霞鹜文楷（SIL OFL 1.1）：字体文件按字切片、按 unicode-range 取用，页面只下载用到的字；
  // 加载不到时退回系统楷体。和 Google Fonts 一样，只有选了它才会请求。
  const fontStylesheets = Object.freeze({
    wenkai: [
      "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css",
      "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-bold.css",
    ],
  });

  function ensureFontStylesheet(font) {
    (fontStylesheets[font] || []).forEach((href) => {
      if (document.querySelector(`link[data-font-stylesheet="${font}"][href="${href}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.fontStylesheet = font;
      document.head.append(link);
    });
    if (!googleFonts.has(font) || document.querySelector("link[data-google-fonts]")) return;
    const href = document.querySelector('meta[name="functionhx:google-fonts"]')?.content;
    if (!href) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.googleFonts = "";
    document.head.append(link);
  }

  function setFont(value) {
    const font = supportedFonts.has(value) ? value : "system";
    ensureFontStylesheet(font);
    root.dataset.siteFont = font;
    window.dispatchEvent(new CustomEvent("functionhx:font-changed", { detail: { font } }));
    return font;
  }

  function setLoadingCopy(value) {
    const choice = Object.hasOwn(loadingCopy, value) ? value : "thinking";
    root.dataset.loadingCopy = choice;
    loader?.querySelector(".sr-only")?.replaceChildren(loadingCopy[choice]);
    document.querySelectorAll("[data-loading-placeholder]").forEach((element) => {
      element.textContent = loadingCopy[choice];
    });
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
      // Dropdowns and other in-page controls cancel navigation later in the
      // event. Wait for their handlers before covering the page with a loader.
      window.setTimeout(() => {
        if (navigatesThisPage(anchor, event)) showLoading();
      }, 0);
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
    getFont: () => root.dataset.siteFont || publishedFont(),
    getLoadingCopy: () => root.dataset.loadingCopy || publishedLoadingCopy(),
    getPublishedFont: publishedFont,
    getPublishedLoadingCopy: publishedLoadingCopy,
    getLoadingText: () => loadingCopy[root.dataset.loadingCopy] || loadingCopy.thinking,
    hideLoading,
    loaderTiming: Object.freeze({ delay: loaderDelay, minimumVisible: loaderMinimumVisible }),
    setFont,
    setLoadingCopy,
    showLoading,
  });

  root.dataset.siteFont = supportedFonts.has(root.dataset.siteFont) ? root.dataset.siteFont : publishedFont();
  root.dataset.loadingCopy = Object.hasOwn(loadingCopy, root.dataset.loadingCopy) ? root.dataset.loadingCopy : publishedLoadingCopy();
  loader?.querySelector(".sr-only")?.replaceChildren(loadingCopy[root.dataset.loadingCopy]);
  document.querySelectorAll("[data-loading-placeholder]").forEach((element) => {
    element.textContent = loadingCopy[root.dataset.loadingCopy];
  });
  ensureFontStylesheet(publishedFont());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hideLoading, { once: true });
  else hideLoading();
})();
