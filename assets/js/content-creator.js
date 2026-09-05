(function initializeContentCreator() {
  "use strict";

  const root = document.getElementById("site-content-creator");
  if (!root) return;

  const repository = root.dataset.repository;
  const owner = root.dataset.owner;
  const branch = root.dataset.branch;
  const maxCoverBytes = 5 * 1024 * 1024;
  const maximumImageCount = 8;
  const maximumImageBytes = 1.5 * 1024 * 1024;
  const maximumMediaBytes = 5 * 1024 * 1024;
  const allowedCoverTypes = new Map([
    ["image/webp", "webp"],
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
  ]);
  const allowedImageTypes = new Map([
    ["image/gif", "gif"],
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ]);

  const elements = {
    announce: document.getElementById("site-content-creator-announce"),
    announceField: document.getElementById("site-content-creator-announce-field"),
    bodyEn: document.getElementById("site-content-creator-body-en"),
    bodyZh: document.getElementById("site-content-creator-body-zh"),
    category: document.getElementById("site-content-creator-category"),
    categoryField: document.getElementById("site-content-creator-category-field"),
    close: document.getElementById("site-content-creator-close"),
    comments: document.getElementById("site-content-creator-comments"),
    commentsField: document.getElementById("site-content-creator-comments-field"),
    commit: document.getElementById("site-content-creator-commit"),
    connect: document.getElementById("site-content-creator-connect"),
    cover: document.getElementById("site-content-creator-cover"),
    coverField: document.getElementById("site-content-creator-cover-field"),
    coverName: document.getElementById("site-content-creator-cover-name"),
    date: document.getElementById("site-content-creator-date"),
    descriptionEn: document.getElementById("site-content-creator-description-en"),
    descriptionZh: document.getElementById("site-content-creator-description-zh"),
    draft: document.getElementById("site-content-creator-draft"),
    english: document.getElementById("site-content-creator-english"),
    github: document.getElementById("site-content-creator-github"),
    githubField: document.getElementById("site-content-creator-github-field"),
    heading: document.getElementById("site-content-creator-heading"),
    kind: document.getElementById("site-content-creator-kind"),
    message: document.getElementById("site-content-creator-message"),
    result: document.getElementById("site-content-creator-result"),
    settings: document.getElementById("site-content-creator-settings"),
    settingsLabel: document.getElementById("site-content-creator-settings-label"),
    slug: document.getElementById("site-content-creator-slug"),
    status: document.getElementById("site-content-creator-status"),
    tabEn: document.getElementById("site-content-creator-tab-en"),
    tabZh: document.getElementById("site-content-creator-tab-zh"),
    tags: document.getElementById("site-content-creator-tags"),
    tagsField: document.getElementById("site-content-creator-tags-field"),
    titleEn: document.getElementById("site-content-creator-title-en"),
    titleZh: document.getElementById("site-content-creator-title-zh"),
    translate: document.getElementById("site-content-creator-translate"),
    url: document.getElementById("site-content-creator-url"),
    urlField: document.getElementById("site-content-creator-url-field"),
  };

  const fields = {
    zh: {
      body: elements.bodyZh,
      characterCount: root.querySelector('[data-content-character-count="zh"]'),
      complete: document.getElementById("site-content-creator-complete-zh"),
      description: elements.descriptionZh,
      dropzone: root.querySelector('[data-content-dropzone="zh"]'),
      editor: root.querySelector('[data-content-editor="zh"]'),
      imageInput: root.querySelector('[data-content-image-input="zh"]'),
      mediaList: root.querySelector('[data-content-media-list="zh"]'),
      mediaSection: root.querySelector('[data-content-media-section="zh"]'),
      mediaTotal: root.querySelector('[data-content-media-total="zh"]'),
      panel: document.getElementById("site-content-creator-panel-zh"),
      preview: root.querySelector('[data-content-preview="zh"]'),
      previewBody: root.querySelector('[data-content-preview-body="zh"]'),
      previewEmpty: root.querySelector('[data-content-preview-empty="zh"]'),
      previewSummary: root.querySelector('[data-content-preview-summary="zh"]'),
      previewTitle: root.querySelector('[data-content-preview-title="zh"]'),
      tab: document.getElementById("site-content-creator-tab-zh"),
      title: elements.titleZh,
    },
    en: {
      body: elements.bodyEn,
      characterCount: root.querySelector('[data-content-character-count="en"]'),
      complete: document.getElementById("site-content-creator-complete-en"),
      description: elements.descriptionEn,
      dropzone: root.querySelector('[data-content-dropzone="en"]'),
      editor: root.querySelector('[data-content-editor="en"]'),
      imageInput: root.querySelector('[data-content-image-input="en"]'),
      mediaList: root.querySelector('[data-content-media-list="en"]'),
      mediaSection: root.querySelector('[data-content-media-section="en"]'),
      mediaTotal: root.querySelector('[data-content-media-total="en"]'),
      panel: document.getElementById("site-content-creator-english"),
      preview: root.querySelector('[data-content-preview="en"]'),
      previewBody: root.querySelector('[data-content-preview-body="en"]'),
      previewEmpty: root.querySelector('[data-content-preview-empty="en"]'),
      previewSummary: root.querySelector('[data-content-preview-summary="en"]'),
      previewTitle: root.querySelector('[data-content-preview-title="en"]'),
      tab: document.getElementById("site-content-creator-tab-en"),
      title: elements.titleEn,
    },
  };

  if (
    Object.values(elements).some((element) => element === null) ||
    Object.values(fields).some((field) => Object.values(field).some((element) => element === null))
  ) {
    return;
  }

  const typeLabels = {
    activity: "动态",
    article: "文章",
    project: "项目",
    tool: "工具",
  };
  const actionTypes = new Map([
    ["activity-create", "activity"],
    ["article-create", "article"],
    ["project-create", "project"],
    ["tool-create", "tool"],
  ]);

  let activeToken = "";
  let activeTrigger = null;
  let baselineSnapshot = "";
  let busy = false;
  let coverFile = null;
  let currentLanguage = "zh";
  let currentType = "article";
  let draftTimer = 0;
  let draftWritePromise = Promise.resolve();
  let media = [];
  let previousScrollY = 0;
  let restorePromise = Promise.resolve(null);
  let slugIsAutomatic = true;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDateTime(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function defaultSlug(type, date = new Date()) {
    return `${type}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
  }

  function setStatus(message, state = "") {
    elements.status.textContent = message;
    if (state) elements.status.dataset.state = state;
    else delete elements.status.dataset.state;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    root.setAttribute("aria-busy", String(nextBusy));
    for (const element of [elements.close, elements.commit, elements.connect, elements.draft, elements.translate]) element.disabled = nextBusy;
    for (const language of ["zh", "en"]) {
      fields[language].imageInput.disabled = nextBusy;
      for (const button of fields[language].editor.querySelectorAll("[data-content-command], .site-spark-writer__media-remove")) {
        button.disabled = nextBusy;
      }
    }
  }

  function autoSize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 304)}px`;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return window.btoa(binary);
  }

  function base64ByteLength(value) {
    const normalized = String(value || "").replace(/\s/g, "");
    if (!normalized) return 0;
    const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function normalizedMedia(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const normalized = [];
    for (const candidate of input.slice(0, maximumImageCount)) {
      const id = String(candidate?.id || "").toLowerCase();
      const type = String(candidate?.type || "").toLowerCase();
      const data = String(candidate?.data || "").replace(/\s/g, "");
      if (!/^[a-f0-9]{16}$/.test(id) || seen.has(id) || !allowedImageTypes.has(type) || !/^[a-z0-9+/]*={0,2}$/i.test(data)) continue;
      const size = base64ByteLength(data);
      if (!size || size > maximumImageBytes) continue;
      seen.add(id);
      normalized.push({
        data,
        height: Math.max(0, Number(candidate.height) || 0),
        id,
        name: String(candidate.name || "image").slice(0, 120),
        size,
        type,
        width: Math.max(0, Number(candidate.width) || 0),
      });
    }
    return normalized;
  }

  function mediaSize() {
    return media.reduce((total, item) => total + item.size, 0);
  }

  function mediaSource(item) {
    return `data:${item.type};base64,${item.data}`;
  }

  function mediaMarker(item) {
    const alt =
      String(item.name || "image")
        .replace(/\.[^.]+$/, "")
        .replace(/[\[\]]/g, "")
        .trim() || "image";
    return `![${alt}](content-media://${item.id})`;
  }

  function characterCount(value) {
    return Array.from(
      String(value || "")
        .replace(/!\[[^\]]*\]\(content-media:\/\/[^)]+\)/g, "")
        .replace(/\s/g, "")
    ).length;
  }

  function updateEditorMeta() {
    for (const language of ["zh", "en"]) fields[language].characterCount.textContent = String(characterCount(fields[language].body.value));
  }

  function resolvePreviewImage(source) {
    const match = String(source || "").match(/^content-media:\/\/([a-f0-9]{16})$/);
    if (!match) return source;
    const item = media.find((candidate) => candidate.id === match[1]);
    return item ? mediaSource(item) : "";
  }

  function updatePreview(language) {
    const field = fields[language];
    const title = field.title.value.trim();
    const summary = field.description.value.trim();
    const body = field.body.value;
    const hasContent = Boolean(title || summary || body.trim());
    field.previewTitle.textContent = title || field.preview.dataset.untitled;
    field.previewTitle.hidden = !hasContent;
    field.previewSummary.textContent = summary;
    field.previewSummary.hidden = !summary;
    field.previewEmpty.hidden = hasContent;
    if (window.functionhxMarkdownPreview?.render) {
      field.previewBody.innerHTML = window.functionhxMarkdownPreview.render(body, {
        imageUnavailable: field.preview.dataset.imageUnavailable,
        resolveImage: resolvePreviewImage,
      });
    } else {
      field.previewBody.textContent = body;
    }
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise([field.previewBody]).catch(() => {});
    }
  }

  function updatePreviews() {
    for (const language of ["zh", "en"]) updatePreview(language);
  }

  function languageComplete(language) {
    const field = fields[language];
    return Boolean(
      field.title.value.trim() &&
      field.description.value.trim() &&
      (currentType !== "article" && currentType !== "activity" ? true : field.body.value.trim())
    );
  }

  function updateCompletion() {
    for (const language of ["zh", "en"]) fields[language].complete.dataset.complete = String(languageComplete(language));
    updateEditorMeta();
    updatePreviews();
  }

  function insertText(textarea, text, options = {}) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const prefix = options.block && before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const suffix = options.block && after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    textarea.setRangeText(`${prefix}${text}${suffix}`, start, end, "end");
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wrapSelection(textarea, before, after = before, placeholder = "") {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const selected = textarea.value.slice(start, end) || placeholder;
    textarea.setRangeText(`${before}${selected}${after}`, start, end, "select");
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function prefixSelectedLines(textarea, prefix) {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const lineStart = textarea.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextBreak = textarea.value.indexOf("\n", end);
    const lineEnd = nextBreak < 0 ? textarea.value.length : nextBreak;
    const lines = textarea.value.slice(lineStart, lineEnd).split("\n");
    const isNumberedList = prefix === "1. ";
    const hasPrefix = (line) => (isNumberedList ? /^\d+\.\s/.test(line) : line.startsWith(prefix));
    const alreadyPrefixed = lines.every((line) => !line.trim() || hasPrefix(line));
    const replacement = lines
      .map((line, index) => {
        if (!line.trim()) return line;
        if (alreadyPrefixed) return isNumberedList ? line.replace(/^\d+\.\s/, "") : line.slice(prefix.length);
        return isNumberedList ? `${index + 1}. ${line}` : `${prefix}${line}`;
      })
      .join("\n");
    textarea.setRangeText(replacement, lineStart, lineEnd, "select");
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function runEditorCommand(language, command) {
    const textarea = fields[language].body;
    if (command === "image") {
      fields[language].imageInput.click();
      return;
    }
    if (command === "undo" || command === "redo") {
      textarea.focus();
      document.execCommand(command);
      updateEditorMeta();
      return;
    }
    const isEnglish = language === "en";
    if (command === "heading") prefixSelectedLines(textarea, "## ");
    else if (command === "bold") wrapSelection(textarea, "**", "**", isEnglish ? "bold text" : "加粗文字");
    else if (command === "italic") wrapSelection(textarea, "_", "_", isEnglish ? "italic text" : "斜体文字");
    else if (command === "bullet-list") prefixSelectedLines(textarea, "- ");
    else if (command === "numbered-list") prefixSelectedLines(textarea, "1. ");
    else if (command === "quote") prefixSelectedLines(textarea, "> ");
    else if (command === "divider") insertText(textarea, "---", { block: true });
    else if (command === "code") {
      const selected = textarea.value.slice(textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0);
      if (selected.includes("\n")) wrapSelection(textarea, "```\n", "\n```", selected);
      else wrapSelection(textarea, "`", "`", isEnglish ? "code" : "代码");
    } else if (command === "link") {
      const start = textarea.selectionStart ?? 0;
      const selected = textarea.value.slice(start, textarea.selectionEnd ?? start) || (isEnglish ? "link text" : "链接文字");
      const inserted = `[${selected}](https://)`;
      textarea.setRangeText(inserted, start, textarea.selectionEnd ?? start, "end");
      textarea.focus();
      const urlStart = start + selected.length + 3;
      textarea.setSelectionRange(urlStart, urlStart + 8);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (command === "table") {
      insertText(textarea, `| ${isEnglish ? "Column 1" : "列 1"} | ${isEnglish ? "Column 2" : "列 2"} |\n| --- | --- |\n|  |  |`, { block: true });
    }
  }

  function locateMedia(language, item) {
    const textarea = fields[language].body;
    const token = `content-media://${item.id}`;
    const index = textarea.value.indexOf(token);
    if (index < 0) {
      insertText(textarea, mediaMarker(item), { block: true });
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(index, index + token.length);
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 30;
    textarea.scrollTop = Math.max(0, textarea.value.slice(0, index).split("\n").length * lineHeight - textarea.clientHeight / 2);
  }

  function removeMedia(item) {
    if (!window.confirm("从中英文草稿中移除这张图片？")) return;
    const markerPattern = new RegExp(`!?\\[[^\\]]*\\]\\(content-media:\\/\\/${item.id}\\)`, "g");
    media = media.filter((candidate) => candidate.id !== item.id);
    for (const language of ["zh", "en"]) {
      const textarea = fields[language].body;
      textarea.value = textarea.value.replace(markerPattern, "").replace(/\n{3,}/g, "\n\n");
      autoSize(textarea);
    }
    renderMedia();
    handleChange();
  }

  function renderMedia() {
    const total = `${media.length} 张 · ${formatBytes(mediaSize())}`;
    for (const language of ["zh", "en"]) {
      fields[language].mediaList.replaceChildren();
      fields[language].mediaSection.hidden = media.length === 0;
      fields[language].mediaTotal.textContent = total;
      for (const item of media) {
        const figure = document.createElement("figure");
        figure.className = "site-spark-writer__media-card";

        const locate = document.createElement("button");
        locate.type = "button";
        locate.title = "在正文中定位图片";
        locate.setAttribute("aria-label", `在正文中定位图片：${item.name}`);
        locate.addEventListener("click", () => locateMedia(language, item));
        const image = document.createElement("img");
        image.alt = "";
        image.decoding = "async";
        image.loading = "lazy";
        image.src = mediaSource(item);
        locate.append(image);

        const caption = document.createElement("figcaption");
        const name = document.createElement("strong");
        name.textContent = item.name;
        const size = document.createElement("span");
        size.textContent = formatBytes(item.size);
        caption.append(name, size);

        const remove = document.createElement("button");
        remove.className = "site-spark-writer__media-remove";
        remove.type = "button";
        remove.title = "移除图片";
        remove.setAttribute("aria-label", `移除图片：${item.name}`);
        remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        remove.addEventListener("click", () => removeMedia(item));
        remove.disabled = busy;

        figure.append(locate, caption, remove);
        fields[language].mediaList.append(figure);
      }
    }
    updateEditorMeta();
  }

  function randomMediaId() {
    const bytes = window.crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function decodeImage(file) {
    if (typeof window.createImageBitmap === "function") {
      const bitmap = await window.createImageBitmap(file);
      return { close: () => bitmap.close(), height: bitmap.height, source: bitmap, width: bitmap.width };
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return { close: () => URL.revokeObjectURL(url), height: image.naturalHeight, source: image, width: image.naturalWidth };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async function optimizeImage(file) {
    if (!allowedImageTypes.has(file.type)) {
      const error = new Error("只支持 JPEG、PNG、WebP 或 GIF 图片。");
      error.code = "invalid_image";
      throw error;
    }
    if (file.type === "image/gif" || file.size <= maximumImageBytes) {
      if (file.size > maximumImageBytes) {
        const error = new Error("单张图片优化后不能超过 1.5 MB。");
        error.code = "image_limit";
        throw error;
      }
      return { blob: file, height: 0, type: file.type, width: 0 };
    }

    const decoded = await decodeImage(file);
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("浏览器无法处理这张图片。");
      let scale = Math.min(1, 2048 / Math.max(decoded.width, decoded.height));
      for (const quality of [0.88, 0.78, 0.68, 0.58]) {
        canvas.width = Math.max(1, Math.round(decoded.width * scale));
        canvas.height = Math.max(1, Math.round(decoded.height * scale));
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
        const blob = await canvasBlob(canvas, "image/webp", quality);
        if (blob && blob.size <= maximumImageBytes) return { blob, height: canvas.height, type: "image/webp", width: canvas.width };
        scale *= 0.82;
      }
      const error = new Error("单张图片优化后不能超过 1.5 MB。");
      error.code = "image_limit";
      throw error;
    } finally {
      decoded.close();
    }
  }

  async function fileToMedia(file) {
    const optimized = await optimizeImage(file);
    const bytes = new Uint8Array(await optimized.blob.arrayBuffer());
    return {
      data: bytesToBase64(bytes),
      height: optimized.height,
      id: randomMediaId(),
      name:
        String(file.name || "image")
          .replace(/[\u0000-\u001f]/g, "")
          .slice(0, 120) || "image",
      size: bytes.length,
      type: optimized.type,
      width: optimized.width,
    };
  }

  async function addImages(language, files) {
    const candidates = Array.from(files || []).filter((file) => file?.type?.startsWith("image/"));
    if (!candidates.length) {
      setStatus("只支持 JPEG、PNG、WebP 或 GIF 图片。", "error");
      return;
    }
    if (media.length + candidates.length > maximumImageCount) {
      setStatus("每份内容最多插入 8 张图片。", "error");
      return;
    }
    setStatus("正在本地优化图片…");
    let inserted = 0;
    try {
      for (const file of candidates) {
        const item = await fileToMedia(file);
        if (mediaSize() + item.size > maximumMediaBytes) throw new Error("优化后的图片总量不能超过 5 MB。");
        media.push(item);
        insertText(fields[language].body, mediaMarker(item), { block: true });
        inserted += 1;
      }
      renderMedia();
      setStatus(`已在光标处插入 ${inserted} 张图片。`, "success");
    } catch (error) {
      renderMedia();
      setStatus(error.message || "无法插入图片。", "error");
    } finally {
      fields[language].imageInput.value = "";
    }
  }

  function selectLanguage(language, focus = false) {
    currentLanguage = language === "en" ? "en" : "zh";
    for (const candidate of ["zh", "en"]) {
      const selected = candidate === currentLanguage;
      fields[candidate].tab.setAttribute("aria-selected", String(selected));
      fields[candidate].panel.hidden = !selected;
    }
    if (focus) fields[currentLanguage].title.focus();
  }

  function draftStorageId(type = currentType) {
    return `content-creator:${repository}:${branch}:${type}`;
  }

  function readValues() {
    return {
      announce: elements.announce.checked,
      bodyEn: elements.bodyEn.value,
      bodyZh: elements.bodyZh.value,
      category: elements.category.value,
      comments: elements.comments.checked,
      date: elements.date.value,
      descriptionEn: elements.descriptionEn.value,
      descriptionZh: elements.descriptionZh.value,
      github: elements.github.value,
      media: media.map((item) => ({ ...item })),
      message: elements.message.value,
      slug: elements.slug.value,
      tags: elements.tags.value,
      titleEn: elements.titleEn.value,
      titleZh: elements.titleZh.value,
      type: currentType,
      url: elements.url.value,
    };
  }

  function formValues(values) {
    return {
      announce: values.announce,
      bodyEn: values.bodyEn,
      bodyZh: values.bodyZh,
      category: values.category,
      comments: values.comments,
      date: values.date,
      descriptionEn: values.descriptionEn,
      descriptionZh: values.descriptionZh,
      github: values.github,
      media: normalizedMedia(values.media),
      message: values.message,
      slug: values.slug,
      tags: values.tags,
      titleEn: values.titleEn,
      titleZh: values.titleZh,
      type: values.type,
      url: values.url,
    };
  }

  function serializeFormValues(values) {
    return JSON.stringify(formValues(values));
  }

  function writeValues(values) {
    media = normalizedMedia(values.media);
    elements.announce.checked = values.announce !== false;
    elements.bodyEn.value = values.bodyEn || "";
    elements.bodyZh.value = values.bodyZh || "";
    elements.category.value = values.category || (currentType === "tool" ? "fun" : currentType === "project" ? "work" : "");
    elements.comments.checked = values.comments !== false;
    elements.date.value = values.date || localDateTime();
    elements.descriptionEn.value = values.descriptionEn || "";
    elements.descriptionZh.value = values.descriptionZh || "";
    elements.github.value = values.github || "";
    elements.message.value = values.message || `content: add ${currentType}`;
    elements.slug.value = values.slug || defaultSlug(currentType);
    elements.tags.value = values.tags || "";
    elements.titleEn.value = values.titleEn || "";
    elements.titleZh.value = values.titleZh || "";
    elements.url.value = values.url || "";
    for (const language of ["zh", "en"]) autoSize(fields[language].body);
    renderMedia();
    updateCompletion();
  }

  async function restoreDraft() {
    try {
      await draftWritePromise.catch(() => undefined);
      const serialized = await window.functionhxGitHubAuth?.restoreOpaque?.({ id: draftStorageId() });
      const draft = JSON.parse(serialized || "null");
      if (!draft?.values || draft.values.type !== currentType) return false;
      writeValues(draft.values);
      slugIsAutomatic = draft.slugIsAutomatic !== false;
      return true;
    } catch (_error) {
      return false;
    }
  }

  async function persistDraft(showStatus = true) {
    try {
      if (!window.functionhxGitHubAuth?.saveOpaque) throw new Error("Encrypted device storage is unavailable.");
      await window.functionhxGitHubAuth.saveOpaque({
        id: draftStorageId(),
        value: JSON.stringify({ savedAt: new Date().toISOString(), slugIsAutomatic, values: readValues() }),
      });
      if (showStatus) {
        const coverNote = coverFile ? "；封面请在下次打开时重新选择" : "";
        setStatus(`草稿已加密保存在这台设备中${coverNote}。`, "success");
      }
      return true;
    } catch (_error) {
      if (showStatus) setStatus("无法在这台设备上加密保存草稿。", "error");
      return false;
    }
  }

  function saveDraft(showStatus = true) {
    draftWritePromise = draftWritePromise.catch(() => undefined).then(() => persistDraft(showStatus));
    return draftWritePromise;
  }

  function scheduleDraftSave() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => saveDraft(false), 350);
  }

  function handleChange() {
    updateCompletion();
    elements.result.hidden = true;
    scheduleDraftSave();
  }

  async function forgetDraft(type = currentType) {
    await window.functionhxGitHubAuth?.forgetOpaque?.({ id: draftStorageId(type) }).catch(() => undefined);
  }

  function configureType(type) {
    currentType = type;
    root.dataset.creatorType = type;
    elements.heading.textContent = elements.heading.dataset[`heading${type[0].toUpperCase()}${type.slice(1)}`] || "新建内容";
    elements.kind.textContent = `${typeLabels[type]} · 中文优先 · 修改会自动加密保存`;
    const isArticle = type === "article";
    const isCard = type === "tool" || type === "project";
    const isActivity = type === "activity";
    elements.tagsField.hidden = !isArticle;
    elements.categoryField.hidden = isActivity;
    elements.urlField.hidden = !isCard;
    elements.githubField.hidden = !isCard;
    elements.coverField.hidden = !isCard;
    elements.commentsField.hidden = !isArticle;
    elements.announceField.hidden = isActivity;
    elements.settingsLabel.textContent = type === "tool" ? "封面与链接 · 发布设置" : "发布设置";
    elements.bodyZh.placeholder = isActivity ? "写下这条动态，可使用 Markdown 链接……" : "从这里开始写……";
    elements.descriptionZh.placeholder = isActivity ? "动态摘要" : "一句话说明这是什么";
  }

  async function openCreator(type, trigger) {
    if (!typeLabels[type] || busy) return;
    if (!root.hidden && currentType !== type) await saveDraft(false);
    activeTrigger = trigger;
    previousScrollY = window.scrollY;
    configureType(type);
    coverFile = null;
    elements.cover.value = "";
    elements.coverName.textContent = "未选择封面";
    slugIsAutomatic = true;
    writeValues({
      announce: true,
      comments: true,
      date: localDateTime(),
      slug: defaultSlug(type),
      type,
    });
    elements.settings.open = type === "tool";
    elements.result.hidden = true;
    root.hidden = false;
    document.body.classList.add("site-content-creator-active");
    root.scrollIntoView({ block: "start" });
    const restored = await restoreDraft();
    baselineSnapshot = restored ? "" : serializeFormValues(readValues());
    selectLanguage("zh");
    setStatus(restored ? "已恢复这台设备上的加密草稿。" : "直接开始写；修改会自动加密保存在这台设备中。", restored ? "success" : "");
    window.requestAnimationFrame(() => elements.titleZh.focus());
  }

  function closeCreator() {
    if (busy) return;
    if (serializeFormValues(readValues()) === baselineSnapshot) forgetDraft();
    else saveDraft(false);
    root.hidden = true;
    document.body.classList.remove("site-content-creator-active");
    window.requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
    if (activeTrigger && typeof activeTrigger.focus === "function") activeTrigger.focus();
  }

  function parseList(value) {
    return String(value || "")
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  function plainSummary(body) {
    return String(body || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function normalizedUrl(value, label) {
    const text = String(value || "").trim();
    if (!text) return "";
    let parsed;
    try {
      parsed = new URL(text);
    } catch (_error) {
      throw new Error(`${label}不是有效网址。`);
    }
    if (!new Set(["https:", "http:"]).has(parsed.protocol)) throw new Error(`${label}只支持 HTTP 或 HTTPS。`);
    return parsed.href;
  }

  function validate(values, type, selectedCover) {
    if (!values.titleZh.trim() || !values.descriptionZh.trim()) {
      setStatus("请先填写中文标题和摘要。", "error");
      (values.titleZh.trim() ? elements.descriptionZh : elements.titleZh).focus();
      return false;
    }
    if (["article", "activity"].includes(type) && !values.bodyZh.trim()) {
      setStatus("请先填写中文正文。", "error");
      elements.bodyZh.focus();
      return false;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) {
      elements.settings.open = true;
      setStatus("网址短名只能包含小写字母、数字和连字符。", "error");
      elements.slug.focus();
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(values.date)) {
      elements.settings.open = true;
      setStatus("请选择有效的日期与时间。", "error");
      elements.date.focus();
      return false;
    }
    try {
      normalizedUrl(values.url, "公开网址");
      normalizedUrl(values.github, "GitHub 网址");
    } catch (error) {
      elements.settings.open = true;
      setStatus(error.message, "error");
      return false;
    }
    if (selectedCover && (!allowedCoverTypes.has(selectedCover.type) || selectedCover.size > maxCoverBytes)) {
      elements.settings.open = true;
      setStatus("封面必须是 WebP、PNG 或 JPEG，且不超过 5 MB。", "error");
      return false;
    }
    const mediaIds = new Set(values.media.map((item) => item.id));
    const referencedIds = [...`${values.bodyZh}\n${values.bodyEn}`.matchAll(/content-media:\/\/([a-f0-9]{16})/g)].map((match) => match[1]);
    if (referencedIds.some((id) => !mediaIds.has(id))) {
      setStatus("正文引用了一张已经移除的图片，请重新插入。", "error");
      return false;
    }
    return true;
  }

  function dateParts(value) {
    const date = value.slice(0, 10);
    return { date, year: date.slice(0, 4), jekyll: `${value.replace("T", " ")}:00 +0800` };
  }

  function englishLocalization(values, targetPath, options = {}) {
    const body = values.bodyEn.trim() || (options.allowDescriptionBody ? values.descriptionEn.trim() : "");
    const complete = values.titleEn.trim() && body;
    if (complete) {
      return {
        body,
        description: values.descriptionEn.trim() || plainSummary(values.bodyEn),
        title: values.titleEn.trim(),
      };
    }
    return {
      body: `> English translation pending. [Read the Chinese source](${targetPath}).`,
      description: "English translation pending. Read the Chinese source.",
      title: `Translation pending · ${values.titleZh.trim()}`,
    };
  }

  function sourceBlock(frontMatter, body) {
    return `${["---", ...frontMatter, "---", "", body.trimEnd(), ""].join("\n")}`;
  }

  function mediaDirectory(type, slug) {
    const section = type === "article" ? "posts" : type === "activity" ? "news" : type === "tool" ? "tools" : "projects";
    return `assets/img/${section}/${slug}`;
  }

  function mediaPath(type, slug, item) {
    return `${mediaDirectory(type, slug)}/${item.id}.${allowedImageTypes.get(item.type)}`;
  }

  function renderMediaMarkers(body, type, slug) {
    let rendered = String(body || "");
    for (const item of media) rendered = rendered.split(`content-media://${item.id}`).join(`/${mediaPath(type, slug, item)}`);
    return rendered;
  }

  function composeArticle(language, values) {
    const parts = dateParts(values.date);
    const zhPath = `/blog/${parts.year}/${values.slug}/`;
    const localized =
      language === "zh"
        ? { body: values.bodyZh.trim(), description: values.descriptionZh.trim(), title: values.titleZh.trim() }
        : englishLocalization(values, zhPath);
    localized.body = renderMediaMarkers(localized.body, "article", values.slug);
    const permalink = language === "zh" ? zhPath : `/en/blog/${parts.year}/${values.slug}/`;
    return sourceBlock(
      [
        "layout: post",
        `title: ${JSON.stringify(localized.title)}`,
        `slug: ${JSON.stringify(values.slug)}`,
        `date: ${parts.jekyll}`,
        "published: true",
        `announce: ${values.announce ? "true" : "false"}`,
        `description: ${JSON.stringify(localized.description)}`,
        `permalink: ${permalink}`,
        `lang: ${language}`,
        `locale: ${language}`,
        `translation_key: post-${values.slug}`,
        "kind: writing",
        `tags: ${JSON.stringify(parseList(values.tags))}`,
        `categories: ${JSON.stringify(parseList(values.category))}`,
        "related_posts: false",
        `giscus_comments: ${values.comments ? "true" : "false"}`,
      ],
      localized.body
    );
  }

  function composeCard(language, values, coverPath, type) {
    const isTool = type === "tool";
    const zhPath = `/${isTool ? "tools" : "projects"}/${values.slug}/`;
    const localized =
      language === "zh"
        ? {
            body: values.bodyZh.trim() || values.descriptionZh.trim(),
            description: values.descriptionZh.trim(),
            title: values.titleZh.trim(),
          }
        : englishLocalization(values, zhPath, { allowDescriptionBody: true });
    localized.body = renderMediaMarkers(localized.body, type, values.slug);
    const frontMatter = [
      "layout: page",
      `title: ${JSON.stringify(localized.title)}`,
      `description: ${JSON.stringify(localized.description)}`,
      `permalink: ${language === "zh" ? zhPath : `/en${zhPath}`}`,
    ];
    const url = normalizedUrl(values.url, "产品网址");
    const github = normalizedUrl(values.github, "GitHub 网址");
    if (url) frontMatter.push(`redirect: ${url}`);
    if (github) frontMatter.push(`github: ${github}`);
    frontMatter.push(
      `lang: ${language}`,
      `translation_key: ${values.slug}`,
      `kind: ${type}`,
      "importance: 99",
      `category: ${JSON.stringify(values.category.trim() || (isTool ? "fun" : "work"))}`
    );
    if (coverPath) frontMatter.push(`img: ${coverPath}`);
    return sourceBlock(frontMatter, localized.body);
  }

  function composeActivity(language, values, options = {}) {
    const parts = dateParts(values.date);
    const zhPath = options.link || `/news/${values.slug}/`;
    const localized =
      language === "zh"
        ? { body: options.zhBody || values.bodyZh.trim(), title: options.zhTitle || values.titleZh.trim() }
        : values.titleEn.trim() && values.bodyEn.trim()
          ? { body: options.enBody || values.bodyEn.trim(), title: options.enTitle || values.titleEn.trim() }
          : {
              body: options.enBody || `English translation pending. [Read the Chinese update](${zhPath}).`,
              title: options.enTitle || `Translation pending · ${values.titleZh.trim()}`,
            };
    localized.body = renderMediaMarkers(localized.body, "activity", values.slug);
    return sourceBlock(
      [
        "layout: post",
        `title: ${JSON.stringify(localized.title)}`,
        `date: ${parts.date}`,
        "inline: true",
        "related_posts: false",
        `lang: ${language}`,
        `translation_key: news-${options.key || values.slug}`,
        `permalink: ${language === "zh" ? `/news/${options.key || values.slug}/` : `/en/news/${options.key || values.slug}/`}`,
      ],
      localized.body
    );
  }

  function sourceEntries(type, values, coverPath) {
    const parts = dateParts(values.date);
    if (type === "article") {
      const prefix = `_posts/${parts.date}-${values.slug}`;
      return [
        { content: composeArticle("zh", values), path: `${prefix}-zh.md` },
        { content: composeArticle("en", values), path: `${prefix}-en.md` },
      ];
    }
    if (type === "activity") {
      const prefix = `_news/${parts.date}-${values.slug}`;
      return [
        { content: composeActivity("zh", values), path: `${prefix}-zh.md` },
        { content: composeActivity("en", values), path: `${prefix}-en.md` },
      ];
    }

    const entries = [
      { content: composeCard("zh", values, coverPath, type), path: `_projects/${values.slug}-zh.md` },
      { content: composeCard("en", values, coverPath, type), path: `_projects/${values.slug}-en.md` },
    ];
    if (values.announce) {
      const destination = `/${type === "tool" ? "tools" : "projects"}/${values.slug}/`;
      const key = `${values.slug}-launched`;
      const zhLabel = type === "tool" ? "工具" : "项目";
      const enLabel = type === "tool" ? "tool" : "project";
      const newsPrefix = `_news/${parts.date}-${key}`;
      entries.push(
        {
          content: composeActivity("zh", values, {
            key,
            link: destination,
            zhBody: `[${values.titleZh.trim()}](${destination}) 已加入${zhLabel}页。`,
            zhTitle: `${values.titleZh.trim()}上线`,
          }),
          path: `${newsPrefix}-zh.md`,
        },
        {
          content: composeActivity("en", values, {
            enBody: `[${values.titleEn.trim() || values.titleZh.trim()}](/en${destination}) is now listed on the ${enLabel} page.`,
            enTitle: `${values.titleEn.trim() || values.titleZh.trim()} is live`,
            key,
            link: destination,
          }),
          path: `${newsPrefix}-en.md`,
        }
      );
    }
    return entries;
  }

  function encodePath(path) {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  async function githubRequest(endpoint, options = {}) {
    const headers = {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await window.fetch(`https://api.github.com${endpoint}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      headers,
      method: options.method || "GET",
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404 && options.allowNotFound) return null;
    if (!response.ok) {
      const error = new Error(payload.message || `GitHub API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function restoreGitHubSession() {
    const session = await window.functionhxGitHubAuth?.restore({ owner, repository }).catch(() => null);
    activeToken = session?.token || "";
    elements.connect.innerHTML = activeToken
      ? '<i class="fa-brands fa-github" aria-hidden="true"></i> @Functionhx 已连接'
      : '<i class="fa-solid fa-gear" aria-hidden="true"></i> 站长连接';
    return session;
  }

  function openConnection() {
    setStatus("请先在“站点设置 → 站长设置”中连接 @Functionhx。", "error");
    const settingsToggle = document.getElementById("site-settings-toggle");
    if (settingsToggle) settingsToggle.click();
  }

  function createCommitIntent(type, values, selectedCover) {
    const frozenValues = Object.freeze(formValues({ ...values, type }));
    let cover = null;
    if (selectedCover) {
      const extension = allowedCoverTypes.get(selectedCover.type);
      const directory = type === "tool" ? "tools" : "projects";
      cover = Object.freeze({
        file: selectedCover,
        path: `assets/img/${directory}/${frozenValues.slug}-cover.${extension}`,
      });
    }
    const sources = Object.freeze(
      sourceEntries(type, frozenValues, cover?.path || "").map((entry) => Object.freeze({ content: entry.content, path: entry.path }))
    );
    const mediaFiles = Object.freeze(
      frozenValues.media.map((item) =>
        Object.freeze({
          data: item.data,
          path: mediaPath(type, frozenValues.slug, item),
        })
      )
    );
    return Object.freeze({
      branch,
      cover,
      mediaFiles,
      message: frozenValues.message.trim() || `content: add ${type} "${frozenValues.slug}"`,
      repository,
      sources,
      type,
      values: frozenValues,
    });
  }

  async function createCoverBlob(file, snapshot) {
    const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const blob = await githubRequest(`/repos/${snapshot.repository}/git/blobs`, {
      body: { content, encoding: "base64" },
      method: "POST",
      token: snapshot.token,
    });
    if (!blob.sha) throw new Error("GitHub 未返回封面文件标识。");
    return blob.sha;
  }

  async function createMediaBlob(item, snapshot) {
    const blob = await githubRequest(`/repos/${snapshot.repository}/git/blobs`, {
      body: { content: item.data, encoding: "base64" },
      method: "POST",
      token: snapshot.token,
    });
    if (!blob.sha) throw new Error("GitHub 未返回正文图片文件标识。");
    return blob.sha;
  }

  async function ensurePathsAvailable(entries, headSha, snapshot) {
    const collisions = await Promise.all(
      entries.map((entry) =>
        githubRequest(`/repos/${snapshot.repository}/contents/${encodePath(entry.path)}?ref=${encodeURIComponent(headSha)}`, {
          allowNotFound: true,
          token: snapshot.token,
        })
      )
    );
    if (collisions.some(Boolean)) throw new Error("同名内容已经存在，请修改网址短名。 ");
  }

  async function createCommit(snapshot) {
    const head = await githubRequest(`/repos/${snapshot.repository}/git/ref/heads/${encodeURIComponent(snapshot.branch)}`, {
      token: snapshot.token,
    });
    const headSha = head.object?.sha;
    if (!headSha) throw new Error("无法读取 main 分支。");
    const parent = await githubRequest(`/repos/${snapshot.repository}/git/commits/${headSha}`, { token: snapshot.token });
    const baseTree = parent.tree?.sha;
    if (!baseTree) throw new Error("无法读取 main 分支文件树。");

    const coverEntry = snapshot.cover ? { mode: "100644", path: snapshot.cover.path, type: "blob" } : null;
    const mediaEntries = snapshot.mediaFiles.map((item) => ({ mode: "100644", path: item.path, type: "blob" }));
    await ensurePathsAvailable([...snapshot.sources, ...(coverEntry ? [coverEntry] : []), ...mediaEntries], headSha, snapshot);
    if (coverEntry) coverEntry.sha = await createCoverBlob(snapshot.cover.file, snapshot);
    await Promise.all(
      mediaEntries.map(async (entry, index) => {
        entry.sha = await createMediaBlob(snapshot.mediaFiles[index], snapshot);
      })
    );

    const treeEntries = snapshot.sources.map((entry) => ({ content: entry.content, mode: "100644", path: entry.path, type: "blob" }));
    if (coverEntry) treeEntries.push(coverEntry);
    treeEntries.push(...mediaEntries);
    const tree = await githubRequest(`/repos/${snapshot.repository}/git/trees`, {
      body: { base_tree: baseTree, tree: treeEntries },
      method: "POST",
      token: snapshot.token,
    });
    const commit = await githubRequest(`/repos/${snapshot.repository}/git/commits`, {
      body: {
        message: snapshot.message,
        parents: [headSha],
        tree: tree.sha,
      },
      method: "POST",
      token: snapshot.token,
    });
    await githubRequest(`/repos/${snapshot.repository}/git/refs/heads/${encodeURIComponent(snapshot.branch)}`, {
      body: { force: false, sha: commit.sha },
      method: "PATCH",
      token: snapshot.token,
    });
    return commit;
  }

  async function commitContent() {
    if (busy) return;
    setBusy(true);
    const type = currentType;
    const values = Object.freeze(formValues({ ...readValues(), type }));
    const selectedCover = coverFile;
    try {
      if (!validate(values, type, selectedCover)) return;
      const intent = createCommitIntent(type, values, selectedCover);
      await restorePromise;
      const token = activeToken;
      if (!token) {
        openConnection();
        return;
      }
      const snapshot = Object.freeze({ ...intent, token });

      setStatus("正在创建双语内容与 Commit…");
      elements.result.hidden = true;
      const commit = await createCommit(snapshot);
      await forgetDraft(snapshot.type);
      baselineSnapshot = serializeFormValues(snapshot.values);
      if (serializeFormValues(readValues()) !== baselineSnapshot) await saveDraft(false);
      setStatus("已创建 Commit；发布进度会显示在页面右下角。", "success");
      if (commit.html_url) {
        elements.result.href = commit.html_url;
        elements.result.textContent = "在 GitHub 查看 Commit →";
        elements.result.hidden = false;
      }
      window.functionhxDeployment?.watch(commit);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        activeToken = "";
        window.functionhxOwnerUi?.setVerified?.(false);
      }
      setStatus(`无法创建内容。${error.message || ""}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function translateChinese() {
    if (!elements.titleZh.value.trim() || !elements.bodyZh.value.trim()) {
      setStatus("请先填写中文标题和正文。", "error");
      elements.titleZh.focus();
      return;
    }
    if (
      (elements.titleEn.value.trim() || elements.descriptionEn.value.trim() || elements.bodyEn.value.trim()) &&
      !window.confirm("用新的 DeepSeek 翻译覆盖当前英文稿？")
    ) {
      return;
    }
    if (!window.functionhxDeepSeek?.translate) {
      setStatus("翻译工具尚未载入。", "error");
      return;
    }

    elements.translate.disabled = true;
    setStatus("正在等待 DeepSeek 翻译中文稿…");
    try {
      const translated = await window.functionhxDeepSeek.translate({
        body: elements.bodyZh.value,
        summary: elements.descriptionZh.value,
        title: elements.titleZh.value,
      });
      elements.titleEn.value = translated.title;
      elements.descriptionEn.value = translated.summary;
      elements.bodyEn.value = translated.body;
      if (slugIsAutomatic) {
        const generated = slugify(translated.title);
        if (generated) elements.slug.value = generated;
      }
      autoSize(elements.bodyEn);
      selectLanguage("en");
      handleChange();
      setStatus("英文译稿已生成，请检查后再提交。", "success");
    } catch (error) {
      if (error.name === "AbortError") setStatus("已取消翻译，中文稿保持不变。");
      else setStatus(`无法生成英文译稿。${error.message || ""}`, "error");
    } finally {
      elements.translate.disabled = false;
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const trigger = event.target.closest("[data-author-action]");
      const type = actionTypes.get(trigger?.dataset.authorAction || "");
      if (!type) return;
      if (busy) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setStatus("当前 Commit 完成前不能切换创作类型。");
        return;
      }
      openCreator(type, trigger);
    },
    true
  );

  elements.close.addEventListener("click", closeCreator);
  elements.commit.addEventListener("click", commitContent);
  elements.connect.addEventListener("click", async () => {
    await restorePromise;
    if (activeToken) setStatus("已连接为 @Functionhx，可以直接创建 Commit。", "success");
    else openConnection();
  });
  elements.draft.addEventListener("click", () => saveDraft(true));
  elements.translate.addEventListener("click", translateChinese);
  fields.zh.tab.addEventListener("click", () => selectLanguage("zh", true));
  fields.en.tab.addEventListener("click", () => selectLanguage("en", true));

  for (const language of ["zh", "en"]) {
    fields[language].editor.addEventListener("click", (event) => {
      const command = event.target.closest("[data-content-command]")?.dataset.contentCommand;
      if (command && !busy) runEditorCommand(language, command);
    });
    fields[language].imageInput.addEventListener("change", () => addImages(language, fields[language].imageInput.files));
    fields[language].body.addEventListener("paste", (event) => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      addImages(language, files);
    });
    fields[language].dropzone.addEventListener("dragenter", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      fields[language].dropzone.dataset.dragging = "true";
    });
    fields[language].dropzone.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      fields[language].dropzone.dataset.dragging = "true";
    });
    fields[language].dropzone.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && fields[language].dropzone.contains(event.relatedTarget)) return;
      delete fields[language].dropzone.dataset.dragging;
    });
    fields[language].dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      delete fields[language].dropzone.dataset.dragging;
      addImages(language, Array.from(event.dataTransfer?.files || []));
    });
    fields[language].body.addEventListener("input", () => {
      autoSize(fields[language].body);
      handleChange();
    });
    fields[language].title.addEventListener("input", handleChange);
    fields[language].description.addEventListener("input", handleChange);
  }

  window.addEventListener("dragend", () => {
    for (const language of ["zh", "en"]) delete fields[language].dropzone.dataset.dragging;
  });

  for (const control of root.querySelectorAll(".site-content-creator__settings input, .site-content-creator__settings textarea")) {
    control.addEventListener("input", handleChange);
    control.addEventListener("change", handleChange);
  }

  elements.cover.addEventListener("change", () => {
    coverFile = elements.cover.files?.[0] || null;
    elements.coverName.textContent = coverFile ? `${coverFile.name} · ${(coverFile.size / 1024 / 1024).toFixed(2)} MB` : "未选择封面";
    if (coverFile && (!allowedCoverTypes.has(coverFile.type) || coverFile.size > maxCoverBytes)) {
      setStatus("封面必须是 WebP、PNG 或 JPEG，且不超过 5 MB。", "error");
    }
  });

  elements.slug.addEventListener("input", () => {
    slugIsAutomatic = false;
    elements.slug.value = slugify(elements.slug.value);
  });
  elements.titleZh.addEventListener("input", () => {
    if (!slugIsAutomatic) return;
    const generated = slugify(elements.titleZh.value);
    if (generated) elements.slug.value = generated;
  });
  elements.titleEn.addEventListener("input", () => {
    if (!slugIsAutomatic) return;
    const generated = slugify(elements.titleEn.value);
    if (generated) elements.slug.value = generated;
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !root.hidden && !document.querySelector("dialog[open]")) {
        if (busy) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setStatus("Commit 进行中，完成后才能关闭创作区。");
          return;
        }
        closeCreator();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !root.hidden && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        commitContent();
      }
    },
    true
  );

  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (String(event.detail?.repository || "").toLowerCase() !== repository.toLowerCase()) return;
    restorePromise = restoreGitHubSession();
  });

  restorePromise = restoreGitHubSession();
})();
