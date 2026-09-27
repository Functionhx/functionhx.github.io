(function initializeEggs() {
  "use strict";

  // 隐藏彩蛋。访客点导航栏的齿轮打开「彩蛋图鉴」，长按齿轮（或 Alt+Enter）才是站长登录；
  // 已验证的站长点齿轮直接打开站点设置（由 site-settings.js 处理）。
  // 彩蛋：Turbo（长按主题按钮，turbo-mode.js）、机器狗（↑↑↓↓←→←→BA）、终端（` 键）、
  // f(x)（首页连点 ƒ 五下）、一封信（暗号拿到信封，六位密码拆信）。

  const root = document.documentElement;
  const configNode = document.getElementById("function-eggs-config");
  if (!configNode) return;
  let config = {};
  try {
    config = JSON.parse(configNode.textContent || "{}");
  } catch (_error) {
    return;
  }

  const FOUND_KEY = "functionhx:eggs:found";
  const HOLD_DURATION = 700;
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  const EGGS = [
    { id: "turbo", icon: "⚡", name: "Turbo 模式", hint: "有个按钮，按住它久一点。" },
    { id: "dog", icon: "🐕", name: "机器狗", hint: "一段三十多年前的游戏秘籍，用方向键和 B、A。" },
    { id: "terminal", icon: "⌨️", name: "终端", hint: "键盘左上角，数字 1 的旁边。" },
    { id: "fx", icon: "ƒ", name: "f(x)", hint: "首页左上角的 ƒ 好像不只是个标志。" },
    { id: "letter", icon: "✉️", name: "一封信", hint: "只有一个人知道暗号。", phrase: true },
  ].filter((egg) => egg.id !== "letter" || hasLetter());
  const publicHints = config.public && typeof config.public === "object" ? config.public : {};

  function hasLetter() {
    const letter = config.letter;
    return Boolean(letter && letter.v === 2 && letter.salt && letter.iv && letter.data);
  }

  function readFound() {
    try {
      const value = JSON.parse(window.localStorage.getItem(FOUND_KEY) || "[]");
      return new Set(Array.isArray(value) ? value : []);
    } catch (_error) {
      return new Set();
    }
  }
  const found = readFound();

  function markFound(id) {
    if (found.has(id)) return;
    found.add(id);
    try {
      window.localStorage.setItem(FOUND_KEY, JSON.stringify([...found]));
    } catch (_error) {
      /* 进度只是锦上添花，存不下也不影响彩蛋本身。 */
    }
    if (gallery) renderGallery();
  }

  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  function isTyping(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']"));
  }

  function anyOverlayOpen() {
    return Boolean(document.querySelector("dialog[open], .egg-overlay"));
  }

  // ---------- 加密：PBKDF2 + AES-GCM，两层 ----------
  // 外层用暗号加密，里面是「用六位密码加密的信」和密码提示：暗号只能拿到上了锁的信封。
  const encoder = new TextEncoder();
  const toBase64 = (buffer) => {
    let binary = "";
    new Uint8Array(buffer).forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
  };
  const fromBase64 = (value) => Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0));
  // 与 letter-mailer/worker.mjs 的 normalizePhrase 保持一致。
  const normalize = (value) =>
    String(value || "")
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

  async function deriveKey(secret, salt) {
    const base = await window.crypto.subtle.importKey("raw", encoder.encode(normalize(secret)), "PBKDF2", false, ["deriveKey"]);
    return window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptWith(secret, value) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const data = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
    return { salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
  }

  async function decryptWith(secret, box) {
    try {
      const key = await deriveKey(secret, fromBase64(box.salt));
      const plain = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(box.iv) }, key, fromBase64(box.data));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (_error) {
      return null;
    }
  }

  async function sealLetter({ phrase, pin, title, text, sign, pinHint }) {
    if (!normalize(phrase)) throw new Error("暗号不能为空。");
    if (!/^\d{6}$/.test(String(pin || ""))) throw new Error("密码需要是 6 位数字。");
    const inner = await encryptWith(String(pin), { title, text, sign });
    return { v: 2, ...(await encryptWith(phrase, { inner, pinHint: pinHint || "" })) };
  }

  async function revealEnvelope(phrase) {
    if (!hasLetter()) return null;
    const envelope = await decryptWith(phrase, config.letter);
    return envelope?.inner ? { ...envelope, phrase } : null;
  }

  // ---------- 图鉴 ----------
  const gear = document.getElementById("site-settings-toggle");
  let gallery = null;

  function ownerVerified() {
    return root.dataset.ownerVerified === "true";
  }

  function renderGallery() {
    const shown = EGGS.filter((egg) => publicHints[egg.id] || found.has(egg.id));
    const hiddenCount = EGGS.length - shown.length;
    const discovered = EGGS.filter((egg) => found.has(egg.id)).length;
    gallery.innerHTML = `
      <header><h2 id="egg-gallery-title">彩蛋图鉴</h2><span>已发现 ${discovered} / ${EGGS.length}</span></header>
      <div class="egg-progress" aria-hidden="true"><i style="width:${(discovered / Math.max(EGGS.length, 1)) * 100}%"></i></div>
      <ul class="egg-list">${shown
        .map((egg) => {
          const isFound = found.has(egg.id);
          return `<li class="egg-item" data-found="${isFound}">
            <span class="egg-icon" aria-hidden="true">${egg.icon}</span>
            <div>
              <strong>${isFound ? `${escapeHtml(egg.name)}<span class="egg-found">已发现</span>` : "？？？"}</strong>
              <p>${escapeHtml(egg.hint)}</p>
              ${
                egg.phrase
                  ? `<form class="egg-phrase" data-egg-phrase><input aria-label="暗号" placeholder="输入暗号" autocomplete="off" maxlength="64"><button type="submit">打开</button></form><p class="egg-phrase-status" role="status"></p>`
                  : ""
              }
            </div>
          </li>`;
        })
        .join("")}</ul>
      ${hiddenCount ? `<p class="egg-secret-count">还有 ${hiddenCount} 个彩蛋没有线索。</p>` : ""}`;
    gallery.querySelector("[data-egg-phrase]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = event.currentTarget.querySelector("input");
      const status = gallery.querySelector(".egg-phrase-status");
      status.textContent = "正在核对暗号…";
      const envelope = await revealEnvelope(input.value);
      if (!envelope) {
        status.textContent = "暗号不对。再想想？";
        input.select();
        return;
      }
      closeGallery();
      showLetter(envelope);
    });
  }

  function placeGallery() {
    if (!gallery || !gear) return;
    const rect = gear.getBoundingClientRect();
    const top = rect.width ? rect.bottom + 12 : 76;
    const right = rect.width ? Math.max(12, window.innerWidth - rect.right - 8) : 16;
    gallery.style.top = `${top}px`;
    gallery.style.right = `${right}px`;
  }

  function openGallery() {
    if (gallery) return;
    window.functionhxOwnerUi?.closePrimaryNavigation?.();
    gallery = document.createElement("section");
    gallery.className = "egg-gallery";
    gallery.setAttribute("role", "dialog");
    gallery.setAttribute("aria-labelledby", "egg-gallery-title");
    document.body.append(gallery);
    renderGallery();
    placeGallery();
    gear?.setAttribute("aria-expanded", "true");
    gallery.querySelector("input")?.focus({ preventScroll: true });
  }

  function closeGallery(returnFocus = false) {
    if (!gallery) return;
    gallery.remove();
    gallery = null;
    gear?.setAttribute("aria-expanded", "false");
    if (returnFocus) gear?.focus();
  }

  document.addEventListener("click", (event) => {
    if (gallery && !gallery.contains(event.target) && !gear?.contains(event.target)) closeGallery();
  });
  window.addEventListener("resize", placeGallery, { passive: true });

  // ---------- 齿轮：点一下是图鉴，长按是站长登录 ----------
  // 站长登录走 site-settings.js 的流程：给齿轮打上 ownerIntent 标记再点一次，
  // admin-loader.js 会先载入设置模块，site-settings.js 读到标记后发起登录。
  let holdTimer = 0;
  let suppressNextClick = false;

  function requestOwnerLogin() {
    if (!gear) return;
    closeGallery();
    gear.dataset.ownerIntent = "true";
    gear.click();
  }

  if (gear) {
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ring.setAttribute("class", "egg-hold-ring");
    ring.setAttribute("viewBox", "0 0 46 46");
    ring.setAttribute("aria-hidden", "true");
    ring.innerHTML = '<rect x="1" y="1" width="44" height="44" rx="13" pathLength="100"></rect>';
    const tip = document.createElement("span");
    tip.className = "egg-hold-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.textContent = "继续按住 · 站长登录";
    gear.append(ring, tip);

    const cancelHold = () => {
      window.clearTimeout(holdTimer);
      holdTimer = 0;
      gear.classList.remove("is-egg-holding");
    };
    gear.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || ownerVerified()) return;
      gear.classList.add("is-egg-holding");
      holdTimer = window.setTimeout(() => {
        holdTimer = 0;
        gear.classList.remove("is-egg-holding");
        gear.classList.add("is-egg-done");
        suppressNextClick = true;
        window.setTimeout(() => {
          gear.classList.remove("is-egg-done");
          requestOwnerLogin();
        }, 240);
      }, HOLD_DURATION);
    });
    gear.addEventListener("pointerup", cancelHold);
    // 长按后登录框会立刻盖住齿轮，松手那一下未必落在齿轮上；无论落在哪里，
    // 这次松手之后都清掉「吞掉下一次点击」的标记，免得误吞之后的正常点击。
    window.addEventListener(
      "pointerup",
      () => {
        if (suppressNextClick) window.setTimeout(() => (suppressNextClick = false), 0);
      },
      true
    );
    gear.addEventListener("pointerleave", cancelHold);
    gear.addEventListener("pointercancel", cancelHold);
    gear.addEventListener("contextmenu", (event) => {
      if (!ownerVerified()) event.preventDefault();
    });
    gear.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.altKey && !ownerVerified()) {
        event.preventDefault();
        requestOwnerLogin();
      }
    });

    // 在 window 捕获阶段处理，早于 admin-loader.js 在 document 上的拦截。
    window.addEventListener(
      "click",
      (event) => {
        if (!gear.contains(event.target)) return;
        if (suppressNextClick && event.detail > 0) {
          suppressNextClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (ownerVerified() || gear.dataset.ownerIntent === "true") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (gallery) closeGallery();
        else openGallery();
      },
      true
    );
  }

  // ---------- Turbo：turbo-mode.js 打开时记为已发现 ----------
  if (root.dataset.turbo === "on") markFound("turbo");
  new MutationObserver(() => {
    if (root.dataset.turbo === "on") markFound("turbo");
  }).observe(root, { attributes: true, attributeFilter: ["data-turbo"] });

  // ---------- 通用浮层 ----------
  function openOverlay(className, html, label) {
    const overlay = document.createElement("div");
    overlay.className = `egg-overlay ${className}`;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", label);
    overlay.innerHTML = html;
    const previousFocus = document.activeElement;
    document.body.append(overlay);
    const close = () => {
      overlay.dispatchEvent(new CustomEvent("egg:close"));
      overlay.remove();
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && !overlay.classList.contains("egg-letter")) close();
    });
    overlay.egg = { close };
    return overlay;
  }

  // ---------- 机器狗 ----------
  const DOG_SVG = `<svg viewBox="0 0 52 30" aria-hidden="true" shape-rendering="crispEdges">
    <rect x="8" y="8" width="30" height="10" fill="#2b2733"/><rect x="10" y="9" width="26" height="3" fill="#4d4659"/>
    <rect x="36" y="4" width="12" height="9" fill="#2b2733"/><rect x="44" y="7" width="4" height="3" fill="#c5a2ff"/>
    <rect x="46" y="2" width="2" height="3" fill="#2b2733"/><rect x="4" y="9" width="5" height="2" fill="#2b2733"/>
    <rect x="18" y="12" width="10" height="2" fill="#6434b2"/>
    <g class="egg-legs-a" fill="#2b2733"><rect x="11" y="18" width="3" height="8"/><rect x="31" y="18" width="3" height="8"/><rect x="9" y="26" width="5" height="2"/><rect x="31" y="26" width="5" height="2"/></g>
    <g class="egg-legs-b" fill="#2b2733"><rect x="15" y="18" width="3" height="8"/><rect x="27" y="18" width="3" height="8"/><rect x="15" y="26" width="5" height="2"/><rect x="27" y="26" width="5" height="2"/></g>
  </svg>`;

  function runDog() {
    markFound("dog");
    if (document.querySelector(".egg-dog-lane")) return;
    const lane = document.createElement("div");
    lane.className = "egg-dog-lane";
    lane.setAttribute("aria-hidden", "true");
    lane.innerHTML = `<div class="egg-dog">${DOG_SVG}<span class="egg-dog-bubble">汪！0 1 0 1</span></div>`;
    document.body.append(lane);
    const dog = lane.querySelector(".egg-dog");
    const finish = () => lane.remove();
    dog.addEventListener("animationend", finish, { once: true });
    window.setTimeout(finish, 6000);
  }

  // ---------- 终端 ----------
  let terminal = null;
  const FORTUNES = [
    "机器人不会累，但它的电池会。",
    "先让它跑起来，再让它跑得对，最后让它跑得快。",
    "真机永远比仿真多一个 bug。",
    "今天也要记得保存 rosbag。",
  ];

  function openTerminal() {
    if (terminal) return;
    markFound("terminal");
    terminal = openOverlay(
      "egg-terminal-backdrop",
      `<div class="egg-terminal">
        <div class="egg-terminal-bar"><i></i><i></i><i></i><span>visitor@function: ~</span><button type="button" data-egg-exit>esc</button></div>
        <div class="egg-terminal-log" aria-live="polite"></div>
        <form class="egg-terminal-input"><label for="egg-terminal-command">visitor@function:~$</label><input id="egg-terminal-command" autocomplete="off" spellcheck="false" autocapitalize="off"></form>
      </div>`,
      "终端"
    );
    const log = terminal.querySelector(".egg-terminal-log");
    const input = terminal.querySelector("input");
    const print = (html) => {
      log.insertAdjacentHTML("beforeend", `${html}\n`);
      log.scrollTop = log.scrollHeight;
    };
    const close = () => terminal?.egg.close();
    terminal.addEventListener("egg:close", () => {
      terminal = null;
    });
    print('<span class="egg-accent">Function OS</span> <span class="egg-dim">· 输入 help 查看命令，esc 退出</span>');
    const commands = {
      help: () => print('<span class="egg-dim">可用命令：</span> whoami  ls  cat about.txt  fortune  dog  date  unlock &lt;暗号&gt;  clear  exit'),
      whoami: () => print("visitor —— 一位好奇的访客。欢迎你。"),
      ls: (argument) =>
        print(
          argument.replace(/\/$/, "") === "secrets"
            ? '<span class="egg-dim">ls: secrets/: 权限不够。也许去齿轮里看看？</span>'
            : "about.txt  projects/  tools/  blog/  secrets/"
        ),
      cat: (argument) =>
        print(
          argument === "about.txt"
            ? "樊宇琛 · Function\n北京理工大学，机器人工程本科生。\n关注自主系统、具身智能、三维场景智能与 AI 系统工程。"
            : `<span class="egg-dim">cat: ${escapeHtml(argument)}: 没有这个文件</span>`
        ),
      fortune: () => print(escapeHtml(FORTUNES[Math.floor(Math.random() * FORTUNES.length)])),
      dog: () => {
        print("正在放出机器狗……");
        runDog();
      },
      date: () => print(new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })),
      sudo: () => print('<span class="egg-dim">visitor 不在 sudoers 文件中。此事将被报告（给 ƒ）。</span>'),
      clear: () => {
        log.innerHTML = "";
      },
      exit: close,
      unlock: async (argument) => {
        const envelope = await revealEnvelope(argument);
        if (!envelope) {
          print('<span class="egg-dim">unlock: 暗号不对</span>');
          return;
        }
        print('<span class="egg-accent">✉ 找到一封上了锁的信</span>');
        window.setTimeout(() => {
          close();
          showLetter(envelope);
        }, 500);
      },
    };
    terminal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const line = input.value.trim();
      input.value = "";
      if (!line) return;
      print(`<span class="egg-accent">visitor@function:~$</span> ${escapeHtml(line)}`);
      const [name, ...rest] = line.split(/\s+/);
      const run = Object.hasOwn(commands, name.toLowerCase()) ? commands[name.toLowerCase()] : null;
      if (run) run(rest.join(" "));
      else print(`<span class="egg-dim">${escapeHtml(name)}: 找不到命令。输入 help 看看。</span>`);
    });
    terminal.querySelector("[data-egg-exit]").addEventListener("click", close);
    input.focus();
  }

  // ---------- f(x)：首页连点 ƒ 五下 ----------
  let taps = [];
  function showFunction() {
    markFound("fx");
    const overlay = openOverlay(
      "egg-fx-backdrop",
      `<div class="egg-fx">
        <div class="egg-fx-glyph" aria-hidden="true">ƒ</div>
        <div class="egg-fx-formula" aria-live="polite"></div>
        <svg viewBox="0 0 400 150" aria-hidden="true"><path class="egg-fx-axis" d="M10 120H390M30 140V10"/>
          <path class="egg-fx-curve" d="M30 118 C 90 116, 120 104, 160 88 S 240 40, 290 30 S 360 18, 390 14"/><circle class="egg-fx-dot" cx="390" cy="14" r="5"/></svg>
        <p class="egg-fx-caption">输入好奇心，输出一点点新东西。</p>
        <button class="egg-button" type="button">收起</button>
      </div>`,
      "f(x)"
    );
    const formula = overlay.querySelector(".egg-fx-formula");
    const text = "f(x) = 樊宇琛";
    let index = 0;
    const type = () => {
      index += 1;
      formula.innerHTML = escapeHtml(text.slice(0, index)).replace("樊宇琛", "<b>樊宇琛</b>");
      if (index < text.length && overlay.isConnected) window.setTimeout(type, 90);
    };
    window.setTimeout(type, 700);
    overlay.querySelector(".egg-button").addEventListener("click", () => overlay.egg.close());
    overlay.querySelector(".egg-button").focus({ preventScroll: true });
  }

  document.addEventListener("click", (event) => {
    const brand = event.target.closest?.(".function-wordmark, .function-mobile-brand");
    if (!brand) return;
    const link = brand.closest("a") || brand;
    const home = new URL(config.home || "/", window.location.href).pathname;
    // 只在首页计数：其它页面上点 ƒ 仍然是回到首页。
    if (window.location.pathname !== home || !link.matches("a")) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    const now = window.performance.now();
    taps = taps.filter((time) => now - time < 2000).concat(now);
    if (taps.length >= 5) {
      taps = [];
      showFunction();
    }
  });

  // ---------- 一封信 ----------
  function sparkle(canvas) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = canvas.getContext("2d");
    if (!context) return () => {};
    let width = 0;
    let height = 0;
    let frame = 0;
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    window.addEventListener("resize", resize);
    const dots = Array.from({ length: reduce ? 30 : 60 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.8 + 0.4,
      s: Math.random() * 0.25 + 0.05,
      p: Math.random() * Math.PI * 2,
    }));
    let last = 0;
    const draw = (time) => {
      // 30 帧足够，背景星点不需要更高帧率。
      if (time - last >= 33) {
        last = time;
        context.clearRect(0, 0, width, height);
        for (const dot of dots) {
          if (!reduce) {
            dot.y -= dot.s * 2;
            if (dot.y < -5) {
              dot.y = height + 5;
              dot.x = Math.random() * width;
            }
          }
          context.beginPath();
          context.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
          context.fillStyle = `rgba(233, 214, 255, ${0.35 + 0.35 * Math.sin(time / 900 + dot.p)})`;
          context.fill();
        }
      }
      if (!reduce) frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }

  const MAILER_ERRORS = {
    wrong_phrase: "暗号对不上，邮件没有发出。",
    invalid_email: "邮箱格式好像不对。",
    rate_limited: "今天发得有点多了，明天再试，或者自己猜猜看？",
    origin_denied: "这个页面暂时不能发邮件。",
    not_configured: "发信服务还没准备好。",
    send_failed: "邮件暂时发不出去，稍后再试。",
  };

  async function mailPin(phrase, email) {
    if (!config.mailer) return { ok: false, message: "发信服务还没准备好。" };
    try {
      const response = await window.fetch(new URL("/send-pin", config.mailer), {
        body: JSON.stringify({ email, phrase }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.ok) return { ok: true };
      const body = await response.json().catch(() => ({}));
      return { ok: false, message: MAILER_ERRORS[body.error] || "邮件暂时发不出去，稍后再试。" };
    } catch (_error) {
      return { ok: false, message: "连不上发信服务，可能是网络的问题，稍后再试。" };
    }
  }

  function showLetter(envelope) {
    markFound("letter");
    const overlay = openOverlay(
      "egg-letter",
      `<canvas aria-hidden="true"></canvas>
      <div class="egg-letter-stage">
        <div class="egg-envelope is-locked" aria-hidden="true"><span class="egg-envelope-body"></span><span class="egg-envelope-flap"></span><span class="egg-envelope-pocket"></span><span class="egg-envelope-seal">ƒ</span></div>
        <form class="egg-pin" autocomplete="off">
          <p class="egg-pin-title">这封信上了锁</p>
          <div class="egg-pin-boxes" role="group" aria-label="六位密码">${Array.from(
            { length: 6 },
            (_, index) => `<input inputmode="numeric" pattern="[0-9]" maxlength="1" aria-label="第 ${index + 1} 位">`
          ).join("")}</div>
          <p class="egg-pin-status" role="status"></p>
          <button class="egg-pin-mail-toggle" type="button">不知道密码？发到我的邮箱</button>
          <div class="egg-pin-mail" hidden>
            <input type="email" placeholder="你的邮箱" aria-label="你的邮箱" autocomplete="email" maxlength="254">
            <button type="button">发送</button>
          </div>
        </form>
      </div>
      <article class="egg-paper" tabindex="-1"><h3></h3><p class="egg-paper-text"></p><p class="egg-paper-sign"></p><button class="egg-paper-close" type="button">把信收好</button></article>
      <button class="egg-letter-dismiss" type="button" aria-label="关闭">×</button>`,
      "一封上了锁的信"
    );
    const stop = sparkle(overlay.querySelector("canvas"));
    overlay.addEventListener("egg:close", stop);
    overlay.querySelector(".egg-letter-dismiss").addEventListener("click", () => overlay.egg.close());
    overlay.querySelector(".egg-paper-close").addEventListener("click", () => overlay.egg.close());

    const form = overlay.querySelector(".egg-pin");
    const boxes = [...form.querySelectorAll(".egg-pin-boxes input")];
    const status = form.querySelector(".egg-pin-status");
    const envelopeNode = overlay.querySelector(".egg-envelope");
    const paper = overlay.querySelector(".egg-paper");
    let misses = 0;
    let checking = false;
    boxes[0].focus();

    async function tryPin() {
      const pin = boxes.map((box) => box.value).join("");
      if (pin.length < 6 || checking) return;
      checking = true;
      status.textContent = "正在开锁…";
      const letter = await decryptWith(pin, envelope.inner);
      checking = false;
      if (!letter) {
        misses += 1;
        status.textContent = misses >= 3 && envelope.pinHint ? `不对哦。提示：${envelope.pinHint}` : "不对哦，再试试？";
        form.classList.remove("is-wrong");
        void form.offsetWidth;
        form.classList.add("is-wrong");
        boxes.forEach((box) => {
          box.value = "";
        });
        boxes[0].focus();
        return;
      }
      status.textContent = "";
      form.classList.add("is-open");
      envelopeNode.classList.remove("is-locked");
      paper.querySelector("h3").textContent = letter.title || "给你";
      paper.querySelector(".egg-paper-text").textContent = letter.text || "";
      paper.querySelector(".egg-paper-sign").textContent = letter.sign || "";
      window.setTimeout(() => envelopeNode.classList.add("is-open"), 350);
      window.setTimeout(() => paper.classList.add("is-shown"), 700);
      window.setTimeout(() => {
        envelopeNode.style.visibility = "hidden";
        paper.focus({ preventScroll: true });
      }, 1700);
    }

    boxes.forEach((box, index) => {
      box.addEventListener("input", () => {
        box.value = box.value.replace(/\D/g, "").slice(-1);
        if (box.value && index < 5) boxes[index + 1].focus();
        tryPin();
      });
      box.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && !box.value && index > 0) boxes[index - 1].focus();
      });
      box.addEventListener("paste", (event) => {
        const digits = (event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
        if (!digits) return;
        event.preventDefault();
        digits.split("").forEach((digit, position) => {
          boxes[position].value = digit;
        });
        boxes[Math.min(digits.length, 5)].focus();
        tryPin();
      });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      tryPin();
    });

    const mail = form.querySelector(".egg-pin-mail");
    const mailInput = mail.querySelector("input");
    const mailButton = mail.querySelector("button");
    form.querySelector(".egg-pin-mail-toggle").addEventListener("click", () => {
      mail.hidden = !mail.hidden;
      if (!mail.hidden) mailInput.focus();
    });
    const sendMail = async () => {
      if (!mailInput.value || !mailInput.checkValidity()) {
        status.textContent = "邮箱格式好像不对。";
        mailInput.focus();
        return;
      }
      mailButton.disabled = true;
      status.textContent = "正在发送…";
      const result = await mailPin(envelope.phrase, mailInput.value.trim());
      mailButton.disabled = false;
      if (result.ok) {
        status.textContent = "密码已经发到你的邮箱，去看看吧。";
        mail.hidden = true;
        boxes[0].focus();
      } else {
        status.textContent = result.message;
      }
    };
    mailButton.addEventListener("click", sendMail);
    mailInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        sendMail();
      }
    });
  }

  // ---------- 键盘 ----------
  let konami = 0;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (gallery) {
        closeGallery(true);
        return;
      }
      const overlay = document.querySelector(".egg-overlay");
      if (overlay) {
        event.preventDefault();
        overlay.egg?.close();
      }
      return;
    }
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    konami = key === KONAMI[konami] ? konami + 1 : key === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) {
      konami = 0;
      runDog();
    }
    if (event.key === "`" && !anyOverlayOpen()) {
      event.preventDefault();
      openTerminal();
    }
  });

  window.functionhxEggs = Object.freeze({ eggs: EGGS.map(({ id, name }) => ({ id, name })), sealLetter });
})();
