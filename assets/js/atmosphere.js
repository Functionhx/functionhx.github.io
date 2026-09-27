/* global toggleThemeSetting: writable, transTheme: writable */
(function initializeAtmosphere() {
  "use strict";

  // 两件事：日夜切换时新主题从按钮处以圆形扩散开；以及站长发布的季节氛围（飘雪、樱花、雨、落叶）。
  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- 日夜切换：圆形扩散 ----------
  // theme.js 的按钮在点击时按名字调用全局的 toggleThemeSetting，这里包一层 View Transition。
  // Turbo 的长按会在 theme.js 之前吞掉那次点击，所以不受影响。
  (function installThemeReveal() {
    if (typeof toggleThemeSetting !== "function" || typeof document.startViewTransition !== "function") return;
    const originalToggle = toggleThemeSetting;
    let pointer = null;
    document.addEventListener(
      "pointerdown",
      (event) => {
        pointer = { x: event.clientX, y: event.clientY, at: window.performance.now() };
      },
      true
    );

    function origin() {
      if (pointer && window.performance.now() - pointer.at < 1500) return pointer;
      const button = document.getElementById("light-toggle");
      const rect = button?.getBoundingClientRect();
      if (rect && rect.width) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return { x: window.innerWidth - 40, y: 40 };
    }

    toggleThemeSetting = function toggleWithReveal() {
      if (reducedMotion.matches || document.visibilityState !== "visible") return originalToggle();
      const { x, y } = origin();
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      root.classList.add("is-theme-revealing");
      const transition = document.startViewTransition(() => {
        // theme.js 自带的整页颜色渐变会和圆形扩散打架，切换的这一下先关掉它。
        const fade = typeof transTheme === "function" ? transTheme : null;
        if (fade) transTheme = () => {};
        try {
          originalToggle();
        } finally {
          if (fade) transTheme = fade;
        }
      });
      transition.ready
        .then(() => {
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 560, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" }
          );
        })
        .catch(() => {});
      transition.finished.finally(() => root.classList.remove("is-theme-revealing"));
    };
  })();

  // ---------- 季节氛围 ----------
  const EFFECTS = new Set(["off", "auto", "snow", "sakura", "rain", "leaves"]);
  const PETAL_COLORS = ["#f9d3dd", "#f6bccb", "#f2a9bd", "#fbe1e7"];
  const LEAF_COLORS = ["#d9772b", "#c2452d", "#e0a33a", "#a8552d", "#bf8a2e"];
  const WIND = 0.14;

  function resolveEffect(effect) {
    if (effect !== "auto") return effect;
    const month = new Date().getMonth();
    if (month === 11 || month <= 1) return "snow";
    if (month <= 4) return "sakura";
    if (month <= 7) return "rain";
    return "leaves";
  }

  const random = (min, max) => min + Math.random() * (max - min);
  const isDark = () => root.dataset.theme === "dark";

  // 每种效果：make(width, height, scatter) 生成一个粒子；step 更新；draw 画出来。
  const KINDS = {
    snow: {
      layers: [
        { count: 70, size: [0.6, 1.2], speed: [0.25, 0.55], alpha: [0.25, 0.45], drift: [0.1, 0.3] },
        { count: 55, size: [1.2, 2], speed: [0.55, 1.1], alpha: [0.4, 0.65], drift: [0.2, 0.5] },
        { count: 22, size: [2.2, 3.4], speed: [1, 1.7], alpha: [0.55, 0.85], drift: [0.3, 0.7] },
      ],
      make(layer, width, height, scatter) {
        return {
          x: random(0, width),
          y: scatter ? random(0, height) : random(-40, -8),
          size: random(...layer.size),
          speed: random(...layer.speed),
          alpha: random(...layer.alpha),
          drift: random(...layer.drift),
          freq: random(0.6, 1.4),
          phase: random(0, Math.PI * 2),
        };
      },
      step(item, dt, time) {
        item.y += item.speed * dt * 60;
        item.x += Math.sin(time * item.freq + item.phase) * item.drift * dt * 60;
      },
      draw(context, items) {
        const color = isDark() ? "255, 255, 255" : "132, 150, 176";
        for (const item of items) {
          context.fillStyle = `rgba(${color}, ${item.alpha})`;
          context.beginPath();
          context.arc(item.x, item.y, item.size, 0, Math.PI * 2);
          context.fill();
        }
      },
    },
    rain: {
      layers: [
        { count: 60, size: [8, 14], speed: [5, 8], alpha: [0.08, 0.16], width: 0.8 },
        { count: 45, size: [14, 22], speed: [9, 14], alpha: [0.14, 0.26], width: 1 },
        { count: 20, size: [22, 32], speed: [14, 20], alpha: [0.22, 0.38], width: 1.3 },
      ],
      make(layer, width, height, scatter) {
        return {
          x: random(-height * WIND, width),
          y: scatter ? random(0, height) : random(-120, -20),
          size: random(...layer.size),
          speed: random(...layer.speed),
          alpha: random(...layer.alpha),
          width: layer.width,
          splash: layer.width > 1,
        };
      },
      step(item, dt) {
        item.y += item.speed * dt * 60;
        item.x += item.speed * WIND * dt * 60;
      },
      draw(context, items, splashes) {
        const color = isDark() ? "196, 210, 232" : "86, 106, 136";
        context.lineCap = "round";
        for (const item of items) {
          context.strokeStyle = `rgba(${color}, ${item.alpha})`;
          context.lineWidth = item.width;
          context.beginPath();
          context.moveTo(item.x, item.y);
          context.lineTo(item.x - item.size * WIND, item.y - item.size);
          context.stroke();
        }
        for (const splash of splashes) {
          const progress = splash.age / 0.4;
          context.strokeStyle = `rgba(${color}, ${0.35 * (1 - progress)})`;
          context.lineWidth = 1;
          context.beginPath();
          context.ellipse(splash.x, splash.y, 2 + progress * 9, 1 + progress * 2.5, 0, Math.PI, Math.PI * 2);
          context.stroke();
        }
      },
    },
    sakura: {
      layers: [
        { count: 18, size: [5, 7], speed: [0.5, 0.8], alpha: [0.5, 0.7] },
        { count: 22, size: [7, 10], speed: [0.8, 1.2], alpha: [0.75, 0.95] },
        { count: 8, size: [10, 13], speed: [1.1, 1.6], alpha: [0.85, 1] },
      ],
      make(layer, width, height, scatter) {
        return {
          x: random(-60, width),
          y: scatter ? random(0, height) : random(-60, -12),
          size: random(...layer.size),
          speed: random(...layer.speed),
          alpha: random(...layer.alpha),
          color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
          angle: random(0, Math.PI * 2),
          spin: random(-0.02, 0.02),
          flip: random(0, Math.PI * 2),
          flipSpeed: random(0.02, 0.05),
          sway: random(0.4, 1.1),
          phase: random(0, Math.PI * 2),
        };
      },
      step(item, dt, time) {
        const frames = dt * 60;
        item.y += item.speed * frames;
        item.x += (0.45 + Math.sin(time * 0.9 + item.phase) * item.sway) * frames;
        item.angle += item.spin * frames;
        item.flip += item.flipSpeed * frames;
      },
      draw(context, items) {
        for (const item of items) {
          const s = item.size;
          context.save();
          context.translate(item.x, item.y);
          context.rotate(item.angle);
          context.scale(Math.max(0.15, Math.abs(Math.cos(item.flip))), 1);
          context.globalAlpha = item.alpha * (isDark() ? 0.85 : 1);
          context.fillStyle = item.color;
          // 花瓣：圆润的一头，另一头有个小缺口
          context.beginPath();
          context.moveTo(0, s);
          context.bezierCurveTo(s * 0.95, s * 0.55, s * 0.8, -s * 0.75, s * 0.18, -s);
          context.lineTo(0, -s * 0.72);
          context.lineTo(-s * 0.18, -s);
          context.bezierCurveTo(-s * 0.8, -s * 0.75, -s * 0.95, s * 0.55, 0, s);
          context.fill();
          context.globalAlpha *= 0.35;
          context.fillStyle = "#e0819c";
          context.beginPath();
          context.ellipse(0, s * 0.55, s * 0.12, s * 0.3, 0, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }
      },
    },
    leaves: {
      layers: [
        { count: 10, size: [7, 9], speed: [0.6, 0.9], alpha: [0.55, 0.7] },
        { count: 12, size: [10, 13], speed: [0.9, 1.3], alpha: [0.8, 0.95] },
        { count: 5, size: [13, 17], speed: [1.2, 1.7], alpha: [0.9, 1] },
      ],
      make(layer, width, height, scatter) {
        return {
          x: random(-60, width),
          y: scatter ? random(0, height) : random(-60, -14),
          size: random(...layer.size),
          speed: random(...layer.speed),
          alpha: random(...layer.alpha),
          color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
          angle: random(0, Math.PI * 2),
          spin: random(-0.03, 0.03),
          flip: random(0, Math.PI * 2),
          flipSpeed: random(0.015, 0.04),
          sway: random(0.6, 1.4),
          phase: random(0, Math.PI * 2),
        };
      },
      step(item, dt, time) {
        const frames = dt * 60;
        item.y += item.speed * frames;
        item.x += (0.3 + Math.sin(time * 0.7 + item.phase) * item.sway) * frames;
        item.angle += item.spin * frames;
        item.flip += item.flipSpeed * frames;
      },
      draw(context, items) {
        for (const item of items) {
          const s = item.size;
          context.save();
          context.translate(item.x, item.y);
          context.rotate(item.angle);
          context.scale(0.35 + 0.65 * Math.abs(Math.cos(item.flip)), 1);
          context.globalAlpha = item.alpha * (isDark() ? 0.85 : 1);
          context.fillStyle = item.color;
          // 叶片：两头尖的椭圆，加一条叶脉和一小截叶柄
          context.beginPath();
          context.moveTo(0, -s);
          context.quadraticCurveTo(s * 0.75, -s * 0.2, 0, s * 0.8);
          context.quadraticCurveTo(-s * 0.75, -s * 0.2, 0, -s);
          context.fill();
          context.strokeStyle = "rgba(90, 45, 20, 0.45)";
          context.lineWidth = 0.9;
          context.beginPath();
          context.moveTo(0, -s * 0.85);
          context.lineTo(0, s * 1.15);
          context.stroke();
          context.restore();
        }
      },
    },
  };

  let canvas = null;
  let context = null;
  let current = "off";
  let kind = null;
  let items = [];
  let splashes = [];
  let frame = 0;
  let last = 0;
  let clock = 0;
  let ratio = 1;
  let requested = "off";

  function density() {
    const area = (window.innerWidth * window.innerHeight) / (1440 * 900);
    return Math.max(0.35, Math.min(1.3, area));
  }

  function resize() {
    if (!canvas) return;
    ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function populate() {
    items = [];
    splashes = [];
    const scale = density();
    kind.layers.forEach((layer) => {
      const count = Math.round(layer.count * scale);
      for (let index = 0; index < count; index += 1) {
        const item = kind.make(layer, window.innerWidth, window.innerHeight, true);
        item.layer = layer;
        items.push(item);
      }
    });
  }

  function tick(time) {
    frame = 0;
    if (!canvas || !kind) return;
    const dt = last ? Math.min((time - last) / 1000, 0.05) : 1 / 60;
    last = time;
    clock += dt;
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (const item of items) {
      kind.step(item, dt, clock);
      if (item.y - item.size > height || item.x - item.size > width + 80) {
        if (item.splash && splashes.length < 24 && Math.random() < 0.5) splashes.push({ x: item.x, y: height - random(2, 14), age: 0 });
        Object.assign(item, kind.make(item.layer, width, height, false), { layer: item.layer });
      }
    }
    splashes = splashes.filter((splash) => (splash.age += dt) < 0.4);
    context.clearRect(0, 0, width, height);
    kind.draw(context, items, splashes);
    frame = window.requestAnimationFrame(tick);
  }

  function start() {
    if (frame || !kind || document.hidden) return;
    last = 0;
    frame = window.requestAnimationFrame(tick);
  }

  function stop() {
    window.cancelAnimationFrame(frame);
    frame = 0;
  }

  // Turbo 有自己的全屏画布；减少动态效果的访客不显示季节氛围。
  function allowed() {
    return !reducedMotion.matches && root.dataset.turbo !== "on";
  }

  function apply() {
    const target = allowed() ? resolveEffect(requested) : "off";
    if (target === current) return;
    current = target;
    const next = KINDS[target] || null;
    const swap = () => {
      stop();
      kind = next;
      if (!kind) {
        canvas?.remove();
        canvas = null;
        context = null;
        return;
      }
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.className = "season-canvas";
        canvas.setAttribute("aria-hidden", "true");
        document.body.append(canvas);
        context = canvas.getContext("2d");
        resize();
      }
      populate();
      canvas.classList.remove("is-leaving");
      start();
    };
    // 换效果时旧的先淡出，再换新的，免得两种粒子同时出现。
    if (canvas && canvas.isConnected) {
      canvas.classList.add("is-leaving");
      window.setTimeout(() => {
        if (current === target) swap();
      }, 450);
    } else {
      swap();
    }
  }

  function set(effect) {
    requested = EFFECTS.has(effect) ? effect : "off";
    apply();
  }

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  reducedMotion.addEventListener?.("change", apply);
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-turbo"] });

  window.functionhxSeasons = Object.freeze({ set, resolve: resolveEffect });
  set(root.dataset.publishedSeasonEffect || "off");
})();
