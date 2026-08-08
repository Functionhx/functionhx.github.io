(function initializeAdminLoader() {
  "use strict";

  const scriptElement = document.currentScript;
  const loaderUrl = new URL(scriptElement?.src || "/assets/js/admin-loader.js", window.location.href);
  const assetRoot = loaderUrl.href.replace(/\/assets\/js\/admin-loader\.js(?:\?.*)?$/, "") || window.location.origin;
  const assetVersion = loaderUrl.search;
  const loadedFeatures = new Set();
  const featurePromises = new Map();
  const loadedAssets = new Set();
  const resourcePromises = new Map();
  const pendingTriggers = new WeakSet();
  const pendingFeatures = new Set();

  const features = {
    creator: {
      styles: ["deployment-monitor.css", "deepseek-translator.css", "content-creator.css"],
      scripts: ["github-auth-vault.js", "deployment-monitor.js", "deepseek-translator.js", "content-creator.js"],
    },
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
    feishuDocuments: {
      styles: [],
      scripts: ["github-auth-vault.js", "spark-vault-client.js", "feishu-documents.js"],
    },
  };

  function assetUrl(kind, filename) {
    return `${assetRoot}/assets/${kind}/${filename}${assetVersion}`;
  }

  function statusRegion() {
    let region = document.getElementById("site-admin-load-status");
    if (region) return region;
    region = document.createElement("div");
    region.id = "site-admin-load-status";
    region.className = "site-admin-load-status";
    region.hidden = true;
    region.setAttribute("aria-atomic", "true");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    document.body.append(region);
    return region;
  }

  function setLoadStatus(message = "", state = "") {
    const region = statusRegion();
    region.textContent = message;
    region.dataset.state = state;
    region.hidden = !message;
  }

  function stylesheetIsLoaded(source) {
    return [...document.styleSheets].some((sheet) => sheet.href === source);
  }

  function loadStyle(filename) {
    const source = assetUrl("css", filename);
    if (loadedAssets.has(source) || stylesheetIsLoaded(source)) {
      loadedAssets.add(source);
      return Promise.resolve();
    }
    if (resourcePromises.has(source)) return resourcePromises.get(source);

    const promise = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = source;
      link.dataset.adminAsset = filename;
      link.addEventListener(
        "load",
        () => {
          link.dataset.loaded = "true";
          loadedAssets.add(source);
          resolve();
        },
        { once: true }
      );
      link.addEventListener(
        "error",
        () => {
          link.remove();
          resourcePromises.delete(source);
          reject(new Error(`Could not load ${filename}.`));
        },
        { once: true }
      );
      document.head.append(link);
    });
    resourcePromises.set(source, promise);
    return promise;
  }

  function loadScript(filename) {
    const source = assetUrl("js", filename);
    if (loadedAssets.has(source)) return Promise.resolve();
    if (resourcePromises.has(source)) return resourcePromises.get(source);

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.dataset.adminAsset = filename;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "true";
          loadedAssets.add(source);
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          script.remove();
          resourcePromises.delete(source);
          reject(new Error(`Could not load ${filename}.`));
        },
        { once: true }
      );
      document.body.append(script);
    });
    resourcePromises.set(source, promise);
    return promise;
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

  async function restoreVerifiedOwner() {
    if (document.documentElement.dataset.ownerRestore !== "true") return;
    try {
      await loadScript("github-auth-vault.js");
      const session = await window.functionhxGitHubAuth?.restore({ owner: "Functionhx", repository: "Functionhx/functionhx.github.io" });
      if (!session?.token) {
        // A lazy restore can finish after another authoring surface has already
        // completed a fresh verification. Never let that stale empty result
        // revoke the newer owner state or collapse an active editing session.
        if (document.documentElement.dataset.ownerVerified !== "true") {
          window.functionhxOwnerUi?.setVerified?.(false);
        }
        return;
      }

      // Decrypting a remembered AES-GCM vault record is sufficient to restore
      // this device's authoring UI. GitHub still validates every write, while
      // the identity request below can revoke the local UI when the credential
      // is explicitly invalid. A temporary GitHub/network outage must not make
      // a trusted device lose its pencil on every page load.
      window.functionhxOwnerUi?.setVerified?.(true, session.remembered === true);

      const response = await window.fetch("https://api.github.com/user", {
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${session.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (response.status === 401) {
        await window.functionhxGitHubAuth?.forget({ repository: "Functionhx/functionhx.github.io" });
        window.functionhxOwnerUi?.setVerified?.(false);
        return;
      }
      if (!response.ok) throw new Error(`Could not verify the saved GitHub session (${response.status}).`);
      const user = await response.json();
      if (String(user.login || "").toLowerCase() !== "functionhx") {
        await window.functionhxGitHubAuth?.forget({ repository: "Functionhx/functionhx.github.io" });
        window.functionhxOwnerUi?.setVerified?.(false);
        return;
      }
      window.functionhxOwnerUi?.setVerified?.(true, session.remembered === true);
    } catch (error) {
      // A transient network or asset failure must not erase a valid encrypted
      // credential. The hint remains so a later navigation can retry quietly.
      console.warn("Could not restore the owner controls.", error);
    }
  }

  function adminTrigger(target) {
    if (!(target instanceof Element)) return null;
    return target.closest("#site-settings-toggle, [data-author-action], .site-spark-create, .site-spark-drafts-toggle, .site-spark-edit-trigger");
  }

  function featureFor(trigger) {
    if (trigger.id === "site-settings-toggle") return "settings";
    const authorAction = trigger.dataset.authorAction || "";
    if (authorAction === "feishu-document-create") return "feishuDocuments";
    if (authorAction === "source-edit") return "editor";
    if (["article-create", "tool-create", "project-create", "activity-create"].includes(authorAction)) return "creator";
    if (
      authorAction.startsWith("spark-") ||
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

  function loadOwnerContext() {
    const context = document.getElementById("site-inline-editor-toggle")?.dataset.authorContext || "";
    if (context !== "documents") return;
    loadFeature("feishuDocuments").catch(() => {
      setLoadStatus("站长文档库暂时没有载入。请重新点击铅笔后重试。", "error");
    });
  }

  document.addEventListener("pointerover", prepareFromEvent, { capture: true, passive: true });
  document.addEventListener("focusin", prepareFromEvent, true);
  window.addEventListener("functionhx:owner-mode-changed", (event) => {
    if (event.detail?.active === true) loadOwnerContext();
  });
  document.addEventListener(
    "click",
    (event) => {
      const trigger = adminTrigger(event.target);
      if (!trigger) return;

      const feature = featureFor(trigger);
      if (loadedFeatures.has(feature)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (pendingTriggers.has(trigger) || pendingFeatures.has(feature)) return;
      pendingTriggers.add(trigger);
      pendingFeatures.add(feature);
      trigger.setAttribute("aria-busy", "true");
      setLoadStatus();
      window.functionhxSitePreferences?.showLoading?.();
      loadFeature(feature)
        .then(() => {
          window.functionhxSitePreferences?.hideLoading?.();
          trigger.removeAttribute("aria-busy");
          pendingTriggers.delete(trigger);
          pendingFeatures.delete(feature);
          setLoadStatus();
          if (trigger.isConnected) trigger.click();
        })
        .catch((error) => {
          window.functionhxSitePreferences?.hideLoading?.();
          trigger.removeAttribute("aria-busy");
          pendingTriggers.delete(trigger);
          pendingFeatures.delete(feature);
          setLoadStatus("创作工具暂时没有载入。请再次点按原按钮重试。", "error");
          console.error(error);
        });
    },
    true
  );

  restoreVerifiedOwner();

  try {
    const hasActiveDeployment = Object.keys(window.localStorage).some((key) => key.startsWith("functionhx:deployment:"));
    if (hasActiveDeployment) loadFeature("monitor").catch(() => undefined);
  } catch (_error) {
    // Private browsing modes may disable localStorage; editing still loads on demand.
  }

  if (new URLSearchParams(window.location.search).get("compose") === "1" && document.getElementById("site-spark-writer")) {
    loadFeature("spark").catch(() => undefined);
  }
})();
