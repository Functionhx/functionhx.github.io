(function initializeOwnerUi() {
  "use strict";

  const repository = "Functionhx/functionhx.github.io";
  const toggle = document.getElementById("site-inline-editor-toggle");
  const menu = document.getElementById("site-author-menu");

  function setVerified(connected, remembered = false) {
    try {
      if (connected) {
        window.sessionStorage.setItem("functionhx:owner-ui:session", "true");
        if (remembered) window.localStorage.setItem("functionhx:owner-ui:remembered", "true");
        document.documentElement.dataset.ownerVerified = "true";
      } else {
        window.sessionStorage.removeItem("functionhx:owner-ui:session");
        window.localStorage.removeItem("functionhx:owner-ui:remembered");
        delete document.documentElement.dataset.ownerVerified;
        closeMenu();
      }
    } catch (_error) {
      if (connected) document.documentElement.dataset.ownerVerified = "true";
      else delete document.documentElement.dataset.ownerVerified;
    }
  }

  function closeMenu(focus = false) {
    if (!toggle || !menu) return;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (focus) toggle.focus();
  }

  function openMenu() {
    if (!toggle || !menu) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    menu.addEventListener("click", (event) => {
      if (event.target.closest("[data-author-action], a[href]")) closeMenu();
    });

    document.addEventListener("click", (event) => {
      if (menu.hidden || event.target.closest(".site-author-nav")) return;
      closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) closeMenu(true);
    });
  }

  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (String(event.detail?.repository || "").toLowerCase() !== repository.toLowerCase()) return;
    setVerified(event.detail.connected === true, event.detail.remembered === true);
  });

  window.functionhxOwnerUi = Object.freeze({ closeMenu, setVerified });
})();
