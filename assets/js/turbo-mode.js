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
  let lastParticleAt = 0;
  let cursorFrameRequest = 0;
  let cursorRingX = window.innerWidth / 2;
  let cursorRingY = window.innerHeight / 2;
  let cursorRingInitialized = false;
  let palette = readPalette();
  let particles = [];
  let circuitNodes = [];
  const pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    seen: false,
    interactive: false,
    nativeCursor: false,
  };

  function readPalette() {
    const styles = window.getComputedStyle(root);
    return {
      void: styles.getPropertyValue("--turbo-void").trim() || "#050a0f",
      cyan: styles.getPropertyValue("--turbo-cyan").trim() || "#00dff5",
      cyanSoft: styles.getPropertyValue("--turbo-cyan-soft").trim() || "#7df4ff",
      magenta: styles.getPropertyValue("--turbo-magenta").trim() || "#ef1bc8",
      amber: styles.getPropertyValue("--turbo-amber").trim() || "#ffc247",
      danger: styles.getPropertyValue("--turbo-danger").trim() || "#ff365f",
      steel: styles.getPropertyValue("--turbo-steel").trim() || "#7892a8",
      dark: root.dataset.theme === "dark",
    };
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

  function stopCursorAnimation() {
    if (cursorFrameRequest) window.cancelAnimationFrame(cursorFrameRequest);
    cursorFrameRequest = 0;
  }

  function animateCursor() {
    if (!canUseTurboCursor() || !pointer.seen || pointer.nativeCursor || document.hidden) {
      cursorFrameRequest = 0;
      return;
    }

    const easing = pointer.interactive ? 0.28 : 0.2;
    cursorRingX += (pointer.x - cursorRingX) * easing;
    cursorRingY += (pointer.y - cursorRingY) * easing;
    cursor.style.setProperty("--turbo-cursor-ring-x", `${cursorRingX}px`);
    cursor.style.setProperty("--turbo-cursor-ring-y", `${cursorRingY}px`);
    cursorFrameRequest = window.requestAnimationFrame(animateCursor);
  }

  function startCursorAnimation() {
    if (!canUseTurboCursor() || !pointer.seen || pointer.nativeCursor || document.hidden) return;
    if (!cursorRingInitialized) {
      cursorRingX = pointer.x;
      cursorRingY = pointer.y;
      cursorRingInitialized = true;
      cursor.style.setProperty("--turbo-cursor-ring-x", `${cursorRingX}px`);
      cursor.style.setProperty("--turbo-cursor-ring-y", `${cursorRingY}px`);
    }
    if (!cursorFrameRequest) cursorFrameRequest = window.requestAnimationFrame(animateCursor);
  }

  function updateCursorTarget(target) {
    const element = target instanceof Element ? target : null;
    pointer.nativeCursor = Boolean(element?.closest(NATIVE_CURSOR_SELECTOR));
    pointer.interactive = !pointer.nativeCursor && Boolean(element?.closest(INTERACTIVE_CURSOR_SELECTOR));
    cursor.dataset.state = pointer.interactive ? "locked" : "tracking";
    cursor.style.setProperty("--turbo-cursor-core-x", `${pointer.x}px`);
    cursor.style.setProperty("--turbo-cursor-core-y", `${pointer.y}px`);

    if (!canUseTurboCursor() || pointer.nativeCursor) {
      setCursorVisible(false);
      setCursorPressed(false);
      stopCursorAnimation();
      return;
    }

    setCursorVisible(true);
    startCursorAnimation();
  }

  function syncCursorCapability() {
    const enabled = canUseTurboCursor();
    root.dataset.turboCursor = enabled ? "enabled" : "native";
    if (!enabled || pointer.nativeCursor || !pointer.seen) {
      setCursorVisible(false);
      setCursorPressed(false);
      stopCursorAnimation();
      return;
    }
    updateCursorTarget(document.elementFromPoint(pointer.x, pointer.y));
  }

  function resizeCanvas() {
    viewportWidth = Math.max(1, window.innerWidth);
    viewportHeight = Math.max(1, window.innerHeight);
    pixelRatio = Math.min(window.devicePixelRatio || 1, viewportWidth < 720 ? 1.15 : 1.35);

    const renderWidth = Math.floor(viewportWidth * pixelRatio);
    const renderHeight = Math.floor(viewportHeight * pixelRatio);
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    buildCircuitNodes();
    if (active && reducedMotion) drawScene(0);
  }

  function buildCircuitNodes() {
    const count = viewportWidth < 720 ? 16 : 34;
    circuitNodes = Array.from({ length: count }, (_, index) => {
      const seed = (index + 3) * 7919;
      return {
        x: 0.04 * viewportWidth + ((seed * 0.61803398875) % 1) * viewportWidth * 0.92,
        y: 0.12 * viewportHeight + (((seed + 67) * 0.41421356237) % 1) * viewportHeight * 0.72,
        length: 6 + (seed % 24),
        phase: (seed % 31) / 31,
        color: index % 7 === 0 ? palette.magenta : index % 5 === 0 ? palette.amber : palette.cyan,
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

  function tracePolygon(points, close = true) {
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    if (close) context.closePath();
  }

  function drawArmor(points, color, fillAlpha = 0.09, strokeAlpha = 0.74, lineWidth = 1.1) {
    context.save();
    tracePolygon(points);
    context.fillStyle = color;
    context.globalAlpha = Math.min(0.42, fillAlpha * (palette.dark ? 1.55 : 1));
    context.fill();
    context.strokeStyle = color;
    context.globalAlpha = Math.min(1, strokeAlpha * (palette.dark ? 1.1 : 1));
    context.lineWidth = lineWidth;
    context.stroke();
    context.restore();
  }

  function drawJoint(x, y, radius, color) {
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = 0.16;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.78;
    context.stroke();
    context.beginPath();
    context.arc(x, y, radius * 0.36, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawBackdrop(time) {
    const coreX = viewportWidth * 0.5 + (pointer.seen ? (pointer.x / viewportWidth - 0.5) * 18 : 0);
    const coreY = viewportHeight * (viewportWidth < 720 ? 0.76 : 0.61);
    const radius = Math.min(viewportWidth, viewportHeight) * (viewportWidth < 720 ? 0.48 : 0.58);
    const glow = context.createRadialGradient(coreX, coreY, 0, coreX, coreY, radius);
    glow.addColorStop(0, palette.dark ? "rgba(0, 223, 245, 0.12)" : "rgba(0, 155, 190, 0.08)");
    glow.addColorStop(0.33, palette.dark ? "rgba(239, 27, 200, 0.045)" : "rgba(239, 27, 200, 0.025)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, viewportWidth, viewportHeight);

    context.save();
    context.lineWidth = 0.6;
    circuitNodes.forEach((node, index) => {
      const pulse = reducedMotion ? 0.55 : 0.28 + Math.sin(time / 520 + index * 1.7) * 0.2;
      const direction = index % 2 === 0 ? 1 : -1;
      context.strokeStyle = node.color;
      context.fillStyle = node.color;
      context.globalAlpha = (palette.dark ? 0.24 : 0.15) * pulse;
      context.beginPath();
      context.moveTo(node.x, node.y);
      context.lineTo(node.x + node.length * direction, node.y);
      context.lineTo(node.x + node.length * direction, node.y + (index % 3 === 0 ? 10 : -10));
      context.stroke();
      context.fillRect(node.x - 1, node.y - 1, 2, 2);
    });
    context.restore();
  }

  function drawArenaGrid(time) {
    const horizon = viewportHeight * (viewportWidth < 720 ? 0.77 : 0.64);
    const bottom = viewportHeight + 18;
    const vanishingX = viewportWidth * 0.5 + (pointer.seen ? (pointer.x / viewportWidth - 0.5) * 28 : 0);

    context.save();
    context.strokeStyle = palette.cyan;
    context.lineWidth = 0.75;
    context.globalAlpha = palette.dark ? 0.2 : 0.12;

    const verticalCount = viewportWidth < 720 ? 10 : 19;
    for (let index = -verticalCount; index <= verticalCount; index += 1) {
      const spread = viewportWidth / verticalCount;
      drawLine(vanishingX, horizon, viewportWidth / 2 + index * spread, bottom);
    }

    const lineCount = viewportWidth < 720 ? 8 : 13;
    const drift = reducedMotion ? 0 : ((time / 1700) % 1) / lineCount;
    for (let index = 0; index <= lineCount; index += 1) {
      const progress = Math.min(1, index / lineCount + drift);
      const curved = progress * progress;
      const y = horizon + (bottom - horizon) * curved;
      context.globalAlpha = (palette.dark ? 0.08 : 0.055) + curved * (palette.dark ? 0.22 : 0.13);
      drawLine(0, y, viewportWidth, y);
    }

    context.globalAlpha = palette.dark ? 0.42 : 0.24;
    context.strokeStyle = palette.magenta;
    drawLine(0, horizon, viewportWidth, horizon);
    context.restore();
  }

  function drawSegmentedRing(x, y, radius, segments, rotation, color, alpha, lineWidth = 1) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.globalAlpha = alpha;
    for (let index = 0; index < segments; index += 1) {
      const start = (Math.PI * 2 * index) / segments;
      const end = start + (Math.PI * 1.28) / segments;
      context.beginPath();
      context.arc(0, 0, radius, start, end);
      context.stroke();
    }
    context.restore();
  }

  function drawNeuralCore(time) {
    const mobile = viewportWidth < 720;
    const pointerX = pointer.seen ? (pointer.x / viewportWidth - 0.5) * (mobile ? 8 : 18) : 0;
    const pointerY = pointer.seen ? (pointer.y / viewportHeight - 0.5) * (mobile ? 5 : 11) : 0;
    const x = viewportWidth * 0.5 + pointerX;
    const y = viewportHeight * (mobile ? 0.77 : 0.64) + pointerY;
    const size = mobile ? 25 : clamp(Math.min(viewportWidth, viewportHeight) * 0.045, 32, 48);
    const rotation = reducedMotion ? 0.32 : time / 2400;
    const pulse = reducedMotion ? 1 : 0.92 + Math.sin(time / 310) * 0.08;

    context.save();
    const glow = context.createRadialGradient(x, y, 0, x, y, size * 4.6);
    glow.addColorStop(0, palette.dark ? "rgba(255, 194, 71, 0.23)" : "rgba(255, 170, 20, 0.12)");
    glow.addColorStop(0.18, palette.dark ? "rgba(0, 223, 245, 0.17)" : "rgba(0, 160, 190, 0.1)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(x - size * 5, y - size * 5, size * 10, size * 10);

    drawSegmentedRing(x, y, size * 2.7 * pulse, 18, rotation, palette.cyan, palette.dark ? 0.34 : 0.22, 0.8);
    drawSegmentedRing(x, y, size * 2.05, 12, -rotation * 1.35, palette.magenta, palette.dark ? 0.45 : 0.28, 1.05);
    drawSegmentedRing(x, y, size * 1.45 * pulse, 8, rotation * 1.8, palette.amber, palette.dark ? 0.56 : 0.34, 1.2);

    const nodes = mobile ? 8 : 14;
    const orbitRadius = size * 3.35;
    const positions = [];
    for (let index = 0; index < nodes; index += 1) {
      const angle = (Math.PI * 2 * index) / nodes + rotation * (index % 2 === 0 ? 0.18 : -0.12);
      const radius = orbitRadius * (0.72 + ((index * 17) % 5) * 0.075);
      positions.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
    }

    context.strokeStyle = palette.cyan;
    context.lineWidth = 0.55;
    positions.forEach((node, index) => {
      const next = positions[(index + (index % 3 === 0 ? 3 : 1)) % positions.length];
      context.globalAlpha = palette.dark ? 0.16 : 0.1;
      drawLine(node.x, node.y, next.x, next.y);
      context.fillStyle = index % 4 === 0 ? palette.magenta : palette.cyan;
      context.globalAlpha = palette.dark ? 0.7 : 0.48;
      context.fillRect(node.x - 1.25, node.y - 1.25, 2.5, 2.5);
    });

    context.translate(x, y);
    context.rotate(Math.PI / 4 + rotation * 0.07);
    context.shadowColor = palette.cyan;
    context.shadowBlur = palette.dark ? 18 : 8;
    drawArmor(
      [
        [-size * 0.62, -size * 0.62],
        [size * 0.62, -size * 0.62],
        [size * 0.62, size * 0.62],
        [-size * 0.62, size * 0.62],
      ],
      palette.cyan,
      palette.dark ? 0.14 : 0.08,
      0.92,
      1.5
    );
    context.rotate(-Math.PI / 4 - rotation * 0.07);
    context.fillStyle = palette.void;
    context.globalAlpha = palette.dark ? 0.92 : 0.58;
    context.beginPath();
    context.ellipse(0, 0, size * 0.62, size * 0.29, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.amber;
    context.globalAlpha = 0.96;
    context.lineWidth = 1.7;
    context.beginPath();
    context.ellipse(0, 0, size * 0.62, size * 0.29, 0, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = palette.danger;
    context.shadowColor = palette.danger;
    context.shadowBlur = 15;
    context.globalAlpha = 1;
    context.fillRect(-size * 0.32, -1, size * 0.64, 2);
    context.restore();

    return { x, y, size };
  }

  function drawThruster(x, y, width, height, color, strength) {
    const gradient = context.createLinearGradient(x, y, x, y + height * strength);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.34, palette.cyanSoft);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.save();
    context.fillStyle = gradient;
    context.globalAlpha = 0.42 + strength * 0.35;
    tracePolygon([
      [x - width / 2, y],
      [x + width / 2, y],
      [x + width * 0.18, y + height * strength],
      [x - width * 0.22, y + height * strength * 0.86],
    ]);
    context.fill();
    context.restore();
  }

  function drawHeavyMech(x, y, scale, facing, color, time, label) {
    const walk = reducedMotion ? 0 : Math.sin(time / 560 + (facing > 0 ? 0 : Math.PI)) * 2.2;
    const breathe = reducedMotion ? 0 : Math.sin(time / 420) * 1.4;
    const thruster = reducedMotion ? 0.72 : 0.68 + Math.sin(time / 120) * 0.18;

    context.save();
    context.translate(x, y);
    context.scale(scale * facing, scale);
    context.shadowColor = color;
    context.shadowBlur = palette.dark ? 11 : 4;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = palette.dark ? 0.58 : 0.4;
    context.lineWidth = 0.9;

    drawThruster(-39, -78, 13, 49, color, thruster);
    drawThruster(-17, -70, 10, 39, palette.magenta, thruster * 0.84);

    drawArmor(
      [
        [-57, -157],
        [-28, -174],
        [-4, -153],
        [-12, -88],
        [-48, -83],
        [-66, -113],
      ],
      palette.steel,
      palette.dark ? 0.11 : 0.08,
      0.55,
      1
    );
    drawLine(-47, -150, -34, -93);
    drawLine(-31, -167, -20, -95);

    drawArmor(
      [
        [-42, -127 + breathe],
        [-28, -151 + breathe],
        [18, -151 + breathe],
        [39, -126 + breathe],
        [29, -77],
        [-29, -77],
      ],
      color,
      palette.dark ? 0.13 : 0.09,
      0.86,
      1.35
    );
    drawArmor(
      [
        [-25, -130 + breathe],
        [19, -130 + breathe],
        [26, -101],
        [8, -86],
        [-15, -89],
        [-31, -106],
      ],
      palette.steel,
      palette.dark ? 0.09 : 0.06,
      0.56,
      0.85
    );
    drawLine(-24, -112, 21, -112);
    drawLine(-9, -130, -5, -89);
    drawLine(8, -130, 5, -88);

    context.save();
    context.fillStyle = palette.amber;
    context.shadowColor = palette.amber;
    context.shadowBlur = 13;
    context.globalAlpha = 0.92;
    tracePolygon([
      [-11, -119 + breathe],
      [10, -119 + breathe],
      [15, -111],
      [8, -104],
      [-8, -104],
      [-15, -111],
    ]);
    context.fill();
    context.restore();

    drawArmor(
      [
        [-31, -174 + breathe],
        [-19, -193 + breathe],
        [12, -193 + breathe],
        [26, -175 + breathe],
        [18, -151 + breathe],
        [-24, -151 + breathe],
      ],
      color,
      palette.dark ? 0.12 : 0.07,
      0.92,
      1.25
    );
    drawArmor(
      [
        [-16, -199 + breathe],
        [-7, -210 + breathe],
        [11, -206 + breathe],
        [16, -193 + breathe],
        [-13, -193 + breathe],
      ],
      palette.steel,
      0.08,
      0.68,
      0.9
    );
    drawLine(-20, -190, -36, -211);
    drawLine(17, -189, 34, -205);
    context.save();
    context.strokeStyle = palette.danger;
    context.shadowColor = palette.danger;
    context.shadowBlur = 14;
    context.globalAlpha = 1;
    context.lineWidth = 2.2;
    drawLine(-12, -178 + breathe, 14, -178 + breathe);
    context.restore();

    drawArmor(
      [
        [-72, -160],
        [-41, -169],
        [-24, -147],
        [-42, -125],
        [-78, -132],
        [-89, -147],
      ],
      color,
      palette.dark ? 0.15 : 0.1,
      0.88,
      1.25
    );
    drawArmor(
      [
        [35, -157],
        [70, -151],
        [78, -133],
        [52, -113],
        [31, -126],
      ],
      color,
      palette.dark ? 0.15 : 0.1,
      0.88,
      1.25
    );
    drawJoint(-49, -131, 7, color);
    drawJoint(44, -127, 7, color);

    drawArmor(
      [
        [-52, -130],
        [-67, -96],
        [-55, -62],
        [-35, -69],
        [-32, -108],
      ],
      color,
      0.1,
      0.76,
      1.1
    );
    drawJoint(-58, -91, 6, color);
    drawArmor(
      [
        [-62, -67],
        [-50, -65],
        [-44, -40],
        [-65, -34],
        [-72, -48],
      ],
      palette.steel,
      0.08,
      0.6,
      0.9
    );

    drawArmor(
      [
        [44, -127],
        [66, -115],
        [81, -124],
        [88, -111],
        [69, -92],
        [48, -98],
      ],
      color,
      0.1,
      0.84,
      1.1
    );
    drawJoint(67, -109, 6, color);
    drawArmor(
      [
        [77, -130],
        [122, -130],
        [139, -120],
        [132, -105],
        [79, -105],
        [69, -116],
      ],
      color,
      palette.dark ? 0.16 : 0.1,
      0.94,
      1.25
    );
    drawArmor(
      [
        [113, -139],
        [149, -136],
        [158, -122],
        [137, -116],
        [117, -123],
      ],
      palette.steel,
      0.08,
      0.64,
      0.9
    );
    context.save();
    context.strokeStyle = palette.amber;
    context.shadowColor = palette.amber;
    context.shadowBlur = 11;
    context.globalAlpha = 0.86;
    context.lineWidth = 1.4;
    drawLine(128, -119, 156, -122);
    context.restore();

    drawArmor(
      [
        [-25, -78],
        [-4, -78],
        [-9, -32 + walk],
        [-39, -3 + walk],
        [-54, -13 + walk],
        [-38, -50 + walk],
      ],
      color,
      0.1,
      0.76,
      1.1
    );
    drawArmor(
      [
        [1, -78],
        [27, -77],
        [41, -45 - walk],
        [44, -7 - walk],
        [25, 2 - walk],
        [8, -34 - walk],
      ],
      color,
      0.1,
      0.76,
      1.1
    );
    drawJoint(-22, -48 + walk, 6, color);
    drawJoint(27, -45 - walk, 6, color);
    drawArmor(
      [
        [-49, -9 + walk],
        [-29, -9 + walk],
        [-20, 5 + walk],
        [-32, 13 + walk],
        [-67, 13 + walk],
        [-72, 4 + walk],
      ],
      palette.steel,
      0.09,
      0.66,
      0.9
    );
    drawArmor(
      [
        [29, -7 - walk],
        [50, -8 - walk],
        [68, 6 - walk],
        [58, 14 - walk],
        [22, 13 - walk],
        [16, 4 - walk],
      ],
      palette.steel,
      0.09,
      0.66,
      0.9
    );

    context.save();
    context.scale(facing, 1);
    context.font = '650 7px "SFMono-Regular", Consolas, monospace';
    context.fillStyle = color;
    context.globalAlpha = 0.62;
    context.textAlign = "center";
    context.fillText(label, 0, 28);
    context.restore();
    context.restore();
  }

  function drawMachineLinks(core, leftMech, rightMech, time) {
    context.save();
    context.setLineDash([2, 7]);
    context.lineDashOffset = reducedMotion ? 0 : -time / 28;
    context.lineWidth = 0.8;
    context.globalAlpha = palette.dark ? 0.34 : 0.2;
    context.strokeStyle = palette.cyan;
    drawLine(leftMech.linkX, leftMech.linkY, core.x - core.size * 1.1, core.y);
    context.strokeStyle = palette.magenta;
    drawLine(rightMech.linkX, rightMech.linkY, core.x + core.size * 1.1, core.y);
    context.restore();
  }

  function drawCombatBeam(time, leftMech, rightMech, core) {
    if (reducedMotion) return;

    const cycle = (time / 1000) % 5.4;
    let origin;
    let impact;
    let color;
    let phase;

    if (cycle > 0.72 && cycle < 1.62) {
      origin = leftMech.muzzle;
      impact = { x: core.x + core.size * 2.1, y: core.y + core.size * 0.28 };
      color = palette.cyan;
      phase = (cycle - 0.72) / 0.9;
    } else if (cycle > 2.65 && cycle < 3.58) {
      origin = rightMech.muzzle;
      impact = { x: core.x - core.size * 2.05, y: core.y - core.size * 0.16 };
      color = palette.magenta;
      phase = (cycle - 2.65) / 0.93;
    } else {
      return;
    }

    const strength = Math.sin(phase * Math.PI);
    context.save();
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 18 + strength * 14;
    context.globalAlpha = 0.22 + strength * 0.72;
    context.lineWidth = 1 + strength * 2.8;
    drawLine(origin.x, origin.y, impact.x, impact.y);
    context.strokeStyle = palette.cyanSoft;
    context.globalAlpha = strength * 0.82;
    context.lineWidth = 0.65;
    drawLine(origin.x, origin.y, impact.x, impact.y);

    const flashRadius = 5 + strength * 20;
    for (let index = 0; index < 10; index += 1) {
      const angle = (Math.PI * 2 * index) / 10 + time / 280;
      const inner = 2 + (index % 3);
      const outer = flashRadius * (0.55 + (index % 4) * 0.15);
      drawLine(
        impact.x + Math.cos(angle) * inner,
        impact.y + Math.sin(angle) * inner,
        impact.x + Math.cos(angle) * outer,
        impact.y + Math.sin(angle) * outer
      );
    }
    context.beginPath();
    context.arc(origin.x, origin.y, 4 + strength * 7, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function drawHud(time) {
    const margin = viewportWidth < 720 ? 17 : 30;
    const length = viewportWidth < 720 ? 26 : 48;
    const top = viewportWidth < 720 ? 82 : Math.max(96, viewportHeight * 0.105);
    const bottom = viewportHeight - margin;

    context.save();
    context.strokeStyle = palette.cyan;
    context.lineWidth = 1.15;
    context.globalAlpha = palette.dark ? 0.64 : 0.4;
    drawLine(margin, top, margin + length, top);
    drawLine(margin, top, margin, top + length);
    drawLine(viewportWidth - margin, top, viewportWidth - margin - length, top);
    drawLine(viewportWidth - margin, top, viewportWidth - margin, top + length);
    drawLine(margin, bottom, margin + length, bottom);
    drawLine(margin, bottom, margin, bottom - length);
    drawLine(viewportWidth - margin, bottom, viewportWidth - margin - length, bottom);
    drawLine(viewportWidth - margin, bottom, viewportWidth - margin, bottom - length);

    const centerWidth = viewportWidth < 720 ? 42 : 76;
    const centerY = viewportHeight * (viewportWidth < 720 ? 0.77 : 0.64);
    context.strokeStyle = palette.danger;
    context.globalAlpha = palette.dark ? 0.5 : 0.32;
    drawLine(viewportWidth / 2 - centerWidth, centerY, viewportWidth / 2 - 20, centerY);
    drawLine(viewportWidth / 2 + 20, centerY, viewportWidth / 2 + centerWidth, centerY);
    drawLine(viewportWidth / 2, centerY - 24, viewportWidth / 2, centerY - 10);
    drawLine(viewportWidth / 2, centerY + 10, viewportWidth / 2, centerY + 24);

    const glitchPhase = reducedMotion ? 10 : Math.floor(time / 105) % 47;
    if (glitchPhase < 2) {
      context.fillStyle = glitchPhase === 0 ? palette.cyan : palette.magenta;
      context.globalAlpha = palette.dark ? 0.18 : 0.1;
      for (let index = 0; index < 4; index += 1) {
        const y = ((index * 0.271 + 0.18) % 1) * viewportHeight;
        const width = viewportWidth * (0.08 + index * 0.035);
        const x = index % 2 === 0 ? 0 : viewportWidth - width;
        context.fillRect(x, y, width, index % 2 === 0 ? 2 : 1);
      }
    }
    context.restore();
  }

  function spawnParticle(x, y, color, force = 1) {
    if (reducedMotion) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.4 + Math.random() * 1.55) * force;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.16,
      life: 1,
      decay: 0.015 + Math.random() * 0.024,
      size: 0.8 + Math.random() * 1.8,
      color,
    });
    if (particles.length > 150) particles.splice(0, particles.length - 150);
  }

  function spawnActivationBurst() {
    const rect = trigger.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (let index = 0; index < 54; index += 1) {
      const color = index % 4 === 0 ? palette.danger : index % 3 === 0 ? palette.magenta : palette.cyan;
      spawnParticle(x, y, color, 3.3);
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
      particle.vx *= 0.982;
      particle.vy *= 0.982;
      particle.life -= particle.decay;
      context.globalAlpha = particle.life * (palette.dark ? 0.9 : 0.62);
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = palette.dark ? 5 : 2;
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(Math.atan2(particle.vy, particle.vx));
      context.fillRect(0, -particle.size * 0.3, particle.size * 3.6, particle.size * 0.62);
      context.restore();
    });
    context.restore();
  }

  function drawScene(time) {
    clearCanvas();
    if (!active) return;

    drawBackdrop(time);
    drawArenaGrid(time);
    const core = drawNeuralCore(time);

    const mobile = viewportWidth < 720;
    const scale = mobile ? 0.68 : clamp(Math.min(viewportWidth / 1280, viewportHeight / 820), 0.88, 1.22);
    const mechY = viewportHeight + (mobile ? 24 : 28);
    const leftX = mobile ? 31 : Math.max(76, viewportWidth * 0.065);
    const rightX = mobile ? viewportWidth - 31 : Math.min(viewportWidth - 76, viewportWidth * 0.935);
    const leftMech = {
      linkX: leftX + 10 * scale,
      linkY: mechY - 110 * scale,
      muzzle: { x: leftX + 152 * scale, y: mechY - 122 * scale },
    };
    const rightMech = {
      linkX: rightX - 10 * scale,
      linkY: mechY - 110 * scale,
      muzzle: { x: rightX - 152 * scale, y: mechY - 122 * scale },
    };

    drawMachineLinks(core, leftMech, rightMech, time);
    drawHeavyMech(leftX, mechY, scale, 1, palette.cyan, time, "M-01 / ARMORED");
    drawHeavyMech(rightX, mechY, scale, -1, palette.magenta, time, "M-02 / ARMORED");
    drawCombatBeam(time, leftMech, rightMech, core);
    drawHud(time);
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

  function runBootSequence() {
    window.clearTimeout(bootTimer);
    root.dataset.turboBoot = "false";
    if (reducedMotion) return;
    window.requestAnimationFrame(() => {
      root.dataset.turboBoot = "true";
      bootTimer = window.setTimeout(() => {
        root.dataset.turboBoot = "false";
      }, 1180);
    });
  }

  function showStatus(isNowActive) {
    window.clearTimeout(statusTimer);
    const chinese = isChinesePage();
    if (isNowActive) {
      status.textContent = chinese
        ? `AI CORE ONLINE · 重装机甲战术层已接入${reducedMotion ? " · 静态效果" : " · Shift+T 关闭"}`
        : `AI CORE ONLINE · ROBOT ARENA READY · ARMORED LAYER LINKED${reducedMotion ? " · STATIC EFFECTS" : " · SHIFT+T TO EXIT"}`;
    } else {
      status.textContent = chinese ? "TURBO OFFLINE · 战术层已断开" : "TURBO OFFLINE · TACTICAL LAYER DISENGAGED";
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
      if (burst) spawnActivationBurst();
      if (boot) runBootSequence();
      startAnimation();
    } else {
      window.clearTimeout(bootTimer);
      root.dataset.turboBoot = "false";
      particles = [];
      cursorRingInitialized = false;
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
      if (!active || reducedMotion || event.timeStamp - lastParticleAt < 15) return;
      lastParticleAt = event.timeStamp;
      const speed = Math.hypot(event.movementX, event.movementY);
      const color = particles.length % 5 === 0 ? palette.danger : particles.length % 3 === 0 ? palette.magenta : palette.cyan;
      spawnParticle(event.clientX, event.clientY, color, clamp(speed / 8, 0.55, 1.45));
      spawnParticle(event.clientX - event.movementX * 0.38, event.clientY - event.movementY * 0.38, palette.amber, 0.42);
    },
    { passive: true }
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || !canUseTurboCursor() || pointer.nativeCursor) return;
      setCursorPressed(true);
      for (let index = 0; index < 8; index += 1) {
        spawnParticle(event.clientX, event.clientY, index % 3 === 0 ? palette.danger : palette.amber, 1.5);
      }
    },
    { passive: true }
  );

  const releaseCursor = () => setCursorPressed(false);
  document.addEventListener("pointerup", releaseCursor, { passive: true });
  document.addEventListener("pointercancel", releaseCursor, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => {
    setCursorVisible(false);
    setCursorPressed(false);
    stopCursorAnimation();
  });
  window.addEventListener("blur", () => {
    setCursorVisible(false);
    setCursorPressed(false);
    stopCursorAnimation();
  });

  window.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnimation();
      stopCursorAnimation();
      setCursorVisible(false);
    } else {
      startAnimation();
      syncCursorCapability();
    }
  });

  const handleReducedMotionChange = (event) => {
    reducedMotion = event.matches;
    stopAnimation();
    syncCursorCapability();
    if (active) startAnimation();
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
    buildCircuitNodes();
    if (active && reducedMotion) drawScene(0);
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  resizeCanvas();
  setActive(active, { persist: false, announce: false });

  window.functionhxTurbo = Object.freeze({
    isActive: () => active,
    setActive: (value) => setActive(Boolean(value), { boot: Boolean(value) && !active }),
    toggle: () => toggleTurbo({ burst: !active, boot: !active }),
  });
})();
