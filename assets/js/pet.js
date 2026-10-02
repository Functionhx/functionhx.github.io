/* 网站宠物 ƒ-01。
 *
 * 身体、感知、记忆、主动性、动作全部在浏览器本地完成：即时、免费、不上传。只有访客主动提问时，
 * 才把问题和当前页面的摘录发给大脑（pet-brain/，Cloudflare Worker → DeepSeek）；大脑不可用时退回站内搜索。
 *
 * 边界（validate_content.py 会检查）：不碰站长凭据、GitHub API 或 IndexedDB；只请求同源的 /api/*.json、
 * /assets/pet/lines.json 与配置里的大脑地址；不读剪贴板、不追踪其他网站、不保存访客的原话；
 * 记得的东西只在本机 localStorage，并可以一键「忘记我」。
 */
(function initializePet() {
  "use strict";

  const configNode = document.getElementById("functionhx-pet-config");
  if (!configNode || document.getElementById("functionhx-pet")) return;
  let CONFIG;
  try {
    CONFIG = JSON.parse(configNode.textContent);
  } catch (_error) {
    return;
  }

  const MEMORY_KEY = "functionhx:pet:memory";
  const SESSION_KEY = "functionhx:pet:session";
  const EGGS_KEY = "functionhx:eggs:found";
  const SITE = "https://functionhx.github.io";
  const LETTER = /(信封|那封信|一封信|暗号|口令|拆信|六位|\bpin\b|信的密码|信件)/i;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = window.matchMedia("(max-width: 760px)");
  const root = document.documentElement;

  // ------------------------------------------------------------------ 存储

  function read(store, key, fallback) {
    try {
      const value = JSON.parse(store.getItem(key));
      return value === null || value === undefined ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }
  function write(store, key, value) {
    try {
      store.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // 存储不可用时照常工作，只是记不住。
    }
  }

  const freshMemory = () => ({
    v: 1,
    firstSeen: null,
    lastSeen: null,
    visits: 0,
    petName: "",
    lastRead: null,
    pages: {},
    topics: [],
    quietness: 0,
    chats: 0,
    storyStep: 0,
    hidden: false,
    dock: null,
    interacted: false,
  });
  let memory = Object.assign(freshMemory(), read(window.localStorage, MEMORY_KEY, {}));
  const isNewVisit = read(window.sessionStorage, SESSION_KEY, null) === null;
  const session = Object.assign({ spoken: 0, silenced: false, greeted: false }, read(window.sessionStorage, SESSION_KEY, {}));
  let saveTimer = 0;
  function save() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      write(window.localStorage, MEMORY_KEY, memory);
      write(window.sessionStorage, SESSION_KEY, session);
    }, 120);
  }
  if (isNewVisit) {
    memory.visits += 1;
    memory.firstSeen = memory.firstSeen || new Date().toISOString();
  }
  memory.lastSeen = new Date().toISOString();
  const path = window.location.pathname;
  memory.pages[path] = (memory.pages[path] || 0) + 1;
  const pageKeys = Object.keys(memory.pages);
  if (pageKeys.length > 80) delete memory.pages[pageKeys[0]];
  save();

  // ------------------------------------------------------------------ 台词

  let LINES = {};
  const pick = (list) => (Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : typeof list === "string" ? list : "");
  const petName = () => memory.petName || LINES.name || "ƒ-01";
  function fill(text, values = {}) {
    return String(text || "").replace(/\{(\w+)\}/g, (_match, key) => {
      if (key === "name") return petName();
      if (key === "visits") return String(memory.visits);
      return values[key] === undefined ? "" : String(values[key]);
    });
  }

  // ------------------------------------------------------------------ 页面上下文

  const content = document.querySelector("#site-rendered-content") || document.body;
  const article = content.querySelector("article.post-content, .post-body, article") || content;
  function pageKind() {
    if (path === "/" || path === "/index.html") return "home";
    if (/^\/blog\/\d{4}\//.test(path)) return "post";
    if (/^\/(projects|research|tools)\/.+/.test(path)) return "project";
    return "list";
  }
  function pageTitle() {
    const heading = content.querySelector(".post-title, h1");
    return (heading ? heading.textContent : document.title.replace(/\s*·\s*(Function|Magic)\s*$/, "")).trim().slice(0, 120);
  }
  let currentSection = "";
  let currentHeading = null;
  function sectionText(start, limit = 700) {
    let text = "";
    for (let node = start ? start.nextElementSibling : article.firstElementChild; node && text.length < limit; node = node.nextElementSibling) {
      if (start && /^H[1-3]$/.test(node.tagName)) break;
      text += ` ${node.textContent || ""}`;
    }
    return text.replace(/\s+/g, " ").trim().slice(0, limit);
  }
  function nearbyText(element, limit = 700) {
    const parts = [];
    const caption = element.closest("figure")?.querySelector("figcaption")?.textContent || element.getAttribute("alt") || "";
    if (caption) parts.push(`（图注：${caption}）`);
    let node = element.closest("figure, table, pre, p, div") || element;
    for (let i = 0, sibling = node.previousElementSibling; i < 2 && sibling; i += 1, sibling = sibling.previousElementSibling) {
      parts.unshift(sibling.textContent || "");
    }
    if (node.tagName === "PRE" || node.tagName === "TABLE") parts.push((node.textContent || "").slice(0, 300));
    if (node.nextElementSibling) parts.push(node.nextElementSibling.textContent || "");
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, limit);
  }
  const readingMinutes = () => Math.max(1, Math.round((article.textContent || "").replace(/\s+/g, "").length / 500));
  function pageContext(focus) {
    return {
      url: window.location.href.split("#")[0],
      title: pageTitle(),
      section: currentSection,
      excerpt: focus ? nearbyText(focus) : sectionText(currentHeading),
    };
  }

  // ------------------------------------------------------------------ 界面

  const WHALE = `<svg class="pet-whale" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="pet-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb4ff"/><stop offset="1" stop-color="#2f6fe0"/></linearGradient>
      <clipPath id="pet-clip"><path d="M22 62C22 38 44 26 68 27C93 28 107 44 105 64C103 82 86 91 63 91C39 91 22 81 22 62Z"/></clipPath>
    </defs>
    <ellipse class="shadow" cx="63" cy="96" rx="34" ry="3.2" fill="#000" opacity=".2"/>
    <g class="rig">
      <g class="fx">
        <g class="spout"><path d="M80 27C79 20 79 13 85 10.5C88.5 9 91.5 10.5 92 13M76 18.5H86" fill="none" stroke="#5cbcf0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
        <g class="drops" fill="#5cbcf0"><circle cx="84" cy="9" r="2.2"/><circle cx="90" cy="8" r="1.8"/><circle cx="87" cy="5" r="1.5"/></g>
        <g class="bubbles" fill="none" stroke="#5cbcf0" stroke-width="1.6"><circle cx="82" cy="22" r="2.6"/><circle cx="88" cy="20" r="3.4"/><circle cx="78" cy="19" r="2"/></g>
        <g class="zzz" fill="#5cbcf0" font-family="ui-rounded,-apple-system,sans-serif" font-weight="700"><text x="84" y="24" font-size="9">z</text><text x="88" y="20" font-size="11">z</text><text x="92" y="16" font-size="13">Z</text></g>
        <g class="question" fill="#c5a2ff" font-family="ui-rounded,-apple-system,sans-serif" font-weight="800"><text x="84" y="22" font-size="18">?</text></g>
      </g>
      <g class="tail"><path d="M27 60C20 57 15 50 14 42C18 44 21 47 22 50C21 44 23 38 28 35C29 42 30 50 31 58Z" fill="var(--deep)" stroke="var(--line)" stroke-width="1.6" stroke-linejoin="round"/></g>
      <g class="body-wrap">
        <path d="M22 62C22 38 44 26 68 27C93 28 107 44 105 64C103 82 86 91 63 91C39 91 22 81 22 62Z" fill="var(--skin)" stroke="var(--line)" stroke-width="1.8"/>
        <g clip-path="url(#pet-clip)"><ellipse cx="72" cy="86" rx="38" ry="15" fill="#fff4e6"/><ellipse cx="54" cy="40" rx="14" ry="6" fill="#fff" opacity=".18" transform="rotate(-18 54 40)"/></g>
        <g clip-path="url(#pet-clip)">
          <path d="M60 75C57 62 55 48 57 34" stroke="#c96442" stroke-width="3.4" stroke-linecap="round" fill="none"/>
          <path d="M57 75C70 71.5 88 71 104 73.5V96H55Z" fill="#d97757"/>
          <rect x="64" y="77.5" width="15" height="10.5" rx="2.4" fill="#fff4e6" stroke="#c96442" stroke-width="1.1"/>
          <text x="71.5" y="85.8" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="8.2" fill="#6434b2">ƒ</text>
        </g>
        <g class="fin"><path d="M52 70C47 74 44 79 45 83C50 82 55 78 58 73Z" fill="var(--fin)" stroke="var(--line)" stroke-width="1.4" stroke-linejoin="round"/></g>
        <g class="face">
          <g class="eyes eyes-open"><g class="eye-open"><ellipse cx="78" cy="56" rx="4.2" ry="4.8" fill="#1d1a2e"/><ellipse cx="94" cy="54.5" rx="3.6" ry="4.2" fill="#1d1a2e"/><circle cx="79.6" cy="54.2" r="1.5" fill="#fff"/><circle cx="95.3" cy="52.8" r="1.2" fill="#fff"/></g></g>
          <g class="eyes-happy" fill="none" stroke="#1d1a2e" stroke-width="2.2" stroke-linecap="round"><path d="M74 57Q78 52 82 57"/><path d="M90.5 55.5Q94 51 97.5 55.5"/></g>
          <g class="eyes-closed" fill="none" stroke="#1d1a2e" stroke-width="2" stroke-linecap="round"><path d="M74 56Q78 59.5 82 56"/><path d="M90.5 54.5Q94 58 97.5 54.5"/></g>
          <g class="eyes-squeeze" fill="none" stroke="#1d1a2e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M74.5 52.5L80.5 56L74.5 59.5"/><path d="M97.5 51L91.5 54.5L97.5 58"/></g>
          <g class="eyes-confused"><ellipse cx="78" cy="56" rx="4.2" ry="4.8" fill="#1d1a2e"/><circle cx="79.6" cy="54.2" r="1.5" fill="#fff"/><path d="M90.5 55Q94 53 97.5 55" fill="none" stroke="#1d1a2e" stroke-width="2.2" stroke-linecap="round"/></g>
          <ellipse cx="72.5" cy="64" rx="4.2" ry="2.4" fill="#ff8fb3" opacity=".45"/><ellipse cx="98.5" cy="62" rx="3.6" ry="2.2" fill="#ff8fb3" opacity=".45"/>
          <path class="mouth mouth-smile" d="M83 63.5Q86 66.5 89 63.5" fill="none" stroke="#1d1a2e" stroke-width="1.8" stroke-linecap="round"/>
          <path class="mouth mouth-open" d="M83 63Q86 69 89 63Z" fill="#7a2b4a" stroke="#1d1a2e" stroke-width="1.4" stroke-linejoin="round"/>
          <path class="mouth mouth-flat" d="M83.5 64.5H88.5" fill="none" stroke="#1d1a2e" stroke-width="1.8" stroke-linecap="round"/>
          <path class="mouth mouth-sleep" d="M84.5 64.5Q86 65.8 87.5 64.5" fill="none" stroke="#1d1a2e" stroke-width="1.6" stroke-linecap="round"/>
          <path class="mouth mouth-wavy" d="M82.5 65Q84 63.5 85.5 65T88.5 65" fill="none" stroke="#1d1a2e" stroke-width="1.7" stroke-linecap="round"/>
          <ellipse class="mouth mouth-o" cx="86" cy="65" rx="1.8" ry="2.2" fill="#7a2b4a" stroke="#1d1a2e" stroke-width="1.3"/>
        </g>
      </g>
    </g>
  </svg>`;

  function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "text") node.textContent = value;
      else if (value !== false && value !== undefined && value !== null) node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) node.append(child);
    return node;
  }

  const ui = {};
  ui.root = element("div", { id: "functionhx-pet", class: "pet-root" });
  ui.body = element("button", { type: "button", class: "pet-body", "aria-haspopup": "dialog", "aria-expanded": "false" });
  ui.figure = element("div", { class: "pet-figure is-idle" });
  ui.body.append(ui.figure);
  ui.bubble = element("div", { class: "pet-bubble", role: "status", "aria-live": "polite", hidden: true });
  ui.bubbleText = element("div", { class: "pet-bubble-text" });
  ui.bubbleActions = element("div", { class: "pet-chips pet-bubble-actions" });
  ui.bubbleClose = element("button", { type: "button", class: "pet-close", "aria-label": "让它安静", text: "✕" });
  ui.bubble.append(ui.bubbleText, ui.bubbleActions, ui.bubbleClose);
  ui.panel = element("section", { class: "pet-panel", role: "dialog", "aria-label": "和它说话", hidden: true });
  ui.panelTitle = element("strong");
  ui.panelSub = element("span");
  ui.panelClose = element("button", { type: "button", class: "pet-close", "aria-label": "关闭", text: "✕" });
  ui.chips = element("div", { class: "pet-chips" });
  ui.log = element("div", { class: "pet-log", role: "log", "aria-live": "polite" });
  ui.input = element("input", { type: "text", maxlength: "300", autocomplete: "off", enterkeyhint: "send" });
  ui.send = element("button", { type: "submit", text: "发送" });
  ui.form = element("form", { class: "pet-form" }, [ui.input, ui.send]);
  ui.footnote = element("p", { class: "pet-footnote" });
  ui.panel.append(element("header", {}, [ui.panelTitle, ui.panelSub]), ui.panelClose, ui.chips, ui.log, ui.form, ui.footnote);
  ui.tab = element("button", { type: "button", class: "pet-tab", hidden: true });
  ui.tab.innerHTML = `<svg viewBox="14 24 94 70" aria-hidden="true"><path d="M22 62C22 38 44 26 68 27C93 28 107 44 105 64C103 82 86 91 63 91C39 91 22 81 22 62Z" fill="#2f6fe0"/><circle cx="80" cy="56" r="4" fill="#fff"/></svg>`;
  ui.tabLabel = element("span");
  ui.tab.append(ui.tabLabel);
  ui.root.append(ui.body, ui.bubble, ui.panel, ui.tab);

  // 形象：有授权序列帧时用它，否则用内置占位形象。
  const sprites = CONFIG.sprites && CONFIG.sprites.states ? CONFIG.sprites : null;
  if (sprites) {
    ui.sprite = element("div", { class: "pet-sprite", role: "presentation" });
    ui.figure.append(ui.sprite);
    // 授权形象的比例不一定和占位鲸鱼相同：按配置的显示尺寸（桌面）设定身体大小，手机上等比缩小。
    if (sprites.width && sprites.height) {
      const scale = narrow.matches ? 0.74 : 1;
      ui.body.style.width = `${Math.round(sprites.width * scale)}px`;
      ui.body.style.height = `${Math.round(sprites.height * scale)}px`;
    }
  } else {
    ui.figure.innerHTML = WHALE;
  }

  // ------------------------------------------------------------------ 状态

  let state = "idle";
  let stateTimer = 0;
  function setState(next, holdMs = 0) {
    window.clearTimeout(stateTimer);
    state = next;
    ui.figure.className = `pet-figure is-${next}${facingLeft ? " is-left" : ""}`;
    if (sprites) {
      const spec = sprites.states[next] || sprites.states.idle;
      const base = String(sprites.base || "/assets/pet/sprites/").replace(/\/?$/, "/");
      ui.sprite.style.backgroundImage = `url("${base}${spec.file}")`;
      ui.sprite.style.setProperty("--frames", String(Math.max(1, spec.frames || 1)));
      ui.sprite.style.setProperty("--duration", `${(Math.max(1, spec.frames || 1) / Math.max(1, spec.fps || 8)).toFixed(3)}s`);
      ui.sprite.classList.toggle("is-once", spec.loop === false);
    }
    if (holdMs) {
      stateTimer = window.setTimeout(() => {
        if (!dragging && !physics) setState(sleeping ? "sleep" : "idle");
      }, holdMs);
    }
  }

  // ------------------------------------------------------------------ 身体：位置、拖拽、飘落、游动

  let x = 0;
  let y = 0;
  let width = 76;
  let height = 64;
  let facingLeft = false;
  let physics = 0;
  let dragging = false;

  const floorY = () => window.innerHeight - height - 10;
  const clampX = (value) => Math.min(Math.max(value, 8), window.innerWidth - width - 8);
  function place(nextX, nextY) {
    x = clampX(nextX);
    y = Math.min(Math.max(nextY, 8), floorY());
    ui.body.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    positionOverlays();
  }
  function dock() {
    const rect = ui.body.getBoundingClientRect();
    width = rect.width || width;
    height = rect.height || height;
    const fraction = memory.dock && typeof memory.dock.x === "number" ? memory.dock.x : null;
    place(fraction === null ? window.innerWidth - width - 28 : fraction * (window.innerWidth - width), floorY());
  }
  function rememberDock() {
    memory.dock = { x: x / Math.max(1, window.innerWidth - width) };
    save();
  }
  function face(left) {
    facingLeft = left;
    ui.figure.classList.toggle("is-left", left);
  }

  function release(vx, vy) {
    if (reduceMotion.matches) {
      place(x, floorY());
      setState("idle");
      rememberDock();
      return;
    }
    setState("float");
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      vx *= Math.pow(0.9, dt * 60);
      vy = Math.min(vy + 420 * dt, 130); // 像在水里：下沉慢、终速低
      let nextX = x + vx * dt;
      if (nextX <= 8 || nextX >= window.innerWidth - width - 8) vx = -vx * 0.5;
      place(nextX, y + vy * dt);
      if (Math.abs(vx) > 4) face(vx < 0);
      if (y >= floorY() - 0.5 && Math.abs(vx) < 12) {
        physics = 0;
        setState("happy", 900);
        rememberDock();
        return;
      }
      physics = window.requestAnimationFrame(step);
    };
    physics = window.requestAnimationFrame(step);
  }

  let pointer = null;
  ui.body.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    window.cancelAnimationFrame(physics);
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - x,
      offsetY: event.clientY - y,
      samples: [],
    };
    ui.body.setPointerCapture(event.pointerId);
  });
  ui.body.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (!dragging && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 6) return;
    if (!dragging) {
      dragging = true;
      ui.root.classList.add("is-dragging");
      ui.root.classList.remove("is-shy", "is-swimming");
      hideBubble();
      setState("drag");
      noteInteraction();
      if (Math.random() < 0.35) say(fill(pick(LINES.drag)), { response: true, ms: 1800 });
    }
    pointer.samples.push({ x: event.clientX, y: event.clientY, t: performance.now() });
    if (pointer.samples.length > 6) pointer.samples.shift();
    place(event.clientX - pointer.offsetX, event.clientY - pointer.offsetY);
  });
  function endPointer(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const samples = pointer.samples;
    pointer = null;
    if (!dragging) return; // 普通点击交给 click 处理
    dragging = false;
    ui.root.classList.remove("is-dragging");
    let vx = 0;
    let vy = 0;
    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = Math.max(16, last.t - first.t) / 1000;
      vx = Math.max(-1600, Math.min(1600, (last.x - first.x) / dt));
      vy = Math.max(-900, Math.min(900, (last.y - first.y) / dt));
    }
    suppressClick = true;
    release(vx, vy);
  }
  let suppressClick = false;
  ui.body.addEventListener("pointerup", endPointer);
  ui.body.addEventListener("pointercancel", endPointer);

  function swim() {
    if (reduceMotion.matches || dragging || physics || !ui.panel.hidden || !ui.bubble.hidden || sleeping || document.hidden || narrow.matches) return;
    if (reading.skimming || reading.active) return;
    const target = clampX(x + (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 220));
    face(target < x);
    ui.root.classList.add("is-swimming");
    place(target, floorY());
    window.setTimeout(() => {
      ui.root.classList.remove("is-swimming");
      rememberDock();
    }, 4300);
  }

  // ------------------------------------------------------------------ 气泡与面板的位置

  function positionOverlays() {
    for (const overlay of [ui.bubble, ui.panel]) {
      if (overlay.hidden) continue;
      if (overlay === ui.panel && narrow.matches) {
        overlay.style.left = "";
        overlay.style.top = "";
        continue;
      }
      const rect = overlay.getBoundingClientRect();
      let left = x + width * 0.4 - rect.width;
      let top = y - rect.height - 8;
      if (top < 8) top = Math.min(y + height + 8, window.innerHeight - rect.height - 8);
      left = Math.min(Math.max(left, 8), window.innerWidth - rect.width - 8);
      overlay.style.left = `${Math.round(left)}px`;
      overlay.style.top = `${Math.round(Math.max(8, top))}px`;
    }
  }

  // ------------------------------------------------------------------ 说话与克制

  const BUDGET = () => (memory.quietness >= 3 ? 1 : 2);
  const COOLDOWN_MS = 30000;
  let lastSpoke = 0;
  let bubbleTimer = 0;

  function hideBubble() {
    window.clearTimeout(bubbleTimer);
    ui.bubble.hidden = true;
    if (state === "talk") setState("idle");
  }

  // response：访客主动触发的回应，不占打扰预算；否则是主动搭话，受预算、冷却和阅读状态约束。
  function say(text, { response = false, actions = [], ms = 0, mood = "talk" } = {}) {
    if (!text) return false;
    if (!response) {
      if (session.silenced || session.spoken >= BUDGET()) return false;
      if (reading.skimming || !ui.panel.hidden || document.hidden || dragging) return false;
      if (Date.now() - lastSpoke < COOLDOWN_MS) return false;
      session.spoken += 1;
      save();
    }
    lastSpoke = Date.now();
    ui.bubbleText.textContent = text;
    ui.bubbleActions.replaceChildren(
      ...actions.map(([label, handler]) => {
        const button = element("button", { type: "button", text: label });
        button.addEventListener("click", () => {
          hideBubble();
          handler();
        });
        return button;
      })
    );
    ui.bubbleActions.hidden = actions.length === 0;
    ui.bubble.hidden = false;
    ui.root.classList.remove("is-shy");
    positionOverlays();
    // 被拎着或正在飘落时，说话不打断身体的动作。
    if (!dragging && !physics) setState(mood, 1600);
    window.clearTimeout(bubbleTimer);
    const duration = ms || Math.min(14000, 3500 + text.length * 160 + (actions.length ? 6000 : 0));
    bubbleTimer = window.setTimeout(hideBubble, duration);
    return true;
  }
  ui.bubble.addEventListener("pointerenter", () => window.clearTimeout(bubbleTimer));
  ui.bubble.addEventListener("pointerleave", () => {
    bubbleTimer = window.setTimeout(hideBubble, 3000);
  });
  ui.bubbleClose.addEventListener("click", () => {
    // 关掉一次，本次访问就不再主动说话；也记一笔「喜欢安静」。
    hideBubble();
    session.silenced = true;
    memory.quietness = Math.min(memory.quietness + 1, 6);
    save();
  });

  // ------------------------------------------------------------------ 感知

  const reading = { active: false, skimming: false, lastScroll: 0, velocity: 0 };
  let lastScrollY = window.scrollY;
  let lastScrollAt = performance.now();
  let lastInput = Date.now();
  let sleeping = false;

  function noteInput() {
    lastInput = Date.now();
    if (sleeping) {
      sleeping = false;
      if (state === "sleep") setState("idle");
    }
  }
  window.addEventListener(
    "scroll",
    () => {
      const now = performance.now();
      const dt = Math.max(16, now - lastScrollAt);
      const speed = (Math.abs(window.scrollY - lastScrollY) / dt) * 1000;
      reading.velocity = reading.velocity * 0.7 + speed * 0.3;
      reading.skimming = reading.velocity > 2200;
      reading.lastScroll = Date.now();
      lastScrollY = window.scrollY;
      lastScrollAt = now;
      noteInput();
      trackProgress();
    },
    { passive: true }
  );
  for (const type of ["pointermove", "keydown", "pointerdown"]) window.addEventListener(type, noteInput, { passive: true });

  // 正在读的小节
  const headings = [...article.querySelectorAll("h2, h3")];
  if ("IntersectionObserver" in window && headings.length) {
    const seen = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target, entry.boundingClientRect.top);
        let best = null;
        for (const heading of headings) {
          const top = heading.getBoundingClientRect().top;
          if (top < window.innerHeight * 0.45) best = heading;
        }
        if (best && best !== currentHeading) {
          currentHeading = best;
          currentSection = best.textContent.trim().slice(0, 80);
          trackProgress();
        }
      },
      { rootMargin: "0px 0px -40% 0px" }
    );
    headings.forEach((heading) => observer.observe(heading));
  }

  // 阅读进度：文章页记住读到哪，读完（到 90%）就不再提醒。
  function trackProgress() {
    if (pageKind() !== "post") return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? window.scrollY / scrollable : 1;
    memory.lastRead = {
      url: path,
      title: pageTitle(),
      section: currentSection,
      finished: progress > 0.9 || (memory.lastRead?.url === path && memory.lastRead.finished),
      at: Date.now(),
    };
    save();
  }

  // 在图、代码、表格前停留：可见、且 3 秒没滚动，累计 10 秒就问一次要不要解释。
  const offered = new WeakSet();
  const watched = [...article.querySelectorAll("figure, img, pre, table")].filter((node) => !node.closest(".pet-root"));
  const visible = new Map();
  if ("IntersectionObserver" in window && watched.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.5) visible.set(entry.target, visible.get(entry.target) || 0);
          else visible.delete(entry.target);
        }
      },
      { threshold: [0, 0.5, 1] }
    );
    watched.forEach((node) => observer.observe(node));
  }
  function tickDwell() {
    if (document.hidden || Date.now() - reading.lastScroll < 3000) return;
    for (const [node, seconds] of visible) {
      const target = node.closest("figure") || node;
      if (offered.has(target)) continue;
      const next = seconds + 1;
      visible.set(node, next);
      if (next < 10) continue;
      offered.add(target);
      const kind = target.tagName === "PRE" ? "code" : target.tagName === "TABLE" ? "table" : "figure";
      say(fill(pick(LINES.dwell?.[kind])), {
        actions: [
          ["要", () => explain(target)],
          ["不用", () => undefined],
        ],
      });
      return;
    }
  }

  // 在导航栏来回找：5 秒内悬停 4 个以上不同链接却没点。
  const navHovers = [];
  document.getElementById("navbar")?.addEventListener("pointerover", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    const now = Date.now();
    navHovers.push({ href: link.href, at: now });
    while (navHovers.length && now - navHovers[0].at > 5000) navHovers.shift();
    if (new Set(navHovers.map((h) => h.href)).size >= 4) {
      navHovers.length = 0;
      say(fill(pick(LINES.lost)), { actions: [["带我逛逛", () => openPanel("tour")]] });
    }
  });

  // 主题、Turbo、彩蛋、资源加载失败
  new MutationObserver(() => {
    const dark = root.getAttribute("data-theme") === "dark";
    say(fill(pick(LINES.theme?.[dark ? "dark" : "light"])), { mood: "happy" });
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("functionhx:turbo-changed", (event) => {
    if (event.detail?.active) {
      setState("happy", 2000);
      say(fill(pick(LINES.turbo)));
    }
  });
  const eggsFound = () => {
    const list = read(window.localStorage, EGGS_KEY, []);
    return Array.isArray(list) ? list.length : 0;
  };
  let knownEggs = eggsFound();
  function tickEggs() {
    const count = eggsFound();
    if (count > knownEggs) {
      setState("happy", 2400);
      // 找到彩蛋是访客自己的成就：不占预算，但关掉过气泡就只开心、不说话。
      if (!session.silenced) say(fill(pick(LINES.egg)), { response: true });
    }
    knownEggs = count;
  }
  let reportedBroken = false;
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (reportedBroken || !(target instanceof HTMLImageElement) || !content.contains(target)) return;
      reportedBroken = true;
      setState("confused", 2400);
      say(fill(pick(LINES.broken)));
    },
    true
  );

  document.addEventListener("visibilitychange", () => {
    ui.root.classList.toggle("is-paused", document.hidden);
  });

  function tick() {
    tickDwell();
    tickEggs();
    reading.active = pageKind() === "post" && Date.now() - reading.lastScroll < 20000 && !reading.skimming;
    if (!sleeping && Date.now() - lastInput > 70000 && ui.panel.hidden && !dragging) {
      sleeping = true;
      hideBubble();
      setState("sleep");
    }
  }

  // ------------------------------------------------------------------ 数据：/api/*.json（与 Agent 版同一份）

  const cache = new Map();
  function api(name) {
    if (!cache.has(name)) {
      cache.set(
        name,
        window
          .fetch(`/api/${name}.json`, { credentials: "omit" })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
      );
    }
    return cache.get(name);
  }

  function siteLink(url) {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin === window.location.origin) return parsed.pathname + parsed.hash;
      if (parsed.origin === SITE) return window.location.origin === SITE ? parsed.pathname + parsed.hash : parsed.href;
    } catch (_error) {
      return null;
    }
    return null;
  }

  // 只把站内链接渲染成可点的链接；其余一律当纯文本。
  function renderRich(container, text) {
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)|(https?:\/\/functionhx\.github\.io\/[^\s)）。，]*)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      container.append(document.createTextNode(text.slice(last, match.index)));
      const href = siteLink(match[2] || match[3]);
      const label = match[1] || match[3];
      container.append(href ? element("a", { href, text: label }) : document.createTextNode(label));
      last = match.index + match[0].length;
    }
    container.append(document.createTextNode(text.slice(last)));
  }

  // ------------------------------------------------------------------ 面板与动作

  let chatLog = [];
  let controller = null;
  let namingMode = false;

  function addMessage(text, who = "pet", { meta = "", links = [] } = {}) {
    const node = element("div", { class: `pet-message ${who === "visitor" ? "is-visitor" : "is-pet"}` });
    if (who === "visitor") node.textContent = text;
    else renderRich(node, text);
    if (links.length) {
      const line = element("span", { class: "pet-meta" });
      line.append(document.createTextNode("出处："));
      links.forEach((link, index) => {
        const href = siteLink(link.url);
        if (index) line.append(document.createTextNode("、"));
        line.append(href ? element("a", { href, text: `《${link.title}》` }) : document.createTextNode(`《${link.title}》`));
      });
      node.append(line);
    }
    if (meta) node.append(element("span", { class: "pet-meta", text: meta }));
    ui.log.append(node);
    ui.log.scrollTop = ui.log.scrollHeight;
    positionOverlays();
    return node;
  }

  function openPanel(action) {
    hideBubble();
    ui.panel.hidden = false;
    ui.body.setAttribute("aria-expanded", "true");
    ui.root.classList.remove("is-shy");
    renderPanelHeader();
    positionOverlays();
    noteInteraction();
    if (action) runAction(action);
    else if (!ui.log.childElementCount) addMessage(fill(pick(memory.visits > 1 ? LINES.greet?.return : LINES.greet?.first)));
    if (!narrow.matches) ui.input.focus({ preventScroll: true });
  }
  function closePanel() {
    controller?.abort();
    ui.panel.hidden = true;
    ui.body.setAttribute("aria-expanded", "false");
    namingMode = false;
    setState(sleeping ? "sleep" : "idle");
    ui.body.focus({ preventScroll: true });
  }
  function renderPanelHeader() {
    ui.panelTitle.textContent = petName();
    ui.panelSub.textContent = memory.petName ? `（${LINES.name || "ƒ-01"}）` : "住在这个网站里";
    ui.input.placeholder = namingMode ? "给它起个名字（最多 12 个字）" : CONFIG.endpoint ? "问点什么……" : "输入关键词，在站里翻翻";
    const credit = sprites && sprites.credit ? ` ${sprites.credit}` : "";
    ui.footnote.textContent = `${(CONFIG.endpoint ? LINES.disclosure : LINES.disclosure_local) || ""}${credit}`;
  }
  function noteInteraction() {
    if (!memory.interacted) {
      memory.interacted = true;
      save();
    }
  }

  ui.body.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!ui.panel.hidden) closePanel();
    else {
      if (Math.random() < 0.3 && memory.visits > 1) setState("happy", 900);
      openPanel();
    }
  });
  ui.panelClose.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!ui.panel.hidden) closePanel();
    else if (!ui.bubble.hidden) hideBubble();
  });

  async function runAction(id) {
    noteInteraction();
    if (id === "intro") {
      const profile = await api("profile");
      if (!profile) return addMessage(fill(pick(LINES.offline)));
      addMessage(
        `站长是${profile.name}（${profile.name_latin}）：${profile.headline}。${LINES.not_owner || ""}\n他的英文学术主页在 ${profile.academic?.url || ""}`
      );
    } else if (id === "latest") {
      const data = await api("writings");
      const item = data?.items?.[0];
      if (!item) return addMessage(fill(pick(LINES.offline)));
      addMessage(`最新一篇是 [《${item.title}》](${item.url})（${item.date}）。${item.description}`);
    } else if (id === "project") {
      const data = await api("projects");
      const items = (data?.items || []).filter((item) => item.kind !== "tool");
      const unseen = items.filter((item) => !memory.pages[new URL(item.url).pathname]);
      const item = (unseen.length ? unseen : items)[Math.floor(Math.random() * Math.max(1, (unseen.length ? unseen : items).length))];
      if (!item) return addMessage(fill(pick(LINES.offline)));
      addMessage(`${unseen.length ? "这个你还没看过：" : "这个值得再看一遍："}[${item.title}](${item.url})——${item.description}`);
    } else if (id === "tour") {
      const [projects, writings] = await Promise.all([api("projects"), api("writings")]);
      const pickUnseen = (items) => (items || []).find((item) => !memory.pages[new URL(item.url).pathname]) || (items || [])[0];
      const stops = [
        pickUnseen((projects?.items || []).filter((i) => i.kind !== "tool")),
        pickUnseen(writings?.items),
        pickUnseen((projects?.items || []).filter((i) => i.kind === "tool")),
      ].filter(Boolean);
      if (!stops.length) return addMessage(fill(pick(LINES.offline)));
      addMessage(`走这条路线：\n${stops.map((item, index) => `${index + 1}. [${item.title}](${item.url})`).join("\n")}\n看完记得回来找我。`);
    } else if (id === "top") {
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
      addMessage("回到顶部了。");
    } else if (id === "theme") {
      const toggle = document.getElementById("light-toggle");
      if (toggle) toggle.click();
      else addMessage("这页没有主题开关，我也没办法。");
    } else if (id === "memory") {
      showMemory();
    } else if (id === "name") {
      namingMode = true;
      renderPanelHeader();
      addMessage(memory.petName ? `我现在叫「${memory.petName}」。想换一个就写在下面。` : "你想叫我什么？写在下面。");
      ui.input.focus();
    } else if (id === "quiet") {
      addMessage(fill(pick(LINES.quiet)));
      session.silenced = true;
      memory.hidden = true;
      memory.quietness = Math.min(memory.quietness + 1, 6);
      save();
      window.setTimeout(() => {
        closePanel();
        collapse();
      }, 900);
    }
  }

  function showMemory() {
    const days = memory.firstSeen ? new Date(memory.firstSeen) : null;
    const favourite = Object.entries(memory.pages).sort((a, b) => b[1] - a[1])[0];
    const items = [
      `这是你第 ${memory.visits} 次来${days ? `，我们第一次见面是 ${days.getFullYear()} 年 ${days.getMonth() + 1} 月 ${days.getDate()} 日` : ""}。`,
      memory.petName ? `你给我起的名字：${memory.petName}。` : "",
      memory.lastRead
        ? `你上次在读《${memory.lastRead.title}》${memory.lastRead.section ? `的「${memory.lastRead.section}」` : ""}${memory.lastRead.finished ? "，读完了" : ""}。`
        : "",
      favourite ? `你最常来的页面：${favourite[0]}（${favourite[1]} 次）。` : "",
      `你找到过 ${eggsFound()} 个彩蛋，也就是我的 ${eggsFound()} 个零件。`,
      memory.topics.length ? `你问过的话题：${memory.topics.slice(-5).join("、")}。` : "",
      memory.quietness >= 3 ? "你好像喜欢安静，所以我少说话。" : "",
    ].filter(Boolean);
    const node = addMessage("我记得这些：");
    const list = element(
      "ul",
      { class: "pet-memory" },
      items.map((text) => element("li", { text }))
    );
    const forget = element("button", { type: "button", class: "pet-forget", text: "忘记我" });
    forget.addEventListener("click", forgetEverything);
    node.append(list, element("span", { class: "pet-meta", text: "都只存在你这台设备的浏览器里，没有上传。你和我聊天的原话我不记。" }), forget);
  }

  function forgetEverything() {
    try {
      window.localStorage.removeItem(MEMORY_KEY);
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (_error) {
      // ignore
    }
    memory = freshMemory();
    chatLog = [];
    ui.log.replaceChildren();
    addMessage(fill(pick(LINES.forgot)));
    renderPanelHeader();
  }

  // ------------------------------------------------------------------ 对话

  async function localAnswer(question) {
    const [writings, projects] = await Promise.all([api("writings"), api("projects")]);
    const words = question
      .toLowerCase()
      .split(/[\s，。？！、,.?!]+/)
      .filter((w) => w.length >= 2);
    const items = [...(writings?.items || []), ...(projects?.items || [])];
    const scored = items
      .map((item) => {
        const hay = `${item.title} ${item.description || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
        let score = 0;
        for (const word of words) {
          if (hay.includes(word)) score += 2;
          for (let i = 0; i + 1 < word.length; i += 1) if (hay.includes(word.slice(i, i + 2))) score += 0.5;
        }
        return { item, score };
      })
      .filter((entry) => entry.score >= 1)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return addMessage(fill(pick(LINES.unknown), { section: "文章" }));
    addMessage(
      `我在站里翻到这些：\n${scored
        .slice(0, 3)
        .map(({ item }) => `· [${item.title}](${item.url})`)
        .join("\n")}`
    );
  }

  async function ask(question, focus) {
    if (LETTER.test(question)) {
      setState("confused", 2400);
      return addMessage(LINES.letter || "那不是一道题。");
    }
    if (!CONFIG.endpoint) return localAnswer(question);
    chatLog.push({ role: "user", content: question });
    chatLog = chatLog.slice(-8);
    setState("think");
    ui.send.disabled = true;
    const node = addMessage("……");
    controller = new AbortController();
    let answer = "";
    let finished = null;
    try {
      const response = await window.fetch(`${String(CONFIG.endpoint).replace(/\/$/, "")}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatLog, page: pageContext(focus), petName: memory.petName }),
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const code = (await response.json().catch(() => ({}))).error;
        node.remove();
        chatLog.pop();
        addMessage(fill(pick(code === "budget_exhausted" ? LINES.budget : code === "rate_limited" ? LINES.rate : LINES.offline)));
        if (code !== "rate_limited") await localAnswer(question);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const block of events) {
          if (!block.startsWith("data: ")) continue;
          let data;
          try {
            data = JSON.parse(block.slice(6));
          } catch (_error) {
            continue;
          }
          if (data.t) {
            if (!answer) setState("talk");
            answer += data.t;
            node.textContent = answer;
            ui.log.scrollTop = ui.log.scrollHeight;
          }
          if (data.done || data.error) finished = data;
        }
      }
      node.replaceChildren();
      renderRich(node, answer || "……");
      const sources = (finished?.sources || []).slice(0, 2);
      if (sources.length) {
        const line = element("span", { class: "pet-meta" });
        line.append(document.createTextNode("出处："));
        sources.forEach((source, index) => {
          const href = siteLink(source.url);
          if (index) line.append(document.createTextNode("、"));
          line.append(href ? element("a", { href, text: `《${source.title}》` }) : document.createTextNode(`《${source.title}》`));
        });
        node.append(line);
        for (const source of sources) if (!memory.topics.includes(source.title)) memory.topics.push(source.title);
        memory.topics = memory.topics.slice(-10);
      }
      if (!finished?.letter) node.append(element("span", { class: "pet-meta", text: LINES.ai_label || "AI 生成" }));
      chatLog.push({ role: "assistant", content: answer.slice(0, 600) });
      memory.chats += 1;
      memory.quietness = Math.max(0, memory.quietness - 1);
      save();
      setState("happy", 1200);
    } catch (error) {
      node.remove();
      chatLog.pop();
      if (error?.name !== "AbortError") {
        addMessage(fill(pick(LINES.offline)));
        await localAnswer(question);
      }
    } finally {
      controller = null;
      ui.send.disabled = false;
      if (state === "think") setState("idle");
    }
  }

  function explain(target) {
    openPanel();
    const kind = target.tagName === "PRE" ? "这段代码" : target.tagName === "TABLE" ? "这张表" : "这张图";
    const question = `解释一下${kind}`;
    addMessage(question, "visitor");
    ask(question, target);
  }

  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.input.value.trim().slice(0, 300);
    if (!text) return;
    ui.input.value = "";
    if (namingMode) {
      namingMode = false;
      memory.petName = text.replace(/[\u0000-\u001f<>]/g, "").slice(0, 12);
      save();
      renderPanelHeader();
      setState("happy", 1500);
      addMessage(`好，以后我就叫「${memory.petName}」。`);
      return;
    }
    addMessage(text, "visitor");
    ask(text);
  });

  // ------------------------------------------------------------------ 收起 / 召回

  function collapse() {
    ui.body.hidden = true;
    hideBubble();
    ui.tab.hidden = false;
    ui.tabLabel.textContent = petName();
    ui.tab.setAttribute("aria-label", `叫出 ${petName()}`);
  }
  function expand() {
    ui.tab.hidden = true;
    ui.body.hidden = false;
    memory.hidden = false;
    save();
    dock();
    setState("happy", 1200);
  }
  ui.tab.addEventListener("click", () => {
    expand();
    session.collapsedThisVisit = false;
    save();
  });

  // ------------------------------------------------------------------ 启动

  function greet() {
    if (session.greeted) {
      const kind = pageKind();
      say(fill(pick(LINES.page?.[kind]), { minutes: readingMinutes() }));
      return;
    }
    session.greeted = true;
    save();
    const hour = new Date().getHours();
    const story = Array.isArray(LINES.story) ? LINES.story : [];
    const next = story[memory.storyStep];
    if (next && eggsFound() >= next.eggs && memory.visits > 1) {
      memory.storyStep += 1;
      save();
      return say(next.line, { mood: "happy" });
    }
    if (hour < 5) return say(fill(pick(LINES.greet?.night)));
    const last = memory.lastRead;
    if (memory.visits > 1 && last && !last.finished && last.url !== path && Date.now() - last.at < 30 * 86400000) {
      return say(fill(pick(LINES.greet?.unfinished), last), {
        actions: [
          ["接着看", () => window.location.assign(last.url)],
          ["不了", () => undefined],
        ],
      });
    }
    say(fill(pick(memory.visits > 1 ? LINES.greet?.return : LINES.greet?.first)));
  }

  function start(lines) {
    LINES = lines || {};
    renderPanelHeader();
    ui.body.setAttribute("aria-label", `${petName()}：住在这个网站里的小鲸鱼，点它说话`);
    for (const item of LINES.menu || []) {
      const button = element("button", { type: "button", text: item.label });
      button.addEventListener("click", () => runAction(item.id));
      ui.chips.append(button);
    }
    document.body.append(ui.root);
    if (memory.visits <= 1 && !memory.interacted) ui.root.classList.add("is-shy");
    setState("idle");
    dock();
    const collapsed = memory.hidden || (narrow.matches && !session.expandedOnMobile);
    if (collapsed) collapse();
    window.addEventListener("resize", () => {
      if (!ui.body.hidden) place(x, floorY());
    });
    ui.tab.addEventListener("click", () => {
      session.expandedOnMobile = true;
      save();
    });
    window.setInterval(tick, 1000);
    window.setInterval(swim, 32000);
    if (!collapsed) window.setTimeout(greet, 2500);
    window.addEventListener("pagehide", () => {
      window.clearTimeout(saveTimer);
      write(window.localStorage, MEMORY_KEY, memory);
      write(window.sessionStorage, SESSION_KEY, session);
    });
    window.functionhxPet = Object.freeze({ say: (text) => say(String(text), { response: true }), setState, open: openPanel });
  }

  window
    .fetch(CONFIG.lines, { credentials: "omit" })
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))
    .then(start);
})();
