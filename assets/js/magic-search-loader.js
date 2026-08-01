(() => {
  const script = document.currentScript;
  if (!script) return;

  const config = {
    language: script.dataset.language === "en" ? "en" : "zh",
    indexUrl: script.dataset.indexUrl,
    moduleUrl: script.dataset.moduleUrl,
    stylesheetUrl: script.dataset.stylesheetUrl,
    fallbackUrl: script.dataset.fallbackUrl,
  };
  let modulePromise;

  const ensureStylesheet = () => {
    if (document.querySelector('link[data-magic-search-stylesheet="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = config.stylesheetUrl;
    link.dataset.magicSearchStylesheet = "true";
    document.head.append(link);
  };

  const loadSearch = () => {
    ensureStylesheet();
    modulePromise ||= import(config.moduleUrl);
    return modulePromise;
  };

  const openSearch = async (initialQuery = "") => {
    try {
      const search = await loadSearch();
      await search.open(config, initialQuery);
    } catch (_error) {
      window.location.assign(config.fallbackUrl);
    }
  };

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("#search-toggle, [data-magic-search-open]");
    if (!trigger) return;
    event.preventDefault();
    openSearch(trigger.dataset.magicSearchQuery || "");
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });

  window.functionhxMagicSearch = { open: openSearch };

  const autoStart = document.querySelector("[data-magic-search-autostart]");
  if (autoStart) {
    const query = new URL(window.location.href).searchParams.get("q") || "";
    openSearch(query);
  }
})();
