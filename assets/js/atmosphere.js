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
          // 圆圈的前沿就是风的前沿：从按钮处吹起，扫过哪里，那里的叶子就被卷走。
          // 快照那一小段时间页面本身会停住，风在动画开始的这一刻才起，停顿读起来像起风前的屏息。
          gust(x, y, radius, 420);
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            // 快起步、慢收尾：一点下去圆圈立刻冲出去，截图冻住的时间更短。
            { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
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
    // 飘雪：参照 Voyager 的做法——三层景深（尘埃 / 中景 / 前景）共约 240 颗，尘埃层是极细的亚像素小点，
    // 每颗有自己的缓慢正弦飘移，水平方向出屏后从另一侧绕回来。
    snow: {
      layers: [
        { count: 100, size: [0.3, 0.75], speed: [0.15, 0.4], alpha: [0.2, 0.42], drift: [0.05, 0.2] },
        { count: 80, size: [0.7, 1.3], speed: [0.4, 1], alpha: [0.35, 0.65], drift: [0.15, 0.45] },
        { count: 60, size: [1.4, 2.7], speed: [0.8, 1.6], alpha: [0.55, 0.85], drift: [0.25, 0.6] },
      ],
      make(layer, width, height, scatter) {
        return {
          x: random(0, width),
          y: scatter ? random(0, height) : -random(2, 40),
          size: random(...layer.size),
          speed: random(...layer.speed),
          alpha: random(...layer.alpha),
          drift: random(...layer.drift),
          freq: random(0.3, 1.2),
          phase: random(0, Math.PI * 2),
        };
      },
      step(item, dt, time) {
        const frames = dt * 60;
        item.y += item.speed * frames;
        item.x += Math.sin(item.phase + time * item.freq) * item.drift * frames;
        const width = window.innerWidth;
        if (item.x > width + item.size) item.x = -item.size;
        else if (item.x < -item.size) item.x = width + item.size;
      },
      draw(context, items) {
        const dark = isDark();
        for (const item of items) {
          if (dark) {
            context.fillStyle = `rgba(255, 255, 255, ${item.alpha})`;
            context.beginPath();
            context.arc(item.x, item.y, item.size, 0, Math.PI * 2);
            context.fill();
            continue;
          }
          // 浅色背景上白色的雪看不见：改成实心的浅蓝灰，大一点的再点一粒高光，像有体积的雪球。
          context.fillStyle = `rgba(132, 158, 196, ${Math.min(1, item.alpha + 0.12)})`;
          context.beginPath();
          context.arc(item.x, item.y, item.size, 0, Math.PI * 2);
          context.fill();
          if (item.size > 1.2) {
            context.fillStyle = `rgba(255, 255, 255, ${Math.min(1, item.alpha + 0.2)})`;
            context.beginPath();
            context.arc(item.x - item.size * 0.28, item.y - item.size * 0.28, item.size * 0.42, 0, Math.PI * 2);
            context.fill();
          }
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
          drawWithTrail(context, item, (alpha, dx, dy) => {
            const s = item.size;
            context.save();
            context.translate(item.x + dx, item.y + dy);
            context.rotate(item.angle);
            context.scale(Math.max(0.15, Math.abs(Math.cos(item.flip))), 1);
            context.globalAlpha = alpha * (isDark() ? 0.85 : 1);
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
          });
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
          drawWithTrail(context, item, (alpha, dx, dy, trail) => {
            const s = item.size;
            context.save();
            context.translate(item.x + dx, item.y + dy);
            context.rotate(item.angle);
            context.scale(0.35 + 0.65 * Math.abs(Math.cos(item.flip)), 1);
            context.globalAlpha = alpha * (isDark() ? 0.85 : 1);
            context.fillStyle = item.color;
            // 叶片：两头尖的椭圆，加一条叶脉和一小截叶柄
            context.beginPath();
            context.moveTo(0, -s);
            context.quadraticCurveTo(s * 0.75, -s * 0.2, 0, s * 0.8);
            context.quadraticCurveTo(-s * 0.75, -s * 0.2, 0, -s);
            context.fill();
            if (!trail) {
              context.strokeStyle = "rgba(90, 45, 20, 0.45)";
              context.lineWidth = 0.9;
              context.beginPath();
              context.moveTo(0, -s * 0.85);
              context.lineTo(0, s * 1.15);
              context.stroke();
            }
            context.restore();
          });
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
  // 一阵风：从 (x, y) 起，前沿半径按揭开动画的节奏扩大，被前沿扫到的粒子获得一个向外的冲量。
  let wind = null;
  // 关闭时不让粒子突然消失：不再生成新的，已有的继续落出屏幕，落完再撤掉画布。
  let draining = false;
  let drainStart = 0;
  const GUST_FORCE = { leaves: 1, sakura: 0.8, snow: 0.45, rain: 0.2 };

  // 与揭开动画 cubic-bezier(0.22, 1, 0.36, 1) 近似的缓出曲线。
  const easeOut = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3.6);

  function gust(x, y, radius, duration) {
    if (!canvas || !kind || reducedMotion.matches) return;
    wind = { x, y, radius, duration, start: window.performance.now(), force: GUST_FORCE[current] ?? 0.4 };
    for (const item of items) item.swept = false;
  }

  function applyWind(item, dt) {
    if (!wind) return;
    if (!item.swept) {
      const progress = easeOut((window.performance.now() - wind.start) / wind.duration);
      const dx = item.x - wind.x;
      const dy = item.y - wind.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance > progress * wind.radius) return;
      item.swept = true;
      // 大的（近处的）叶子被吹得更猛；沿半径方向向外，再加一点切向的卷曲。
      const depth = Math.min(Math.max((item.size || 6) / 10, 0.7), 1.5);
      const power = random(520, 900) * depth * wind.force;
      const curl = random(0.25, 0.55) * (Math.random() < 0.5 ? 1 : -1);
      item.kx = (dx / distance - (dy / distance) * curl) * power;
      item.ky = (dy / distance + (dx / distance) * curl) * power - power * 0.12;
      if ("spin" in item) item.gustSpin = random(0.12, 0.3) * (Math.random() < 0.5 ? 1 : -1) * wind.force;
    }
    if (!item.kx && !item.ky) return;
    item.x += item.kx * dt;
    item.y += item.ky * dt;
    if (item.gustSpin) {
      item.angle += item.gustSpin * dt * 60;
      item.flip += Math.abs(item.gustSpin) * dt * 30;
    }
    // 风势逐渐减弱，叶子回到自己的节奏里继续飘。
    const decay = Math.exp(-dt / 0.55);
    item.kx *= decay;
    item.ky *= decay;
    if (item.gustSpin) item.gustSpin *= decay;
    if (Math.hypot(item.kx, item.ky) < 8) item.kx = item.ky = item.gustSpin = 0;
  }

  // 被风吹着的时候，沿来路补两道淡淡的残影，看起来更有速度。
  function drawWithTrail(context, item, paint) {
    const speed = Math.hypot(item.kx || 0, item.ky || 0);
    if (speed > 90) {
      const length = Math.min(speed * 0.014, 14);
      const ux = item.kx / speed;
      const uy = item.ky / speed;
      paint(item.alpha * 0.16, -ux * length * 2, -uy * length * 2, true);
      paint(item.alpha * 0.3, -ux * length, -uy * length, true);
    }
    paint(item.alpha, 0, 0, false);
  }

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
    if (wind && window.performance.now() - wind.start > 2200) wind = null;
    for (const item of items) {
      if (item.dead) continue;
      // 落完之前越落越快：最细的尘埃层每秒只落几像素，不加速的话要一分多钟才撤得干净。
      const boost = draining ? Math.min(1 + ((window.performance.now() - drainStart) / 1000) * 0.9, 9) : 1;
      kind.step(item, dt * boost, clock);
      applyWind(item, dt);
      // 被吹出屏幕左边或上边的，回到顶部重新飘下来。
      const gone = item.x + item.size < -120 || item.y + item.size < -220;
      if (gone || item.y - item.size > height || item.x - item.size > width + 80) {
        if (draining) {
          item.dead = true;
          continue;
        }
        if (item.splash && splashes.length < 24 && Math.random() < 0.5) splashes.push({ x: item.x, y: height - random(2, 14), age: 0 });
        Object.assign(item, kind.make(item.layer, width, height, false), { layer: item.layer });
        // 重新飘下来的叶子不带走旧的风势，也不再被这一阵风卷第二次。
        Object.assign(item, { kx: 0, ky: 0, gustSpin: 0, swept: true });
      }
    }
    if (draining) {
      items = items.filter((item) => !item.dead);
      if (!items.length) {
        finishDrain();
        return;
      }
    }
    splashes = splashes.filter((splash) => (splash.age += dt) < 0.4);
    context.clearRect(0, 0, width, height);
    kind.draw(context, items, splashes);
    frame = window.requestAnimationFrame(tick);
  }

  function finishDrain() {
    draining = false;
    stop();
    canvas?.remove();
    canvas = null;
    context = null;
    kind = null;
    items = [];
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
    // 关成「关闭」时让已有的粒子自然落完；减少动态效果或进入 Turbo 时则立刻撤掉。
    if (!next && allowed() && canvas && kind) {
      draining = true;
      drainStart = window.performance.now();
      return;
    }
    const swap = () => {
      draining = false;
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

  window.functionhxSeasons = Object.freeze({ set, resolve: resolveEffect, gust });
  set(root.dataset.publishedSeasonEffect || "off");
})();
