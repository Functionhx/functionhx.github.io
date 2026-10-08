// 文章便利贴（站长决定 2026-10-07）。两层，同一种纸：
//
// - 作者便利贴：文章里写 `> [!便利贴] ……`，构建时变成 <aside class="sticky-note">（_plugins/sticky_notes.rb）。
// - 我的便利贴：读者选中一段文字，在旁边贴一张。只存在这台设备的 localStorage 里，不上传、不需要登录；
//   位置用「原文 + 前后各 32 字」记，文章改过之后多半还能找回原处，找不到的收进文末「掉落的便利贴」。
//   站长在站长模式下可以把一张选为「公开」：交给原位编辑器插进 Markdown，由站长检查后 Commit。
//
// 排版三种：宽屏贴在正文右侧留白（margin），中等宽度夹在段落之间（inline，也是没有脚本时的样子），
// 手机上折成段尾的折角，点开揭起（fold）。本文件不发任何网络请求（validate_content.py 检查）。
(() => {
  "use strict";

  const article = document.querySelector(".post--article");
  const content = document.getElementById("markdown-content");
  if (!article || !content) return;

  const STORE = "functionhx:sticky-notes";
  const PUBLISH = "functionhx:sticky-publish";
  const WENKAI = "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css";
  const COLORS = ["yellow", "pink", "mint", "blue"];
  const COLOR_LABELS = { yellow: "黄色", pink: "粉色", mint: "薄荷绿", blue: "雾蓝" };
  const MAX_TEXT = 500;
  const MAX_QUOTE = 400;
  const CONTEXT = 32;
  const SKIP = ".sticky-note, .sticky-chip, .post-code__head, button, mjx-assistive-mml, script, style";
  const page = window.location.pathname;
  const root = document.documentElement;
  const phone = window.matchMedia("(max-width: 820px)");
  const coarse = window.matchMedia("(pointer: coarse)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const highlights = typeof window.Highlight === "function" && window.CSS?.highlights ? window.CSS.highlights : null;
  const column = content.closest(".post-content") || content;
  const title = document.querySelector(".post-title")?.textContent.trim() || document.title;

  let mine = [];
  let editing = null;
  let pending = null;
  let layoutQueued = false;
  let stuck = 0;
  let noteSerial = 0;

  // ---------- 存储：只在这台设备 ----------
  const validNote = (note) =>
    note &&
    typeof note.id === "string" &&
    typeof note.quote === "string" &&
    note.quote &&
    typeof note.text === "string" &&
    COLORS.includes(note.color) &&
    typeof note.prefix === "string" &&
    typeof note.suffix === "string";

  function readStore() {
    try {
      const data = JSON.parse(window.localStorage.getItem(STORE) || "null");
      if (data?.version === 1 && data.pages && typeof data.pages === "object") return data;
    } catch {
      /* 读不出来就当没有。 */
    }
    return { version: 1, pages: {} };
  }

  function loadMine() {
    const list = readStore().pages[page];
    return Array.isArray(list) ? list.filter(validNote).map((note) => ({ ...note })) : [];
  }

  function saveMine() {
    const data = readStore();
    const list = mine.map(({ id, quote, prefix, suffix, text, color, created, updated, publicPending }) => ({
      id,
      quote,
      prefix,
      suffix,
      text,
      color,
      created,
      updated,
      ...(publicPending ? { publicPending: true } : {}),
    }));
    if (list.length) data.pages[page] = list;
    else delete data.pages[page];
    try {
      window.localStorage.setItem(STORE, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  // ---------- 正文的纯文本索引（不含便利贴自己） ----------
  function buildIndex() {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    return { nodes, text };
  }

  function offsetOf(index, container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const item = index.nodes.find((entry) => entry.node === container);
      if (item) return item.start + offset;
    }
    const point = document.createRange();
    try {
      point.setStart(container, container.nodeType === Node.TEXT_NODE ? offset : Math.min(offset, container.childNodes.length));
    } catch {
      return null;
    }
    const next = index.nodes.find((entry) => point.comparePoint(entry.node, 0) >= 0);
    return next ? next.start : index.text.length;
  }

  function rangeAt(index, start, end) {
    const find = (offset, preferEarlier) => {
      for (const entry of index.nodes) {
        const length = entry.node.data.length;
        if (offset < entry.start + length || (preferEarlier && offset === entry.start + length)) {
          return { node: entry.node, offset: offset - entry.start };
        }
      }
      return null;
    };
    const from = find(start, false);
    const to = find(end, true);
    if (!from || !to) return null;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  const commonSuffix = (a, b) => {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
    return n;
  };
  const commonPrefix = (a, b) => {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
    return n;
  };

  // 原文出现多次时，挑前后文最吻合的那一处。
  function locate(index, note) {
    let best = null;
    for (let at = index.text.indexOf(note.quote); at !== -1; at = index.text.indexOf(note.quote, at + 1)) {
      const end = at + note.quote.length;
      const score =
        commonSuffix(index.text.slice(Math.max(0, at - CONTEXT), at), note.prefix) + commonPrefix(index.text.slice(end, end + CONTEXT), note.suffix);
      if (!best || score > best.score) best = { start: at, end, score };
    }
    return best ? rangeAt(index, best.start, best.end) : null;
  }

  function anchorFromSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) return null;
    const startElement = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    if (startElement?.closest(".sticky-note, .sticky-chip")) return null;
    const index = buildIndex();
    let start = offsetOf(index, range.startContainer, range.startOffset);
    let end = offsetOf(index, range.endContainer, range.endOffset);
    if (start === null || end === null) return null;
    while (start < end && /\s/.test(index.text[start])) start += 1;
    while (end > start && /\s/.test(index.text[end - 1])) end -= 1;
    if (end <= start) return null;
    end = Math.min(end, start + MAX_QUOTE);
    return {
      quote: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
      suffix: index.text.slice(end, end + CONTEXT),
      range: rangeAt(index, start, end),
    };
  }

  // 便利贴挂在哪个块后面：正文的直接子元素。
  function blockOf(node) {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (element && element.parentElement !== content) element = element.parentElement;
    return element;
  }

  // ---------- 便利贴元素 ----------
  const tiltOf = (seed) => {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return (((Math.abs(hash) % 33) - 16) / 10).toFixed(1);
  };

  const dateLabel = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function chipFor(note) {
    note.id ||= `sticky-note-${(noteSerial += 1)}`;
    const chip = element("button", "sticky-chip");
    chip.type = "button";
    chip.dataset.stickyColor = note.dataset.stickyColor || "yellow";
    chip.setAttribute("aria-controls", note.id);
    chip.setAttribute("aria-expanded", "false");
    chip.append(
      element("span", "sticky-chip__paper"),
      element("span", "sticky-chip__label", note.classList.contains("sticky-note--mine") ? "我的便利贴" : "作者便利贴")
    );
    chip.addEventListener("click", () => {
      const open = !note.classList.contains("is-open");
      note.classList.toggle("is-open", open);
      chip.setAttribute("aria-expanded", String(open));
      if (open && !reduceMotion.matches) {
        note.classList.remove("is-peeling");
        void note.offsetWidth;
        note.classList.add("is-peeling");
      }
    });
    note.before(chip);
    return chip;
  }

  function dressNote(note, seed) {
    note.style.setProperty("--sticky-tilt", `${tiltOf(seed)}deg`);
    if (!note.previousElementSibling?.classList.contains("sticky-chip")) chipFor(note);
  }

  function renderMine(entry) {
    const note = entry.element || element("aside", "sticky-note sticky-note--mine");
    note.replaceChildren();
    note.classList.remove("is-editing");
    note.dataset.stickyColor = entry.color;
    note.dataset.noteId = entry.id;
    note.id = `sticky-${entry.id}`;
    note.setAttribute("role", "note");
    note.setAttribute("aria-label", "我的便利贴");
    note.append(element("span", "sticky-note__by", `我 · ${dateLabel(entry.updated || entry.created)}${entry.publicPending ? " · 待公开" : ""}`));
    note.append(element("p", "sticky-note__text", entry.text));
    const edit = element("button", "sticky-note__edit", "改");
    edit.type = "button";
    edit.setAttribute("aria-label", "改这张便利贴");
    edit.addEventListener("click", () => openEditor(entry));
    note.append(edit);
    entry.element = note;
    note.onmouseenter = () => focusHighlight(entry);
    note.onmouseleave = () => focusHighlight(null);
    note.onfocusin = () => focusHighlight(entry);
    note.onfocusout = () => focusHighlight(null);
    const chip = note.previousElementSibling?.classList.contains("sticky-chip") ? note.previousElementSibling : null;
    if (chip) chip.dataset.stickyColor = entry.color;
    return note;
  }

  function place(entry) {
    const note = renderMine(entry);
    if (entry.range) {
      const block = blockOf(entry.range.startContainer);
      let after = block;
      // 同一段后面已经有便利贴时排在它们后面。
      while (after?.nextElementSibling?.matches(".sticky-note, .sticky-chip")) after = after.nextElementSibling;
      if (after && note.previousElementSibling !== after && note !== after) after.after(note);
      dressNote(note, entry.id);
    } else {
      dropped.list.append(note);
      note.previousElementSibling?.classList.contains("sticky-chip") && note.previousElementSibling.remove();
    }
  }

  // ---------- 高亮（CSS Custom Highlight API，不改动正文 DOM） ----------
  function paintHighlights() {
    if (focused && !mine.includes(focused)) focusHighlight(null);
    if (!highlights) return;
    for (const color of COLORS) {
      const ranges = mine.filter((entry) => entry.color === color && entry.range).map((entry) => entry.range);
      if (ranges.length) highlights.set(`sticky-${color}`, new window.Highlight(...ranges));
      else highlights.delete(`sticky-${color}`);
    }
  }

  // 指着一张便利贴时，它批注的原文多一道下划线。记住是哪一张：便利贴被撕掉、改写或重排时，
  // 鼠标移开的事件不会再来，必须在这里把下划线一并收走。
  let focused = null;
  function focusHighlight(entry) {
    focused = entry?.range ? entry : null;
    if (!highlights) return;
    if (focused) highlights.set("sticky-focus", new window.Highlight(focused.range));
    else highlights.delete("sticky-focus");
  }

  // ---------- 排版 ----------
  function marginRoom() {
    const box = content.getBoundingClientRect();
    const textRight = box.left + Math.min(content.clientWidth, 660);
    return window.innerWidth - textRight - 48 - 28;
  }

  function anchorTop(note) {
    const entry = mine.find((item) => item.element === note);
    if (entry?.range) {
      const rect = entry.range.getClientRects()[0] || entry.range.getBoundingClientRect();
      return rect.top;
    }
    let previous = note.previousElementSibling;
    while (previous?.matches(".sticky-note, .sticky-chip")) previous = previous.previousElementSibling;
    return (previous || note).getBoundingClientRect().top;
  }

  function layout() {
    layoutQueued = false;
    const room = marginRoom();
    const mode = phone.matches ? "fold" : room >= 180 ? "margin" : "inline";
    article.dataset.stickyMode = mode;
    const notes = [...content.querySelectorAll(":scope > .sticky-note")];
    if (mode !== "margin") {
      notes.forEach((note) => note.style.removeProperty("top"));
      return;
    }
    content.style.setProperty("--sticky-width", `${Math.round(Math.min(236, room))}px`);
    const top = content.getBoundingClientRect().top;
    let floor = -Infinity;
    notes
      .map((note) => ({ note, target: anchorTop(note) - top }))
      .sort((a, b) => a.target - b.target)
      .forEach(({ note, target }) => {
        const y = Math.max(target - 6, floor);
        note.style.top = `${Math.round(y)}px`;
        floor = y + note.offsetHeight + 16;
      });
  }

  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    window.requestAnimationFrame(layout);
  }

  // 进入视野时「啪」地贴上；每次访问最多两张有动画，其余直接在那里。
  const sticker =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              sticker.unobserve(entry.target);
              if (stuck >= 2 || reduceMotion.matches || article.dataset.stickyMode === "fold") return;
              stuck += 1;
              entry.target.style.setProperty("--sticky-delay", `${(stuck - 1) * 0.18}s`);
              entry.target.classList.add("is-sticking");
            });
          },
          { threshold: 0.6 }
        )
      : null;

  // ---------- 文末：我的便利贴 ----------
  const tray = element("section", "sticky-tray");
  tray.setAttribute("aria-labelledby", "sticky-tray-title");
  const trayTitle = element("p", "sticky-tray__title");
  trayTitle.id = "sticky-tray-title";
  const trayNote = element("p", "sticky-tray__note");
  const trayActions = element("div", "sticky-tray__actions");
  const exportButton = element("button", "", "导出 Markdown");
  exportButton.type = "button";
  const clearButton = element("button", "", "全部撕掉");
  clearButton.type = "button";
  trayActions.append(exportButton, clearButton);
  const dropped = { box: element("div", "sticky-tray__dropped"), list: element("div", "sticky-tray__dropped-list") };
  dropped.box.append(element("p", "", "掉落的便利贴：原文改过，找不到它们原来的位置了。"), dropped.list);
  tray.append(trayTitle, trayNote, trayActions, dropped.box);
  column.after(tray);

  const isOwner = () => root.dataset.ownerVerified === "true" && root.dataset.ownerMode === "true";

  // 侧栏与手机目录面板里的入口：一直看得到；点一下时如果已经选中文字就直接贴，否则告诉读者怎么做。
  const entries = [...document.querySelectorAll("[data-sticky-entry]")];
  entries.forEach((entry) => {
    entry.hidden = false;
    const start = entry.querySelector("[data-sticky-start]");
    const idle = start.textContent;
    start.addEventListener("pointerdown", (event) => event.preventDefault());
    start.addEventListener("click", () => {
      const anchor = anchorFromSelection();
      if (anchor?.range) {
        pending = anchor;
        pin.click();
        return;
      }
      document.getElementById("post-dock-sheet")?.open && document.getElementById("post-dock-sheet").close();
      start.textContent = coarse.matches ? "长按正文选中文字，再点「贴便利贴」" : "先在正文里拖选一段文字";
      start.dataset.hinting = "true";
      content.classList.add("is-sticky-hinting");
      window.setTimeout(() => {
        start.textContent = idle;
        delete start.dataset.hinting;
        content.classList.remove("is-sticky-hinting");
      }, 2600);
    });
  });

  function updateTray() {
    const count = mine.length;
    entries.forEach((entry) => {
      const link = entry.querySelector("[data-sticky-mine]");
      link.hidden = !count;
      link.textContent = `我的便利贴 · ${count} 张`;
    });
    tray.dataset.empty = String(!count);
    trayTitle.textContent = count ? `我的便利贴 · ${count} 张` : "便利贴";
    trayNote.textContent = count
      ? "只存在这台设备的浏览器里，不会上传。"
      : `选中一段文字，就能在旁边贴一张便利贴，只有你自己看得到。${isOwner() ? "站长还可以把它公开。" : ""}`;
    trayActions.hidden = !count;
    dropped.box.hidden = !dropped.list.childElementCount;
    clearButton.textContent = "全部撕掉";
    delete clearButton.dataset.confirm;
  }

  exportButton.addEventListener("click", () => {
    const lines = [`# ${title} · 我的便利贴`, "", `原文：${window.location.origin}${page}`, ""];
    mine.forEach((entry) => {
      lines.push(`> ${entry.quote.replace(/\s+/g, " ")}`, "", entry.text, "", "---", "");
    });
    const blob = new Blob([`${lines.join("\n").trim()}\n`], { type: "text/markdown;charset=utf-8" });
    const link = element("a");
    link.href = URL.createObjectURL(blob);
    link.download = `便利贴-${page.split("/").filter(Boolean).pop() || "article"}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  // 撕掉全部要点两下，不弹浏览器对话框。
  clearButton.addEventListener("click", () => {
    if (!clearButton.dataset.confirm) {
      clearButton.dataset.confirm = "true";
      clearButton.textContent = "再点一下，全部撕掉";
      window.setTimeout(updateTray, 3000);
      return;
    }
    [...mine].forEach((entry) => remove(entry, false));
    saveMine();
    refresh();
  });

  // ---------- 选中文字后的「贴便利贴」 ----------
  const pin = element("button", "sticky-pin");
  pin.type = "button";
  pin.hidden = true;
  pin.append(element("span", "sticky-pin__paper"), document.createTextNode("贴便利贴"));
  document.body.append(pin);
  let pinTimer = 0;

  function updatePin() {
    const anchor = editing ? null : anchorFromSelection();
    if (!anchor || !anchor.range) {
      pin.hidden = true;
      pending = null;
      return;
    }
    pending = anchor;
    const rects = anchor.range.getClientRects();
    const first = rects[0] || anchor.range.getBoundingClientRect();
    const last = rects[rects.length - 1] || first;
    pin.hidden = false;
    const width = pin.offsetWidth;
    const height = pin.offsetHeight;
    // 触屏上系统菜单在选区上方，按钮放到下方；鼠标放在选区上方。
    const below = coarse.matches || first.top < height + 70;
    const x = below ? last.right - width / 2 : first.left;
    const y = below ? last.bottom + 12 : first.top - height - 10;
    pin.style.left = `${Math.round(Math.min(Math.max(x, 8), window.innerWidth - width - 8) + window.scrollX)}px`;
    pin.style.top = `${Math.round(y + window.scrollY)}px`;
  }

  document.addEventListener("selectionchange", () => {
    window.clearTimeout(pinTimer);
    pinTimer = window.setTimeout(updatePin, coarse.matches ? 350 : 120);
  });
  // 按下按钮时不能让选区消失。
  pin.addEventListener("pointerdown", (event) => event.preventDefault());
  pin.addEventListener("click", () => {
    if (!pending) return;
    const now = new Date().toISOString();
    const entry = {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      quote: pending.quote,
      prefix: pending.prefix,
      suffix: pending.suffix,
      text: "",
      color: mine.at(-1)?.color || "yellow",
      created: now,
      updated: now,
      range: pending.range,
      fresh: true,
    };
    pin.hidden = true;
    pending = null;
    window.getSelection()?.removeAllRanges();
    mine.push(entry);
    place(entry);
    paintHighlights();
    openEditor(entry);
  });

  // ---------- 编辑 ----------
  function openEditor(entry) {
    if (editing && editing !== entry) closeEditor(editing, false);
    editing = entry;
    ensureHandwriting();
    const note = entry.element;
    note.replaceChildren();
    note.classList.add("is-editing", "is-open");
    note.previousElementSibling?.classList.contains("sticky-chip") && note.previousElementSibling.setAttribute("aria-expanded", "true");
    let color = entry.color;
    let scope = "private";

    const label = element("label", "sr-only", "便利贴内容");
    const fieldId = `${note.id}-text`;
    label.htmlFor = fieldId;
    const field = element("textarea", "sticky-editor__text");
    field.id = fieldId;
    field.rows = 4;
    field.maxLength = MAX_TEXT;
    field.placeholder = "写点什么……只有你自己看得到";
    field.value = entry.text;

    const bar = element("div", "sticky-editor__bar");
    const colors = element("div", "sticky-editor__colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", "颜色");
    COLORS.forEach((value) => {
      const dot = element("button", "sticky-editor__color");
      dot.type = "button";
      dot.dataset.stickyColor = value;
      dot.setAttribute("role", "radio");
      dot.setAttribute("aria-label", COLOR_LABELS[value]);
      dot.setAttribute("aria-checked", String(value === color));
      dot.addEventListener("click", () => {
        color = value;
        note.dataset.stickyColor = value;
        colors.querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", String(button === dot)));
      });
      colors.append(dot);
    });
    bar.append(colors);

    if (isOwner()) {
      const scopes = element("div", "sticky-editor__scope");
      scopes.setAttribute("role", "radiogroup");
      scopes.setAttribute("aria-label", "谁能看到");
      [
        ["private", "私人"],
        ["public", "公开"],
      ].forEach(([value, text]) => {
        const option = element("button", "", text);
        option.type = "button";
        option.setAttribute("role", "radio");
        option.setAttribute("aria-checked", String(value === scope));
        option.addEventListener("click", () => {
          scope = value;
          scopes.querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", String(button === option)));
          field.placeholder = value === "public" ? "公开便利贴：会插进文章原文，Commit 后所有人可见" : "写点什么……只有你自己看得到";
        });
        scopes.append(option);
      });
      bar.append(scopes);
    }

    const tear = element("button", "sticky-editor__tear", "撕掉");
    tear.type = "button";
    const done = element("button", "sticky-editor__done", "贴好");
    done.type = "button";
    const actions = element("div", "sticky-editor__actions");
    actions.append(tear, done);
    bar.append(actions);
    note.append(label, field, bar);

    const save = () => {
      const text = field.value.trim().slice(0, MAX_TEXT);
      if (!text) {
        remove(entry);
        return;
      }
      entry.text = text;
      entry.color = color;
      entry.updated = new Date().toISOString();
      if (scope === "public") entry.publicPending = true;
      delete entry.fresh;
      editing = null;
      saveMine();
      renderMine(entry);
      paintHighlights();
      refresh();
      entry.element.querySelector(".sticky-note__edit")?.focus({ preventScroll: true });
      if (scope === "public") publish(entry);
    };
    done.addEventListener("click", save);
    tear.addEventListener("click", () => remove(entry));
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEditor(entry, true);
      }
    });
    scheduleLayout();
    window.requestAnimationFrame(() => {
      field.focus({ preventScroll: true });
      if (note.getBoundingClientRect().bottom > window.innerHeight - 80)
        note.scrollIntoView({ block: "center", behavior: reduceMotion.matches ? "auto" : "smooth" });
    });
  }

  function closeEditor(entry, restoreFocus) {
    if (editing === entry) editing = null;
    if (entry.fresh) {
      remove(entry);
      return;
    }
    renderMine(entry);
    scheduleLayout();
    if (restoreFocus) entry.element.querySelector(".sticky-note__edit")?.focus({ preventScroll: true });
  }

  function remove(entry, persist = true) {
    if (editing === entry) editing = null;
    if (focused === entry) focusHighlight(null);
    const chip = entry.element?.previousElementSibling;
    if (chip?.classList.contains("sticky-chip")) chip.remove();
    entry.element?.remove();
    mine = mine.filter((item) => item !== entry);
    if (persist) {
      saveMine();
      refresh();
    }
  }

  function refresh() {
    paintHighlights();
    updateTray();
    scheduleLayout();
  }

  // 公开：交给原位编辑器（inline-editor.js 读取 sessionStorage 里的这一条，插到原文对应段落后面），
  // 站长在编辑器里检查后再 Commit。这里不碰 GitHub。
  function publish(entry) {
    const trigger = document.querySelector('[data-author-action="source-edit"]');
    const path = document.getElementById("site-inline-editor")?.dataset.sourcePath;
    if (!trigger || !path) return;
    try {
      window.sessionStorage.setItem(
        PUBLISH,
        JSON.stringify({ version: 1, path, quote: entry.quote, prefix: entry.prefix, text: entry.text, color: entry.color })
      );
    } catch {
      return;
    }
    trigger.click();
  }

  // 霞鹜文楷：作者便利贴用到的字已经自托管（Function Sticky）；读者自己写的字从 CDN 切片取，
  // 只在这台设备真的有自己的便利贴时才加载。
  function ensureHandwriting() {
    if (document.querySelector("link[data-sticky-font]")) return;
    const link = element("link");
    link.rel = "stylesheet";
    link.href = WENKAI;
    link.dataset.stickyFont = "";
    document.head.append(link);
  }

  // ---------- 启动 ----------
  const index = buildIndex();
  const authorTexts = new Set([...content.querySelectorAll(".sticky-note--author p")].map((node) => node.textContent.replace(/\s+/g, "")));
  mine = loadMine().filter((entry) => !(entry.publicPending && authorTexts.has(entry.text.replace(/\s+/g, ""))));
  content.querySelectorAll(":scope > .sticky-note--author").forEach((note, i) => dressNote(note, `${i}${note.textContent}`));
  mine.forEach((entry) => {
    entry.range = locate(index, entry);
    place(entry);
  });
  if (mine.length !== loadMine().length) saveMine();
  if (mine.length) ensureHandwriting();
  content.querySelectorAll(":scope > .sticky-note").forEach((note) => sticker?.observe(note));
  refresh();
  layout();

  window.addEventListener("resize", scheduleLayout, { passive: true });
  phone.addEventListener?.("change", scheduleLayout);
  if ("ResizeObserver" in window) new ResizeObserver(scheduleLayout).observe(content);
  document.fonts?.ready.then(scheduleLayout);
  window.addEventListener("functionhx:owner-mode-changed", updateTray);
  window.addEventListener("storage", (event) => {
    if (event.key !== STORE || editing) return;
    [...mine].forEach((entry) => remove(entry, false));
    const fresh = buildIndex();
    mine = loadMine();
    mine.forEach((entry) => {
      entry.range = locate(fresh, entry);
      place(entry);
    });
    refresh();
  });
})();
