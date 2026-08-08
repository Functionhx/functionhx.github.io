(function initializeTurboMode() {
  "use strict";

  const root = document.documentElement;
  const trigger = document.querySelector("[data-turbo-trigger]");
  const canvas = document.getElementById("turbo-canvas");
  const status = document.getElementById("turbo-status");

  if (!trigger || !canvas || !status) return;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const STORAGE_KEY = "functionhx:turbo-mode";
  const HOLD_DURATION = 680;
  const HOLD_MOVE_TOLERANCE = 14;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

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
  let lastParticleAt = 0;
  let palette = readPalette();
  let particles = [];
  let arenaMarkers = [];
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, seen: false };

  function readPalette() {
    const styles = window.getComputedStyle(root);
    return {
      cyan: styles.getPropertyValue("--turbo-cyan").trim() || "#00cfe8",
      magenta: styles.getPropertyValue("--turbo-magenta").trim() || "#d818c8",
      amber: styles.getPropertyValue("--turbo-amber").trim() || "#ffb800",
      dark: root.dataset.theme === "dark",
    };
  }

  function isChinesePage() {
    return document.body.dataset.pageLanguage !== "en";
  }

  function resizeCanvas() {
    viewportWidth = Math.max(1, window.innerWidth);
    viewportHeight = Math.max(1, window.innerHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

    const renderWidth = Math.floor(viewportWidth * pixelRatio);
    const renderHeight = Math.floor(viewportHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    buildArenaMarkers();
    if (active && reducedMotion) drawScene(0);
  }

  function buildArenaMarkers() {
    const count = viewportWidth < 720 ? 9 : 18;
    arenaMarkers = Array.from({ length: count }, (_, index) => {
      const seed = (index + 1) * 7919;
      return {
        x: ((seed * 0.61803398875) % 1) * viewportWidth,
        y: (((seed + 37) * 0.41421356237) % 1) * viewportHeight * 0.58 + viewportHeight * 0.08,
        length: 5 + (seed % 17),
        color: index % 5 === 0 ? palette.magenta : palette.cyan,
      };
    });
  }

  function clearCanvas() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function drawLine(x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }

  function drawArenaGrid(time) {
    const horizon = viewportHeight * (viewportWidth < 720 ? 0.7 : 0.63);
    const bottom = viewportHeight + 12;
    const pointerOffset = pointer.seen ? (pointer.x / viewportWidth - 0.5) * 34 : 0;
    const vanishingX = viewportWidth * 0.5 + pointerOffset;

    context.save();
    context.strokeStyle = palette.cyan;
    context.lineWidth = 0.72;
    context.globalAlpha = palette.dark ? 0.15 : 0.1;

    const verticalCount = viewportWidth < 720 ? 11 : 19;
    for (let index = -verticalCount; index <= verticalCount; index += 1) {
      const spread = viewportWidth / verticalCount;
      drawLine(vanishingX, horizon, viewportWidth / 2 + index * spread, bottom);
    }

    const lineCount = viewportWidth < 720 ? 8 : 12;
    const drift = reducedMotion ? 0 : ((time / 1900) % 1) / lineCount;
    for (let index = 0; index <= lineCount; index += 1) {
      const progress = Math.min(1, index / lineCount + drift);
      const curved = progress * progress;
      const y = horizon + (bottom - horizon) * curved;
      context.globalAlpha = (palette.dark ? 0.07 : 0.05) + curved * (palette.dark ? 0.16 : 0.11);
      drawLine(0, y, viewportWidth, y);
    }

    context.globalAlpha = palette.dark ? 0.25 : 0.15;
    context.strokeStyle = palette.magenta;
    drawLine(0, horizon, viewportWidth, horizon);
    context.restore();
  }

  function drawHud(time) {
    const margin = viewportWidth < 720 ? 18 : 30;
    const length = viewportWidth < 720 ? 24 : 38;
    const top = Math.max(84, viewportHeight * 0.1);
    const bottom = viewportHeight - margin;

    context.save();
    context.lineWidth = 1.15;
    context.strokeStyle = palette.cyan;
    context.globalAlpha = palette.dark ? 0.42 : 0.3;

    drawLine(margin, top, margin + length, top);
    drawLine(margin, top, margin, top + length);
    drawLine(viewportWidth - margin, top, viewportWidth - margin - length, top);
    drawLine(viewportWidth - margin, top, viewportWidth - margin, top + length);
    drawLine(margin, bottom, margin + length, bottom);
    drawLine(margin, bottom, margin, bottom - length);
    drawLine(viewportWidth - margin, bottom, viewportWidth - margin - length, bottom);
    drawLine(viewportWidth - margin, bottom, viewportWidth - margin, bottom - length);

    context.font = '500 9px "SFMono-Regular", Consolas, monospace';
    context.fillStyle = palette.cyan;
    context.letterSpacing = "1px";
    context.fillText("MAGIC // TURBO", margin + 1, top + length + 15);
    context.textAlign = "right";
    context.fillText("ARENA 01", viewportWidth - margin - 1, top + length + 15);
    context.textAlign = "left";

    const sweep = reducedMotion ? viewportHeight * 0.46 : ((time / 13) % (viewportHeight + 120)) - 60;
    const gradient = context.createLinearGradient(0, sweep - 18, 0, sweep + 18);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(0.5, palette.cyan);
    gradient.addColorStop(1, "transparent");
    context.strokeStyle = gradient;
    context.globalAlpha = palette.dark ? 0.14 : 0.08;
    drawLine(0, sweep, viewportWidth, sweep);

    arenaMarkers.forEach((marker, index) => {
      const pulse = reducedMotion ? 0.72 : 0.48 + Math.sin(time / 720 + index) * 0.24;
      context.fillStyle = marker.color;
      context.globalAlpha = (palette.dark ? 0.22 : 0.13) * pulse;
      context.fillRect(marker.x, marker.y, marker.length, 1);
      context.fillRect(marker.x, marker.y, 1, 4);
    });
    context.restore();
  }

  function tracePolygon(points, close = true) {
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    if (close) context.closePath();
  }

  function drawJoint(x, y, radius) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  function drawMech(x, y, scale, facing, color, time, label) {
    const stride = reducedMotion ? 0 : Math.sin(time / 430 + (facing > 0 ? 0 : Math.PI)) * 2.4;
    const recoil = reducedMotion ? 0 : Math.max(0, Math.sin(time / 185)) * 1.8;

    context.save();
    context.translate(x, y);
    context.scale(scale * facing, scale);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 1.15 / scale;
    context.globalAlpha = palette.dark ? 0.64 : 0.44;
    context.shadowColor = color;
    context.shadowBlur = palette.dark ? 8 : 3;

    tracePolygon([
      [-15, -48],
      [12, -48],
      [20, -30],
      [11, -10],
      [-13, -10],
      [-21, -30],
    ]);
    context.fillStyle = `${color}18`;
    context.fill();
    context.stroke();

    context.fillStyle = color;
    tracePolygon([
      [-8, -63],
      [10, -63],
      [14, -52],
      [8, -47],
      [-10, -49],
      [-13, -57],
    ]);
    context.fillStyle = `${color}16`;
    context.fill();
    context.stroke();
    drawLine(1, -63, 4, -71);
    drawLine(4, -71, 9, -73);
    context.fillStyle = palette.amber;
    context.globalAlpha = palette.dark ? 0.88 : 0.66;
    context.fillRect(3, -58, 6, 1.5);

    context.fillStyle = color;
    context.globalAlpha = palette.dark ? 0.64 : 0.44;
    drawJoint(-20, -39, 4.2);
    drawJoint(19, -39, 4.2);
    drawLine(-20, -39, -30, -22 + stride * 0.25);
    drawLine(-30, -22 + stride * 0.25, -24, -5);
    drawJoint(-30, -22 + stride * 0.25, 3.2);

    drawLine(19, -39, 30 - recoil, -28);
    drawLine(30 - recoil, -28, 45 - recoil, -29);
    drawJoint(30 - recoil, -28, 3.2);
    tracePolygon([
      [43 - recoil, -33],
      [59 - recoil, -33],
      [64 - recoil, -28],
      [45 - recoil, -25],
    ]);
    context.fillStyle = `${color}1f`;
    context.fill();
    context.stroke();

    context.fillStyle = color;
    drawJoint(-9, -9, 3.6);
    drawJoint(9, -9, 3.6);
    drawLine(-9, -7, -14 - stride, 13);
    drawLine(-14 - stride, 13, -21 - stride, 29);
    drawLine(9, -7, 15 + stride, 13);
    drawLine(15 + stride, 13, 22 + stride, 29);
    drawJoint(-14 - stride, 13, 3.4);
    drawJoint(15 + stride, 13, 3.4);
    drawLine(-27 - stride, 29, -14 - stride, 29);
    drawLine(15 + stride, 29, 29 + stride, 29);

    context.shadowBlur = 0;
    context.globalAlpha = palette.dark ? 0.5 : 0.34;
    context.font = `600 ${7.5 / scale}px "SFMono-Regular", Consolas, monospace`;
    context.fillStyle = color;
    context.textAlign = "center";
    context.scale(facing, 1);
    context.fillText(label, 0, 45);
    context.restore();
  }

  function drawBeam(time, leftMech, rightMech) {
    if (reducedMotion) return;

    const cycle = (time / 1000) % 6.4;
    let origin;
    let impact;
    let color;
    let strength = 0;

    if (cycle > 1.15 && cycle < 1.78) {
      origin = leftMech;
      impact = { x: viewportWidth * 0.58, y: viewportHeight * 0.72 };
      color = palette.cyan;
      strength = Math.sin(((cycle - 1.15) / 0.63) * Math.PI);
    } else if (cycle > 3.82 && cycle < 4.42) {
      origin = rightMech;
      impact = { x: viewportWidth * 0.43, y: viewportHeight * 0.7 };
      color = palette.magenta;
      strength = Math.sin(((cycle - 3.82) / 0.6) * Math.PI);
    } else {
      return;
    }

    context.save();
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 14;
    context.globalAlpha = 0.24 + strength * 0.5;
    context.lineWidth = 0.8 + strength * 1.8;
    drawLine(origin.x, origin.y, impact.x, impact.y);
    context.lineWidth = 0.55;
    context.globalAlpha = strength * 0.42;
    drawLine(origin.x, origin.y - 2, impact.x, impact.y + 2);

    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI * 2 * index) / 6 + time / 520;
      const radius = 4 + strength * 13;
      drawLine(
        impact.x + Math.cos(angle) * 2,
        impact.y + Math.sin(angle) * 2,
        impact.x + Math.cos(angle) * radius,
        impact.y + Math.sin(angle) * radius
      );
    }
    context.restore();
  }

  function spawnParticle(x, y, color, force = 1) {
    if (reducedMotion) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.35 + Math.random() * 1.25) * force;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.18,
      life: 1,
      decay: 0.018 + Math.random() * 0.021,
      size: 0.8 + Math.random() * 1.7,
      color,
    });
    if (particles.length > 120) particles.splice(0, particles.length - 120);
  }

  function spawnActivationBurst() {
    const rect = trigger.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (let index = 0; index < 34; index += 1) {
      spawnParticle(x, y, index % 3 === 0 ? palette.magenta : palette.cyan, 2.8);
    }
  }

  function drawParticles() {
    if (reducedMotion || particles.length === 0) return;

    context.save();
    context.globalCompositeOperation = palette.dark ? "lighter" : "source-over";
    particles = particles.filter((particle) => particle.life > 0.02);
    particles.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
      particle.life -= particle.decay;
      context.globalAlpha = particle.life * (palette.dark ? 0.75 : 0.52);
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.size * 2.8, particle.size * 0.65);
    });
    context.restore();
  }

  function drawScene(time) {
    clearCanvas();
    if (!active) return;

    drawArenaGrid(time);
    drawHud(time);

    const mobile = viewportWidth < 720;
    const mechScale = mobile ? 0.62 : Math.min(1, Math.max(0.72, viewportWidth / 1500));
    const mechY = viewportHeight - (mobile ? 43 : 48);
    const leftMech = {
      x: mobile ? 68 : Math.max(92, viewportWidth * 0.08),
      y: mechY - 29 * mechScale,
    };
    const rightMech = {
      x: mobile ? viewportWidth - 68 : Math.min(viewportWidth - 92, viewportWidth * 0.92),
      y: mechY - 29 * mechScale,
    };

    drawMech(leftMech.x, mechY, mechScale, 1, palette.cyan, time, "M-01");
    drawMech(rightMech.x, mechY, mechScale, -1, palette.magenta, time, "M-02");
    drawBeam(time, leftMech, rightMech);
    drawParticles();
  }

  function animate(time) {
    if (!active || reducedMotion || document.hidden) {
      frameRequest = 0;
      return;
    }

    const frameInterval = viewportWidth < 720 ? 1000 / 30 : 1000 / 60;
    if (time - previousFrame >= frameInterval) {
      previousFrame = time;
      drawScene(time);
    }
    frameRequest = window.requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (!active) return;
    if (reducedMotion) {
      drawScene(0);
      return;
    }
    if (!frameRequest && !document.hidden) frameRequest = window.requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (frameRequest) window.cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    previousFrame = 0;
  }

  function showStatus(isNowActive) {
    window.clearTimeout(statusTimer);
    const chinese = isChinesePage();
    if (isNowActive) {
      status.textContent = chinese
        ? `TURBO ONLINE · 机器人赛场已启动${reducedMotion ? " · 静态效果" : " · Shift+T 关闭"}`
        : `TURBO ONLINE · ROBOT ARENA READY${reducedMotion ? " · STATIC EFFECTS" : " · SHIFT+T TO EXIT"}`;
    } else {
      status.textContent = chinese ? "TURBO OFFLINE · 返回标准模式" : "TURBO OFFLINE · STANDARD MODE RESTORED";
    }
    status.dataset.visible = "true";
    statusTimer = window.setTimeout(() => {
      status.dataset.visible = "false";
    }, 2300);
  }

  function storePreference(isNowActive) {
    try {
      window.localStorage.setItem(STORAGE_KEY, isNowActive ? "on" : "off");
    } catch (_error) {
      // Turbo still works for this page when storage is unavailable.
    }
  }

  function setActive(nextActive, options = {}) {
    const { persist = true, announce = true, burst = false } = options;
    active = Boolean(nextActive);
    root.dataset.turbo = active ? "on" : "off";
    trigger.dataset.turboActive = active ? "true" : "false";
    if (persist) storePreference(active);

    stopAnimation();
    if (active) {
      palette = readPalette();
      resizeCanvas();
      if (burst) spawnActivationBurst();
      startAnimation();
    } else {
      particles = [];
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
      toggleTurbo({ burst: !active });
      if (window.navigator.vibrate) window.navigator.vibrate(24);
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
    toggleTurbo({ burst: !active });
  });

  document.addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.seen = true;
      if (!active || reducedMotion || event.timeStamp - lastParticleAt < 18) return;
      lastParticleAt = event.timeStamp;
      const color = particles.length % 4 === 0 ? palette.magenta : palette.cyan;
      spawnParticle(event.clientX, event.clientY, color, 0.8);
      spawnParticle(event.clientX - event.movementX * 0.35, event.clientY - event.movementY * 0.35, palette.amber, 0.45);
    },
    { passive: true }
  );

  window.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAnimation();
    else startAnimation();
  });

  const handleReducedMotionChange = (event) => {
    reducedMotion = event.matches;
    stopAnimation();
    if (active) startAnimation();
  };
  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  } else {
    reducedMotionQuery.addListener(handleReducedMotionChange);
  }

  new MutationObserver((records) => {
    if (!records.some((record) => record.attributeName === "data-theme")) return;
    palette = readPalette();
    buildArenaMarkers();
    if (active && reducedMotion) drawScene(0);
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  resizeCanvas();
  setActive(active, { persist: false, announce: false });

  window.functionhxTurbo = Object.freeze({
    isActive: () => active,
    setActive: (value) => setActive(Boolean(value)),
    toggle: () => toggleTurbo({ burst: !active }),
  });
})();
