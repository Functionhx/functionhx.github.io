(function initializeTurboMode() {
  "use strict";

  const root = document.documentElement;
  const trigger = document.querySelector("[data-turbo-trigger]");
  const canvas = document.getElementById("turbo-canvas");
  const cursor = document.getElementById("turbo-cursor");
  const status = document.getElementById("turbo-status");
  const bootScreen = document.getElementById("turbo-boot");

  if (!trigger || !canvas || !cursor || !status || !bootScreen) return;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const STORAGE_KEY = "functionhx:turbo-mode";
  const HOLD_DURATION = 680;
  const HOLD_MOVE_TOLERANCE = 14;
  const TRAIL_LIFE = 560;
  const RIPPLE_LIFE = 620;
  const MAX_TRAIL_POINTS = 56;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
  const INTERACTIVE_CURSOR_SELECTOR = [
    "a[href]",
    "button",
    "summary",
    "label",
    "[role='button']",
    "[role='link']",
    "input[type='button']",
    "input[type='submit']",
    "input[type='reset']",
    "input[type='checkbox']",
    "input[type='radio']",
  ].join(",");
  const NATIVE_CURSOR_SELECTOR = [
    "textarea",
    "select",
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
    "input:not([type])",
    "input[type='text']",
    "input[type='search']",
    "input[type='email']",
    "input[type='password']",
    "input[type='number']",
    "input[type='tel']",
    "input[type='url']",
    "input[type='date']",
    "input[type='datetime-local']",
    "input[type='month']",
    "input[type='time']",
    "input[type='week']",
  ].join(",");

  let active = root.dataset.turbo === "on";
  let reducedMotion = reducedMotionQuery.matches;
  let frameRequest = 0;
  let previousFrame = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let pixelRatio = 1;
  let holdTimer = 0;
  let holdPointerId = null;
  let holdStartX = 0;
  let holdStartY = 0;
  let holdCompleted = false;
  let suppressNextClick = false;
  let suppressClickTimer = 0;
  let statusTimer = 0;
  let bootTimer = 0;
  let palette = readPalette();
  // 光迹：最近走过的点（带时间戳），点击时的涟漪。只在鼠标动过之后才逐帧绘制，静止时画布不再重绘。
  let trail = [];
  let ripples = [];
  const pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    seen: false,
    interactive: false,
    nativeCursor: false,
  };

  // 颜色取自站点主题：强调色（紫）渐变到暖金。深色模式用叠加混合，让光迹更亮。
  function readPalette() {
    const styles = window.getComputedStyle(root);
    const theme = root.dataset.theme;
    return {
      accent: styles.getPropertyValue("--turbo-accent").trim() || "#6434b2",
      warm: styles.getPropertyValue("--turbo-warm").trim() || "#e08a3c",
      dark: theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches),
    };
  }

  function rgbOf(color) {
    const hex = String(color).replace("#", "");
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const value = Number.parseInt(full.slice(0, 6), 16);
    if (Number.isNaN(value)) return [100, 52, 178];
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function mixColor(from, to, amount, alpha) {
    const a = rgbOf(from);
    const b = rgbOf(to);
    const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * amount);
    return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha})`;
  }

  function resizeCanvas() {
    viewportWidth = Math.max(1, window.innerWidth);
    viewportHeight = Math.max(1, window.innerHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    const renderWidth = Math.floor(viewportWidth * pixelRatio);
    const renderHeight = Math.floor(viewportHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function clearCanvas() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function pushTrailPoint(x, y) {
    const now = window.performance.now();
    const last = trail[trail.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 2) return;
    // 速度（像素/毫秒）决定这一段光迹有多粗：快的时候粗而亮，慢下来就细。
    const speed = last ? Math.hypot(x - last.x, y - last.y) / Math.max(now - last.t, 1) : 0;
    trail.push({ x, y, t: now, speed: clamp(speed / 1.4, 0, 1) });
    if (trail.length > MAX_TRAIL_POINTS) trail.shift();
    startAnimation();
  }

  function addRipple(x, y) {
    ripples.push({ x, y, t: window.performance.now() });
    startAnimation();
  }

  // 一条长曝光似的光迹：头粗尾细，颜色从强调色慢慢过渡到暖金，随时间淡出。
  // 线段用平头线帽，免得相邻线段的端点叠在一起变成一粒粒珠子；发光单独画一层更宽更淡的。
  function drawTrail(now) {
    if (trail.length < 2) return;
    context.save();
    context.lineCap = "butt";
    context.globalCompositeOperation = palette.dark ? "lighter" : "source-over";
    [
      { widen: 3.4, alpha: palette.dark ? 0.2 : 0.12 },
      { widen: 1, alpha: palette.dark ? 0.92 : 0.8 },
    ].forEach((layer) => {
      for (let index = 1; index < trail.length; index += 1) {
        const from = trail[index - 1];
        const to = trail[index];
        const life = clamp(1 - (now - to.t) / TRAIL_LIFE, 0, 1);
        if (life <= 0) continue;
        const width = (1.4 + to.speed * 3.8) * Math.pow(life, 0.85) * layer.widen;
        context.strokeStyle = mixColor(palette.accent, palette.warm, 1 - life, layer.alpha * Math.pow(life, 1.3));
        context.lineWidth = Math.max(width, 0.4);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
      }
    });
    context.restore();
  }

  function drawRipples(now) {
    if (!ripples.length) return;
    context.save();
    context.globalCompositeOperation = palette.dark ? "lighter" : "source-over";
    ripples.forEach((ripple) => {
      const progress = clamp((now - ripple.t) / RIPPLE_LIFE, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      context.strokeStyle = mixColor(palette.accent, palette.warm, progress, 0.55 * (1 - progress));
      context.lineWidth = 1.6 * (1 - progress) + 0.4;
      context.beginPath();
      context.arc(ripple.x, ripple.y, 6 + eased * 38, 0, Math.PI * 2);
      context.stroke();
    });
    context.restore();
  }

  // 画一帧；返回还有没有东西在淡出（没有了就停掉逐帧重绘）。
  function drawScene() {
    clearCanvas();
    if (!active) return false;
    const now = window.performance.now();
    trail = trail.filter((point) => now - point.t < TRAIL_LIFE);
    ripples = ripples.filter((ripple) => now - ripple.t < RIPPLE_LIFE);
    drawTrail(now);
    drawRipples(now);
    return trail.length > 1 || ripples.length > 0;
  }

  function animate() {
    frameRequest = 0;
    if (!active || reducedMotion || document.hidden) return;
    if (drawScene()) frameRequest = window.requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (!active || reducedMotion || document.hidden) return;
    if (!frameRequest) frameRequest = window.requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (frameRequest) window.cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  }

  function isChinesePage() {
    return document.body.dataset.pageLanguage !== "en";
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function canUseTurboCursor() {
    return active && finePointerQuery.matches && !reducedMotion;
  }

  function setCursorVisible(visible) {
    cursor.dataset.visible = visible ? "true" : "false";
  }

  function setCursorPressed(pressed) {
    cursor.dataset.pressed = pressed ? "true" : "false";
  }

  function updateCursorTarget(target) {
    const element = target instanceof Element ? target : null;
    pointer.nativeCursor = Boolean(element?.closest(NATIVE_CURSOR_SELECTOR));
    pointer.interactive = !pointer.nativeCursor && Boolean(element?.closest(INTERACTIVE_CURSOR_SELECTOR));
    cursor.dataset.state = pointer.interactive ? "locked" : "tracking";
    cursor.style.setProperty("--turbo-cursor-core-x", `${pointer.x}px`);
    cursor.style.setProperty("--turbo-cursor-core-y", `${pointer.y}px`);
    cursor.style.setProperty("--turbo-cursor-ring-x", `${pointer.x}px`);
    cursor.style.setProperty("--turbo-cursor-ring-y", `${pointer.y}px`);

    if (!canUseTurboCursor() || pointer.nativeCursor) {
      setCursorVisible(false);
      setCursorPressed(false);
      return;
    }

    setCursorVisible(true);
  }

  function syncCursorCapability() {
    const enabled = canUseTurboCursor();
    root.dataset.turboCursor = enabled ? "enabled" : "native";
    if (!enabled || pointer.nativeCursor || !pointer.seen) {
      setCursorVisible(false);
      setCursorPressed(false);
      return;
    }
    updateCursorTarget(document.elementFromPoint(pointer.x, pointer.y));
  }

  function runBootSequence() {
    window.clearTimeout(bootTimer);
    root.dataset.turboBoot = "false";
    if (reducedMotion) return;
    // 光晕从触发按钮的位置漾开。
    const rect = trigger.getBoundingClientRect();
    root.style.setProperty("--turbo-boot-x", `${rect.left + rect.width / 2}px`);
    root.style.setProperty("--turbo-boot-y", `${rect.top + rect.height / 2}px`);
    window.requestAnimationFrame(() => {
      root.dataset.turboBoot = "true";
      bootTimer = window.setTimeout(() => {
        root.dataset.turboBoot = "false";
      }, 1000);
    });
  }

  function showStatus(isNowActive) {
    window.clearTimeout(statusTimer);
    const chinese = isChinesePage();
    if (isNowActive) {
      status.textContent = chinese
        ? `Turbo 已开启${reducedMotion ? "" : " · 按 Shift+T 关闭"}`
        : `Turbo on${reducedMotion ? "" : " · press Shift+T to exit"}`;
    } else {
      status.textContent = chinese ? "Turbo 已关闭" : "Turbo off";
    }
    status.dataset.visible = "true";
    statusTimer = window.setTimeout(() => {
      status.dataset.visible = "false";
    }, 2500);
  }

  function storePreference(isNowActive) {
    try {
      window.localStorage.setItem(STORAGE_KEY, isNowActive ? "on" : "off");
    } catch (_error) {
      // Turbo still works for this page when storage is unavailable.
    }
  }

  function setActive(nextActive, options = {}) {
    const { persist = true, announce = true, burst = false, boot = false } = options;
    active = Boolean(nextActive);
    root.dataset.turbo = active ? "on" : "off";
    trigger.dataset.turboActive = active ? "true" : "false";
    syncCursorCapability();
    if (persist) storePreference(active);

    stopAnimation();
    if (active) {
      palette = readPalette();
      resizeCanvas();
      if (burst && !reducedMotion) {
        const rect = trigger.getBoundingClientRect();
        addRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      if (boot) runBootSequence();
    } else {
      window.clearTimeout(bootTimer);
      root.dataset.turboBoot = "false";
      trail = [];
      ripples = [];
      clearCanvas();
    }

    if (announce) showStatus(active);
    window.dispatchEvent(new CustomEvent("functionhx:turbo-changed", { detail: { active } }));
  }

  function toggleTurbo(options = {}) {
    setActive(!active, options);
  }

  function clearHold() {
    window.clearTimeout(holdTimer);
    holdTimer = 0;
    holdPointerId = null;
    trigger.classList.remove("is-turbo-charging");
  }

  function startHold(event) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;

    clearHold();
    holdPointerId = event.pointerId;
    holdStartX = event.clientX;
    holdStartY = event.clientY;
    holdCompleted = false;
    trigger.classList.add("is-turbo-charging");

    if (typeof trigger.setPointerCapture === "function") {
      try {
        trigger.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Pointer capture is optional; the document listeners still cancel safely.
      }
    }

    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      holdCompleted = true;
      suppressNextClick = true;
      window.clearTimeout(suppressClickTimer);
      suppressClickTimer = window.setTimeout(() => {
        suppressNextClick = false;
      }, 1000);
      trigger.classList.remove("is-turbo-charging");
      toggleTurbo({ burst: !active, boot: !active });
      if (window.navigator.vibrate) window.navigator.vibrate([24, 24, 32]);
    }, HOLD_DURATION);
  }

  function moveHold(event) {
    if (event.pointerId !== holdPointerId || !holdTimer) return;
    if (Math.hypot(event.clientX - holdStartX, event.clientY - holdStartY) > HOLD_MOVE_TOLERANCE) clearHold();
  }

  function endHold(event) {
    if (event.pointerId !== holdPointerId && holdPointerId !== null) return;
    const pointerId = holdPointerId;
    clearHold();
    if (pointerId !== null && typeof trigger.releasePointerCapture === "function") {
      try {
        trigger.releasePointerCapture(pointerId);
      } catch (_error) {
        // The pointer may already have been released by the browser.
      }
    }
  }

  function suppressHeldClick(event) {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    window.clearTimeout(suppressClickTimer);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']"));
  }

  trigger.addEventListener("pointerdown", startHold);
  trigger.addEventListener("pointermove", moveHold);
  trigger.addEventListener("pointerup", endHold);
  trigger.addEventListener("pointercancel", endHold);
  trigger.addEventListener("lostpointercapture", endHold);
  trigger.addEventListener("click", suppressHeldClick, true);
  trigger.addEventListener("contextmenu", (event) => {
    if (holdCompleted || holdTimer) event.preventDefault();
    holdCompleted = false;
  });

  document.addEventListener("keydown", (event) => {
    if (!event.shiftKey || event.code !== "KeyT" || event.repeat || isEditableTarget(event.target)) return;
    event.preventDefault();
    toggleTurbo({ burst: !active, boot: !active });
  });

  document.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.seen = true;
      updateCursorTarget(event.target);
      if (!active || reducedMotion || pointer.nativeCursor) return;
      pushTrailPoint(event.clientX, event.clientY);
    },
    { passive: true }
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || !canUseTurboCursor() || pointer.nativeCursor) return;
      setCursorPressed(true);
      addRipple(event.clientX, event.clientY);
    },
    { passive: true }
  );

  const releaseCursor = () => setCursorPressed(false);
  document.addEventListener("pointerup", releaseCursor, { passive: true });
  document.addEventListener("pointercancel", releaseCursor, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => {
    setCursorVisible(false);
    setCursorPressed(false);
  });
  window.addEventListener("blur", () => {
    setCursorVisible(false);
    setCursorPressed(false);
  });

  window.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnimation();
      setCursorVisible(false);
    } else {
      syncCursorCapability();
    }
  });

  const handleReducedMotionChange = (event) => {
    reducedMotion = event.matches;
    stopAnimation();
    if (reducedMotion) clearCanvas();
    syncCursorCapability();
  };
  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  } else {
    reducedMotionQuery.addListener(handleReducedMotionChange);
  }

  const handleFinePointerChange = () => syncCursorCapability();
  if (typeof finePointerQuery.addEventListener === "function") {
    finePointerQuery.addEventListener("change", handleFinePointerChange);
  } else {
    finePointerQuery.addListener(handleFinePointerChange);
  }

  new MutationObserver((records) => {
    if (!records.some((record) => record.attributeName === "data-theme")) return;
    palette = readPalette();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  resizeCanvas();
  setActive(active, { persist: false, announce: false });

  window.functionhxTurbo = Object.freeze({
    isActive: () => active,
    setActive: (value) => setActive(Boolean(value), { boot: Boolean(value) && !active }),
    toggle: () => toggleTurbo({ burst: !active, boot: !active }),
  });
})();
