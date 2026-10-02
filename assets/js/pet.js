/* 网站宠物：ƒ-01（本站原住民）和来串门的大肥鱼、陶陶、薄荷、双双，一次只出来一只，访客可以换。
 *
 * 身体、感知、记忆、主动性、动作全部在浏览器本地完成：即时、免费、不上传。只有访客主动提问时，
 * 才把问题和当前页面的摘录发给大脑（pet-brain/，Cloudflare Worker → 各家模型，没接上的由 DeepSeek 代班）；
 * 大脑不可用时退回站内搜索。
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
  const OVERRIDE_KEY = "functionhx:pet:override";
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

  // 关于访客的记忆所有宠物共用；起的名字、换装按宠物分开记（pets.<id>）。
  const freshMemory = () => ({
    v: 2,
    firstSeen: null,
    lastSeen: null,
    visits: 0,
    character: "",
    pets: {},
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
  if (!memory.pets || typeof memory.pets !== "object") memory.pets = {};
  if (memory.petName) {
    // v1 只有一只宠物，那时起的名字归 ƒ-01。
    memory.pets.f01 = Object.assign({ name: String(memory.petName).slice(0, 12) }, memory.pets.f01);
    delete memory.petName;
  }
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

  // ------------------------------------------------------------------ 角色与台词

  // 只有登记了授权形象的宠物会对访客出现；?pet=on 预览时全部出现（没有形象的用内置占位形象）。
  const preview = (() => {
    try {
      return window.localStorage.getItem(OVERRIDE_KEY) === "on";
    } catch (_error) {
      return false;
    }
  })();
  const roster = (Array.isArray(CONFIG.characters) ? CONFIG.characters : []).filter((c) => c && c.id && (c.sprites || preview));
  if (!roster.length) return;
  const characterById = (id) => roster.find((c) => c.id === id);
  let current = characterById(memory.character) || characterById(CONFIG.default) || roster[0];

  let COMMON = {};
  let LINES = {};
  const pick = (list) => (Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : typeof list === "string" ? list : "");
  const petMemory = () => {
    memory.pets[current.id] = memory.pets[current.id] || {};
    return memory.pets[current.id];
  };
  const nickname = () => (memory.pets[current.id] && memory.pets[current.id].name) || "";
  const petName = () => nickname() || LINES.name || current.name || "ƒ-01";
  function fill(text, values = {}) {
    return String(text || "").replace(/\{(\w+)\}/g, (_match, key) => {
      if (key === "name") return petName();
      if (key === "visits") return String(memory.visits);
      if (key === "model") return values.model || "模型服务商";
      return values[key] === undefined ? "" : String(values[key]);
    });
  }
  // 公共台词 + 这只宠物的台词：同名的对象合并一层（例如 greet.unfinished 来自公共部分，greet.first 来自它自己）。
  function mergeLines(base, own) {
    const out = Object.assign({}, base);
    for (const [key, value] of Object.entries(own || {})) {
      const shared = out[key];
      const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
      out[key] = plain(shared) && plain(value) ? Object.assign({}, shared, value) : value;
    }
    return out;
  }
  const fetchJson = (url) =>
    window
      .fetch(url, { credentials: "omit" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);

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

  // 内置占位形象：授权形象（序列帧）登记之前用。五只共用一个圆滚滚的身体，靠配色、配件和招牌动作区分；
  // 不画任何公司的标志——那些只出现在画师交付的授权形象里。
  const EYES = `<g class="eyes eyes-open"><g class="eye-open"><ellipse cx="78" cy="56" rx="4.2" ry="4.8" fill="#1d1a2e"/><ellipse cx="94" cy="54.5" rx="3.6" ry="4.2" fill="#1d1a2e"/><circle cx="79.6" cy="54.2" r="1.5" fill="#fff"/><circle cx="95.3" cy="52.8" r="1.2" fill="#fff"/></g></g>
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
          <ellipse class="mouth mouth-o" cx="86" cy="65" rx="1.8" ry="2.2" fill="#7a2b4a" stroke="#1d1a2e" stroke-width="1.3"/>`;
  const BODY_PATH = "M22 62C22 38 44 26 68 27C93 28 107 44 105 64C103 82 86 91 63 91C39 91 22 81 22 62Z";
  const INK = 'font-family="ui-rounded,-apple-system,sans-serif" font-weight="800"';
  const OUTFIT = `<g clip-path="url(#pet-clip)">
          <path d="M57 75C70 71.5 88 71 104 73.5V96H55Z" style="fill:var(--pet-uniform)"/>
          <path d="M60 75C57 62 55 48 57 34" style="stroke:var(--pet-uniform-line)" stroke-width="3.4" stroke-linecap="round" fill="none"/>
          <rect x="64" y="77.5" width="15" height="10.5" rx="2.4" fill="#fffaf0" style="stroke:var(--pet-uniform-line)" stroke-width="1.1"/>
          <path d="M67.5 82.8H75.5M67.5 85.2H72.5" style="stroke:var(--pet-uniform-line)" stroke-width="1.1" stroke-linecap="round"/>
        </g>`;
  const PARTS = {
    f01: {
      tail: `<g class="tail"><path d="M27 68C17 71 10 66 9 57C8 47 10 38 15 33C18.5 29.5 22.5 30.5 23.5 34" fill="none" style="stroke:var(--pet-skin-deep)" stroke-width="5.5" stroke-linecap="round"/><path d="M3 50H19" style="stroke:var(--pet-skin-deep)" stroke-width="4" stroke-linecap="round"/></g>`,
      face: `<g class="rings" fill="none" style="stroke:var(--pet-accent2)" stroke-width="1.2"><circle cx="78" cy="56" r="2.7"/><circle cx="94" cy="54.5" r="2.3"/></g><text x="73.5" y="72.5" font-family="Georgia,serif" font-style="italic" font-weight="700" font-size="7.5" style="fill:var(--pet-accent2)">ƒ</text>`,
      fx: `<g class="stream" style="fill:var(--pet-accent2)" ${INK} font-size="8"><text x="18" y="30">0</text><text x="34" y="18">1</text><text x="58" y="12">ƒ</text><text x="88" y="16">x</text><text x="104" y="30">1</text><text x="8" y="50">(</text><text x="110" y="50">)</text></g>`,
    },
    deepseek: {
      tail: `<g class="tail"><path d="M27 60C20 57 15 50 14 42C18 44 21 47 22 50C21 44 23 38 28 35C29 42 30 50 31 58Z" style="fill:var(--pet-skin-deep);stroke:var(--pet-line)" stroke-width="1.6" stroke-linejoin="round"/></g>`,
      outfit: OUTFIT,
      fx: `<g class="spout"><path d="M84 27V16M84 17C81 12 77 11.5 74.5 14.5M84 17C87 12 91 11.5 93.5 14.5" fill="none" stroke="#5cbcf0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
        <g class="drops" fill="#5cbcf0"><circle cx="84" cy="9" r="2.2"/><circle cx="90" cy="8" r="1.8"/><circle cx="87" cy="5" r="1.5"/></g>
        <g class="coins" ${INK} font-size="6.5"><g><circle cx="112" cy="58" r="4.6" fill="#ffd166" stroke="#c79100"/><text x="112" y="60.4" text-anchor="middle" fill="#7a5600">T</text></g><g><circle cx="112" cy="58" r="4.6" fill="#ffd166" stroke="#c79100"/><text x="112" y="60.4" text-anchor="middle" fill="#7a5600">T</text></g></g>`,
    },
    claude: {
      outfit: OUTFIT,
      fx: `<g class="book"><path d="M70 74L86 71L102 74V86L86 83L70 86Z" fill="#fffaf0" stroke="#8a5a3c" stroke-width="1.2" stroke-linejoin="round"/><path d="M86 71V83" stroke="#8a5a3c" stroke-width="1"/><path d="M73 77.5L83 76M73 80.5L83 79M89 76L99 77.5M89 79L99 80.5" stroke="#c9b79c" stroke-width=".9"/></g>
        <g class="tea"><path d="M100 70H112V77C112 81 109 83 106 83C103 83 100 81 100 77Z" fill="#fffaf0" stroke="#8a5a3c" stroke-width="1.2"/><path d="M112 72.5C115 72.5 115 77 112 77" fill="none" stroke="#8a5a3c" stroke-width="1.2"/><path class="steam" d="M104 67C102.5 64 105.5 62 104 59M108 67C106.5 64 109.5 62 108 59" fill="none" stroke="#c9b79c" stroke-width="1.2" stroke-linecap="round"/></g>
        <g class="pencil"><path d="M96 48L112 36" stroke="#d97757" stroke-width="3.2" stroke-linecap="round"/><path d="M112 36L115 34" stroke="#3d3a33" stroke-width="2" stroke-linecap="round"/></g>`,
    },
    chatgpt: {
      outfit: `<g clip-path="url(#pet-clip)"><path d="M57 77C70 74 88 73.5 104 76V96H55Z" style="fill:var(--pet-uniform)"/><path d="M80 75.5L84 80L88 75.5" fill="none" style="stroke:var(--pet-accent2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>`,
      face: `<g class="hairpin"><circle cx="94" cy="33" r="5.4" style="fill:var(--pet-accent2)"/><circle cx="94" cy="33" r="2.6" fill="none" stroke="#fff" stroke-width="1.3"/></g>`,
      fx: `<g class="note"><rect x="100" y="64" width="14" height="17" rx="1.6" fill="#fff" stroke="#1f2a27" stroke-width="1.1" transform="rotate(8 107 72)"/><path d="M103 69H111M103 72.5H111M103 76H108" stroke="#10a37f" stroke-width="1.1" stroke-linecap="round" transform="rotate(8 107 72)"/></g>
        <g class="bulb"><circle cx="104" cy="22" r="6.4" fill="#fff6a8" stroke="#1f2a27" stroke-width="1.2"/><path d="M101.5 28.5H106.5V31.5H101.5Z" fill="#1f2a27"/><path d="M104 11V8M95.5 15L93.5 13M112.5 15L114.5 13" stroke="#10a37f" stroke-width="1.4" stroke-linecap="round"/></g>
        <g class="cards"><rect x="2" y="66" width="12" height="16" rx="1.6" fill="#fff" stroke="#1f2a27" stroke-width="1" /><rect x="6" y="64" width="12" height="16" rx="1.6" fill="#e9f8f2" stroke="#1f2a27" stroke-width="1"/><rect x="10" y="62" width="12" height="16" rx="1.6" fill="#fff" stroke="#10a37f" stroke-width="1.2"/></g>`,
    },
    gemini: {
      face: `<path class="star" d="M86 33Q87 39 93 40Q87 41 86 47Q85 41 79 40Q85 39 86 33Z" fill="#fff" style="stroke:var(--pet-line)" stroke-width=".8"/>`,
      fx: `<g class="sparkles" fill="#fff" style="stroke:var(--pet-accent2)" stroke-width=".8"><path d="M24 26Q25 30 29 31Q25 32 24 36Q23 32 19 31Q23 30 24 26Z"/><path d="M108 22Q108.8 25 112 26Q108.8 27 108 30Q107.2 27 104 26Q107.2 25 108 22Z"/></g>`,
      twin: true,
    },
  };
  function placeholder(id) {
    const parts = PARTS[id] || PARTS.f01;
    const rig = (cls) => `<g class="${cls}">
      ${parts.tail || ""}
      <g class="body-wrap">
        <path d="${BODY_PATH}" fill="url(#pet-skin)" style="stroke:var(--pet-line)" stroke-width="1.8"/>
        <g clip-path="url(#pet-clip)"><ellipse cx="72" cy="86" rx="38" ry="15" style="fill:var(--pet-belly)"/><ellipse cx="54" cy="40" rx="14" ry="6" fill="#fff" opacity=".22" transform="rotate(-18 54 40)"/></g>
        ${parts.outfit || ""}
        <g class="fin"><path d="M52 70C47 74 44 79 45 83C50 82 55 78 58 73Z" style="fill:var(--pet-skin-deep);stroke:var(--pet-line)" stroke-width="1.4" stroke-linejoin="round"/></g>
        <g class="face">${EYES}</g>
        <g class="decor">${parts.face || ""}</g>
      </g>
      <g class="fx">${parts.fx || ""}
        <g class="bubbles" fill="none" stroke="#5cbcf0" stroke-width="1.6"><circle cx="82" cy="22" r="2.6"/><circle cx="88" cy="20" r="3.4"/><circle cx="78" cy="19" r="2"/></g>
        <g class="zzz" fill="#5cbcf0" ${INK}><text x="84" y="24" font-size="9">z</text><text x="88" y="20" font-size="11">z</text><text x="92" y="16" font-size="13">Z</text></g>
        <g class="question" fill="#c5a2ff" ${INK}><text x="84" y="22" font-size="18">?</text></g>
      </g>
    </g>`;
    return `<svg class="pet-whale pet-ph-${id}" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="pet-skin" x1="0" y1="0" x2="${parts.twin ? 1 : 0}" y2="1"><stop offset="0" style="stop-color:var(--pet-skin)"/><stop offset="1" style="stop-color:var(--pet-skin-deep)"/></linearGradient>
      <clipPath id="pet-clip"><path d="${BODY_PATH}"/></clipPath>
    </defs>
    <ellipse class="shadow" cx="63" cy="96" rx="34" ry="3.2" fill="#000" opacity=".2"/>
    ${parts.twin ? `<g class="twin-wrap">${rig("rig twin")}</g>` : ""}${rig("rig main")}
  </svg>`;
  }

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
  ui.tab.innerHTML = `<svg viewBox="14 24 94 70" aria-hidden="true"><path d="${BODY_PATH}" style="fill:var(--pet-color)"/><circle cx="80" cy="56" r="4" fill="#fff"/></svg>`;
  ui.tabLabel = element("span");
  ui.tab.append(ui.tabLabel);
  ui.root.append(ui.body, ui.bubble, ui.panel, ui.tab);

  // ------------------------------------------------------------------ 形象：授权序列帧，或内置占位形象

  // sprites 是这只宠物的 pet.json（见 assets/pet/README.md）：每个状态一张横向序列帧条。
  let sprites = null;
  let spriteBase = "";
  let manifestDir = "";
  const spriteImages = new Map();
  // 画师没画的状态，按这张表退回最接近的那个，最后退回 idle。
  const FALLBACK = {
    walk: "idle",
    wave: "happy",
    waiting: "idle",
    failed: "confused",
    confused: "failed",
    drag: "surprised",
    surprised: "failed",
    float: "fall",
    fall: "drag",
    unfold: "think",
    bubble: "think",
    read: "think",
    write: "think",
    note: "think",
    cards: "think",
    eat: "happy",
    tea: "happy",
    bulb: "happy",
    split: "happy",
    swap: "walk",
    shimmer: "happy",
    dive: "walk",
  };
  function spriteState(name) {
    const seen = new Set();
    for (let candidate = name; candidate && !seen.has(candidate); candidate = FALLBACK[candidate]) {
      if (sprites.states[candidate]) return candidate;
      seen.add(candidate);
    }
    return "idle";
  }
  function costumeOf() {
    const id = petMemory().costume || "";
    return (LINES.costumes || []).find((c) => c.id === id && eggsFound() >= (c.unlock_eggs || 0)) || null;
  }
  // 这个状态用哪一套帧：穿着换装、且换装画了这个动作时用换装的，否则用默认的。
  function spriteFrames(state) {
    const costume = costumeOf();
    const extra = costume && sprites.costumes && sprites.costumes[costume.id];
    if (extra && extra.states && extra.states[state]) {
      return { spec: extra.states[state], base: new URL(extra.base || `sprites/${costume.id}/`, manifestDir).href };
    }
    return { spec: sprites.states[state], base: spriteBase };
  }
  // 只预载 idle，其余动作第一次用到时才下载；下载完之前继续显示上一个动作，不闪白。
  function loadImage(url) {
    if (!spriteImages.has(url)) {
      spriteImages.set(
        url,
        new Promise((resolve) => {
          const image = new Image();
          image.decoding = "async";
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = url;
        })
      );
    }
    return spriteImages.get(url);
  }
  function paintSprite(name) {
    const shown = spriteState(name);
    const { spec, base } = spriteFrames(shown);
    const url = new URL(spec.file || `${shown}.webp`, base).href;
    loadImage(url).then((ok) => {
      if (!ok || !sprites || spriteState(state) !== shown || ui.sprite === null) return;
      const frames = Math.max(1, Number(spec.frames) || 1);
      ui.sprite.style.backgroundImage = `url("${url}")`;
      ui.sprite.style.setProperty("--frames", String(frames));
      ui.sprite.style.setProperty("--duration", `${(frames / Math.max(1, Number(spec.fps) || 8)).toFixed(3)}s`);
      ui.sprite.classList.toggle("is-once", spec.loop === false);
      ui.sprite.classList.toggle("is-still", frames === 1);
    });
  }
  function applyPalette() {
    const palette = Object.assign({}, LINES.palette || {}, (costumeOf() || {}).palette || {});
    const vars = {
      "--pet-skin": palette.skin,
      "--pet-skin-deep": palette.skin_deep,
      "--pet-line": palette.line,
      "--pet-belly": palette.belly,
      "--pet-accent2": palette.accent,
      "--pet-uniform": palette.uniform,
      "--pet-uniform-line": palette.uniform_line,
    };
    for (const [key, value] of Object.entries(vars)) {
      if (value) ui.figure.style.setProperty(key, value);
      else ui.figure.style.removeProperty(key);
    }
    ui.root.style.setProperty("--pet-color", current.color || "#1e5bd8");
    ui.root.style.setProperty("--pet-accent", current.color || "var(--global-theme-color, #6434b2)");
    ui.root.dataset.pet = current.id;
  }
  function buildFigure(manifest) {
    sprites = manifest && manifest.states && manifest.states.idle ? manifest : null;
    ui.body.style.width = "";
    ui.body.style.height = "";
    if (sprites) {
      // 默认帧在 <pet.json 所在目录>/<base>；换装的 base 也相对 pet.json 所在目录。
      manifestDir = new URL(".", new URL(current.sprites, window.location.href)).href;
      spriteBase = new URL(sprites.base || "sprites/", manifestDir).href;
      ui.sprite = element("div", { class: "pet-sprite", role: "presentation" });
      ui.figure.replaceChildren(ui.sprite);
      // 帧画布默认按 2 倍图导出：显示尺寸是帧尺寸的一半；手机上再等比缩小。
      const frame = sprites.frame || {};
      const display = sprites.display || { width: (frame.width || 256) / 2, height: (frame.height || 256) / 2 };
      const scale = narrow.matches ? 0.74 : 1;
      ui.body.style.width = `${Math.round(display.width * scale)}px`;
      ui.body.style.height = `${Math.round(display.height * scale)}px`;
    } else {
      ui.sprite = null;
      ui.figure.innerHTML = placeholder(current.id);
    }
    applyPalette();
  }

  // ------------------------------------------------------------------ 状态

  let state = "idle";
  let stateTimer = 0;
  function setState(next, holdMs = 0) {
    window.clearTimeout(stateTimer);
    state = next;
    ui.figure.className = `pet-figure is-${next}${facingLeft ? " is-left" : ""}`;
    if (sprites) paintSprite(next);
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

  // 闲着的时候：游一段，或者做一个自己的招牌小动作（吃 Token、翻书、记笔记、分裂……），不说话。
  function wander() {
    if (reduceMotion.matches || dragging || physics || !ui.panel.hidden || !ui.bubble.hidden || sleeping || document.hidden) return;
    if (reading.skimming || reading.active || ui.body.hidden) return;
    const quirks = (LINES.moves && LINES.moves.quirks) || [];
    if (quirks.length && (narrow.matches || Math.random() < 0.45)) {
      setState(pick(quirks), 3200);
      return;
    }
    if (narrow.matches) return;
    const target = clampX(x + (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 220));
    face(target < x);
    ui.root.classList.add("is-swimming");
    setState("walk");
    place(target, floorY());
    window.setTimeout(() => {
      ui.root.classList.remove("is-swimming");
      if (state === "walk") setState("idle");
      rememberDock();
    }, 4300);
  }
  const thinkState = () => (LINES.moves && LINES.moves.think) || "think";

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
      setState("failed", 2400);
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
    checkBrain();
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
  // 大脑告诉我们每只宠物现在由哪家模型回答（自家的，或 DeepSeek 代班），面板里据此如实说明对话会发给谁。
  const brainModels = {};
  let brainChecked = false;
  function checkBrain() {
    if (!CONFIG.endpoint || brainChecked) return;
    brainChecked = true;
    fetchJson(`${String(CONFIG.endpoint).replace(/\/$/, "")}/health`).then((data) => {
      if (data && data.pets && typeof data.pets === "object") Object.assign(brainModels, data.pets);
      renderPanelHeader();
    });
  }
  const modelLabel = (info) => (info && info.model ? `${info.model}${info.standIn ? ` ${LINES.stand_in_label || "代班"}` : ""}` : "");
  function renderPanelHeader() {
    ui.panelTitle.textContent = petName();
    ui.panelSub.textContent = nickname() ? `（${current.name}）` : current.company || "住在这个网站里";
    ui.input.placeholder = namingMode ? "给它起个名字（最多 12 个字）" : CONFIG.endpoint ? "问点什么……" : "输入关键词，在站里翻翻";
    const model = brainModels[current.id] && brainModels[current.id].model;
    const disclosure = !CONFIG.endpoint ? LINES.disclosure_local : model ? fill(LINES.disclosure, { model }) : LINES.disclosure_unknown;
    const credit = sprites ? [LINES.credit_label, sprites.credit].filter(Boolean).join(" · ") : "";
    ui.footnote.textContent = [disclosure, credit].filter(Boolean).join(" ");
  }
  function renderChips() {
    const costumes = unlockedCostumes();
    ui.chips.replaceChildren(
      ...(COMMON.menu || [])
        .filter((item) => (item.id !== "switch" || roster.length > 1) && (item.id !== "costume" || costumes.length))
        .map((item) => {
          const button = element("button", { type: "button", text: item.label });
          button.addEventListener("click", () => runAction(item.id));
          return button;
        })
    );
  }
  const unlockedCostumes = () => (LINES.costumes || []).filter((c) => eggsFound() >= (c.unlock_eggs || 0));
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
      addMessage(nickname() ? `我现在叫「${nickname()}」。想换一个就写在下面。` : "你想叫我什么？写在下面。");
      ui.input.focus();
    } else if (id === "switch") {
      const node = addMessage(fill(LINES.switch_prompt || "想换谁来陪你？"));
      const list = element("div", { class: "pet-chips pet-roster" });
      for (const character of roster) {
        if (character.id === current.id) continue;
        const nick = memory.pets[character.id] && memory.pets[character.id].name;
        const button = element("button", { type: "button", title: character.tagline || "" });
        button.style.setProperty("--pet-chip", character.color || "currentColor");
        button.append(element("strong", { text: nick || character.name }), element("span", { text: ` ${character.company || ""}` }));
        button.addEventListener("click", () => {
          addMessage(fill(pick(LINES.switch_back)));
          become(character.id, { announce: true });
        });
        list.append(button);
      }
      node.append(list);
    } else if (id === "costume") {
      const costumes = unlockedCostumes();
      if (!costumes.length) return addMessage("我还没有别的衣服。");
      const ids = ["", ...costumes.map((c) => c.id)];
      const next = ids[(ids.indexOf(petMemory().costume || "") + 1) % ids.length];
      petMemory().costume = next;
      save();
      applyPalette();
      setState("happy", 1400);
      const costume = costumes.find((c) => c.id === next);
      addMessage(costume ? `换上了${costume.label}。好看吗？` : "换回自己的衣服了。");
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
      ...roster
        .filter((c) => memory.pets[c.id] && memory.pets[c.id].name)
        .map((c) => `你给${c.id === current.id ? "我" : c.name}起的名字：${memory.pets[c.id].name}。`),
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
    setState(thinkState());
    ui.send.disabled = true;
    const node = addMessage("……");
    controller = new AbortController();
    let answer = "";
    let finished = null;
    try {
      const response = await window.fetch(`${String(CONFIG.endpoint).replace(/\/$/, "")}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatLog, page: pageContext(focus), petName: nickname(), pet: current.id }),
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const code = (await response.json().catch(() => ({}))).error;
        node.remove();
        chatLog.pop();
        setState("failed", 2000);
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
      // 每条回答都标明是 AI 生成、由哪家模型回答（自家模型没接上时写明「代班」）。
      if (finished?.model) {
        brainModels[current.id] = { model: finished.model, standIn: Boolean(finished.standIn) };
        renderPanelHeader();
      }
      if (!finished?.letter) {
        node.append(element("span", { class: "pet-meta", text: [LINES.ai_label || "AI 生成", modelLabel(finished)].filter(Boolean).join(" · ") }));
      }
      chatLog.push({ role: "assistant", content: answer.slice(0, 600) });
      memory.chats += 1;
      memory.quietness = Math.max(0, memory.quietness - 1);
      save();
      setState("happy", 1200);
    } catch (error) {
      node.remove();
      chatLog.pop();
      if (error?.name !== "AbortError") {
        setState("failed", 2000);
        addMessage(fill(pick(LINES.offline)));
        await localAnswer(question);
      }
    } finally {
      controller = null;
      ui.send.disabled = false;
      if (state === thinkState()) setState("idle");
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
      petMemory().name = text.replace(/[\u0000-\u001f<>]/g, "").slice(0, 12);
      save();
      renderPanelHeader();
      setState("happy", 1500);
      addMessage(`好，以后我就叫「${nickname()}」。`);
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
    if (hour < 5) return say(fill(pick(LINES.greet?.night)), { mood: "wave" });
    const last = memory.lastRead;
    if (memory.visits > 1 && last && !last.finished && last.url !== path && Date.now() - last.at < 30 * 86400000) {
      return say(fill(pick(LINES.greet?.unfinished), last), {
        actions: [
          ["接着看", () => window.location.assign(last.url)],
          ["不了", () => undefined],
        ],
      });
    }
    say(fill(pick(memory.visits > 1 ? LINES.greet?.return : LINES.greet?.first)), { mood: "wave" });
  }

  // 换成另一只（或第一次出场）：取它的台词和形象清单，换身体，留在原来的位置。
  const characterData = new Map();
  function loadCharacter(character) {
    if (!characterData.has(character.id)) {
      characterData.set(character.id, Promise.all([fetchJson(character.lines), character.sprites ? fetchJson(character.sprites) : null]));
    }
    return characterData.get(character.id);
  }
  async function become(id, { announce = false } = {}) {
    const character = characterById(id) || current;
    const [own, manifest] = await loadCharacter(character);
    current = character;
    LINES = mergeLines(COMMON, own || {});
    if (memory.character !== current.id) {
      memory.character = current.id;
      save();
    }
    chatLog = [];
    buildFigure(manifest);
    renderPanelHeader();
    renderChips();
    ui.body.setAttribute("aria-label", `${petName()}：${current.company || "住在这个网站里"}的宠物，点它说话`);
    ui.tabLabel.textContent = petName();
    if (ui.root.isConnected && !ui.body.hidden) {
      const rect = ui.body.getBoundingClientRect();
      width = rect.width || width;
      height = rect.height || height;
      place(x, floorY());
    }
    setState(announce ? "wave" : "idle", announce ? 1600 : 0);
    if (announce) addMessage(fill(pick(LINES.hello)));
  }

  async function start(common) {
    COMMON = common || {};
    await become(current.id);
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
    window.setInterval(wander, 32000);
    if (!collapsed) window.setTimeout(greet, 2500);
    window.addEventListener("pagehide", () => {
      window.clearTimeout(saveTimer);
      write(window.localStorage, MEMORY_KEY, memory);
      write(window.sessionStorage, SESSION_KEY, session);
    });
    window.functionhxPet = Object.freeze({
      say: (text) => say(String(text), { response: true }),
      setState,
      open: openPanel,
      become: (id) => become(String(id), { announce: true }),
      get current() {
        return current.id;
      },
    });
  }

  window
    .fetch(CONFIG.lines, { credentials: "omit" })
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))
    .then(start);
})();
