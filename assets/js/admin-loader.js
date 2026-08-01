(function initializeAdminLoader() {
  "use strict";

  const scriptElement = document.currentScript;
  const assetRoot = scriptElement?.src.replace(/\/assets\/js\/admin-loader\.js(?:\?.*)?$/, "") || window.location.origin;
  const loadedFeatures = new Set();
  const featurePromises = new Map();

  const features = {
    editor: {
      styles: ["deployment-monitor.css", "deepseek-translator.css", "inline-editor.css"],
      scripts: ["github-auth-vault.js", "deployment-monitor.js", "deepseek-translator.js", "inline-editor.js"],
    },
    monitor: {
      styles: ["deployment-monitor.css"],
      scripts: ["deployment-monitor.js"],
    },
    settings: {
      styles: ["deployment-monitor.css", "deepseek-translator.css", "site-settings.css"],
      scripts: ["github-auth-vault.js", "deployment-monitor.js", "deepseek-translator.js", "site-settings.js"],
    },
    spark: {
      styles: ["deployment-monitor.css", "deepseek-translator.css"],
      scripts: ["github-auth-vault.js", "deployment-monitor.js", "deepseek-translator.js", "spark-vault-client.js", "spark-writer.js"],
    },
  };

  function assetUrl(kind, filename) {
    return `${assetRoot}/assets/${kind}/${filename}`;
  }

  function loadStyle(filename) {
    const source = assetUrl("css", filename);
    const existing = [...document.styleSheets].some((sheet) => sheet.href === source);
    if (existing) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = source;
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", () => reject(new Error(`Could not load ${filename}.`)), { once: true });
      document.head.append(link);
    });
  }

  function loadScript(filename) {
    const source = assetUrl("js", filename);
    const existing = document.querySelector(`script[src="${source}"]`);
    if (existing?.dataset.loaded === "true") return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "true";
          resolve();
        },
        { once: true }
      );
      script.addEventListener("error", () => reject(new Error(`Could not load ${filename}.`)), { once: true });
      document.body.append(script);
    });
  }

  function loadFeature(feature) {
    if (loadedFeatures.has(feature)) return Promise.resolve();
    if (featurePromises.has(feature)) return featurePromises.get(feature);

    const definition = features[feature];
    if (!definition) return Promise.reject(new Error(`Unknown admin feature: ${feature}`));

    const promise = Promise.all(definition.styles.map(loadStyle))
      .then(() => definition.scripts.reduce((sequence, filename) => sequence.then(() => loadScript(filename)), Promise.resolve()))
      .then(() => loadedFeatures.add(feature))
      .catch((error) => {
        featurePromises.delete(feature);
        throw error;
      });
    featurePromises.set(feature, promise);
    return promise;
  }

  function adminTrigger(target) {
    if (!(target instanceof Element)) return null;
    return target.closest(
      "#site-settings-toggle, #site-inline-editor-toggle, .site-spark-create, .site-spark-drafts-toggle, .site-spark-edit-trigger"
    );
  }

  function featureFor(trigger) {
    if (trigger.id === "site-settings-toggle") return "settings";
    if (
      trigger.classList.contains("site-spark-create") ||
      trigger.classList.contains("site-spark-drafts-toggle") ||
      trigger.classList.contains("site-spark-edit-trigger") ||
      (trigger.dataset.editorAction || "").startsWith("spark-")
    ) {
      return "spark";
    }
    return "editor";
  }

  function prepareFromEvent(event) {
    const trigger = adminTrigger(event.target);
    if (!trigger) return;
    loadFeature(featureFor(trigger)).catch(() => undefined);
  }

  document.addEventListener("pointerover", prepareFromEvent, { capture: true, passive: true });
  document.addEventListener("focusin", prepareFromEvent, true);
  document.addEventListener(
    "click",
    (event) => {
      const trigger = adminTrigger(event.target);
      if (!trigger) return;

      const feature = featureFor(trigger);
      if (loadedFeatures.has(feature)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      trigger.setAttribute("aria-busy", "true");
      loadFeature(feature)
        .then(() => {
          trigger.removeAttribute("aria-busy");
          if (trigger.isConnected) trigger.click();
        })
        .catch((error) => {
          trigger.removeAttribute("aria-busy");
          console.error(error);
        });
    },
    true
  );

  try {
    const hasActiveDeployment = Object.keys(window.localStorage).some((key) => key.startsWith("functionhx:deployment:"));
    if (hasActiveDeployment) loadFeature("monitor").catch(() => undefined);
  } catch (_error) {
    // Private browsing modes may disable localStorage; editing still loads on demand.
  }
})();
