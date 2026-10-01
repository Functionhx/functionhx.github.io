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
  const ALL_EGGS = [
    { id: "turbo", icon: "⚡", name: "Turbo 模式", hint: "有个按钮，按住它久一点。" },
    { id: "dog", icon: "🐕", name: "机器狗", hint: "一段三十多年前的游戏秘籍，用方向键和 B、A。" },
    { id: "terminal", icon: "⌨️", name: "终端", hint: "键盘左上角，数字 1 的旁边。" },
    { id: "fx", icon: "ƒ", name: "f(x)", hint: "首页左上角的 ƒ 好像不只是个标志。" },
    { id: "night", icon: "🌙", name: "深夜来访", hint: "有些话，只在午夜之后说。" },
    { id: "idle", icon: "🖥️", name: "屏保", hint: "什么都别做，静静等上一分钟。" },
    { id: "console", icon: "🛠️", name: "控制台", hint: "开发者工具里，也有人在等你。" },
    { id: "tab", icon: "👀", name: "标签页", hint: "切到别的标签页，再回来看看。" },
    { id: "letter", icon: "✉️", name: "一封信", hint: "只有一个人知道暗号。", phrase: true },
  ];
  const publicHints = config.public && typeof config.public === "object" ? config.public : {};
  // 图鉴里有哪些彩蛋：那封信写好之前不出现。站长在站点设置里改动后（runtime-settings.js）会重新算一遍。
  const EGGS = [];
  function rebuildEggs() {
    EGGS.length = 0;
    EGGS.push(...ALL_EGGS.filter((egg) => egg.id !== "letter" || hasLetter()));
  }

  function hasLetter() {
    const letter = config.letter;
    return Boolean(letter && letter.v === 2 && letter.salt && letter.iv && letter.data);
  }

  rebuildEggs();

  // 站长实时改的线索开关和那封信：取到新值后更新图鉴。
  function applyRuntimeEggs(settings) {
    const eggs = settings?.eggs;
    if (!eggs) return;
    if (eggs.public) Object.assign(publicHints, eggs.public);
    if ("letter" in eggs) config.letter = eggs.letter;
    rebuildEggs();
    if (typeof gallery !== "undefined" && gallery) renderGallery();
  }
  window.addEventListener("functionhx:runtime-settings", (event) => applyRuntimeEggs(event.detail?.settings));

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
    // date 是封信的日子，拆开后写在落款下面。
    const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const inner = await encryptWith(String(pin), { title, text, sign, date });
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

  // 齿轮跟着「当前模式」走：已验证的站长回到访客模式后，点齿轮也是图鉴，长按才回到站长模式。
  function ownerActive() {
    return root.dataset.ownerVerified === "true" && root.dataset.ownerMode === "true";
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
          const replay = isFound && REPLAY[egg.id] ? ` data-egg-replay="${egg.id}" tabindex="0" role="button" title="再玩一次"` : "";
          return `<li class="egg-item" data-found="${isFound}"${replay}>
            <span class="egg-icon" aria-hidden="true">${egg.icon}</span>
            <div>
              <strong>${isFound ? `${escapeHtml(egg.name)}<span class="egg-found">已发现</span>` : "？？？"}</strong>
              <p>${escapeHtml(egg.hint)}</p>
              ${
                egg.phrase
                  ? `<form class="egg-phrase" data-egg-phrase data-no-page-loader><input aria-label="暗号" placeholder="输入暗号" autocomplete="off" maxlength="64"><button type="submit">打开</button></form><p class="egg-phrase-status" role="status"></p>`
                  : ""
              }
            </div>
          </li>`;
        })
        .join("")}</ul>
      ${hiddenCount ? `<p class="egg-secret-count">还有 ${hiddenCount} 个彩蛋没有线索。</p>` : ""}`;
    gallery.querySelectorAll("[data-egg-replay]").forEach((item) => {
      const run = () => {
        closeGallery();
        REPLAY[item.dataset.eggReplay]?.();
      };
      item.addEventListener("click", (event) => {
        if (!event.target.closest("form")) run();
      });
      item.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target === item) {
          event.preventDefault();
          run();
        }
      });
    });
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
      if (event.button !== 0 || ownerActive()) return;
      tip.textContent = root.dataset.ownerVerified === "true" ? "继续按住 · 回到站长模式" : "继续按住 · 站长登录";
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
      if (!ownerActive()) event.preventDefault();
    });
    gear.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.altKey && !ownerActive()) {
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
        if (ownerActive() || gear.dataset.ownerIntent === "true") return;
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

  // ---------- 字体：打开彩蛋时才按需加载，加载不到就用系统字体 ----------
  const FONT_URLS = {
    hand: "https://cdn.jsdelivr.net/npm/@fontsource/long-cang@5.3.0/400.css",
    type: "https://cdn.jsdelivr.net/npm/@fontsource/special-elite@5.3.0/400.css",
    crt: "https://cdn.jsdelivr.net/npm/@fontsource/vt323@5.3.0/400.css",
  };
  const loadedFonts = new Set();
  function loadFont(...names) {
    for (const name of names) {
      if (loadedFonts.has(name) || !FONT_URLS[name]) continue;
      loadedFonts.add(name);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_URLS[name];
      link.crossOrigin = "anonymous";
      document.head.append(link);
    }
  }

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shanghaiDate = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const dotted = (day) => String(day || "").replace(/-/g, ".");

  // 手账小邮票：外层打孔花边，里面一弯月亮。
  const STAMP_HTML = `<span class="egg-postage" aria-hidden="true"><span class="egg-postage-inner"><i class="egg-postage-moon"></i><b>ƒ</b><small>FUNCTION POST</small></span></span>`;

  // ---------- 终端：复古 CRT ----------
  let terminal = null;
  const FORTUNES = [
    "机器人不会累，但它的电池会。",
    "先让它跑起来，再让它跑得对，最后让它跑得快。",
    "真机永远比仿真多一个 bug。",
    "今天也要记得保存 rosbag。",
    "能用 print 调通的，就不要开调试器。——也不对。",
    "所有的「就改一行」都不止一行。",
    "今天的你，比昨天多懂了一点点。",
  ];
  const TRAIN = [
    "      ====        ________                ___________",
    "  _D _|  |_______/        \\__I_I_____===__|_________|",
    "   |(_)---  |   H\\________/ |   |        =|___ ___|  ",
    "   /     |  |   H  |  |     |   |         ||_| |_||  ",
    "  |      |  |   H  |__--------------------| [___] |  ",
    "  | ________|___H__/__|_____/[][]~\\_______|       |  ",
    "  |/ |   |-----------I_____I [][] []  D   |=======|__",
    "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__",
    " |/-=|___|=    ||    ||    ||    |_____/~\\___/       ",
    "  \\_/      \\O=====O=====O=====O_/      \\_/           ",
  ].join("\n");
  const LOGO = ["     ___  ", "    /  _| ", "  _| |_   ", " |_   _|  ", "   | |    ", "  _| |    ", " |__/     "];
  const COMMANDS = [
    "help",
    "whoami",
    "ls",
    "cat",
    "cd",
    "pwd",
    "echo",
    "fortune",
    "date",
    "neofetch",
    "cowsay",
    "history",
    "sl",
    "matrix",
    "theme",
    "coffee",
    "dog",
    "sudo",
    "rm",
    "vim",
    "clear",
    "exit",
    "unlock",
  ];

  function cowsay(text) {
    const words = Array.from(text || "哞～");
    const line = words.join("");
    const width = words.reduce((sum, character) => sum + (/[\u0000-\u00ff]/.test(character) ? 1 : 2), 0);
    return [
      ` ${"_".repeat(width + 2)}`,
      `< ${line} >`,
      ` ${"-".repeat(width + 2)}`,
      "        \\   ^__^",
      "         \\  (oo)\\_______",
      "            (__)\\       )\\/\\",
      "                ||----w |",
      "                ||     ||",
    ].join("\n");
  }

  function matrixRain(screen) {
    if (reducedMotion() || screen.querySelector(".egg-crt-rain")) return;
    const canvas = document.createElement("canvas");
    canvas.className = "egg-crt-rain";
    screen.append(canvas);
    const context = canvas.getContext("2d");
    const width = (canvas.width = screen.clientWidth);
    const height = (canvas.height = screen.clientHeight);
    const size = 16;
    const drops = Array.from({ length: Math.ceil(width / size) }, () => Math.random() * -30);
    const glyphs = "ƒ01アイウエオカキクケコサシスセソタチツテトナニヌネノ<>{}=+*";
    const color = getComputedStyle(screen).getPropertyValue("--phosphor").trim() || "#8dffb0";
    let last = 0;
    let frame = 0;
    const started = window.performance.now();
    const draw = (time) => {
      if (!canvas.isConnected) return;
      if (time - last > 50) {
        last = time;
        context.fillStyle = "rgba(4, 10, 6, 0.2)";
        context.fillRect(0, 0, width, height);
        context.fillStyle = color;
        context.font = `${size}px VT323, ui-monospace, monospace`;
        drops.forEach((drop, column) => {
          context.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], column * size, drop * size);
          drops[column] = drop * size > height && Math.random() > 0.96 ? 0 : drop + 1;
        });
      }
      if (time - started < 4200) frame = window.requestAnimationFrame(draw);
      else {
        canvas.classList.add("is-fading");
        window.setTimeout(() => canvas.remove(), 500);
      }
    };
    frame = window.requestAnimationFrame(draw);
    canvas.addEventListener("egg:stop", () => window.cancelAnimationFrame(frame));
  }

  function openTerminal() {
    if (terminal) return;
    markFound("terminal");
    loadFont("crt");
    terminal = openOverlay(
      "egg-terminal-backdrop",
      `<div class="egg-crt" data-phosphor="green">
        <div class="egg-crt-screen">
          <div class="egg-crt-content">
            <div class="egg-terminal-log" aria-live="polite"></div>
            <form class="egg-terminal-input" data-no-page-loader><label for="egg-terminal-command">visitor@function:~$</label><input id="egg-terminal-command" autocomplete="off" spellcheck="false" autocapitalize="off"></form>
          </div>
        </div>
        <div class="egg-crt-panel">
          <span class="egg-crt-brand">FUNCTION<small>·80</small></span>
          <span class="egg-crt-hint">esc 关机</span>
          <button class="egg-crt-power" type="button" aria-label="关闭终端"><i></i></button>
        </div>
      </div>`,
      "终端"
    );
    const crt = terminal.querySelector(".egg-crt");
    const screen = terminal.querySelector(".egg-crt-screen");
    const log = terminal.querySelector(".egg-terminal-log");
    const input = terminal.querySelector("input");
    const typed = [];
    let cursor = 0;
    let closing = false;
    const content = terminal.querySelector(".egg-crt-content");
    const print = (html, className = "") => {
      log.insertAdjacentHTML("beforeend", `<div class="egg-line ${className}">${html}</div>`);
      content.scrollTop = content.scrollHeight;
    };
    const text = (value, className) => print(escapeHtml(value), className);
    const dim = (value) => print(escapeHtml(value), "egg-dim");
    const powerOff = () => {
      if (closing) return;
      closing = true;
      screen.querySelector(".egg-crt-rain")?.dispatchEvent(new Event("egg:stop"));
      if (reducedMotion()) return close();
      screen.classList.add("is-off");
      window.setTimeout(close, 420);
    };
    const { close } = terminal.egg;
    terminal.egg = { close: powerOff };
    terminal.addEventListener("egg:close", () => {
      terminal = null;
    });

    const files = {
      "about.txt": "樊宇琛 · Function\n北京理工大学，机器人工程本科生。\n关注自主系统、具身智能、三维场景智能与 AI 系统工程。",
      "notes.md": "# 给好奇的你\n这个终端里藏着几条没写进 help 的命令。\n线索：history 记得一些事情。",
      ".plan": "TODO\n [x] 做一只会跑的机器狗\n [x] 给网站藏几个彩蛋\n [ ] 睡够八小时\n [ ] 把 bug 修完（大概永远勾不上）",
    };
    const commands = {
      help: () => {
        text("whoami  ls  cat <文件>  fortune  date  neofetch  theme  clear  exit");
        dim("（还有一些命令没写在这里。）");
      },
      whoami: () => text("visitor —— 一位好奇的访客。欢迎你。"),
      pwd: () => text("/home/visitor"),
      cd: () => dim("cd: 这里只有一层，哪也去不了。"),
      echo: (argument) => text(argument),
      ls: (argument) =>
        /(^|\s)-\w*a/.test(argument) ? text(".  ..  .plan  about.txt  notes.md  projects/") : text("about.txt  notes.md  projects/"),
      cat: (argument) => {
        const name = argument.replace(/^\.\//, "");
        if (Object.hasOwn(files, name)) text(files[name]);
        else if (name.startsWith("projects")) dim("cat: projects/: 是一个目录。去首页的「项目」看看吧。");
        else dim(`cat: ${argument || "?"}: 没有这个文件`);
      },
      fortune: () => text(FORTUNES[Math.floor(Math.random() * FORTUNES.length)]),
      date: () => text(new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })),
      neofetch: () => {
        const info = [
          '<span class="egg-accent">visitor</span>@<span class="egg-accent">function</span>',
          "----------------",
          '<span class="egg-accent">OS</span>: Function OS 1.0',
          '<span class="egg-accent">Host</span>: functionhx.github.io',
          '<span class="egg-accent">Kernel</span>: curiosity',
          '<span class="egg-accent">Shell</span>: ƒsh',
          '<span class="egg-accent">Theme</span>: 复古手账',
          '<span class="egg-accent">Robots</span>: 1 只机器狗',
        ];
        print(
          LOGO.map((row, index) => `<span class="egg-accent">${escapeHtml(row)}</span>  ${info[index] || ""}`).join("\n") +
            (info[7] ? `\n${" ".repeat(12)}${info[7]}` : "")
        );
      },
      cowsay: (argument) => text(cowsay(argument)),
      history: () =>
        text(
          ["  1  neofetch", "  2  sl", "  3  cowsay 你好", "  4  matrix", "  5  theme amber", "  6  coffee", "  7  rm -rf /      # 别试"].join("\n")
        ),
      sl: () => {
        if (reducedMotion()) return text(TRAIN);
        const train = document.createElement("pre");
        train.className = "egg-crt-train";
        train.setAttribute("aria-hidden", "true");
        train.textContent = TRAIN;
        screen.append(train);
        train.addEventListener("animationend", () => train.remove(), { once: true });
        dim("呜——");
      },
      matrix: () => {
        dim("Wake up, visitor…");
        matrixRain(screen);
      },
      theme: (argument) => {
        const next = argument === "amber" || argument === "green" ? argument : crt.dataset.phosphor === "green" ? "amber" : "green";
        crt.dataset.phosphor = next;
        dim(`荧光粉已切换为 ${next === "amber" ? "琥珀色" : "绿色"}。`);
      },
      coffee: () => text("    ( (\n     ) )\n  ........\n  |      |]\n  \\      /\n   `----'\n咖啡因 +1，bug -0。"),
      dog: () => {
        dim("正在放出机器狗……");
        runDog();
      },
      sudo: () => dim("visitor 不在 sudoers 文件中。此事将被报告（给 ƒ）。"),
      rm: (argument) => {
        if (!/-\w*r/.test(argument)) return dim("rm: 这里的文件都很珍贵，留着吧。");
        crt.classList.remove("is-shaking");
        void crt.offsetWidth;
        crt.classList.add("is-shaking");
        text("正在删除 / ……");
        window.setTimeout(() => dim("开玩笑的。这台机器由 ƒ 守护。"), 700);
      },
      vim: () => dim("你进入了 vim。……开玩笑的，这里没有 vim，所以也不用想怎么退出。"),
      clear: () => {
        log.innerHTML = "";
      },
      exit: powerOff,
      unlock: async (argument) => {
        const envelope = await revealEnvelope(argument);
        if (!envelope) return dim("unlock: 暗号不对");
        print('<span class="egg-accent">✉ 找到一封上了锁的信</span>');
        window.setTimeout(() => {
          close();
          showLetter(envelope);
        }, 500);
      },
    };
    commands.logout = commands.exit;
    commands.vi = commands.vim;

    const boot = [
      ["FUNCTION BIOS v1.0   (C) ƒ", "egg-accent"],
      ["内存检测 ............ 640K OK", ""],
      ["好奇心 .............. 满格", ""],
      ["正在启动 Function OS ...", ""],
      ["", ""],
      ["欢迎。输入 help 看看能做什么，esc 关机。", "egg-dim"],
    ];
    boot.forEach(([line, className], index) => {
      window.setTimeout(() => terminal && text(line || " ", className), reducedMotion() ? 0 : 180 + index * 150);
    });

    terminal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const line = input.value.trim();
      input.value = "";
      if (!line) return;
      typed.push(line);
      cursor = typed.length;
      print(`<span class="egg-accent">visitor@function:~$</span> ${escapeHtml(line)}`);
      const [name, ...rest] = line.split(/\s+/);
      const key = name.toLowerCase();
      const run = Object.hasOwn(commands, key) ? commands[key] : null;
      if (run) run(rest.join(" "));
      else dim(`${name}: 找不到命令。输入 help 看看。`);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (!typed.length) return;
        event.preventDefault();
        cursor = Math.max(0, Math.min(typed.length, cursor + (event.key === "ArrowUp" ? -1 : 1)));
        input.value = typed[cursor] || "";
      } else if (event.key === "Tab") {
        event.preventDefault();
        const matches = COMMANDS.filter((command) => command.startsWith(input.value.trim().toLowerCase()));
        if (input.value.trim() && matches.length === 1) input.value = `${matches[0]} `;
        else if (input.value.trim() && matches.length > 1) dim(matches.join("  "));
      } else if (event.key === "l" && event.ctrlKey) {
        event.preventDefault();
        log.innerHTML = "";
      }
    });
    terminal.querySelector(".egg-crt-power").addEventListener("click", powerOff);
    screen.addEventListener("click", () => input.focus({ preventScroll: true }));
    input.focus();
  }

  // ---------- f(x)：首页连点 ƒ 五下 → 追逐曲线 ----------
  // 追踪者 P 始终朝着目标 Q 的方向前进：dP/dt = v·(Q−P)/|Q−P|。Q 是一个四处游走的问号，
  // 每追上一个，新的问号就会出现在别处。
  function pursuit(canvas, onCatch) {
    const context = canvas.getContext("2d");
    if (!context) return () => {};
    const ink = "#20344f";
    const red = "#b4463d";
    let width = 0;
    let height = 0;
    let phase = Math.random() * 20;
    let clock = 0;
    let pursuer;
    let trail;
    let targetTrail;
    let target;
    let sinceCatch = 0;
    let smoothed = 0;
    let flash = null;
    let frame = 0;
    let lastTime = 0;

    const targetAt = (time) => ({
      x: width * (0.5 + 0.37 * Math.sin(0.83 * time + phase) + 0.06 * Math.sin(2.3 * time + phase)),
      y: height * (0.5 + 0.33 * Math.sin(1.21 * time + phase * 0.7) + 0.06 * Math.cos(3.1 * time)),
    });
    const reset = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      pursuer = { x: width * 0.08, y: height * 0.88 };
      trail = [{ ...pursuer }];
      target = targetAt(clock);
      targetTrail = [{ ...target }];
    };

    const step = (dt) => {
      clock += dt * 0.5;
      sinceCatch += dt;
      const next = targetAt(clock);
      const targetSpeed = Math.hypot(next.x - target.x, next.y - target.y) / Math.max(dt, 1e-3);
      smoothed = smoothed ? smoothed * 0.95 + targetSpeed * 0.05 : targetSpeed;
      target = next;
      targetTrail.push({ ...target });
      if (targetTrail.length > 150) targetTrail.shift();
      // 平时比问号慢一点，只能在拐弯处抄近路；久追不上就慢慢加速。
      const factor = Math.min(0.86 + sinceCatch * 0.025, 1.25);
      const dx = target.x - pursuer.x;
      const dy = target.y - pursuer.y;
      const distance = Math.hypot(dx, dy);
      const move = Math.min(distance, smoothed * factor * dt);
      if (distance > 0) {
        pursuer = { x: pursuer.x + (dx / distance) * move, y: pursuer.y + (dy / distance) * move };
      }
      trail.push({ ...pursuer });
      if (trail.length > 1400) trail.shift();
      if (distance < 9) {
        flash = { x: pursuer.x, y: pursuer.y, age: 0 };
        sinceCatch = 0;
        phase += 2 + Math.random() * 3;
        target = targetAt(clock);
        targetTrail = [{ ...target }];
        onCatch?.();
      }
      if (flash) {
        flash.age += dt;
        if (flash.age > 0.9) flash = null;
      }
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      // 坐标轴
      context.strokeStyle = "rgba(32, 52, 79, 0.55)";
      context.fillStyle = "rgba(32, 52, 79, 0.6)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(14, height - 14);
      context.lineTo(width - 12, height - 14);
      context.moveTo(14, height - 14);
      context.lineTo(14, 10);
      context.stroke();
      context.font = "italic 13px Georgia, serif";
      context.fillText("x", width - 20, height - 20);
      context.fillText("y", 20, 18);
      // 问号走过的路：红铅笔虚线
      context.setLineDash([4, 6]);
      context.strokeStyle = "rgba(180, 70, 61, 0.45)";
      context.lineWidth = 1.4;
      context.beginPath();
      targetTrail.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
      context.stroke();
      context.setLineDash([]);
      // 追踪者的墨迹：越新越浓
      context.lineCap = "round";
      context.lineJoin = "round";
      const segments = 14;
      const chunk = Math.ceil(trail.length / segments);
      for (let part = 0; part < segments; part += 1) {
        const slice = trail.slice(part * chunk, (part + 1) * chunk + 1);
        if (slice.length < 2) continue;
        context.strokeStyle = `rgba(32, 52, 79, ${0.18 + (0.82 * (part + 1)) / segments})`;
        context.lineWidth = 2.2;
        context.beginPath();
        slice.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
        context.stroke();
      }
      // 视线：P 指向 Q 的方向
      context.setLineDash([2, 5]);
      context.strokeStyle = "rgba(32, 52, 79, 0.35)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(pursuer.x, pursuer.y);
      context.lineTo(target.x, target.y);
      context.stroke();
      context.setLineDash([]);
      // Q：问号
      context.fillStyle = red;
      context.font = "26px 'Long Cang', 'Kaiti SC', STKaiti, KaiTi, cursive";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("?", target.x, target.y - 1);
      context.strokeStyle = "rgba(180, 70, 61, 0.55)";
      context.beginPath();
      context.arc(target.x, target.y, 14, 0, Math.PI * 2);
      context.stroke();
      // P：ƒ
      context.fillStyle = ink;
      context.beginPath();
      context.arc(pursuer.x, pursuer.y, 4.2, 0, Math.PI * 2);
      context.fill();
      context.font = "italic 17px Georgia, 'Times New Roman', serif";
      context.fillText("ƒ", pursuer.x - 11, pursuer.y - 13);
      if (flash) {
        const progress = flash.age / 0.9;
        context.strokeStyle = `rgba(180, 70, 61, ${1 - progress})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(flash.x, flash.y, 10 + progress * 34, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = `rgba(180, 70, 61, ${1 - progress})`;
        context.font = "bold 22px Georgia, serif";
        context.fillText("!", flash.x, flash.y - 26 - progress * 10);
      }
      context.textAlign = "start";
      context.textBaseline = "alphabetic";
    };

    reset();
    if (reducedMotion()) {
      for (let index = 0; index < 900; index += 1) step(1 / 60);
      draw();
      return () => {};
    }
    const loop = (time) => {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60;
      lastTime = time;
      step(dt);
      draw();
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    const onResize = () => reset();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }

  let taps = [];
  function showFunction() {
    markFound("fx");
    loadFont("hand", "type");
    const overlay = openOverlay(
      "egg-fx-backdrop",
      `<div class="egg-fx egg-journal">
        <span class="egg-tape egg-tape--left" aria-hidden="true"></span>
        <span class="egg-tape egg-tape--right" aria-hidden="true"></span>
        <header class="egg-fx-head">
          <div>
            <p class="egg-type">f(x) · pursuit curve</p>
            <h3 class="egg-hand">追逐曲线</h3>
          </div>
          ${STAMP_HTML}
        </header>
        <canvas class="egg-fx-plot" role="img" aria-label="一条墨水曲线始终朝着一个游走的问号前进，追上一个，新的问号又出现在别处。"></canvas>
        <p class="egg-fx-formula"><i>d</i><b>P</b>/<i>dt</i> = <i>v</i> · (<b>Q</b> − <b>P</b>) / ‖<b>Q</b> − <b>P</b>‖</p>
        <footer class="egg-fx-foot">
          <div>
            <p class="egg-hand egg-fx-caption">朝着未知的方向，一直追下去。</p>
            <p class="egg-hand egg-fx-count" aria-live="polite">正在追一个问号……</p>
          </div>
          <button class="egg-tag" type="button">收起</button>
        </footer>
      </div>`,
      "f(x) 追逐曲线"
    );
    const count = overlay.querySelector(".egg-fx-count");
    let caught = 0;
    const stop = pursuit(overlay.querySelector("canvas"), () => {
      caught += 1;
      count.textContent = `追上了第 ${caught} 个未知 —— 新的问号又出现了。`;
    });
    overlay.addEventListener("egg:close", stop);
    const button = overlay.querySelector(".egg-tag");
    button.addEventListener("click", () => overlay.egg.close());
    button.focus({ preventScroll: true });
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
  // 背景里缓缓飘着的暖色尘光，像台灯下的空气。
  function dust(canvas) {
    const reduce = reducedMotion();
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
    const motes = Array.from({ length: reduce ? 24 : 46 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.6 + 0.5,
      s: Math.random() * 0.2 + 0.05,
      d: Math.random() * 0.3 - 0.15,
      p: Math.random() * Math.PI * 2,
    }));
    let last = 0;
    const draw = (time) => {
      // 30 帧足够，背景尘光不需要更高帧率。
      if (time - last >= 33) {
        last = time;
        context.clearRect(0, 0, width, height);
        for (const mote of motes) {
          if (!reduce) {
            mote.y -= mote.s;
            mote.x += mote.d * Math.sin(time / 1800 + mote.p);
            if (mote.y < -5) {
              mote.y = height + 5;
              mote.x = Math.random() * width;
            }
          }
          context.beginPath();
          context.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
          context.fillStyle = `rgba(255, 214, 160, ${0.22 + 0.3 * Math.sin(time / 1100 + mote.p) ** 2})`;
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

  function postmark(day) {
    return `<svg class="egg-postmark" viewBox="0 0 132 64" aria-hidden="true">
      <g fill="none" stroke="currentColor"><circle cx="32" cy="32" r="27" stroke-width="1.8"/><circle cx="32" cy="32" r="20.5" stroke-width="1"/>
      <path d="M64 20q8-6 16 0t16 0t16 0t16 0M64 32q8-6 16 0t16 0t16 0t16 0M64 44q8-6 16 0t16 0t16 0t16 0" stroke-width="1.6"/></g>
      <text x="32" y="29" text-anchor="middle" font-size="7.4" fill="currentColor">FUNCTION</text>
      <text x="32" y="40" text-anchor="middle" font-size="7.4" fill="currentColor">${escapeHtml(dotted(day))}</text>
    </svg>`;
  }

  // 一个字一个字写出来；标点和换行处停一停，像真的在写。
  function handwrite(node, value, { onDone } = {}) {
    const characters = Array.from(value);
    const pen = document.createElement("span");
    pen.className = "egg-pen";
    pen.setAttribute("aria-hidden", "true");
    const written = document.createTextNode("");
    node.replaceChildren(written, pen);
    let index = 0;
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      written.data = value;
      pen.remove();
      onDone?.();
    };
    if (reducedMotion()) {
      finish();
      return finish;
    }
    const tick = () => {
      if (!node.isConnected) return;
      if (index >= characters.length) return finish();
      const character = characters[index];
      index += 1;
      written.data += character;
      node.closest(".egg-paper")?.scrollTo?.({ top: node.offsetTop + node.offsetHeight - 260 });
      const pause = character === "\n" ? 420 : /[，、；：,;:]/.test(character) ? 200 : /[。！？…!?]/.test(character) ? 340 : 55 + Math.random() * 45;
      timer = window.setTimeout(tick, pause);
    };
    timer = window.setTimeout(tick, 300);
    return finish;
  }

  function showLetter(envelope) {
    markFound("letter");
    loadFont("hand", "type");
    const overlay = openOverlay(
      "egg-letter",
      `<canvas aria-hidden="true"></canvas>
      <div class="egg-letter-stage">
        <div class="egg-envelope is-locked" aria-hidden="true">
          <span class="egg-envelope-body"></span>
          <span class="egg-envelope-sheet"></span>
          <span class="egg-envelope-pocket"><span class="egg-envelope-to egg-hand">To：你</span></span>
          <span class="egg-envelope-flap"></span>
          ${STAMP_HTML}
          ${postmark(shanghaiDate())}
          <span class="egg-tape egg-tape--corner"></span>
          <span class="egg-seal"><i class="egg-seal-half egg-seal-half--a"></i><i class="egg-seal-half egg-seal-half--b"></i><b>ƒ</b></span>
        </div>
        <form class="egg-pin" autocomplete="off" data-no-page-loader>
          <p class="egg-type egg-pin-kicker">PRIVATE · 6 DIGITS</p>
          <p class="egg-pin-title egg-hand">这封信上了锁</p>
          <div class="egg-pin-boxes" role="group" aria-label="六位密码">${Array.from(
            { length: 6 },
            (_, index) => `<input inputmode="numeric" pattern="[0-9]" maxlength="1" aria-label="第 ${index + 1} 位">`
          ).join("")}</div>
          <p class="egg-pin-status egg-hand" role="status"></p>
          <button class="egg-pin-mail-toggle" type="button">不知道密码？发到我的邮箱</button>
          <div class="egg-pin-mail" hidden>
            <input type="email" placeholder="你的邮箱" aria-label="你的邮箱" autocomplete="email" maxlength="254">
            <button type="button">寄出</button>
          </div>
        </form>
      </div>
      <article class="egg-paper" tabindex="-1" aria-labelledby="egg-paper-title">
        <span class="egg-tape egg-tape--left" aria-hidden="true"></span>
        <span class="egg-tape egg-tape--right" aria-hidden="true"></span>
        <h3 id="egg-paper-title" class="egg-hand"></h3>
        <p class="sr-only egg-paper-full"></p>
        <div class="egg-paper-text egg-hand" aria-hidden="true"></div>
        <div class="egg-paper-end">
          <p class="egg-paper-sign egg-hand"></p>
          <svg class="egg-paper-doodle" viewBox="0 0 48 40" aria-hidden="true"><path d="M24 35C10 25 4 18 6 11c2-6 10-8 14-3l4 5 4-5c4-5 12-3 14 3 2 7-4 14-18 24z" pathLength="1"/></svg>
          <p class="egg-paper-date egg-type"></p>
        </div>
        <div class="egg-paper-actions">
          <button class="egg-paper-skip" type="button">直接看完</button>
          <button class="egg-paper-close" type="button">把信收好</button>
        </div>
      </article>
      <button class="egg-letter-dismiss" type="button" aria-label="关闭">×</button>`,
      "一封上了锁的信"
    );
    const stop = dust(overlay.querySelector("canvas"));
    let skipWriting = null;
    overlay.addEventListener("egg:close", () => {
      stop();
      skipWriting?.();
    });
    overlay.querySelector(".egg-letter-dismiss").addEventListener("click", () => overlay.egg.close());
    overlay.querySelector(".egg-paper-close").addEventListener("click", () => overlay.egg.close());

    const form = overlay.querySelector(".egg-pin");
    const boxes = [...form.querySelectorAll(".egg-pin-boxes input")];
    const status = form.querySelector(".egg-pin-status");
    const envelopeNode = overlay.querySelector(".egg-envelope");
    const paper = overlay.querySelector(".egg-paper");
    const skip = paper.querySelector(".egg-paper-skip");
    let misses = 0;
    let checking = false;
    boxes[0].focus();

    function readLetter(letter) {
      const reduce = reducedMotion();
      paper.querySelector("h3").textContent = letter.title || "给你";
      paper.querySelector(".egg-paper-full").textContent = letter.text || "";
      paper.querySelector(".egg-paper-sign").textContent = letter.sign || "";
      paper.querySelector(".egg-paper-date").textContent = dotted(letter.date);
      const steps = reduce ? [0, 0, 0, 0] : [0, 380, 950, 1600];
      window.setTimeout(() => envelopeNode.classList.add("is-unsealed"), steps[0]);
      window.setTimeout(() => envelopeNode.classList.add("is-open"), steps[1]);
      window.setTimeout(() => envelopeNode.classList.add("is-sliding"), steps[2]);
      window.setTimeout(() => {
        envelopeNode.classList.add("is-gone");
        overlay.querySelector(".egg-letter-stage").classList.add("is-done");
        paper.classList.add("is-shown");
        paper.focus({ preventScroll: true });
        skipWriting = handwrite(paper.querySelector(".egg-paper-text"), letter.text || "", {
          onDone: () => {
            skipWriting = null;
            skip.hidden = true;
            paper.classList.add("is-signed");
          },
        });
      }, steps[3]);
    }
    skip.addEventListener("click", () => skipWriting?.());

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
      readLetter(letter);
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
      status.textContent = "正在寄出…";
      const result = await mailPin(envelope.phrase, mailInput.value.trim());
      mailButton.disabled = false;
      if (result.ok) {
        status.textContent = "密码已经寄到你的邮箱，去看看吧。";
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

  // ---------- 小纸条：深夜、控制台等彩蛋共用 ----------
  let activeToast = null;
  function toast(html, { duration = 8000, className = "" } = {}) {
    activeToast?.remove();
    loadFont("hand");
    const note = document.createElement("div");
    note.className = `egg-toast ${className}`;
    note.setAttribute("role", "status");
    note.innerHTML = `<span class="egg-tape egg-tape--left" aria-hidden="true"></span>${html}<button type="button" class="egg-toast-close" aria-label="关闭">×</button>`;
    document.body.append(note);
    activeToast = note;
    const dismiss = () => {
      if (!note.isConnected) return;
      note.classList.add("is-leaving");
      window.setTimeout(() => note.remove(), reducedMotion() ? 0 : 320);
      if (activeToast === note) activeToast = null;
    };
    note.querySelector(".egg-toast-close").addEventListener("click", dismiss);
    window.setTimeout(dismiss, duration);
    return note;
  }

  // ---------- 深夜来访：零点到五点之间打开网站 ----------
  function showNight() {
    markFound("night");
    toast(
      `<span class="egg-toast-moon" aria-hidden="true"></span>
      <div><p class="egg-hand egg-toast-title">这么晚还不睡呀</p><p>夜里的想法最多，也最该早点休息。晚安，明天见。</p></div>`,
      { className: "egg-toast--night", duration: 10000 }
    );
  }
  if (new Date().getHours() < 5) {
    let shown = false;
    try {
      shown = window.sessionStorage.getItem("functionhx:eggs:night") === "1";
      window.sessionStorage.setItem("functionhx:eggs:night", "1");
    } catch (_error) {
      /* 存不下就每次都说晚安，也没什么不好。 */
    }
    if (!shown) window.setTimeout(showNight, 2400);
  }

  // ---------- 屏保：一分钟没有任何操作，ƒ 在屏幕上弹来弹去 ----------
  const IDLE_MS = 60000;
  const SAVER_COLORS = ["#c5a2ff", "#d97757", "#6a9bcc", "#9fb67a", "#f3d78a", "#f0efe8"];
  let idleTimer = 0;
  let saver = null;

  function stopScreensaver() {
    if (!saver) return;
    window.cancelAnimationFrame(saver.frame);
    const node = saver.node;
    saver = null;
    node.classList.add("is-leaving");
    window.setTimeout(() => node.remove(), reducedMotion() ? 0 : 400);
  }

  function startScreensaver() {
    if (saver) return;
    markFound("idle");
    const node = document.createElement("div");
    node.className = "egg-saver";
    node.setAttribute("aria-hidden", "true");
    node.innerHTML = `<div class="egg-saver-logo"><b>ƒ</b><span>FUNCTION</span></div><p class="egg-saver-corner">正好撞进角落！</p><p class="egg-saver-hint">动一下鼠标就回来</p>`;
    document.body.append(node);
    const logo = node.querySelector(".egg-saver-logo");
    const corner = node.querySelector(".egg-saver-corner");
    saver = { node, frame: 0, startedAt: window.performance.now() };
    let colorIndex = 0;
    logo.style.color = SAVER_COLORS[colorIndex];
    if (reducedMotion()) return;
    let x = Math.random() * Math.max(1, window.innerWidth - 200);
    let y = Math.random() * Math.max(1, window.innerHeight - 120);
    let vx = 150;
    let vy = 110;
    let last = 0;
    const step = (time) => {
      if (!saver) return;
      const dt = last ? Math.min((time - last) / 1000, 0.05) : 0;
      last = time;
      const maxX = window.innerWidth - logo.offsetWidth;
      const maxY = window.innerHeight - logo.offsetHeight;
      x += vx * dt;
      y += vy * dt;
      let hits = 0;
      if (x <= 0 || x >= maxX) {
        vx = -vx;
        x = Math.max(0, Math.min(x, maxX));
        hits += 1;
      }
      if (y <= 0 || y >= maxY) {
        vy = -vy;
        y = Math.max(0, Math.min(y, maxY));
        hits += 1;
      }
      if (hits) {
        colorIndex = (colorIndex + 1) % SAVER_COLORS.length;
        logo.style.color = SAVER_COLORS[colorIndex];
      }
      if (hits === 2) {
        corner.classList.remove("is-shown");
        void corner.offsetWidth;
        corner.classList.add("is-shown");
      }
      logo.style.transform = `translate(${x}px, ${y}px)`;
      saver.frame = window.requestAnimationFrame(step);
    };
    saver.frame = window.requestAnimationFrame(step);
  }

  function resetIdle() {
    // 刚从图鉴里点开屏保时，那一下点击和随后的移动不算「回来了」。
    if (saver && window.performance.now() - saver.startedAt > 900) stopScreensaver();
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (document.hidden || anyOverlayOpen() || gallery) resetIdle();
      else startScreensaver();
    }, IDLE_MS);
  }
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach((type) => {
    window.addEventListener(type, resetIdle, { capture: true, passive: true });
  });
  resetIdle();

  // ---------- 控制台：给打开开发者工具的人 ----------
  function showConsoleToast() {
    markFound("console");
    toast(
      `<span class="egg-toast-icon" aria-hidden="true">🛠️</span>
      <div><p class="egg-hand egg-toast-title">控制台里的你好</p><p>被你发现了。本站源码在 GitHub 上，欢迎来看，也欢迎来提 issue。</p></div>`
    );
  }
  function consoleEgg() {
    showConsoleToast();
    return "ƒ(你) = 好奇心 × 行动力。源码：https://github.com/Functionhx/magic-site-blueprint";
  }
  try {
    if (!("ƒ" in window)) Object.defineProperty(window, "ƒ", { value: consoleEgg, configurable: true });
    if (!("fx" in window)) Object.defineProperty(window, "fx", { value: consoleEgg, configurable: true });
    window.console.log(
      "%cƒ%c Function\n\n你好，同行。既然打开了开发者工具，就输入 ƒ() 试试吧。\n（Mac 上 ƒ 是 Option + F，也可以输入 fx()。）",
      "font: italic 700 44px Georgia, serif; color: #6434b2",
      "font: 600 14px/1.6 -apple-system, 'PingFang SC', sans-serif; color: inherit"
    );
  } catch (_error) {
    /* 控制台不可用时就算了。 */
  }

  // ---------- 标签页：离开时标题喊你回来 ----------
  const originalTitle = document.title;
  const AWAY_TITLE = "ƒ 在等你回来…";
  let titleTimer = 0;
  // 后台标签页里主线程的定时器会被浏览器对齐到约 1 秒一次，设 0.5 秒也要等到 1 秒；
  // Worker 里的定时器不受影响，所以延迟交给 away-timer-worker.js 计时，到点再回主线程改标题。
  // Worker 起不来（被拦截、文件取不到）就退回普通定时器，只是后台里可能慢一点。
  let awayWorker = null;
  let awayWorkerBroken = false;
  let awayToken = 0;
  let awayCallback = null;
  let awayDeadline = 0;
  function startAwayTimer(delay, callback) {
    awayToken += 1;
    awayCallback = callback;
    awayDeadline = window.performance.now() + delay;
    if (!awayWorkerBroken) {
      try {
        if (!awayWorker) {
          awayWorker = new Worker("/assets/js/away-timer-worker.js");
          awayWorker.onmessage = (event) => {
            if (event.data === awayToken) awayCallback?.();
          };
          awayWorker.onerror = () => {
            awayWorkerBroken = true;
            awayWorker = null;
            const pending = awayCallback;
            if (pending) titleTimer = window.setTimeout(pending, Math.max(0, awayDeadline - window.performance.now()));
          };
        }
        awayWorker.postMessage({ token: awayToken, delay });
        return;
      } catch (_error) {
        awayWorkerBroken = true;
      }
    }
    titleTimer = window.setTimeout(callback, delay);
  }
  function cancelAwayTimer() {
    awayToken += 1;
    awayCallback = null;
    window.clearTimeout(titleTimer);
  }
  document.addEventListener("visibilitychange", () => {
    cancelAwayTimer();
    if (document.hidden) {
      // 延迟由站长在站点设置里调（默认 0.5 秒，0 为立即）。
      const delay = Number(document.documentElement.dataset.awayTitleDelay ?? 500);
      const showAway = () => {
        if (document.hidden) document.title = AWAY_TITLE;
      };
      if (delay > 0) startAwayTimer(delay, showAway);
      else showAway();
      return;
    }
    if (document.title !== AWAY_TITLE) return;
    document.title = "欢迎回来 ✦";
    markFound("tab");
    titleTimer = window.setTimeout(() => {
      document.title = originalTitle;
    }, 2500);
  });

  // 图鉴里点一下已发现的彩蛋就能再玩一次（手机上没有 ` 键时也能打开终端）。
  const REPLAY = {
    turbo: () => window.functionhxTurbo?.toggle(),
    dog: runDog,
    terminal: openTerminal,
    fx: showFunction,
    night: showNight,
    idle: startScreensaver,
    console: showConsoleToast,
  };

  // ---------- 键盘 ----------
  let konami = 0;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (activeToast) activeToast.querySelector(".egg-toast-close")?.click();
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

  // 页面头部没有等网络，先用本机缓存里最近一次的设置。
  applyRuntimeEggs(window.functionhxRuntimeSettings?.current?.());

  window.functionhxEggs = Object.freeze({
    get eggs() {
      return EGGS.map(({ id, name }) => ({ id, name }));
    },
    sealLetter,
  });
})();
