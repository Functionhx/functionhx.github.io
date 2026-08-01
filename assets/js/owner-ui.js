(function initializeOwnerUi() {
  "use strict";

  const repository = "Functionhx/functionhx.github.io";
  const vaultHintKey = "functionhx:owner-ui:vault-hint";
  const toggle = document.getElementById("site-inline-editor-toggle");
  const menu = document.getElementById("site-author-menu");

  // Legacy booleans were only visual hints and could be forged or become stale.
  // Owner-only controls now wait for the encrypted vault/auth flow to announce a
  // real connection. GitHub still enforces every write independently.
  delete document.documentElement.dataset.ownerVerified;
  try {
    window.sessionStorage.removeItem("functionhx:owner-ui:session");
    window.localStorage.removeItem("functionhx:owner-ui:remembered");
  } catch (_error) {
    // Storage can be unavailable; clearing the DOM marker is sufficient.
  }

  function setVaultHint(enabled) {
    try {
      if (enabled) window.localStorage.setItem(vaultHintKey, "true");
      else window.localStorage.removeItem(vaultHintKey);
    } catch (_error) {
      // The current verified state still applies when storage is unavailable.
    }
  }

  function setVerified(connected, remembered = false) {
    if (connected) {
      document.documentElement.dataset.ownerVerified = "true";
      delete document.documentElement.dataset.ownerRestore;
      setVaultHint(remembered === true);
    } else {
      delete document.documentElement.dataset.ownerVerified;
      delete document.documentElement.dataset.ownerRestore;
      setVaultHint(false);
      closeMenu();
    }
  }

  function menuItems() {
    if (!menu || menu.hidden) return [];
    return [...menu.querySelectorAll('[role="menuitem"]')].filter(
      (item) => !item.hidden && !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true"
    );
  }

  function closeMenu(focus = false) {
    if (!toggle || !menu) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (focus) toggle.focus();
  }

  function openMenu(focus = "") {
    if (!toggle || !menu) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    const items = menuItems();
    if (focus === "first") items[0]?.focus();
    if (focus === "last") items.at(-1)?.focus();
  }

  function closePrimaryNavigation() {
    const panel = document.getElementById("navbarNav");
    if (!panel?.classList.contains("show")) return;
    panel.classList.remove("show");
    document.querySelectorAll('[data-nav-toggle="navbarNav"], [aria-controls="navbarNav"]').forEach((navToggle) => {
      navToggle.classList.add("collapsed");
      navToggle.setAttribute("aria-expanded", "false");
    });
  }

  function isAuthorIntent(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        '[data-author-action], .site-spark-create, .site-spark-drafts-toggle, .site-spark-edit-trigger, a[href*="/spark/"][href*="compose=1"]'
      )
    );
  }

  if (toggle && menu) {
    toggle.addEventListener("click", (event) => {
      if (menu.hidden) openMenu(event.detail === 0 ? "first" : "");
      else closeMenu();
    });

    toggle.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      openMenu(event.key === "ArrowUp" || event.key === "End" ? "last" : "first");
    });

    menu.addEventListener("click", (event) => {
      if (event.target.closest("[data-author-action], a[href]")) closeMenu();
    });

    menu.addEventListener("keydown", (event) => {
      const items = menuItems();
      if (!items.length) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement);
      let nextIndex = 0;
      if (event.key === "End") nextIndex = items.length - 1;
      else if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      else if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    });

    document.addEventListener("click", (event) => {
      if (menu.hidden || event.target.closest(".site-author-nav")) return;
      closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) closeMenu(true);
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      if (isAuthorIntent(event.target)) closePrimaryNavigation();
    },
    true
  );

  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (String(event.detail?.repository || "").toLowerCase() !== repository.toLowerCase()) return;
    setVerified(event.detail.connected === true, event.detail.remembered === true);
  });

  window.functionhxOwnerUi = Object.freeze({ closeMenu, closePrimaryNavigation, setVerified });
})();
