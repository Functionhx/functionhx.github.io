(function initializeOwnerUi() {
  "use strict";

  const repository = "Functionhx/functionhx.github.io";
  const vaultHintKey = "functionhx:owner-ui:vault-hint";
  const launcherPositionKey = "functionhx:owner-ui:launcher-position:v1";
  const toggle = document.getElementById("site-inline-editor-toggle");
  const menu = document.getElementById("site-author-menu");
  const launcher = toggle?.closest(".site-author-nav") || null;
  const dragThreshold = 6;
  let baseNavbarBottom = null;
  let dragState = null;
  let suppressNextPointerClick = false;
  let resizeFrame = 0;
  const visitorToggleLabel = toggle?.getAttribute("aria-label") || "打开站长创作菜单";
  const visitorToggleTitle = toggle?.getAttribute("title") || "创作与编辑";

  // Legacy booleans were only visual hints and could be forged or become stale.
  // Owner-only controls now wait for the encrypted vault/auth flow to announce a
  // real connection. GitHub still enforces every write independently.
  delete document.documentElement.dataset.ownerVerified;
  delete document.documentElement.dataset.ownerMode;
  try {
    window.sessionStorage.removeItem("functionhx:owner-ui:session");
    window.localStorage.removeItem("functionhx:owner-ui:remembered");
  } catch (_error) {
    // Storage can be unavailable; clearing the DOM marker is sufficient.
  }

  function syncContextualOwnerControls(enabled) {
    document.querySelectorAll("[data-owner-context-control]").forEach((control) => {
      control.hidden = enabled !== true;
    });
  }

  syncContextualOwnerControls(false);

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
      window.requestAnimationFrame(restoreLauncherPosition);
    } else {
      setOwnerMode(false);
      delete document.documentElement.dataset.ownerVerified;
      delete document.documentElement.dataset.ownerRestore;
      setVaultHint(false);
    }
  }

  function ownerModeIsActive() {
    return document.documentElement.dataset.ownerMode === "true";
  }

  function setOwnerMode(active, { focus = false } = {}) {
    const enabled = active === true && document.documentElement.dataset.ownerVerified === "true";
    if (enabled) document.documentElement.dataset.ownerMode = "true";
    else delete document.documentElement.dataset.ownerMode;
    syncContextualOwnerControls(enabled);
    if (toggle) {
      toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
      toggle.setAttribute("aria-label", enabled ? "站长模式已开启；打开创作菜单" : visitorToggleLabel);
      toggle.setAttribute("title", enabled ? "站长模式" : visitorToggleTitle);
    }
    if (!enabled) closeMenu();
    window.dispatchEvent(new CustomEvent("functionhx:owner-mode-changed", { detail: { active: enabled } }));
    if (focus) window.requestAnimationFrame(() => toggle?.focus());
    return enabled;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function readSafeAreaInsets() {
    if (!document.body) return { bottom: 0, left: 0, right: 0, top: 0 };
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px)";
    document.body.append(probe);
    const styles = window.getComputedStyle(probe);
    const insets = {
      bottom: Number.parseFloat(styles.paddingBottom) || 0,
      left: Number.parseFloat(styles.paddingLeft) || 0,
      right: Number.parseFloat(styles.paddingRight) || 0,
      top: Number.parseFloat(styles.paddingTop) || 0,
    };
    probe.remove();
    return insets;
  }

  function navbarBottom() {
    const navbar = document.getElementById("navbar");
    if (!navbar) return 0;
    const navigationPanel = document.getElementById("navbarNav");
    if (baseNavbarBottom == null || !navigationPanel?.classList.contains("show")) {
      baseNavbarBottom = navbar.getBoundingClientRect().bottom;
    }
    return baseNavbarBottom;
  }

  function viewportBounds() {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    return { bottom: top + height, height, left, right: left + width, top, width };
  }

  function launcherConstraints() {
    if (!launcher || !toggle) return null;
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const mobile = window.matchMedia("(max-width: 575.98px)").matches;
    const edgeGap = rootFontSize * (mobile ? 0.65 : 0.75);
    const navbarGap = rootFontSize * (mobile ? 0.4 : 0.55);
    const safeArea = readSafeAreaInsets();
    const viewport = viewportBounds();
    const toggleRect = toggle.getBoundingClientRect();
    const width = toggleRect.width || toggle.offsetWidth || rootFontSize * 2.6;
    const height = toggleRect.height || toggle.offsetHeight || rootFontSize * 2.6;
    const minimumX = viewport.left + Math.max(edgeGap, safeArea.left);
    const minimumY = Math.max(navbarBottom() + navbarGap, viewport.top + safeArea.top + edgeGap);
    const bottomInset = Math.max(edgeGap, safeArea.bottom);
    const rightInset = Math.max(edgeGap, safeArea.right);
    const maximumX = Math.max(minimumX, viewport.right - width - rightInset);
    const maximumY = Math.max(minimumY, viewport.bottom - height - bottomInset);
    return { bottomInset, height, maximumX, maximumY, minimumX, minimumY, rightInset, viewport, width };
  }

  function placeLauncher(left, top, constraints = launcherConstraints()) {
    if (!launcher || !constraints) return;
    const nextLeft = clamp(left, constraints.minimumX, constraints.maximumX);
    const nextTop = clamp(top, constraints.minimumY, constraints.maximumY);
    launcher.dataset.positioned = "true";
    launcher.style.left = `${nextLeft.toFixed(2)}px`;
    launcher.style.right = "auto";
    launcher.style.top = `${nextTop.toFixed(2)}px`;
  }

  function readLauncherPosition() {
    try {
      const value = JSON.parse(window.localStorage.getItem(launcherPositionKey) || "null");
      if (value?.version !== 1 || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
      return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
    } catch (_error) {
      return null;
    }
  }

  function normalizedLauncherPosition(constraints = launcherConstraints()) {
    if (!launcher || !constraints) return null;
    const rect = launcher.getBoundingClientRect();
    const horizontalRange = constraints.maximumX - constraints.minimumX;
    const verticalRange = constraints.maximumY - constraints.minimumY;
    return {
      version: 1,
      x: horizontalRange > 0 ? clamp((rect.left - constraints.minimumX) / horizontalRange, 0, 1) : 0,
      y: verticalRange > 0 ? clamp((rect.top - constraints.minimumY) / verticalRange, 0, 1) : 0,
    };
  }

  function saveLauncherPosition() {
    const value = normalizedLauncherPosition();
    if (!value) return;
    try {
      window.localStorage.setItem(launcherPositionKey, JSON.stringify(value));
    } catch (_error) {
      // Dragging still works when local storage is unavailable.
    }
  }

  function restoreLauncherPosition() {
    if (!launcher || !toggle || toggle.getBoundingClientRect().width === 0) return;
    const saved = readLauncherPosition();
    if (!saved) return;
    const constraints = launcherConstraints();
    if (!constraints) return;
    placeLauncher(
      constraints.minimumX + saved.x * (constraints.maximumX - constraints.minimumX),
      constraints.minimumY + saved.y * (constraints.maximumY - constraints.minimumY),
      constraints
    );
  }

  function placeMenu() {
    if (!launcher || !toggle || !menu || menu.hidden) return;
    const constraints = launcherConstraints();
    if (!constraints) return;
    const toggleRect = toggle.getBoundingClientRect();
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const menuGap = rootFontSize * 0.5;
    menu.style.maxHeight = "";
    menu.style.maxWidth = "";
    menu.style.minWidth = "";
    const belowSpace = Math.max(0, constraints.viewport.bottom - constraints.bottomInset - toggleRect.bottom - menuGap);
    const aboveSpace = Math.max(0, toggleRect.top - constraints.minimumY - menuGap);
    const preferredHeight = Math.min(menu.scrollHeight, constraints.viewport.height * 0.7);
    const placeAbove = belowSpace < preferredHeight && aboveSpace > belowSpace;
    const availableHeight = placeAbove ? aboveSpace : belowSpace;
    launcher.dataset.menuVertical = placeAbove ? "above" : "below";
    menu.style.maxHeight = `${Math.max(0, Math.min(constraints.viewport.height * 0.7, availableHeight)).toFixed(2)}px`;

    const menuWidth = menu.getBoundingClientRect().width;
    const spaceToLeft = toggleRect.right - constraints.minimumX;
    const spaceToRight = constraints.viewport.right - constraints.rightInset - toggleRect.left;
    const alignRight = menuWidth <= spaceToLeft || spaceToLeft >= spaceToRight;
    const availableWidth = Math.max(0, alignRight ? spaceToLeft : spaceToRight);
    launcher.dataset.menuHorizontal = alignRight ? "right" : "left";
    menu.style.maxWidth = `${availableWidth.toFixed(2)}px`;
    menu.style.minWidth = `${Math.min(rootFontSize * 12.5, availableWidth).toFixed(2)}px`;
  }

  function moveLauncherWithKeyboard(event) {
    if (!event.shiftKey || !["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Home"].includes(event.key)) return false;
    event.preventDefault();
    const constraints = launcherConstraints();
    const rect = launcher?.getBoundingClientRect();
    if (!constraints || !rect) return true;
    closeMenu();
    if (event.key === "Home") placeLauncher(constraints.maximumX, constraints.minimumY, constraints);
    else {
      const step = event.altKey ? 1 : 16;
      const horizontal = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const vertical = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      placeLauncher(rect.left + horizontal, rect.top + vertical, constraints);
    }
    saveLauncherPosition();
    return true;
  }

  function clampLauncherToViewport() {
    if (!launcher || !toggle || toggle.getBoundingClientRect().width === 0) return;
    const saved = readLauncherPosition();
    if (saved) restoreLauncherPosition();
    else if (launcher.dataset.positioned === "true") {
      const rect = launcher.getBoundingClientRect();
      placeLauncher(rect.left, rect.top);
    }
    placeMenu();
  }

  function scheduleViewportClamp() {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(clampLauncherToViewport);
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
    placeMenu();
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
    toggle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      const rect = launcher?.getBoundingClientRect();
      if (!rect) return;
      dragState = {
        active: false,
        constraints: launcherConstraints(),
        pointerId: event.pointerId,
        startLeft: rect.left,
        startTop: rect.top,
        startX: event.clientX,
        startY: event.clientY,
      };
      try {
        toggle.setPointerCapture?.(event.pointerId);
      } catch (_error) {
        // Synthetic pointer events may not have a capturable active pointer.
      }
    });

    toggle.addEventListener("pointermove", (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!dragState.active && Math.hypot(deltaX, deltaY) < dragThreshold) return;
      if (!dragState.active) {
        dragState.active = true;
        launcher.dataset.dragging = "true";
        closeMenu();
      }
      event.preventDefault();
      placeLauncher(dragState.startLeft + deltaX, dragState.startTop + deltaY, dragState.constraints);
    });

    function finishDrag(event) {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const wasDragging = dragState.active;
      dragState = null;
      delete launcher.dataset.dragging;
      try {
        if (toggle.hasPointerCapture?.(event.pointerId)) toggle.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // Pointer capture may already be gone after a cancellation.
      }
      if (!wasDragging) return;
      event.preventDefault();
      suppressNextPointerClick = event.type === "pointerup";
      window.setTimeout(() => {
        suppressNextPointerClick = false;
      }, 0);
      saveLauncherPosition();
    }

    toggle.addEventListener("pointerup", finishDrag);
    toggle.addEventListener("pointercancel", finishDrag);
    toggle.addEventListener("lostpointercapture", finishDrag);

    toggle.addEventListener("click", (event) => {
      if (event.detail > 0 && suppressNextPointerClick) {
        suppressNextPointerClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!ownerModeIsActive()) {
        setOwnerMode(true);
        openMenu(event.detail === 0 ? "first" : "");
        return;
      }
      if (menu.hidden) openMenu(event.detail === 0 ? "first" : "");
      else closeMenu();
    });

    toggle.addEventListener("keydown", (event) => {
      if (moveLauncherWithKeyboard(event)) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (!ownerModeIsActive()) setOwnerMode(true);
      openMenu(event.key === "ArrowUp" || event.key === "End" ? "last" : "first");
    });

    menu.addEventListener("click", (event) => {
      if (event.target.closest("[data-owner-mode-exit]")) {
        event.preventDefault();
        setOwnerMode(false, { focus: true });
        return;
      }
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

  window.addEventListener("resize", scheduleViewportClamp, { passive: true });
  window.addEventListener("orientationchange", scheduleViewportClamp, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleViewportClamp, { passive: true });
  window.requestAnimationFrame(restoreLauncherPosition);

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

  window.functionhxOwnerUi = Object.freeze({ closeMenu, closePrimaryNavigation, ownerModeIsActive, setOwnerMode, setVerified });
})();
